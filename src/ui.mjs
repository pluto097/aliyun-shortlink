/**
 * Landing page and 404 page.
 *
 * ---------------------------------------------------------------------------
 * The landing page below is copied verbatim from cf-shortlink-worker
 * (https://github.com/Aethersailor/cf-shortlink-worker), commit
 * 4623ac19d93f1aef361d0825b7aada9a50ee91da, Copyright (c) 2025 Aethersailor,
 * licensed under the GNU Affero General Public License v3.0.
 *
 * This file is therefore distributed under AGPL-3.0; see LICENSE and NOTICE.
 *
 * Documented modifications (everything else is byte-for-byte upstream):
 *   D1  configuration values are HTML-escaped / URL-encoded, and the i18n
 *       dictionary is serialized with < and > escaped.
 *   D2  an optional access-token field is rendered only when CREATE_TOKEN is
 *       configured, and is sent as an Authorization header.
 *   D3  footer copy and the "open source" link point at this project.
 *   D4  <meta name="robots" content="noindex"> is added.
 *   D5  sessionStorage access is wrapped in try/catch so blocked storage
 *       cannot break the page.
 *   D6  client requests are prefixed with the configured access-key path, and
 *       the 404 page omits its "back home" link while an access key is set so
 *       it can never reveal the key.
 * ---------------------------------------------------------------------------
 */

/** This project's repository, used by the landing page footer. */
const REPO_URL = 'https://github.com/pluto097/aliyun-shortlink';

/** Escape a value for HTML text or attribute context. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize a value for inline <script> use.
 * Escapes "<" so a configuration value can never close the script tag.
 */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * Render the landing page.
 * @param {{pageTitle: string, pageIcon: string, pageDesc: string, createToken: string}} config
 */
