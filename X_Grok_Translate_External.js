// ==UserScript==
// @name         X Grok 翻译按钮外置
// @namespace    https://x.com/
// @license      MIT
// @version      0.2.0
// @description  在 X 首页信息流和评论区外置官方 Grok 翻译按钮
// @author       XianYuDaXian
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==


(function () {
  'use strict';

  const API_URL = 'https://api.x.com/2/grok/translation.json';
  const BUTTON_ATTR = 'data-xgrok-translate-button';
  const BATCH_BUTTON_ATTR = 'data-xgrok-translate-all-button';
  const BLOCK_ATTR = 'data-xgrok-translation-block';
  const HOST_ATTR = 'data-xgrok-translate-host';
  const BATCH_HOST_ATTR = 'data-xgrok-translate-all-host';

  const state = {
    cache: new Map(),
    pending: new Map(),
    observer: null,
    runtimeHeaders: {},
    lastTranslationTemplate: null,
    autoTranslateAll: false,
    autoTranslateScheduled: false,
    autoTranslateDetailTweetId: '',
    lastPathname: location.pathname,
  };

  const PUBLIC_BEARER =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  GM_addStyle(`
    [${HOST_ATTR}="1"] {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    [${BUTTON_ATTR}="1"] {
      appearance: none;
      border: 1px solid rgba(83, 100, 113, 0.45);
      background: transparent;
      color: rgb(113, 118, 123);
      border-radius: 9999px;
      padding: 4px 10px;
      font-size: 13px;
      line-height: 18px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    [${BATCH_BUTTON_ATTR}="1"] {
      appearance: none;
      border: 1px solid rgba(29, 155, 240, 0.45);
      background: rgba(29, 155, 240, 0.12);
      color: rgb(29, 155, 240);
      border-radius: 9999px;
      padding: 6px 14px;
      font-size: 14px;
      line-height: 20px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    [${BATCH_BUTTON_ATTR}="1"]:hover {
      background: rgba(29, 155, 240, 0.18);
      border-color: rgba(29, 155, 240, 0.72);
    }

    [${BUTTON_ATTR}="1"]:hover {
      border-color: rgba(29, 155, 240, 0.75);
      color: rgb(29, 155, 240);
      background: rgba(29, 155, 240, 0.08);
    }

    [${BUTTON_ATTR}="1"][data-state="loading"] {
      opacity: 0.72;
      cursor: progress;
    }

    [${BATCH_BUTTON_ATTR}="1"][data-state="loading"] {
      opacity: 0.72;
      cursor: progress;
    }

    [${BUTTON_ATTR}="1"][data-state="done"] {
      color: rgb(29, 155, 240);
      border-color: rgba(29, 155, 240, 0.55);
    }

    [${BATCH_BUTTON_ATTR}="1"][data-state="done"] {
      color: rgb(255, 255, 255);
      background: rgba(29, 155, 240, 0.88);
      border-color: rgba(29, 155, 240, 0.88);
    }

    [${BUTTON_ATTR}="1"][data-state="error"] {
      color: rgb(244, 33, 46);
      border-color: rgba(244, 33, 46, 0.45);
    }

    [${BATCH_BUTTON_ATTR}="1"][data-state="error"] {
      color: rgb(244, 33, 46);
      border-color: rgba(244, 33, 46, 0.45);
      background: rgba(244, 33, 46, 0.08);
    }

    [${BLOCK_ATTR}="1"] {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(83, 100, 113, 0.28);
      background: rgba(29, 155, 240, 0.08);
      color: inherit;
      font-size: 15px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    [${BLOCK_ATTR}="1"] [data-role="title"] {
      display: block;
      margin-bottom: 6px;
      color: rgb(29, 155, 240);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    [${BLOCK_ATTR}="1"] [data-role="content"] {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    [${BLOCK_ATTR}="1"] p,
    [${BLOCK_ATTR}="1"] blockquote {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    [${BLOCK_ATTR}="1"] blockquote {
      padding-left: 12px;
      border-left: 3px solid rgba(29, 155, 240, 0.45);
      color: rgba(231, 233, 234, 0.95);
    }
  `);

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function readStoredLanguage() {
    const candidates = [
      localStorage.getItem('lang'),
      localStorage.getItem('i18n_redirected'),
      sessionStorage.getItem('lang'),
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  function getClientLanguage() {
    return (
      state.runtimeHeaders['x-twitter-client-language'] ||
      document.documentElement.lang ||
      readStoredLanguage() ||
      navigator.language ||
      'en'
    ).toLowerCase();
  }

  function getTargetLanguage() {
    const locale = getClientLanguage().replace(/_/g, '-');

    if (locale.startsWith('zh')) {
      return 'zh';
    }

    return locale.split('-')[0] || 'en';
  }

  function toPlainHeaders(input) {
    if (!input) return {};

    if (input instanceof Headers) {
      return Object.fromEntries(input.entries());
    }

    if (Array.isArray(input)) {
      return Object.fromEntries(input);
    }

    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key.toLowerCase(), String(value)])
    );
  }

  function captureRuntimeHeaders(headers, url) {
    const normalized = toPlainHeaders(headers);
    if (!Object.keys(normalized).length) return;

    const interestingKeys = [
      'authorization',
      'x-csrf-token',
      'x-twitter-active-user',
      'x-twitter-auth-type',
      'x-twitter-client-language',
      'x-client-transaction-id',
      'x-guest-token',
      'x-twitter-polling',
      'x-twitter-client-version',
    ];

    for (const key of interestingKeys) {
      if (normalized[key]) {
        state.runtimeHeaders[key] = normalized[key];
      }
    }

    if (url.includes('/2/grok/translation.json')) {
      state.lastTranslationTemplate = {
        ...normalized,
      };
    }
  }

  function installNetworkHooks() {
    if (window.__xGrokTranslateHooksInstalled) return;
    window.__xGrokTranslateHooksInstalled = true;

    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init) {
      try {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);

        if (url.includes('api.x.com')) {
          captureRuntimeHeaders(input instanceof Request ? input.headers : null, url);
          captureRuntimeHeaders(init?.headers, url);
        }
      } catch (error) {
        console.debug('[X Grok Translate] 抓取 fetch 请求头失败', error);
      }

      return originalFetch.apply(this, arguments);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__xGrokTranslateUrl = typeof url === 'string' ? url : String(url);
      this.__xGrokTranslateHeaders = {};
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
      if (this.__xGrokTranslateHeaders) {
        this.__xGrokTranslateHeaders[String(name).toLowerCase()] = String(value);
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      try {
        if (String(this.__xGrokTranslateUrl || '').includes('api.x.com')) {
          captureRuntimeHeaders(this.__xGrokTranslateHeaders, this.__xGrokTranslateUrl);
        }
      } catch (error) {
        console.debug('[X Grok Translate] 抓取 XHR 请求头失败', error);
      }

      return originalSend.apply(this, arguments);
    };
  }

  function getHeaders() {
    const csrf = readCookie('ct0');
    const hasAuthToken = Boolean(readCookie('auth_token'));

    if (!csrf) {
      throw new Error('缺少 ct0，当前账号可能未登录。');
    }

    const headers = {
      authorization: `Bearer ${decodeURIComponent(PUBLIC_BEARER)}`,
      'content-type': 'text/plain;charset=UTF-8',
      'x-csrf-token': csrf,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': hasAuthToken ? 'OAuth2Session' : '',
      'x-twitter-client-language': getClientLanguage(),
    };

    if (state.lastTranslationTemplate) {
      Object.assign(headers, state.lastTranslationTemplate);
    }

    Object.assign(headers, state.runtimeHeaders);
    headers['content-type'] = 'text/plain;charset=UTF-8';
    headers['x-csrf-token'] = csrf;
    headers['x-twitter-client-language'] =
      (headers['x-twitter-client-language'] || getClientLanguage()).toLowerCase();

    if (!headers.authorization) {
      throw new Error('还没抓到有效 authorization。请先点一次 X 原生翻译按钮，或刷新后滚动页面再试。');
    }

    return headers;
  }

  function extractTweetId(article) {
    const anchors = article.querySelectorAll('a[href*="/status/"]');
    for (const anchor of anchors) {
      const match = anchor.getAttribute('href')?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return '';
  }

  function isStatusDetailPage() {
    return /\/status\/\d+/.test(location.pathname);
  }

  function getStatusDetailTweetId() {
    const match = location.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  }

  function getPrimaryArticle() {
    const main = document.querySelector('main');
    if (!main) return null;

    const articles = Array.from(main.querySelectorAll('article'));
    if (!articles.length) return null;
    const detailTweetId = getStatusDetailTweetId();
    if (!detailTweetId) return articles[0];

    return (
      articles.find((article) => extractTweetId(article) === detailTweetId) ||
      articles[0]
    );
  }

  function resetAutoTranslateState() {
    state.autoTranslateAll = false;
    state.autoTranslateScheduled = false;
    state.autoTranslateDetailTweetId = '';
  }

  function syncRouteState() {
    if (state.lastPathname === location.pathname) return;
    state.lastPathname = location.pathname;
    resetAutoTranslateState();
  }

  function findTextContainer(article) {
    return (
      article.querySelector('[data-testid="tweetText"]') ||
      article.querySelector('[lang]') ||
      article
    );
  }

  function findActionBar(article) {
    const candidates = [
      '[role="group"]',
      '[data-testid="reply"]',
      '[data-testid="retweet"]',
      '[data-testid="like"]',
    ];

    for (const selector of candidates) {
      const node = article.querySelector(selector);
      if (!node) continue;

      if (selector === '[role="group"]') {
        return node;
      }

      const group = node.closest('[role="group"]');
      if (group) return group;
    }

    return null;
  }

  function findButtonHost(article) {
    const actionBar = findActionBar(article);
    if (actionBar?.parentElement) {
      return actionBar.parentElement;
    }

    const textContainer = findTextContainer(article);
    return textContainer.parentElement || article;
  }

  function ensureTranslationBlock(article) {
    let block = article.querySelector(`[${BLOCK_ATTR}="1"]`);
    if (block) return block;

    block = document.createElement('div');
    block.setAttribute(BLOCK_ATTR, '1');
    block.hidden = true;
    block.innerHTML = '<span data-role="title">Grok 翻译</span><div data-role="content"></div>';

    const textContainer = findTextContainer(article);
    if (textContainer.parentElement) {
      textContainer.insertAdjacentElement('afterend', block);
    } else {
      article.appendChild(block);
    }

    return block;
  }

  function renderTranslation(article, translatedText) {
    const block = ensureTranslationBlock(article);
    const content = block.querySelector('[data-role="content"]');
    if (content) {
      renderFormattedText(content, translatedText);
    }
    block.hidden = false;
  }

  function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  function appendParagraph(container, lines) {
    if (!lines.length) return;
    const paragraph = document.createElement('p');
    paragraph.textContent = lines.join('\n');
    container.appendChild(paragraph);
  }

  function appendQuote(container, lines) {
    if (!lines.length) return;
    const quote = document.createElement('blockquote');
    quote.textContent = lines
      .map((line) => line.replace(/^>\s?/, ''))
      .join('\n');
    container.appendChild(quote);
  }

  function renderFormattedText(container, rawText) {
    const decodedText = decodeHtmlEntities(rawText || '').replace(/\r\n/g, '\n');
    const lines = decodedText.split('\n');

    container.replaceChildren();

    let paragraphBuffer = [];
    let quoteBuffer = [];

    const flushParagraph = () => {
      appendParagraph(container, paragraphBuffer);
      paragraphBuffer = [];
    };

    const flushQuote = () => {
      appendQuote(container, quoteBuffer);
      quoteBuffer = [];
    };

    for (const line of lines) {
      const isQuote = /^>\s?/.test(line);
      const isBlank = line.trim() === '';

      if (isBlank) {
        flushParagraph();
        flushQuote();
        continue;
      }

      if (isQuote) {
        flushParagraph();
        quoteBuffer.push(line);
        continue;
      }

      flushQuote();
      paragraphBuffer.push(line);
    }

    flushParagraph();
    flushQuote();
  }

  function normalizeTranslatedText(payload) {
    if (!payload) return '';

    const queue = [payload];
    const visited = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) continue;
      visited.add(current);

      for (const key of [
        'translated_text',
        'translation',
        'text',
        'translatedText',
        'result',
        'output_text',
        'body',
      ]) {
        const value = current[key];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }

      for (const value of Object.values(current)) {
        if (typeof value === 'string') continue;
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return '';
  }

  async function requestTranslation(tweetId) {
    if (state.cache.has(tweetId)) {
      return state.cache.get(tweetId);
    }

    if (state.pending.has(tweetId)) {
      return state.pending.get(tweetId);
    }

    const task = fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: getHeaders(),
      body: JSON.stringify({
        content_type: 'POST',
        id: tweetId,
        dst_lang: getTargetLanguage(),
      }),
    })
      .then(async (response) => {
        const rawText = await response.text();
        let payload = null;

        try {
          payload = rawText ? JSON.parse(rawText) : null;
        } catch {
          payload = { rawText };
        }

        if (!response.ok) {
          const message =
            normalizeTranslatedText(payload) ||
            payload?.errors?.[0]?.message ||
            payload?.error ||
            `HTTP ${response.status}`;
          throw new Error(message);
        }

        const translatedText = normalizeTranslatedText(payload);
        if (!translatedText) {
          throw new Error('接口返回成功，但没有拿到可用译文。');
        }

        state.cache.set(tweetId, translatedText);
        return translatedText;
      })
      .finally(() => {
        state.pending.delete(tweetId);
      });

    state.pending.set(tweetId, task);
    return task;
  }

  function updateButtonState(button, stateName, label) {
    button.dataset.state = stateName;
    button.textContent = label;
  }

  async function handleTranslateClick(article, button) {
    const tweetId = article.dataset.xgrokTweetId || extractTweetId(article);
    if (!tweetId) {
      updateButtonState(button, 'error', '未找到帖子 ID');
      return;
    }

    const block = ensureTranslationBlock(article);
    if (!block.hidden && state.cache.has(tweetId)) {
      block.hidden = true;
      updateButtonState(button, 'done', '显示翻译');
      return;
    }

    updateButtonState(button, 'loading', '翻译中...');

    try {
      const translatedText = await requestTranslation(tweetId);
      renderTranslation(article, translatedText);
      updateButtonState(button, 'done', '隐藏翻译');
    } catch (error) {
      console.error('[X Grok Translate]', error);
      updateButtonState(button, 'error', '翻译失败');
      setTimeout(() => {
        updateButtonState(button, 'idle', '翻译');
      }, 2500);
    }
  }

  function scheduleAutoTranslateVisibleArticles() {
    if (!state.autoTranslateAll || state.autoTranslateScheduled || !isStatusDetailPage()) {
      return;
    }

    if (state.autoTranslateDetailTweetId !== getStatusDetailTweetId()) {
      resetAutoTranslateState();
      return;
    }

    state.autoTranslateScheduled = true;

    queueMicrotask(async () => {
      try {
        const articles = getTranslatableArticles();
        for (const article of articles) {
          const tweetId = article.dataset.xgrokTweetId || extractTweetId(article);
          if (!tweetId || state.cache.has(tweetId) || state.pending.has(tweetId)) {
            continue;
          }

          const button = article.querySelector(`[${BUTTON_ATTR}="1"]`);
          if (!button) continue;

          try {
            await handleTranslateClick(article, button);
          } catch (error) {
            console.error('[X Grok Translate] 自动翻译失败', error);
          }
        }
      } finally {
        state.autoTranslateScheduled = false;
      }
    });
  }

  function getTranslatableArticles() {
    const main = document.querySelector('main');
    if (!main) return [];

    return Array.from(main.querySelectorAll('article')).filter((article) => {
      if (!(article instanceof HTMLElement)) return false;
      if (article.getAttribute('aria-label')) return false;
      return Boolean(extractTweetId(article));
    });
  }

  async function runBatchTranslation(button) {
    state.autoTranslateAll = true;
    state.autoTranslateDetailTweetId = getStatusDetailTweetId();
    const articles = getTranslatableArticles();
    if (!articles.length) {
      updateButtonState(button, 'error', '未找到可翻译内容');
      setTimeout(() => updateButtonState(button, 'idle', '翻译全部'), 2500);
      return;
    }

    const articleButtons = articles
      .map((article) => ({
        article,
        button: article.querySelector(`[${BUTTON_ATTR}="1"]`),
      }))
      .filter((item) => item.button);

    if (!articleButtons.length) {
      updateButtonState(button, 'error', '未找到翻译按钮');
      setTimeout(() => updateButtonState(button, 'idle', '翻译全部'), 2500);
      return;
    }

    updateButtonState(button, 'loading', `翻译中 0/${articleButtons.length}`);

    let completed = 0;

    const workers = new Array(Math.min(3, articleButtons.length)).fill(null).map(async () => {
      while (articleButtons.length) {
        const current = articleButtons.shift();
        if (!current) return;

        try {
          await handleTranslateClick(current.article, current.button);
        } catch (error) {
          console.error('[X Grok Translate] 批量翻译失败', error);
        } finally {
          completed += 1;
          updateButtonState(button, 'loading', `翻译中 ${completed}/${completed + articleButtons.length}`);
        }
      }
    });

    await Promise.all(workers);
    updateButtonState(button, 'done', `已翻译 ${completed} 条`);
  }

  function mountBatchButton() {
    if (!isStatusDetailPage()) return;

    const article = getPrimaryArticle();
    if (!article) return;
    if (extractTweetId(article) !== getStatusDetailTweetId()) return;

    const host = findButtonHost(article);
    if (!host) return;

    let wrapper = host.querySelector(`[${HOST_ATTR}="1"]`);
    if (!wrapper) {
      mountButton(article);
      wrapper = host.querySelector(`[${HOST_ATTR}="1"]`);
    }

    if (!wrapper || wrapper.querySelector(`[${BATCH_BUTTON_ATTR}="1"]`)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(BATCH_BUTTON_ATTR, '1');
    button.dataset.state = 'idle';
    button.textContent = '翻译全部';
    button.addEventListener('click', () => {
      runBatchTranslation(button);
    });

    wrapper.appendChild(button);
  }

  function shouldSkipArticle(article) {
    if (!(article instanceof HTMLElement)) return true;
    if (article.closest('[aria-label*="Timeline: Trending"]')) return true;
    if (article.querySelector(`[${BUTTON_ATTR}="1"]`)) return true;
    return !extractTweetId(article);
  }

  function mountButton(article) {
    if (shouldSkipArticle(article)) return;

    const tweetId = extractTweetId(article);
    article.dataset.xgrokTweetId = tweetId;

    const host = findButtonHost(article);
    if (!host) return;

    let wrapper = host.querySelector(`[${HOST_ATTR}="1"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.setAttribute(HOST_ATTR, '1');
      host.appendChild(wrapper);
    }

    if (wrapper.querySelector(`[${BUTTON_ATTR}="1"]`)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(BUTTON_ATTR, '1');
    button.dataset.state = 'idle';
    button.textContent = '翻译';
    button.addEventListener('click', () => {
      handleTranslateClick(article, button);
    });

    wrapper.appendChild(button);
  }

  function scan(root = document) {
    syncRouteState();
    const articles = root.querySelectorAll('article');
    for (const article of articles) {
      mountButton(article);
    }
    mountBatchButton();
    scheduleAutoTranslateVisibleArticles();
  }

  function bootstrapObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.matches?.('article')) {
            mountButton(node);
            continue;
          }

          if (node.querySelector?.('article')) {
            scan(node);
          }
        }
      }
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function start() {
    installNetworkHooks();
    scan(document);
    bootstrapObserver();
    window.addEventListener('popstate', () => {
      resetAutoTranslateState();
      setTimeout(() => scan(document), 150);
    });
    window.addEventListener('hashchange', () => {
      resetAutoTranslateState();
      setTimeout(() => scan(document), 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
