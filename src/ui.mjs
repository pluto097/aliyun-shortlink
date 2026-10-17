/**
 * Landing page, 404 page and their assets.
 *
 * The page is rendered as a single self-contained HTML string: no external
 * stylesheet, font or script, so the exact same markup works behind Cloudflare
 * Pages and Aliyun Function Compute, and the first paint needs one request.
 */

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
:root {
  --bg-1: #eef2ff; --bg-2: #f8fafc;
  --accent: #4f46e5; --accent-2: #0ea5e9;
  --card: rgba(255, 255, 255, 0.72);
  --card-border: rgba(255, 255, 255, 0.65);
  --text: #0f172a; --muted: #64748b;
  --field: rgba(255, 255, 255, 0.88);
  --field-border: rgba(15, 23, 42, 0.12);
  --ok-bg: rgba(5, 150, 105, 0.10);
  --ok-border: rgba(5, 150, 105, 0.35);
  --error: #dc2626;
  --shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.35);
}
[data-theme="dark"] {
  --bg-1: #0b1020; --bg-2: #05070f;
  --accent: #818cf8; --accent-2: #38bdf8;
  --card: rgba(17, 24, 39, 0.68);
  --card-border: rgba(148, 163, 184, 0.18);
  --text: #e5e7eb; --muted: #94a3b8;
  --field: rgba(15, 23, 42, 0.62);
  --field-border: rgba(148, 163, 184, 0.22);
  --ok-bg: rgba(16, 185, 129, 0.12);
  --ok-border: rgba(16, 185, 129, 0.35);
  --error: #f87171;
  --shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.72);
}
html { color-scheme: light dark; }
body {
  margin: 0; min-height: 100dvh; padding: 24px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background:
    radial-gradient(1100px 560px at 8% -12%, rgba(79, 70, 229, 0.22), transparent 62%),
    radial-gradient(880px 480px at 112% 8%, rgba(14, 165, 233, 0.20), transparent 58%),
    linear-gradient(160deg, var(--bg-1), var(--bg-2));
  transition: background-color 0.3s ease;
}
.card {
  width: 100%; max-width: 560px;
  background: var(--card); border: 1px solid var(--card-border);
  border-radius: 24px; padding: 32px;
  box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
}
.brand { display: flex; gap: 14px; align-items: center; margin-bottom: 24px; }
.brand .logo {
  font-size: 30px; line-height: 1; width: 56px; height: 56px; flex: 0 0 56px;
  display: grid; place-items: center; border-radius: 18px;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.18), rgba(14, 165, 233, 0.18));
  border: 1px solid var(--card-border);
}
h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
.desc { margin: 4px 0 0; font-size: 13.5px; color: var(--muted); }
form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
input {
  width: 100%; padding: 13px 14px; font-size: 15px; color: var(--text);
  background: var(--field); border: 1px solid var(--field-border);
  border-radius: 14px; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.14); }
button { font: inherit; cursor: pointer; border: 0; }
.submit {
  padding: 14px 18px; font-size: 15px; font-weight: 600; color: #fff;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 12px 26px -12px rgba(79, 70, 229, 0.85);
  transition: transform 0.12s ease, filter 0.12s ease;
}
.submit:hover { filter: brightness(1.05); }
.submit:active { transform: translateY(1px); }
.submit[disabled] { opacity: 0.65; cursor: progress; }
.advanced summary { cursor: pointer; font-size: 13px; color: var(--muted); user-select: none; }
.advanced summary:hover { color: var(--text); }
.advanced .inner { display: grid; gap: 14px; padding-top: 14px; }
.result {
  margin-top: 18px; padding: 14px; border-radius: 16px;
  background: var(--ok-bg); border: 1px solid var(--ok-border);
  display: flex; gap: 10px; align-items: center; justify-content: space-between;
}
.result a {
  color: var(--accent); text-decoration: none; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.result a:hover { text-decoration: underline; }
.copy {
  flex: 0 0 auto; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 600;
  color: var(--text); background: var(--field); border: 1px solid var(--field-border);
}
.copy:hover { filter: brightness(0.97); }
.error { margin: 0; font-size: 13px; color: var(--error); }
footer {
  margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--field-border);
  display: flex; gap: 10px; align-items: center; justify-content: flex-end;
}
footer .icon {
  width: 38px; height: 38px; border-radius: 12px; font-size: 16px;
  background: var(--field); border: 1px solid var(--field-border); color: var(--text);
  display: grid; place-items: center;
}
select {
  padding: 9px 10px; border-radius: 12px; font-size: 13px; color: var(--text);
  background: var(--field); border: 1px solid var(--field-border); outline: none;
}
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 12px);
  padding: 11px 18px; border-radius: 999px; font-size: 13.5px;
  background: rgba(15, 23, 42, 0.92); color: #fff;
  opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.center { text-align: center; }