export function renderLandingPage(config) {
  const title = config.pageTitle;
  const icon = config.pageIcon;
  const desc = config.pageDesc;
  const repo = REPO_URL;

  // D6: in private mode the page is mounted under /<accessKey>/, so its client
  // script has to call the API through the same prefix.
  const basePath = config.accessKey ? '/' + config.accessKey : '';

  // D2: rendered only when the deployment requires a token.
  const tokenFieldHtml = config.createToken
    ? [
        '',
        '      <div class="input-group" id="tokenGroup">',
        '        <label for="tokenInput" id="labelToken">Access Token</label>',
        '        <input type="password" id="tokenInput" autocomplete="off" placeholder="Required to create short links">',
        '      </div>',
      ].join('\n')
    : '';

  // ---------------------------------------------------------------- upstream i18n
  const i18n = {
    "en": {
      "title": title,
      "desc": desc,
      "longLabel": "Long Link",
      "tokenLabel": "Access Token",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "Shorten URL",
      "resultLabel": "Your Short Link:",
      "copyBtn": "Copy",
      "footer": "Powered by aliyun-shortlink",
      "openSource": "Open Source",
      "copyToast": "Copied to clipboard!",
      "error": "Error: ",
      "tokenRequired": "Access token required or incorrect.",
      "networkError": "Network Error: "
    },
    "zh-CN": {
      "title": title,
      "desc": desc,
      "longLabel": "长链接",
      "tokenLabel": "访问口令",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "生成短链",
      "resultLabel": "您的短链接：",
      "copyBtn": "复制",
      "footer": "基于 aliyun-shortlink",
      "openSource": "开源项目",
      "copyToast": "已复制到剪贴板！",
      "error": "错误：",
      "tokenRequired": "需要口令或口令不正确。",
      "networkError": "网络错误："
    },
    "zh-TW": {
      "title": title,
      "desc": desc,
      "longLabel": "長網址",
      "tokenLabel": "存取口令",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "產生短鏈",
      "resultLabel": "您的短網址：",
      "copyBtn": "複製",
      "footer": "基於 aliyun-shortlink",
      "openSource": "開源專案",
      "copyToast": "已複製到剪貼簿！",
      "error": "錯誤：",
      "tokenRequired": "需要口令或口令不正確。",
      "networkError": "網絡錯誤："
    }
  };

  // ---------------------------------------------------------------- upstream template (verbatim)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${encodeURIComponent(icon)}</text></svg>">
  <style>
    :root {
      --bg-color: #f0f2f5;
      --card-bg: rgba(255, 255, 255, 0.85);
      --text-main: #1f2937;
      --text-sub: #6b7280;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --border: #e5e7eb;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      --glass-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
      --dropdown-bg: #ffffff;
      --dropdown-hover: #f3f4f6;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #111827;
        --card-bg: rgba(31, 41, 55, 0.7);
        --text-main: #f9fafb;
        --text-sub: #9ca3af;
        --primary: #60a5fa;
        --primary-hover: #93c5fd;
        --border: #374151;
        --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        --dropdown-bg: #1f2937;
        --dropdown-hover: #374151;
      }
    }

    [data-theme="dark"] {
      --bg-color: #111827;
      --card-bg: rgba(31, 41, 55, 0.7);
      --text-main: #f9fafb;
      --text-sub: #9ca3af;
      --primary: #60a5fa;
      --primary-hover: #93c5fd;
      --border: #374151;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
      --dropdown-bg: #1f2937;
      --dropdown-hover: #374151;
    }

    [data-theme="light"] {
      --bg-color: #f0f2f5;
      --card-bg: rgba(255, 255, 255, 0.85);
      --text-main: #1f2937;
      --text-sub: #6b7280;
      --dropdown-bg: #ffffff;
      --dropdown-hover: #f3f4f6;
      /* default values */
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
      transition: background-color 0.3s ease, color 0.3s ease;
      background-image: 
        radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
        radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
        radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
    }

    /* Light mode background gradient override */
    @media (prefers-color-scheme: light) {
      body {
        background-image: 
          radial-gradient(at 0% 0%, hsla(196, 68%, 90%, 1) 0, transparent 50%),
          radial-gradient(at 50% 100%, hsla(266, 60%, 94%, 1) 0, transparent 50%),
          radial-gradient(at 100% 0%, hsla(328, 70%, 92%, 1) 0, transparent 50%);
      }
    }
    
    [data-theme="light"] body {
        background-image: 
          radial-gradient(at 0% 0%, hsla(196, 68%, 90%, 1) 0, transparent 50%),
          radial-gradient(at 50% 100%, hsla(266, 60%, 94%, 1) 0, transparent 50%),
          radial-gradient(at 100% 0%, hsla(328, 70%, 92%, 1) 0, transparent 50%);
    }
    
    [data-theme="dark"] body {
      background-image: 
        radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
        radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
        radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
    }

    .container {
      width: 100%;
      max-width: 600px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      background-color: var(--card-bg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      box-shadow: var(--glass-shadow);
      padding: 40px;
      text-align: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .header { margin-bottom: 2rem; }
    
    .icon { font-size: 4rem; display: block; margin-bottom: 0.5rem; animation: float 6s ease-in-out infinite; }
    
    @keyframes float {
      0% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
      100% { transform: translateY(0px); }
    }

    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.025em; }
    
    .desc { color: var(--text-sub); font-size: 1rem; line-height: 1.5; }

    .input-group { position: relative; margin-bottom: 1.5rem; text-align: left; }
    
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500; color: var(--text-main); }
    
    input[type="url"] {
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: 2px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      font-size: 1rem;
      transition: all 0.2s;
      outline: none;
    }
    
    input[type="url"]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }

    button.primary-btn {
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      border: none;
      background: var(--primary);
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
    }
    
    button.primary-btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    button.primary-btn:active { transform: translateY(0); }
    button.primary-btn:disabled { opacity: 0.7; cursor: not-allowed; }

    .result {
      margin-top: 2rem;
      padding: 1.5rem;
      background: rgba(0, 0, 0, 0.03);
      border-radius: 12px;
      display: none;
      animation: fadeIn 0.3s ease;
      border: 1px solid var(--border);
      text-align: left;
    }
    
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

    .result-label { font-size: 0.875rem; color: var(--text-sub); margin-bottom: 0.5rem; }
    
    .result-box {
      display: flex;
      gap: 0.5rem;
      background: var(--bg-color);
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      align-items: center;
    }
    
    .short-url { flex: 1; font-family: monospace; font-size: 1rem; color: var(--primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 0.5rem;}
    
    .copy-btn {
      width: auto;
      padding: 8px 12px;
      font-size: 0.875rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: rgba(0, 0, 0, 0.05); /* Soft background for copy button */
      color: var(--text-main);
      transition: background 0.2s;
    }
    
    .copy-btn:hover { background: rgba(0, 0, 0, 0.1); }

    .footer { margin-top: 2rem; font-size: 0.875rem; color: var(--text-sub); }
    .footer a { color: var(--text-sub); text-decoration: none; opacity: 0.8; transition: opacity 0.2s;}
    .footer a:hover { opacity: 1; text-decoration: underline; }

    .top-right-controls {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .icon-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: var(--text-main);
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
      position: relative;
    }
    .icon-btn:hover { background: rgba(255, 255, 255, 0.2); }

    /* Dropdown Menu */
    .dropdown {
        position: relative;
    }
    .dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        top: 110%;
        background-color: var(--dropdown-bg);
        min-width: 120px;
        box-shadow: var(--shadow);
        border-radius: 8px;
        z-index: 10;
        overflow: hidden;
        border: 1px solid var(--border);
    }
    .dropdown-content button {
        color: var(--text-main);
        padding: 10px 16px;
        text-decoration: none;
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-radius: 0;
        justify-content: flex-start;
        font-weight: 400;
    }
    .dropdown-content button:hover {
        background-color: var(--dropdown-hover);
        transform: translateY(0);
    }
    .dropdown.show .dropdown-content {
        display: block;
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #ffffff;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
    }

    @keyframes rotation {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* Toast notif */
    .toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--text-main);
        color: var(--bg-color);
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 0.9rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s;
        z-index: 100;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>

  <div class="top-right-controls">
    <div class="dropdown" id="langDropdown">
        <button class="icon-btn" id="langBtn" aria-label="Switch Language" title="Switch Language">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        </button>
        <div class="dropdown-content">
            <button onclick="changeLang('en')">English</button>
            <button onclick="changeLang('zh-CN')">简体中文</button>
            <button onclick="changeLang('zh-TW')">繁體中文</button>
        </div>
    </div>
    
    <button class="icon-btn" id="themeBtn" aria-label="Toggle theme" title="Switch Theme">
      <svg id="moonIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      <svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
    </button>
  </div>

  <div class="container">
    <div class="header">
      <span class="icon">${escapeHtml(icon)}</span>
      <h1 id="pageTitle">${escapeHtml(title)}</h1>
      <p class="desc" id="pageDesc">${escapeHtml(desc)}</p>
    </div>

    <form id="shortenForm">
      <div class="input-group">
        <label for="longUrl" id="labelLongUrl">Long Link</label>
        <input type="url" id="longUrl" placeholder="https://example.com/very/long/url..." required autofocus>
      </div>${tokenFieldHtml}
      
      <button type="submit" id="submitBtn" class="primary-btn">
        <span id="btnText">Shorten URL</span>
        <span class="spinner" id="btnSpinner" style="display:none"></span>
      </button>
    </form>

    <div class="result" id="resultArea">
      <div class="result-label" id="labelResult">Your Short Link:</div>
      <div class="result-box">
        <div class="short-url" id="shortUrlDisplay"></div>
        <button class="copy-btn" id="copyBtn">Copy</button>
      </div>
    </div>

    <div class="footer">
      <span id="labelFooter">Powered by Cloudflare Workers.</span> 
      <a href="${repo}" target="_blank" id="labelOpenSource">Open Source</a>
    </div>
  </div>
  
  <div class="toast" id="toast">Copied to clipboard!</div>

  <!-- Inject Dictionary -->
  <script>
    const I18N = ${scriptJson(i18n)};
    const BASE_PATH = ${scriptJson(basePath)};
  </script>

  <script>
    /* --- Logic --- */

    function storageGet(key) {
      try { return sessionStorage.getItem(key); } catch (e) { return null; }
    }
    function storageSet(key, value) {
      try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
    
    // Elements
    const els = {
      langBtn: document.getElementById('langBtn'),
      langDropdown: document.getElementById('langDropdown'),
      themeBtn: document.getElementById('themeBtn'),
      moonIcon: document.getElementById('moonIcon'),
      sunIcon: document.getElementById('sunIcon'),
      pageTitle: document.getElementById('pageTitle'),
      pageDesc: document.getElementById('pageDesc'),
      labelLongUrl: document.getElementById('labelLongUrl'),
      longUrl: document.getElementById('longUrl'),
      submitBtn: document.getElementById('submitBtn'),
      btnText: document.getElementById('btnText'),
      btnSpinner: document.getElementById('btnSpinner'),
      resultArea: document.getElementById('resultArea'),
      labelResult: document.getElementById('labelResult'),
      shortUrlDisplay: document.getElementById('shortUrlDisplay'),
      copyBtn: document.getElementById('copyBtn'),
      labelFooter: document.getElementById('labelFooter'),
      labelOpenSource: document.getElementById('labelOpenSource'),
      toast: document.getElementById('toast'),
      form: document.getElementById('shortenForm'),
      tokenInput: document.getElementById('tokenInput'),
    };

    // State
    let currentLang = 'en';
    const SESSION_KEY_LANG = 'cf_short_lang';
    const SESSION_KEY_THEME = 'cf_short_theme';
    
    // --- i18n ---
    function detectLang() {
      // Priority: Session -> Browser -> Default
      const saved = storageGet(SESSION_KEY_LANG);
      if (saved) return saved;
      
      const sys = navigator.language || navigator.userLanguage || "en";
      if (sys.toLowerCase().startsWith("zh")) {
         if (sys.toLowerCase().includes("tw") || sys.toLowerCase().includes("hk")) {
           return "zh-TW";
         }
         return "zh-CN";
      }
      return "en";
    }

    function applyLang(lang) {
      if (!I18N[lang]) lang = 'en';
      currentLang = lang;
      // Save to Session Storage ONLY
      storageSet(SESSION_KEY_LANG, lang);
      const dict = I18N[lang];
      
      // Update DOM
      els.pageTitle.textContent = dict.title;
      els.pageDesc.textContent = dict.desc;
      els.labelLongUrl.textContent = dict.longLabel;
      els.longUrl.placeholder = dict.placeholder;
      els.btnText.textContent = dict.shortenBtn;
      els.labelResult.textContent = dict.resultLabel;
      els.copyBtn.textContent = dict.copyBtn;
      els.labelFooter.textContent = dict.footer;
      els.labelOpenSource.textContent = dict.openSource;
      els.toast.textContent = dict.copyToast;
      
      // Update html lang attr
      document.documentElement.lang = lang;
    }
    
    // Dropdown Logic
    els.langBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.langDropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    window.addEventListener('click', () => {
        if (els.langDropdown.classList.contains('show')) {
            els.langDropdown.classList.remove('show');
        }
    });
    
    // Exposed function for onclick events
    window.changeLang = function(lang) {
        applyLang(lang);
    }
    
    // Init Lang
    applyLang(detectLang());


    // --- Theme ---
    function setTheme(isDark) {
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      els.moonIcon.style.display = isDark ? 'none' : 'block';
      els.sunIcon.style.display = isDark ? 'block' : 'none';
      // Save to Session Storage
      storageSet(SESSION_KEY_THEME, isDark ? 'dark' : 'light');
    }

    // Init Theme: Priority Session -> System
    const savedTheme = storageGet(SESSION_KEY_THEME);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme) {
      setTheme(savedTheme === 'dark');
    } else {
      setTheme(systemPrefersDark);
    }
    
    els.themeBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      setTheme(currentTheme === 'light');
    });


    // --- Form ---
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const longUrlVal = els.longUrl.value;
      
      if (!longUrlVal) return;

      // Loading
      els.submitBtn.disabled = true;
      els.btnText.style.display = 'none';
      els.btnSpinner.style.display = 'inline-block';
      els.resultArea.style.display = 'none';

      try {
        const formData = new FormData();
        const b64 = btoa(unescape(encodeURIComponent(longUrlVal))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=/g, "");
        formData.append('longUrl', b64);

        const headers = {};
        if (els.tokenInput && els.tokenInput.value.trim()) headers.Authorization = 'Bearer ' + els.tokenInput.value.trim();

        const response = await fetch(BASE_PATH + '/short', {
          method: 'POST',
          headers: headers,
          body: formData
        });

        const data = await response.json();
        const dict = I18N[currentLang];

        if (data.Code === 1) {
          els.shortUrlDisplay.textContent = data.ShortUrl;
          els.resultArea.style.display = 'block';
        } else {
          if (response.status === 401) {
            alert(dict.error + dict.tokenRequired);
          } else {
            alert(dict.error + (data.Message || 'Unknown error'));
          }
        }
      } catch (err) {
        alert(I18N[currentLang].networkError + err.message);
      } finally {
        els.submitBtn.disabled = false;
        els.btnText.style.display = 'inline-block';
        els.btnSpinner.style.display = 'none';
      }
    });

    // --- Copy ---
    els.copyBtn.addEventListener('click', () => {
      const text = els.shortUrlDisplay.textContent;
      navigator.clipboard.writeText(text).then(() => {
        showToast();
      });
    });
    
    function showToast() {
        els.toast.classList.add('show');
        setTimeout(() => els.toast.classList.remove('show'), 2000);
    }
  </script>
