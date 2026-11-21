// ISOLATED-world content script.
//  * Every frame: relays task data found by inject.js to the background
//    worker, which merges it into storage.
//  * Top Calendar frame only: maps task chips to task ids, writes a <style>
//    that recolors them, and adds a color button to the task details popup.
//  (The Tasks side panel's list button lives in list-header.js; the shared
//  floating menu in menu.js.)
//
// Note: parser.js runs only in the MAIN world. Chrome injects a given file at
// most once per frame, so listing it for this world too would silently skip it.
(() => {
  const C = globalThis.RCCColors;
  const S = globalThis.RCCStore;
  if (!C || !S || globalThis.__rccContent) {
    console.warn('[rcc] content script not started', { colors: !!C, store: !!S });
    return;
  }
  globalThis.__rccContent = true;

  let debug = false;
  const log = (...a) => { if (debug) console.debug('[rcc]', ...a); };

  // ---------------------------------------------------------------------------
  // Data relay (all frames)
  // ---------------------------------------------------------------------------
  let pending = { lists: {}, tasks: {} };
  let flushTimer = null;

  function queueIndex(r) {
    const lists = (r && r.lists) || {};
    const tasks = (r && r.tasks) || {};
    if (!Object.keys(lists).length && !Object.keys(tasks).length) return;
    Object.assign(pending.lists, lists);
    Object.assign(pending.tasks, tasks);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushIndex, 400);
  }

  function flushIndex() {
    const msg = { type: 'rcc:index', lists: pending.lists, tasks: pending.tasks };
    pending = { lists: {}, tasks: {} };
    log('found', Object.keys(msg.lists).length, 'lists,', Object.keys(msg.tasks).length, 'tasks');
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) { /* extension reloaded */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__rcc !== 'index') return;
    queueIndex({ lists: e.data.lists || {}, tasks: e.data.tasks || {} });
  });
  window.postMessage({ __rcc: 'hello' }, location.origin);

  // Top-level Calendar/Tasks pages enable the toolbar button for this tab
  // (background.js keeps it grayed out everywhere else).
  if (window.top === window) {
    try { chrome.runtime.sendMessage({ type: 'rcc:page' }).catch(() => {}); } catch (_) { /* extension reloaded */ }
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'rcc:ping') reply(true);
    });
  }

  const isTop = window.top === window && location.hostname === 'calendar.google.com';
  if (!isTop) {
    S.get().then((s) => { debug = s.debug; });
    return;
  }

  // ---------------------------------------------------------------------------
  // Chip coloring (top Calendar frame)
  // ---------------------------------------------------------------------------
  let settings = { enabled: true, listColors: {}, taskColors: {} };
  let index = { lists: {}, tasks: {} };
  let titleMap = new Map(); // normalized title -> [taskId]
  const chipMap = new Map(); // data-eventid value -> taskId
  const unmatched = new Set(); // data-eventid values that matched nothing (retried when the index changes)
  const unmatchedTaskLike = new Set();
  let ready = false;
  let lastUrl = location.href;

  const styleEl = document.createElement('style');
  styleEl.id = 'rcc-style';
  const baseStyleEl = document.createElement('style');
  baseStyleEl.id = 'rcc-base-style';
  baseStyleEl.textContent = globalThis.RCCPicker.CSS + `
.rcc-orig-dot{display:none!important}
.rcc-detail .rcc-trigger{padding:3px 0 3px 3px;gap:0}
.rcc-detail .rcc-trigger .rcc-dot{width:16px;height:16px}
.rcc-detail .rcc-trigger svg{width:14px;height:14px}
.rcc-row{all:initial;display:flex;align-items:center;gap:10px;margin:8px 16px 12px;color:inherit;
  font:500 14px/20px "Google Sans",Roboto,system-ui,sans-serif}
`;
  (document.head || document.documentElement).append(baseStyleEl, styleEl);

  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

  function rebuildTitleMap() {
    titleMap = new Map();
    for (const t of Object.values(index.tasks)) {
      const k = norm(t.title);
      if (!k) continue;
      if (!titleMap.has(k)) titleMap.set(k, []);
      titleMap.get(k).push(t.id);
    }
  }

  function b64(s) {
    if (!s || s.length < 8 || !/^[A-Za-z0-9+/_=-]+$/.test(s)) return null;
    try {
      let t = s.replace(/-/g, '+').replace(/_/g, '/');
      while (t.length % 4) t += '=';
      const d = atob(t);
      return /^[\x20-\x7e]+$/.test(d) ? d : null;
    } catch (_) { return null; }
  }

  // Calendar labels task chips "tasks_<taskId>". A task with a deadline gets a
  // second chip on the deadline's day, "tasks_/dl_<taskId>".
  const TASK_EVENT_RE = /^tasks_(?:\/[a-z]{1,8}_)?([\w~-]{4,64})$/i;
  // Calendar's own task chips that stand for no single task, e.g.
  // "tasks_rollover_view". Real task ids are random base64, never words.
  const isPseudoId = (id) => /^[a-z]+(?:_[a-z]+)+$/.test(id);

  // All plausible task ids encoded in a chip attribute value. Calendar has used
  // "tasks_<id>", "tasks_/dl_<id>" and base64("<id> <owner>")-style values; we
  // try each form.
  function idCandidates(raw) {
    if (!raw) return [];
    const strip = (s) => s.replace(/^tasks?[_:-]/i, '').replace(/^\/[a-z]{1,8}_/i, '');
    const out = new Set([raw, strip(raw)]);
    for (const src of [raw, strip(raw)]) {
      const dec = b64(src);
      if (!dec) continue;
      out.add(dec);
      out.add(strip(dec));
      for (const part of dec.split(/\s+/)) { out.add(part); out.add(strip(part)); }
    }
    return [...out];
  }

  const looksLikeTask = (el, cands) =>
    cands.some((c) => /^tasks?[_:-]/i.test(c)) ||
    el.hasAttribute('data-taskid') || !!el.querySelector('[data-taskid]') ||
    /\btasks?\b/i.test(el.getAttribute('aria-label') || '');

  function matchByTitle(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue;
      for (const piece of [text, ...text.split(/,\s*/)]) {
        const ids = titleMap.get(norm(piece.replace(/^tasks?:\s*/i, '')));
        if (!ids) continue;
        // Duplicate titles are only safe to use when they share a list.
        const list = index.tasks[ids[0]].listId;
        if (ids.every((id) => index.tasks[id].listId === list)) return ids[0];
      }
    }
    return null;
  }

  // The one place that knows how a Calendar chip maps to a task id.
  function getTaskIdFromChip(el) {
    const cands = idCandidates(el.getAttribute('data-eventid'));
    const inner = el.hasAttribute('data-taskid') ? el : el.querySelector('[data-taskid]');
    if (inner) cands.push(...idCandidates(inner.getAttribute('data-taskid')));
    for (const c of cands) if (index.tasks[c]) return c;
    const labeled = cands.map((c) => TASK_EVENT_RE.exec(c)).find(Boolean);
    if (labeled && isPseudoId(labeled[1])) return null;
    if (!looksLikeTask(el, cands)) return null;
    const byTitle = matchByTitle(el);
    if (byTitle) return byTitle;
    // Even if a "tasks_<taskId>" chip's task isn't in the index yet, use the
    // id so per-task colors and the popup picker still work; list colors
    // apply once the index learns the task's list.
    if (labeled) return labeled[1];
    unmatchedTaskLike.add(el.getAttribute('data-eventid'));
    return null;
  }

  function scanChips() {
    let changed = false;
    for (const el of document.querySelectorAll('[data-eventid]')) {
      const raw = el.getAttribute('data-eventid');
      if (!raw || chipMap.has(raw) || unmatched.has(raw)) continue;
      const id = getTaskIdFromChip(el);
      if (id) {
        chipMap.set(raw, id);
        changed = true;
        log('chip', raw, '->', id, index.tasks[id] && index.tasks[id].title);
      } else {
        unmatched.add(raw);
      }
    }
    if (changed) renderCss();
  }

  const isAgenda = () => /\/agenda(\/|$)/.test(location.pathname);

  function renderCss() {
    if (!settings.enabled) { styleEl.textContent = ''; return; }
    const agenda = isAgenda();
    let css = '';
    for (const [raw, id] of chipMap) {
      const r = C.resolve(id, settings, index);
      if (!r) continue;
      // Color the chips on the grid (and in "+N more" lists), never the
      // task's details popup, which also carries the task's data-eventid.
      const attr = `[data-eventid="${CSS.escape(raw)}"]`;
      const sel = `:is([data-eventchip]${attr},${attr}:not([role="dialog"] *)):not(.rcc-detail *)`;
      css += C.chipCss(sel, r.color, agenda);
    }
    styleEl.textContent = css;
  }

  // ---------------------------------------------------------------------------
  // Color control in the task details popup: the colored circle at its top
  // left becomes a "● ▾" button that opens a Google-style color menu.
  // ---------------------------------------------------------------------------
  const P = globalThis.RCCPicker;
  const M = globalThis.RCCMenu;
  let lastClick = null; // { id, at }

  const visible = (el) => el.getClientRects().length > 0;

  function colorOf(el) {
    const cs = getComputedStyle(el);
    return M.rgbToHex(cs.backgroundColor) || M.rgbToHex(cs.borderTopColor);
  }

  // The small colored circle/square at the top left of the details popup.
  function findDot(dialog) {
    let best = null;
    for (const el of dialog.querySelectorAll('[style*="background-color"],[style*="border-color"]')) {
      if (el.closest('.rcc-trigger,.rcc-menu,.rcc-row')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.width > 32 || r.height < 8 || r.height > 32 || Math.abs(r.width - r.height) > 6) continue;
      if (!colorOf(el)) continue;
      if (!best || r.top < best.r.top - 2 || (Math.abs(r.top - best.r.top) <= 2 && r.left < best.r.left)) best = { el, r };
    }
    return best && best.el;
  }

  // What the task shows without a custom color: its list color, else Google's.
  const defaultColor = (id, orig) => {
    const t = index.tasks[id];
    const lc = t && settings.listColors[t.listId];
    return C.isColor(lc) ? lc : (orig || null);
  };
  const effectiveColor = (id, orig) => {
    const r = C.resolve(id, settings, index);
    return (r && r.color) || orig || '#039be5';
  };

  function defaultTitle(id) {
    const t = index.tasks[id];
    if (t && C.isColor(settings.listColors[t.listId])) return `Use the list color (${C.listName(index, t.listId)})`;
    return 'Use the default color';
  }

  function toggleMenu(trig) {
    const id = trig.dataset.taskId;
    M.toggle(trig, {
      value: settings.taskColors[id],
      fallback: defaultColor(id, trig.dataset.orig),
      defaultTitle: defaultTitle(id),
      // Inside the popup so Calendar treats clicks on the menu as "inside".
      host: trig.closest('[role="dialog"]') || document.body,
      onPick: (color) => S.setTaskColor(id, color),
    });
  }

  function cleanupDetail() {
    const cur = M.current();
    if (cur && cur.trigger.dataset.taskId) M.close();
    for (const n of document.querySelectorAll('.rcc-detail .rcc-trigger,.rcc-row')) n.remove();
    for (const n of document.querySelectorAll('.rcc-orig-dot')) n.classList.remove('rcc-orig-dot');
    for (const n of document.querySelectorAll('.rcc-detail')) n.classList.remove('rcc-detail');
  }

  function onChipActivate(e) {
    const t = e.target;
    if (!t.closest || t.closest('.rcc-menu,.rcc-trigger,.rcc-detail')) return;
    const chip = t.closest('[data-eventid]');
    if (!chip) return;
    const id = chipMap.get(chip.getAttribute('data-eventid')) || getTaskIdFromChip(chip);
    lastClick = id ? { id, at: Date.now() } : null;
    cleanupDetail(); // Calendar may reuse the same popup for the next item
    schedule();
  }
  document.addEventListener('click', onChipActivate, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onChipActivate(e); }, true);

  function taskIdForDialog(dialog) {
    for (const el of dialog.querySelectorAll('[data-eventid],[data-taskid]')) {
      const id = getTaskIdFromChip(el);
      if (id) return id;
    }
    if (lastClick && Date.now() - lastClick.at < 4000) return lastClick.id;
    return null;
  }

  // The button is wider than Google's circle, whose column is fixed-width, so
  // it can crowd the title. Shift it left (visually only, via transform) into
  // the popup's margin to keep a gap before the title.
  const TITLE_GAP = 12;
  function nudgeTrigger(trig, dialog) {
    if (!trig.isConnected || trig.closest('.rcc-row')) return;
    const base = trig.dataset.base || '0,0';
    const [bx, by] = base.split(',').map(Number);
    trig.style.transform = `translate(${bx}px,${by}px)`;
    const tr = trig.getBoundingClientRect();
    const mid = (tr.top + tr.bottom) / 2;
    let titleLeft = Infinity;
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim() || n.parentElement.closest('.rcc-trigger,.rcc-menu')) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width || r.top > mid || r.bottom < mid || r.left < tr.left) continue; // same line, to our right
      titleLeft = Math.min(titleLeft, r.left);
    }
    if (titleLeft === Infinity) return;
    const overlap = tr.right + TITLE_GAP - titleLeft;
    if (overlap <= 0) return;
    const room = Math.max(0, tr.left - (dialog.getBoundingClientRect().left + 8));
    trig.style.transform = `translate(${bx - Math.min(overlap, room)}px,${by}px)`;
  }
  window.addEventListener('resize', () => {
    for (const t of document.querySelectorAll('.rcc-detail .rcc-trigger')) nudgeTrigger(t, t.closest('.rcc-detail'));
  });

  function injectDetail(dialog, id) {
    const dot = findDot(dialog);
    const trig = P.trigger({ label: 'Task color', onClick: () => toggleMenu(trig) });
    trig.dataset.taskId = id;
    trig.setAttribute('aria-expanded', 'false');
    trig.addEventListener('keydown', (e) => e.stopPropagation());
    if (dot) {
      trig.dataset.orig = colorOf(dot) || '';
      const cs = getComputedStyle(dot);
      if (cs.position === 'absolute') {
        Object.assign(trig.style, { position: 'absolute', top: cs.top, left: cs.left });
        trig.dataset.base = '-4,-3';
      }
      dot.classList.add('rcc-orig-dot');
      dot.insertAdjacentElement('afterend', trig);
    } else {
      // Unknown layout: fall back to a labeled row at the bottom.
      const row = document.createElement('div');
      row.className = 'rcc-row';
      row.append(document.createTextNode('Color'), trig);
      dialog.appendChild(row);
    }
    dialog.classList.add('rcc-detail');
    trig.refresh = () => trig.setColor(effectiveColor(id, trig.dataset.orig));
    trig.refresh();
    nudgeTrigger(trig, dialog);
    log('detail control for', id, dot ? 'replacing dot' : 'in fallback row');
  }

  function checkDialogs() {
    M.closeIfDetached();
    if (!settings.enabled) return;
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!visible(dialog) || dialog.querySelector('.rcc-trigger')) continue;
      if (dialog.querySelector('[data-eventchip]')) continue; // a list of chips ("+N more"), not a details popup
      const id = taskIdForDialog(dialog);
      if (id) injectDetail(dialog, id);
    }
  }

  const refreshPanels = () => {
    if (!settings.enabled) { cleanupDetail(); return; }
    for (const t of document.querySelectorAll('.rcc-detail .rcc-trigger')) {
      if (t.refresh) t.refresh();
      M.update(t, settings.taskColors[t.dataset.taskId], defaultColor(t.dataset.taskId, t.dataset.orig));
    }
  };

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  let scheduled = false;
  function schedule() {
    if (scheduled || !ready) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (location.href !== lastUrl) { lastUrl = location.href; renderCss(); }
      scanChips();
      checkDialogs();
    }, 80);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  S.get().then((s) => {
    settings = { enabled: s.enabled, listColors: s.listColors, taskColors: s.taskColors };
    index = s.taskIndex;
    debug = s.debug;
    rebuildTitleMap();
    ready = true;
    renderCss();
    schedule();
  });

  S.onChange((ch) => {
    if (ch.debug) debug = ch.debug.newValue;
    let restyle = false;
    for (const k of ['enabled', 'listColors', 'taskColors']) {
      if (ch[k]) { settings[k] = ch[k].newValue ?? (k === 'enabled' ? true : {}); restyle = true; }
    }
    if (ch.taskIndex) {
      index = ch.taskIndex.newValue || { lists: {}, tasks: {} };
      rebuildTitleMap();
      // New tasks may now match chips we skipped, or chips we could only map
      // to a bare "tasks_<id>" id (they may match by title now).
      unmatched.clear();
      unmatchedTaskLike.clear();
      for (const [raw, id] of chipMap) if (!index.tasks[id]) chipMap.delete(raw);
      restyle = true;
      schedule();
    }
    if (restyle) { renderCss(); refreshPanels(); }
  });

  // ---------------------------------------------------------------------------
  // Diagnostics for the toolbar popup
  // ---------------------------------------------------------------------------
  function stats() {
    return {
      chips: document.querySelectorAll('[data-eventid]').length,
      matched: chipMap.size,
      unmatchedTaskLike: [...unmatchedTaskLike].slice(0, 10),
      chipTasksNotIndexed: [...new Set(chipMap.values())].filter((id) => !index.tasks[id]).slice(0, 10),
    };
  }

  // Ask inject.js (MAIN world) for its counters; it answers via postMessage.
  function mainWorldDiag(ids, find) {
    return new Promise((resolve) => {
      const done = (v) => { window.removeEventListener('message', onMsg); resolve(v); };
      const onMsg = (e) => { if (e.source === window && e.data && e.data.__rcc === 'diag') done(e.data.diag); };
      window.addEventListener('message', onMsg);
      window.postMessage({ __rcc: 'diag?', ids, find }, location.origin);
      setTimeout(() => done('no reply from inject.js'), 300);
    });
  }

  // find: the popup's search text, looked up in the raw responses inject.js kept.
  async function diagnostics(find) {
    const short = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
    const chips = [...document.querySelectorAll('[data-eventid]')];
    const taskLike = chips.filter((c) => /task/i.test(c.outerHTML));
    const attrNames = new Set();
    for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (/task/i.test(a.name)) attrNames.add(a.name);
    const lists = C.allLists(index);
    // Lists that tasks point to but whose own record we never parsed.
    const unnamed = lists.filter((l) => !index.lists[l.id]).map((l) => l.id);
    const st = stats();
    return {
      extension: chrome.runtime.getManifest().version,
      view: location.pathname,
      ...st,
      cachedLists: Object.keys(index.lists).length,
      cachedTasks: Object.keys(index.tasks).length,
      lists: lists.map((l) => `${index.lists[l.id] ? l.name : `(no name) ${l.id}`}: ${l.count} tasks`),
      sampleCachedTaskIds: Object.keys(index.tasks).slice(0, 5),
      sampleEventIds: chips.slice(0, 12).map((c) => c.getAttribute('data-eventid')),
      taskLikeChipCount: taskLike.length,
      taskLikeChipHtml: taskLike.slice(0, 2).map((c) => short(c.outerHTML, 1500)),
      attributesNamedTask: [...attrNames],
      iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '(no src)').split('?')[0]),
      dataCapture: await mainWorldDiag([...st.chipTasksNotIndexed.slice(0, 2), ...unnamed.slice(0, 2)], find),
      requests: [...new Set(performance.getEntriesByType('resource').map((r) => r.name.split('?')[0]))]
        .filter((u) => !/\.(js|css|png|svg|woff2?|gif|jpe?g|ico|webp)$/.test(u))
        .slice(0, 40),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg) return;
    if (msg.type === 'rcc:stats') reply(stats());
    else if (msg.type === 'rcc:diagnostics') { diagnostics(msg.find).then(reply); return true; }
  });
})();