.big { font-size: 64px; font-weight: 800; letter-spacing: -0.04em; margin: 0;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.back { display: inline-block; margin-top: 18px; color: var(--accent); text-decoration: none; font-weight: 600; }
.back:hover { text-decoration: underline; }
@media (max-width: 480px) {
  .card { padding: 22px; border-radius: 20px; }
  h1 { font-size: 19px; }
}
`;

const I18N = {
  'zh-CN': {
    htmlLang: 'zh-CN',
    urlLabel: '长链接',
    urlPlaceholder: 'https://example.com/very/long/path',
    advanced: '高级选项（自定义短码 / 访问口令）',
    codeLabel: '自定义短码（可选）',
    codePlaceholder: '例如 hello （3-64 位字母数字与 - _）',
    tokenLabel: '创建口令',
    tokenPlaceholder: '输入创建口令',
    create: '生成短链接',
    creating: '生成中…',
    copy: '复制',
    copied: '已复制到剪贴板',
    resultHint: '短链接已生成',
    theme: '切换主题',
    errInvalidUrl: '请输入合法的 http/https 链接',
    errRateLimited: '请求过于频繁，请稍后再试',
    errUnauthorized: '创建口令不正确',
    errConflict: '该短码已被占用，请换一个',
    errBadCode: '短码只能由 3-64 位字母、数字、- 和 _ 组成，且不能是保留字',
    errTooLong: '链接过长',
    errBlocked: '该域名不被允许',
    errNetwork: '网络异常，请稍后重试',
    errGeneric: '生成失败，请稍后重试',
    notFoundTitle: '链接不存在',
    notFoundDesc: '这个短码没有对应的链接，可能已过期或被删除。',
    backHome: '返回首页',
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    urlLabel: '長連結',
    urlPlaceholder: 'https://example.com/very/long/path',
    advanced: '進階選項（自訂短碼 / 存取口令）',
    codeLabel: '自訂短碼（選填）',
    codePlaceholder: '例如 hello （3-64 位字母數字與 - _）',
    tokenLabel: '建立口令',
    tokenPlaceholder: '輸入建立口令',
    create: '產生短連結',
    creating: '產生中…',
    copy: '複製',
    copied: '已複製到剪貼簿',
    resultHint: '短連結已產生',
    theme: '切換主題',
    errInvalidUrl: '請輸入合法的 http/https 連結',
    errRateLimited: '請求過於頻繁，請稍後再試',
    errUnauthorized: '建立口令不正確',
    errConflict: '該短碼已被佔用，請換一個',
    errBadCode: '短碼只能由 3-64 位字母、數字、- 和 _ 組成，且不能是保留字',
    errTooLong: '連結過長',
    errBlocked: '該網域不被允許',
    errNetwork: '網路異常，請稍後重試',
    errGeneric: '產生失敗，請稍後重試',
    notFoundTitle: '連結不存在',
    notFoundDesc: '這個短碼沒有對應的連結，可能已過期或被刪除。',
    backHome: '返回首頁',
  },
  en: {
    htmlLang: 'en',
    urlLabel: 'Long URL',
    urlPlaceholder: 'https://example.com/very/long/path',
    advanced: 'Advanced (custom code / access token)',
    codeLabel: 'Custom code (optional)',
    codePlaceholder: 'e.g. hello (3-64 letters, digits, - or _)',
    tokenLabel: 'Create token',
    tokenPlaceholder: 'Enter the create token',
    create: 'Shorten',
    creating: 'Shortening…',
    copy: 'Copy',
    copied: 'Copied to clipboard',
    resultHint: 'Your short link is ready',
    theme: 'Toggle theme',
    errInvalidUrl: 'Please enter a valid http/https URL',
    errRateLimited: 'Too many requests, please try again later',
    errUnauthorized: 'Invalid create token',
    errConflict: 'That code is already taken, please pick another',
    errBadCode: 'Codes are 3-64 characters of letters, digits, - or _, and cannot be reserved',
    errTooLong: 'The URL is too long',
    errBlocked: 'This host is not allowed',
    errNetwork: 'Network error, please try again',
    errGeneric: 'Something went wrong, please try again',
    notFoundTitle: 'Link not found',
    notFoundDesc: 'No link matches this code. It may have expired or been deleted.',
    backHome: 'Back to home',
  },
};

/** Escape a value for safe interpolation into HTML text or an attribute. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize a value for inline <script> use, neutralising `</script>`. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

const CLIENT_JS = `
(function () {
  var I18N = window.__I18N__;
  var HAS_TOKEN = window.__HAS_TOKEN__ === true;
  var STORE_KEY = 'shortlink.';

  var el = {
    form: document.getElementById('form'),
    url: document.getElementById('url'),
    code: document.getElementById('code'),
    token: document.getElementById('token'),
    tokenField: document.getElementById('tokenField'),
    submit: document.getElementById('submit'),
    error: document.getElementById('error'),
    result: document.getElementById('result'),
    shortUrl: document.getElementById('shortUrl'),
    copy: document.getElementById('copy'),
    theme: document.getElementById('theme'),
    lang: document.getElementById('lang'),
    toast: document.getElementById('toast')
  };

  function detectLang() {
    var saved = read('lang');
    if (saved && I18N[saved]) return saved;
    var nav = (navigator.language || 'en').toLowerCase();
    if (nav.indexOf('zh-tw') === 0 || nav.indexOf('zh-hk') === 0 || nav.indexOf('zh-hant') === 0) return 'zh-TW';
    if (nav.indexOf('zh') === 0) return 'zh-CN';
    return 'en';
  }

  function read(key) {
    try { return localStorage.getItem(STORE_KEY + key); } catch (e) { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(STORE_KEY + key, value); } catch (e) { /* private mode */ }
  }

  function detectTheme() {
    var saved = read('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (el.theme) el.theme.setAttribute('title', I18N[currentLang()].theme);
  }

  function currentLang() {
    var nav = (document.documentElement.lang || 'en');
    return I18N[nav] ? nav : 'en';
  }

  function applyLang(lang) {
    var dict = I18N[lang] || I18N.en;
    currentLangValue = lang;
    document.documentElement.lang = dict.htmlLang;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      var attr = nodes[i].getAttribute('data-i18n-attr');
      if (dict[key]) {
        if (attr) nodes[i].setAttribute(attr, dict[key]);
        else nodes[i].textContent = dict[key];
      }
    }
    if (el.lang) el.lang.value = lang;
    if (el.theme) el.theme.setAttribute('title', dict.theme);
    write('lang', lang);
  }

  var currentLangValue = detectLang();

  function toast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.className = 'toast show';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.toast.className = 'toast'; }, 1800);
  }

  function showError(code) {
    var dict = I18N[currentLangValue] || I18N.en;
    var map = {
      missing_url: 'errInvalidUrl',
      invalid_url: 'errInvalidUrl',
      url_too_long: 'errTooLong',
      blocked_host: 'errBlocked',
      rate_limited: 'errRateLimited',
      unauthorized: 'errUnauthorized',
      code_taken: 'errConflict',
      invalid_code: 'errBadCode',
      reserved_code: 'errBadCode',
      invalid_json: 'errGeneric',
      invalid_form: 'errGeneric'
    };
    var key = map[code] || 'errGeneric';
    el.error.textContent = dict[key];
    el.error.hidden = false;
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = '';
  }

  function setBusy(busy) {
    el.submit.disabled = busy;
    el.submit.textContent = busy ? (I18N[currentLangValue] || I18N.en).creating : (I18N[currentLangValue] || I18N.en).create;
  }

  function renderResult(shortUrl) {
    el.shortUrl.textContent = shortUrl;
    el.shortUrl.setAttribute('href', shortUrl);
    el.result.hidden = false;
    el.copy.textContent = (I18N[currentLangValue] || I18N.en).copy;
    toast((I18N[currentLangValue] || I18N.en).resultHint);
  }

  async function submit(event) {
    event.preventDefault();
    clearError();

    var url = el.url.value.trim();
    if (!url) {
      el.url.focus();
      showError('missing_url');
      return;
    }

    var payload = { url: url };
    if (el.code && el.code.value.trim()) payload.code = el.code.value.trim();
    var token = el.token && el.token.value.trim() ? el.token.value.trim() : read('token');

    var headers = { 'content-type': 'application/json' };
    if (HAS_TOKEN && token) {
      headers.authorization = 'Bearer ' + token;
      write('token', token);
    }

    setBusy(true);
    try {
      var response = await fetch('/api/shorten', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
      var data = await response.json().catch(function () { return null; });
      if (!response.ok || !data || data.ok !== true) {
        showError(data && data.error ? data.error.code : 'generic');
        return;
      }
      renderResult(data.shortUrl);
    } catch (e) {
      showError('network');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    var text = el.shortUrl.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (err) { /* give up quietly */ }
      document.body.removeChild(area);
    }
    toast((I18N[currentLangValue] || I18N.en).copied);
  }

  if (el.form) el.form.addEventListener('submit', submit);
  if (el.copy) el.copy.addEventListener('click', copy);
  if (el.theme) {
    el.theme.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      write('theme', next);
    });
  }
  if (el.lang) {
    el.lang.addEventListener('change', function () { applyLang(el.lang.value); });
  }

  if (HAS_TOKEN && el.tokenField) {
    el.tokenField.hidden = false;
    if (el.token && read('token')) el.token.value = read('token');
  }

  applyTheme(detectTheme());
  applyLang(currentLangValue);
})();
`;

function pageShell({ lang, title, description, icon, body, scripts = '' }) {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E${encodeURIComponent(icon)}%3C/text%3E%3C/svg%3E">
<style>${BASE_CSS}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>`;
}

