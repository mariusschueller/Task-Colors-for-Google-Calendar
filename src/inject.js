// Runs in the page's MAIN world at document_start. Captures task data from
// AF_initDataCallback chunks and from fetch/XHR responses, parses it with
// RCCParser, and hands the results to content.js via window.postMessage.
// It never modifies what the page sees.
(() => {
  const P = window.RCCParser;
  if (!P || window.__rccInjected) return;
  window.__rccInjected = true;

  const MAX_BYTES = 8e6;
  const found = { lists: {}, tasks: {} };

  // Counters for the popup's "Copy diagnostics" button.
  const diag = { frame: location.href.split('?')[0], initChunks: 0, initScripts: 0, responses: 0, candidateUrls: [], hits: [] };
  const note = (arr, v) => { if (arr.length < 20 && !arr.includes(v)) arr.push(v); };
  // Last few responses that passed the shape pre-filter, kept so diagnostics
  // can show the raw format around a task id that failed to parse.
  const recent = [];
  const keep = (url, text) => {
    if (text.length > 1e6) return;
    recent.push({ url, text });
    if (recent.length > 2) recent.shift();
  };
  function contextFor(ids) {
    const out = {};
    for (const id of ids || []) {
      if (typeof id !== 'string' || !/^[\w~-]{4,64}$/.test(id)) continue;
      for (const { url, text } of recent) {
        const i = text.indexOf(id);
        if (i < 0) continue;
        out[id] = { url, context: text.slice(Math.max(0, i - 200), i + 600) };
        break;
      }
      if (!out[id]) out[id] = 'not found in captured responses';
    }
    return out;
  }

  function post(r, source) {
    if (P.isEmpty(r)) return;
    P.mergeInto(found, r);
    note(diag.hits, `${source}: ${Object.keys(r.lists).length} lists, ${Object.keys(r.tasks).length} tasks`);
    window.postMessage({ __rcc: 'index', lists: r.lists, tasks: r.tasks }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    // content.js may load after we've already found data; replay on request.
    if (e.data.__rcc === 'hello') {
      window.postMessage({ __rcc: 'index', lists: found.lists, tasks: found.tasks }, location.origin);
    } else if (e.data.__rcc === 'diag?') {
      window.postMessage({ __rcc: 'diag', diag: { ...diag, idContext: contextFor(e.data.ids) } }, location.origin);
    }
  });

  const defer = (fn) => setTimeout(() => { try { fn(); } catch (_) { /* ignore */ } }, 0);

  // --- AF_initDataCallback chunks -----------------------------------------
  const seen = new WeakSet();
  function handleChunk(c) {
    if (!c || typeof c !== 'object' || seen.has(c)) return;
    seen.add(c);
    diag.initChunks++;
    defer(() => {
      let d = c.data;
      if (typeof d === 'function') d = d();
      post(P.extract(d), `initData ${c.key || ''}`);
    });
  }

  let realCallback;
  function wrappedCallback(chunk) {
    try { handleChunk(chunk); } catch (_) { /* ignore */ }
    return realCallback && realCallback.apply(this, arguments);
  }
  try {
    Object.defineProperty(window, 'AF_initDataCallback', {
      configurable: true,
      get() { return realCallback ? wrappedCallback : undefined; },
      set(fn) { realCallback = fn; },
    });
  } catch (_) { /* already defined; the queue + script scan cover it */ }

  function drainQueue() {
    const q = window.AF_initDataChunkQueue;
    if (Array.isArray(q)) q.forEach(handleChunk);
  }

  // Backup for when the callback hook misses: parse inline <script> text.
  const scannedScripts = new WeakSet();
  function scanScripts() {
    for (const s of document.querySelectorAll('script:not([src])')) {
      if (scannedScripts.has(s)) continue;
      scannedScripts.add(s);
      const t = s.textContent;
      if (t && t.includes('AF_initDataCallback')) {
        diag.initScripts++;
        defer(() => post(P.parseInitScript(t), 'inline script'));
      }
    }
  }

  const onReady = () => { drainQueue(); scanScripts(); };
  document.addEventListener('DOMContentLoaded', onReady);
  window.addEventListener('load', onReady);

  // --- Network responses ----------------------------------------------------
  const wantType = (ct) => !ct || /json|javascript|protobuf|text\//i.test(ct);
  const scan = (text, url) => {
    if (typeof text !== 'string' || text.length >= MAX_BYTES) return;
    diag.responses++;
    defer(() => {
      const r = P.parseText(text);
      const path = String(url || '').split('?')[0];
      if (r) { note(diag.candidateUrls, path); keep(path, text); } // passed the cheap shape pre-filter
      post(r, path);
    });
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((res) => {
        try {
          if (!wantType(res.headers.get('content-type'))) return;
          if ((+res.headers.get('content-length') || 0) > MAX_BYTES) return;
          res.clone().text().then((t) => scan(t, res.url), () => {});
        } catch (_) { /* ignore */ }
      }, () => {});
      return p;
    };
  }

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      this.addEventListener('load', function () {
        try {
          if (this.responseType && this.responseType !== 'text') return;
          if (!wantType(this.getResponseHeader('content-type'))) return;
          scan(this.responseText, this.responseURL);
        } catch (_) { /* ignore */ }
      });
    } catch (_) { /* ignore */ }
    return origSend.apply(this, args);
  };
})();
