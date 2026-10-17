/**
 * Zero-dependency single-file bundler for the Aliyun ESA edge function.
 *
 * ESA accepts exactly one JavaScript file (4 MB) with no module resolution and
 * no environment-variable binding, so this script:
 *   1. walks the ESM graph starting from `es/entry.mjs`,
 *   2. drops `import` statements and `export` keywords,
 *   3. concatenates the modules in dependency order (dependencies first),
 *   4. injects the deployment config as `const ESA_BUILD_ENV = {...}`.
 *
 * It deliberately fails loudly on duplicate top-level declarations, which is
 * the main way a naive concatenation breaks.
 *
 * Usage:
 *   node scripts/build-esa.mjs                       # uses es/env.json if present
 *   node scripts/build-esa.mjs --env es/env.json --out es/dist/edge.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** ESA rejects code packages over 4 MB. */
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

/**
 * Configuration keys that are allowed to be baked into the bundle.
 * A Pages build supplies these as build-time environment variables, so they
 * never have to be committed.
 */
export const ENV_KEYS = [
  'STORAGE',
  'ESA_KV_NAMESPACE',
  'BASE_URL',
  'PAGE_TITLE',
  'PAGE_ICON',
  'PAGE_DESC',
  'CORS_MODE',
  'CORS_ORIGINS',
  'RL_WINDOW_SEC',
  'RL_MAX_REQ',
  'CODE_LENGTH',
  'DEDUP_TTL_SEC',
  'CREATE_TOKEN',
  'BLOCK_HOSTS',
  'LOCAL_CACHE_TTL_SEC',
];

const ENV_PREFIXES = ['UPSTASH_', 'OSS_', 'KV_REST_'];

/** Pick known configuration keys out of a process environment. */
export function pickEnvFromProcess(source = process.env) {
  const picked = {};

  for (const key of ENV_KEYS) {
    const value = source?.[key];
    if (typeof value === 'string' && value !== '') picked[key] = value;
  }

  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value !== 'string' || value === '') continue;
    if (ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) picked[key] = value;
  }

  return picked;
}