/**
 * Render the landing page.
 * @param {{pageTitle: string, pageIcon: string, pageDesc: string, createToken: string}} config
 */
export function renderLandingPage(config) {
  const dict = I18N['zh-CN'];

  const body = `
<main class="card">
  <header class="brand">
    <div class="logo" aria-hidden="true">${escapeHtml(config.pageIcon)}</div>
    <div>
      <h1>${escapeHtml(config.pageTitle)}</h1>
      <p class="desc">${escapeHtml(config.pageDesc)}</p>
    </div>
  </header>
  <form id="form" autocomplete="off" novalidate>
    <label class="field">
      <span data-i18n="urlLabel">${escapeHtml(dict.urlLabel)}</span>
      <input id="url" name="url" type="text" inputmode="url" spellcheck="false"
        placeholder="${escapeHtml(dict.urlPlaceholder)}" data-i18n="urlPlaceholder" data-i18n-attr="placeholder" required>
    </label>
    <details class="advanced">
      <summary data-i18n="advanced">${escapeHtml(dict.advanced)}</summary>
      <div class="inner">
        <label class="field">
          <span data-i18n="codeLabel">${escapeHtml(dict.codeLabel)}</span>
          <input id="code" name="code" type="text" spellcheck="false" autocapitalize="off"
            placeholder="${escapeHtml(dict.codePlaceholder)}" data-i18n="codePlaceholder" data-i18n-attr="placeholder">
        </label>
        <label class="field" id="tokenField" hidden>
          <span data-i18n="tokenLabel">${escapeHtml(dict.tokenLabel)}</span>
          <input id="token" name="token" type="password" autocomplete="off"
            placeholder="${escapeHtml(dict.tokenPlaceholder)}" data-i18n="tokenPlaceholder" data-i18n-attr="placeholder">
        </label>
      </div>
    </details>
    <button class="submit" id="submit" type="submit" data-i18n="create">${escapeHtml(dict.create)}</button>
    <p class="error" id="error" role="alert" hidden></p>
  </form>
  <section class="result" id="result" hidden>
    <a id="shortUrl" href="#" target="_blank" rel="noopener noreferrer"></a>
    <button class="copy" id="copy" type="button" data-i18n="copy">${escapeHtml(dict.copy)}</button>
  </section>
  <footer>
    <select id="lang" aria-label="Language">
      <option value="zh-CN">简体中文</option>
      <option value="zh-TW">繁體中文</option>
      <option value="en">English</option>
    </select>
    <button class="icon" id="theme" type="button" aria-label="Theme" data-i18n="theme" data-i18n-attr="title">🌓</button>
  </footer>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;

  const scripts = `<script>window.__I18N__ = ${scriptJson(I18N)}; window.__HAS_TOKEN__ = ${config.createToken ? 'true' : 'false'};</script>
<script>${CLIENT_JS}</script>`;

  return pageShell({
    lang: 'zh-CN',
    title: config.pageTitle,
    description: config.pageDesc,
    icon: config.pageIcon,
    body,
    scripts,
  });
}

/**
 * Render the 404 page shown for unknown codes.
 * @param {{pageTitle: string, pageIcon: string}} config
 * @param {string} [code]
 */
export function renderNotFoundPage(config, code = '') {
  const dict = I18N['zh-CN'];
  const body = `
<main class="card center">
  <p class="big">404</p>
  <h1 data-i18n="notFoundTitle">${escapeHtml(dict.notFoundTitle)}</h1>
  <p class="desc">${escapeHtml(dict.notFoundDesc)}${code ? ` <code>/${escapeHtml(code)}</code>` : ''}</p>
  <a class="back" href="/" data-i18n="backHome">${escapeHtml(dict.backHome)}</a>
</main>`;

  const scripts = `<script>window.__I18N__ = ${scriptJson(I18N)}; window.__HAS_TOKEN__ = false;</script>
<script>
(function () {
  var I18N = window.__I18N__;
  var nav = (navigator.language || 'en').toLowerCase();
  var lang = nav.indexOf('zh-tw') === 0 || nav.indexOf('zh-hk') === 0 ? 'zh-TW'
    : nav.indexOf('zh') === 0 ? 'zh-CN' : 'en';
  try {
    var saved = localStorage.getItem('shortlink.lang');
    if (saved && I18N[saved]) lang = saved;
  } catch (e) { /* private mode */ }
  var dict = I18N[lang] || I18N.en;
  document.documentElement.lang = dict.htmlLang;
  var nodes = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++) {
    var key = nodes[i].getAttribute('data-i18n');
    if (dict[key]) nodes[i].textContent = dict[key];
  }
  var dark = false;
  try { dark = localStorage.getItem('shortlink.theme') === 'dark'; } catch (e) { /* ignore */ }
  if (!dark && window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
</script>`;

  return pageShell({
    lang: 'zh-CN',
    title: `${dict.notFoundTitle} · ${config.pageTitle}`,
    description: config.pageDesc,
    icon: config.pageIcon,
    body,
    scripts,
  });
}

export { I18N };
