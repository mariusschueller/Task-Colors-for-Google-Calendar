// Adds a "● ▾" list-color button next to the list name in the Tasks side
// panel header ("TASKS / My Tasks ▾"). That header normally lives in the
// embedded tasks.google.com frame; as a fallback this also looks in the top
// Calendar frame, just above the Tasks iframe.
//
// The header is found by text: the topmost visible, large-ish text that
// exactly matches a known list name. Switching lists in the panel re-targets
// the button.
(() => {
  const C = globalThis.RCCColors;
  const S = globalThis.RCCStore;
  const P = globalThis.RCCPicker;
  const M = globalThis.RCCMenu;
  if (!C || !S || !P || !M || globalThis.__rccListHeader) return;

  const inTasks = location.hostname === 'tasks.google.com';
  const inCalendarTop = location.hostname === 'calendar.google.com' && window.top === window;
  if (!inTasks && !inCalendarTop) return;
  globalThis.__rccListHeader = true;

  let debug = false;
  const log = (...a) => { if (debug) console.debug('[rcc]', ...a); };

  let settings = { enabled: true, listColors: {} };
  let index = { lists: {}, tasks: {} };
  let names = new Map(); // normalized list name -> [listId]
  let ready = false;
  let trig = null; // the button, with .textNode/.anchor/.nameKey of what it's attached to

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'rcc-list-style';
    // In the Calendar frame content.js already added the picker CSS.
    style.textContent = (document.getElementById('rcc-base-style') ? '' : P.CSS) + `
.rcc-list-trigger{position:absolute!important;margin:0!important;z-index:1}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function rebuildNames() {
    names = new Map();
    for (const l of C.allLists(index)) {
      const k = norm(l.name);
      if (!k) continue;
      if (!names.has(k)) names.set(k, []);
      names.get(k).push(l.id);
    }
  }

  // Where to look: the whole Tasks frame, or (in Calendar) the strip just
  // above a visible Tasks iframe.
  function searchBox() {
    if (inTasks) return { left: 0, right: innerWidth, top: 0, bottom: 200 };
    for (const f of document.querySelectorAll('iframe[src*="tasks.google.com"]')) {
      const r = f.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { left: r.left - 4, right: r.right + 4, top: r.top - 140, bottom: r.top + 4 };
    }
    return null;
  }

  function findHeader() {
    if (!names.size || !document.body) return null;
    const box = searchBox();
    if (!box) return null;
    let best = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const key = norm(n.nodeValue);
      if (!key || !names.has(key)) continue;
      const el = n.parentElement;
      if (!el || el.closest('.rcc-menu,.rcc-trigger,[data-eventid],[role="dialog"],[role="menu"],[role="listbox"],[role="option"]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top < box.top || r.top > box.bottom || r.left < box.left || r.right > box.right) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 15) continue; // the header name is large; list rows aren't
      if (!best || r.top < best.r.top) best = { node: n, el, r, key, ids: names.get(key) };
    }
    return best;
  }

  // Put the button after the list switcher ("My Tasks ▾"), not between the
  // name and Google's caret.
  function anchorFor(el) {
    const btn = el.closest('button,[role="button"],[aria-haspopup],[role="combobox"]');
    if (btn && btn.getBoundingClientRect().width < innerWidth * 0.8) return btn;
    const parent = el.parentElement;
    if (parent && parent.querySelector(':scope > svg, :scope > * > svg')) return parent;
    return el;
  }

  function listName(id) { return C.listName(index, id); }

  // Where the switcher visibly ends: the list name's text plus Google's ▾
  // caret, which may sit well to the right of the name (the switcher is a
  // fixed-width box). Carets can be SVGs or icon-font glyphs, so look for
  // small icon-sized boxes on the name's line, a short way to its right.
  function visualEnd(textNode, anchor) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const tr = range.getBoundingClientRect();
    const midY = tr.top + tr.height / 2;
    let right = tr.right;
    // Only the switcher's own box counts: other icons on the same line (open
    // in new tab, close) must not. If the anchor is just the name, allow the
    // element right after it (a caret sibling).
    const box = anchor.getBoundingClientRect();
    const candidates = [...anchor.querySelectorAll('*')];
    if (anchor === textNode.parentElement && anchor.nextElementSibling) {
      candidates.push(anchor.nextElementSibling, ...anchor.nextElementSibling.querySelectorAll('*'));
    }
    for (const el of candidates) {
      if (el.closest('.rcc-trigger')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.width > 40 || r.height < 6 || r.height > 40) continue;
      if (r.top > midY || r.bottom < midY) continue; // not on the name's line
      if (r.left < tr.right - 2) continue;
      const inside = r.right <= box.right + 2;
      const adjacent = anchor === textNode.parentElement && r.left - tr.right <= 40;
      if (!inside && !adjacent) continue;
      if (r.right > right) right = r.right;
    }
    return { right, midY };
  }

  // Float the button just right of the switcher, centered on the name's line,
  // without touching Google's layout (it stacks the header vertically, so a
  // normal sibling would wrap onto its own line).
  function placeTrigger() {
    if (!trig || !trig.textNode || !trig.textNode.isConnected) return;
    const end = visualEnd(trig.textNode, trig.anchor);
    trig.style.left = '0px';
    trig.style.top = '0px';
    const o = trig.getBoundingClientRect(); // where (0,0) lands for its containing block
    trig.style.left = `${Math.round(end.right + 10 - o.left)}px`;
    trig.style.top = `${Math.round(end.midY - o.height / 2 - o.top)}px`;
  }

  function refresh() {
    if (!trig) return;
    const id = trig.dataset.listId;
    const color = settings.listColors[id];
    trig.setColor(C.isColor(color) ? color : null);
    const label = `Color for “${listName(id)}”`;
    trig.title = label;
    trig.setAttribute('aria-label', label);
    M.update(trig, color, null);
  }

  function makeTrigger() {
    const t = P.trigger({
      label: 'List color',
      onClick: () => {
        const id = t.dataset.listId;
        M.toggle(t, {
          value: settings.listColors[id],
          fallback: null,
          defaultTitle: `No color for “${listName(id)}” (keep Google’s default)`,
          onPick: (color) => S.setListColor(id, color),
        });
      },
    });
    t.classList.add('rcc-list-trigger');
    t.setAttribute('aria-expanded', 'false');
    // Don't let the header (e.g. the list switcher) react to our clicks/keys.
    for (const type of ['click', 'mousedown', 'pointerdown', 'keydown']) t.addEventListener(type, (e) => e.stopPropagation());
    return t;
  }

  function removeTrigger() {
    if (!trig) return;
    if (M.current() && M.current().trigger === trig) M.close();
    trig.remove();
    trig = null;
  }

  function check() {
    M.closeIfDetached();
    if (!settings.enabled) { removeTrigger(); return; }
    // Fast path: still attached to the same, unchanged header.
    if (trig && trig.isConnected && trig.textNode && trig.textNode.isConnected &&
        norm(trig.textNode.nodeValue) === trig.nameKey && trig.previousElementSibling === trig.anchor) {
      placeTrigger();
      return;
    }
    const h = findHeader();
    if (!h || h.ids.length !== 1) {
      if (h) log('list header name is ambiguous:', h.key, h.ids);
      removeTrigger();
      return;
    }
    const anchor = anchorFor(h.el);
    if (!trig) trig = makeTrigger();
    if (trig.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', trig);
    Object.assign(trig, { textNode: h.node, anchor, nameKey: h.key });
    if (trig.dataset.listId !== h.ids[0]) {
      if (M.current() && M.current().trigger === trig) M.close();
      trig.dataset.listId = h.ids[0];
      log('list header button for', h.ids[0], listName(h.ids[0]));
    }
    refresh();
    placeTrigger();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled || !ready) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; check(); }, inTasks ? 120 : 300);
  }

  injectStyles();
  window.addEventListener('resize', placeTrigger);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  S.get().then((s) => {
    settings = { enabled: s.enabled, listColors: s.listColors };
    index = s.taskIndex;
    debug = s.debug;
    rebuildNames();
    ready = true;
    schedule();
  });

  S.onChange((ch) => {
    if (ch.debug) debug = ch.debug.newValue;
    if (ch.enabled) settings.enabled = ch.enabled.newValue ?? true;
    if (ch.listColors) settings.listColors = ch.listColors.newValue || {};
    if (ch.taskIndex) {
      index = ch.taskIndex.newValue || { lists: {}, tasks: {} };
      rebuildNames();
      if (trig) trig.nameKey = null; // force a re-check against the new names
    }
    refresh();
    schedule();
  });
})();