</body>
</html>`;
}

/**
 * Render the 404 page shown for unknown codes.
 * @param {{pageTitle: string, pageIcon: string}} config
 * @param {string} [code]
 */
const NOT_FOUND_CSS = [
  '*{box-sizing:border-box}',
  ':root{--text:#0f172a;--muted:#64748b;--accent:#4f46e5;--accent2:#0ea5e9}',
  '@media (prefers-color-scheme:dark){:root{--text:#e5e7eb;--muted:#94a3b8;--accent:#818cf8;--accent2:#38bdf8}',
  'body{background:linear-gradient(160deg,#0b1020,#05070f)}}',
  'body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;text-align:center;',
  'color:var(--text);background:linear-gradient(160deg,#eef2ff,#f8fafc);',
  'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
  '.card{max-width:460px}',
  '.big{margin:0;font-size:64px;font-weight:800;letter-spacing:-.04em;',
  'background:linear-gradient(135deg,var(--accent),var(--accent2));',
  '-webkit-background-clip:text;background-clip:text;color:transparent}',
  'h1{margin:8px 0 6px;font-size:20px}',
  'p{margin:0 0 18px;font-size:14px;color:var(--muted)}',
  'code{font-size:13px;color:var(--muted)}',
  'a{display:inline-block;padding:10px 16px;border-radius:12px;font-weight:600;color:#fff;text-decoration:none;',
  'background:linear-gradient(135deg,var(--accent),var(--accent2))}',
].join('');

export function renderNotFoundPage(config, code = '') {
  const codeSuffix = code ? ' <code>/' + escapeHtml(code) + '</code>' : '';

  // D6: while an access key is configured this page is what unauthorised
  // visitors see, so it must not contain a link that embeds the key.
  const homeLink = config.accessKey ? '' : '<a href="/">返回首页</a>\n';

  return (
    '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex">\n' +
    '<title>' + escapeHtml('链接不存在 · ' + config.pageTitle) + '</title>\n' +
    '<style>' + NOT_FOUND_CSS + '</style>\n</head>\n<body>\n' +
    '<main class="card">\n' +
    '<p class="big">404</p>\n' +
    '<h1>链接不存在</h1>\n' +
    '<p>这个短码没有对应的链接，可能已过期或被删除。' + codeSuffix + '</p>\n' +
    homeLink +
    '</main>\n</body>\n</html>'
  );
}