const IMPORT_SPECIFIER = /from\s*['"](\.[^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^import\s*['"](\.[^'"]+)['"]/gm;
const TOP_LEVEL_DECLARATION = /^(?:export\s+)?(?:async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

/** Collect relative import specifiers from one module. */
function collectImports(source) {
  const specs = new Set();
  for (const match of source.matchAll(IMPORT_SPECIFIER)) specs.add(match[1]);
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) specs.add(match[1]);
  return [...specs];
}

/** Remove `import ...` statements, including multi-line named imports. */
function stripImports(source) {
  const lines = source.split(/\r?\n/);
  const out = [];
  let skipping = false;

  for (const line of lines) {
    if (skipping) {
      if (/from\s*['"][^'"]+['"]\s*;?\s*$/.test(line)) skipping = false;
      continue;
    }

    if (/^import\b/.test(line)) {
      const singleLine = /from\s*['"][^'"]+['"]\s*;?\s*$/.test(line)
        || /^import\s*['"][^'"]+['"]\s*;?\s*$/.test(line);
      if (!singleLine) skipping = true;
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

/** Drop `export` keywords; `export default` is preserved for the entry module. */
function stripExports(source, { keepDefault }) {
  let out = source
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^export\s+(async\s+function|function|class|const|let|var)\b/gm, '$1');

  if (!keepDefault) out = out.replace(/^export\s+default\s+/gm, '');
  return out;
}

/** Top-level declared names, used to detect unsafe concatenation. */
function topLevelNames(source) {
  const names = [];
  for (const match of source.matchAll(TOP_LEVEL_DECLARATION)) names.push(match[1]);
  return names;
}

/** Depth-first walk producing dependency-first module order. */
function collectModules(entryFile) {
  const state = new Map();
  const order = [];

  function visit(file) {
    const status = state.get(file);
    if (status === 'done' || status === 'visiting') return;
    state.set(file, 'visiting');

    const source = fs.readFileSync(file, 'utf8');
    for (const spec of collectImports(source)) {
      visit(path.resolve(path.dirname(file), spec));
    }

    state.set(file, 'done');
    order.push({ file, source });
  }

  visit(path.resolve(entryFile));
  return order;
}

/**
 * Build the bundle without touching the filesystem output.
 *
 * Configuration precedence: `process.env` (whitelisted keys only, so a Pages
 * build can supply secrets) overrides the values from `esa/env.json`.
 *
 * @param {{entry?: string, root?: string, env?: Record<string, string>,
 *          useProcessEnv?: boolean, processEnv?: Record<string, string|undefined>,
 *          banner?: string}} [options]
 * @returns {{code: string, modules: string[], bytes: number, env: Record<string, string>}}
 */
export function buildEsaBundle(options = {}) {
  const root = options.root ?? ROOT;
  const entryFile = path.resolve(options.entry ?? path.join(root, 'esa', 'entry.mjs'));

  const env = {
    ...(options.env ?? {}),
    ...(options.useProcessEnv === false ? {} : pickEnvFromProcess(options.processEnv ?? process.env)),
  };

  const modules = collectModules(entryFile);
  const entryResolved = path.resolve(entryFile);

  const declaredIn = new Map();
  const problems = [];
  const chunks = [];

  for (const { file, source } of modules) {
    const relative = path.relative(root, file).split(path.sep).join('/');

    for (const name of topLevelNames(source)) {
      const owner = declaredIn.get(name);
      if (owner && owner !== relative) {
        problems.push(`duplicate top-level declaration "${name}" in ${owner} and ${relative}`);
      } else {
        declaredIn.set(name, relative);
      }
    }

    const body = stripExports(stripImports(source), { keepDefault: file === entryResolved }).trimEnd();
    chunks.push(`// ---------------------------------------------------------------- ${relative}\n${body}`);
  }

  if (problems.length > 0) {
    throw new Error(`ESA bundling failed:\n  - ${problems.join('\n  - ')}`);
  }

  const banner = options.banner
    ?? '/* Generated by scripts/build-esa.mjs - do not edit. Source of truth: src/ + esa/entry.mjs */';

  const code = [
    banner,
    `const ESA_BUILD_ENV = ${JSON.stringify(env)};`,
    chunks.join('\n\n'),
    '',
  ].join('\n\n');

  const leftovers = code.match(/^export\s+(?!default\b)\w/gm);
  if (leftovers) {
    throw new Error(`ESA bundling failed: leftover export statements (${leftovers.join(', ')})`);
  }

  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > MAX_BUNDLE_BYTES) {
    throw new Error(`ESA bundling failed: bundle is ${bytes} bytes, over the 4 MB ESA limit`);
  }

  return {
    code,
    modules: modules.map(({ file }) => path.relative(root, file).split(path.sep).join('/')),
    bytes,
    env,
  };
}

/** Parse `--flag value` style arguments. */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object of environment variables`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(ROOT, String(args.env ?? 'esa/env.json'));
  const outPath = path.resolve(ROOT, String(args.out ?? 'esa/dist/edge.js'));

  const fileEnv = readEnvFile(envPath);
  const { code, modules, bytes, env } = buildEsaBundle({ env: fileEnv });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code, 'utf8');

  const keys = Object.keys(env);
  console.log(`[build:esa] ${modules.length} modules -> ${path.relative(ROOT, outPath)} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`[build:esa] config keys baked in: ${keys.length ? keys.join(', ') : '(none)'}`);

  if (keys.length === 0) {
    console.warn(`[build:esa] no configuration found: copy esa/env.example.json to esa/env.json,`);
    console.warn('[build:esa] or set the variables as Pages build environment variables.');
  }
  console.log('[build:esa] paste that file into the ESA console, or let the Pages build use it as `entry`');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[build:esa] ${error.message}`);
    process.exitCode = 1;
  }
}
