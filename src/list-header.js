// Adds a "● ▾" list-color button next to list names in Google Tasks:
//  * The Tasks side panel embedded in Calendar (a tasks.google.com frame)
//    shows one list at a time under its header ("TASKS / My Tasks ▾"). As a
//    fallback this also looks in the top Calendar frame, just above the
//    Tasks iframe.
//  * The full-page Tasks app (tasks.google.com in its own tab) shows several
//    lists side by side, each under its own header. Each gets a button.
//
// Headers are found by text: visible, large-ish text that exactly matches a
// known list name. In the side panel that's the topmost match, and switching
// lists re-targets the button. In the full-page app it's every match in the
// largest such font, one per list.
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
  const multi = inTasks && window.top === window; // the full-page app

  let debug = false;
  const log = (...a) => { if (debug) console.debug('[rcc]', ...a); };

  let settings = { enabled: true, listColors: {} };
  let index = { lists: {}, tasks: {} };
  let names = new Map(); // normalized list name -> [listId]
  let ready = false;
  // listId -> its button, with .textNode/.anchor/.scrollers of the header it's attached to
  const triggers = new Map();
  const loggedAmbiguous = new Set();

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Never a list header: our own UI, Calendar chips, Google's popups and
  // menus. In the full-page app also its top bar, so a list named "Tasks"
  // doesn't match the app's name next to the logo.
  const SKIP = '.rcc-menu,.rcc-trigger,[data-eventid],[role="dialog"],[role="menu"],[role="listbox"],[role="option"]' +
    (multi ? ',[role="banner"]' : '');

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

  // Where the side panel's header can be: the top of the Tasks frame, or (in
  // Calendar) the strip just above a visible Tasks iframe.
  function searchBox() {
    if (inTasks) return { left: 0, right: innerWidth, top: 0, bottom: 200 };
    for (const f of document.querySelectorAll('iframe[src*="tasks.google.com"]')) {
      const r = f.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { left: r.left - 4, right: r.right + 4, top: r.top - 140, bottom: r.top + 4 };
    }
    return null;
  }

  // Visible text that exactly matches a list name, in a header-sized font.
  // The full-page app is searched whole: its list columns can sit below the
  // top or off to the side in a board that scrolls.
  function candidates() {
    if (!names.size || !document.body) return [];
    const box = multi ? null : searchBox();
    if (!multi && !box) return [];
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const key = norm(n.nodeValue);
      if (!key || !names.has(key)) continue;
      const el = n.parentElement;
      if (!el || el.closest(SKIP)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (box && (r.top < box.top || r.top > box.bottom || r.left < box.left || r.right > box.right)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 15) continue; // headers are large; list rows (menus, side nav) aren't
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue;
      out.push({ node: n, el, r, key, ids: names.get(key), size });
    }
    return out;
  }

  function findHeaders() {
    const all = candidates();
    if (!multi) {
      let best = null;
      for (const c of all) if (!best || c.r.top < best.r.top) best = c;
      return best ? [best] : [];
    }
    // All list headers share one style. Smaller matches (e.g. a task titled
    // like a list) aren't headers. Per name, keep the topmost, then leftmost.
    const largest = Math.max(0, ...all.map((c) => c.size));
    const byName = new Map();
    for (const c of all) {
      if (c.size < largest - 1) continue;
      const cur = byName.get(c.key);
      if (!cur || c.r.top < cur.r.top - 2 || (Math.abs(c.r.top - cur.r.top) <= 2 && c.r.left < cur.r.left)) byName.set(c.key, c);
    }
    return [...byName.values()];
  }

  // Put the button after the list switcher ("My Tasks ▾"), not between the
  // name and Google's caret. Our own button's caret doesn't count: once
  // inserted next to the name it would otherwise make the name's parent look
  // like a switcher, and the button would hop between the two on every check.
  function anchorFor(el) {
    const btn = el.closest('button,[role="button"],[aria-haspopup],[role="combobox"]');
    if (btn && btn.getBoundingClientRect().width < innerWidth * 0.8) return btn;
    const parent = el.parentElement;
    if (parent && [...parent.querySelectorAll(':scope > svg, :scope > * > svg')].some((s) => !s.closest('.rcc-trigger'))) return parent;
    return el;
  }

  // Boxes around a header that scroll (e.g. a board of list columns that
  // scrolls sideways). The button may not scroll or clip with them, so it's
  // hidden while it sits outside one.
  function scrollParents(el) {
    const out = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/auto|scroll|overlay/.test(`${cs.overflowX} ${cs.overflowY}`)) out.push(p);
    }
    return out;
  }

  function listName(id) { return C.listName(index, id); }

  const CONTROL = 'button,[role="button"],a[href]';
  // Part of a control other than the one holding the list name (e.g. a
  // column's ⋮ menu in the full-page app), or a box wrapped around one.
  const otherControl = (el, textNode) => {
    const c = el.closest(CONTROL);
    if (c) return !c.contains(textNode);
    for (const d of el.querySelectorAll(CONTROL)) if (!d.contains(textNode)) return true;
    return false;
  };

  // Where the switcher visibly ends: the list name's text plus Google's ▾
  // caret, which may sit well to the right of the name (the switcher is a
  // fixed-width box). Carets can be SVGs or icon-font glyphs, so look for
  // small icon-sized boxes on the name's line, a short way to its right.
  // In the full-page app, also where the next control on that line starts
  // (`limit`), so the button doesn't cover it.
  function visualEnd(textNode, anchor) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const tr = range.getBoundingClientRect();
    const midY = tr.top + tr.height / 2;
    let right = tr.right;
    // A truncated name ("Side proj…") ends where its box clips it.
    const holder = textNode.parentElement;
    if (getComputedStyle(holder).overflowX !== 'visible') right = Math.min(right, holder.getBoundingClientRect().right);
    // Only the switcher's own box counts: other icons on the same line (open
    // in new tab, close) must not. If the anchor is just the name, allow the
    // element right after it (a caret sibling).
    const box = anchor.getBoundingClientRect();
    const candidates = [...anchor.querySelectorAll('*')];
    if (anchor === holder && anchor.nextElementSibling) {
      candidates.push(anchor.nextElementSibling, ...anchor.nextElementSibling.querySelectorAll('*'));
    }
    const nameEnd = right;
    for (const el of candidates) {
      if (el.closest('.rcc-trigger')) continue;
      if (multi && otherControl(el, textNode)) continue; // a column's list has no caret
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.width > 40 || r.height < 6 || r.height > 40) continue;
      if (r.top > midY || r.bottom < midY) continue; // not on the name's line
      if (r.left < nameEnd - 2) continue;
      const inside = r.right <= box.right + 2;
      const adjacent = anchor === holder && r.left - nameEnd <= 40;
      if (!inside && !adjacent) continue;
      if (r.right > right) right = r.right;
    }
    let limit = Infinity;
    if (multi) {
      for (const el of (anchor.parentElement || anchor).querySelectorAll(CONTROL)) {
        if (el.closest('.rcc-trigger') || !otherControl(el, textNode)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.top > midY || r.bottom < midY || r.left < tr.left) continue;
        limit = Math.min(limit, r.left);
      }
    }
    return { right, midY, limit, start: tr.left };
  }

  // Float each button just right of its switcher, centered on the name's
  // line, without touching Google's layout (the side panel stacks its header
  // vertically, so a normal sibling would wrap onto its own line). All reads
  // come before any writes, so placing many buttons costs one layout.
  function placeAll() {
    const moves = [];
    for (const t of triggers.values()) {
      if (!t.textNode || !t.textNode.isConnected) continue;
      const end = visualEnd(t.textNode, t.anchor);
      const r = t.getBoundingClientRect();
      // Where (0,0) lands for its containing block (left/top are always set).
      const ox = r.left - parseFloat(t.style.left);
      const oy = r.top - parseFloat(t.style.top);
      // Before the next control if there's no room (it covers the end of a
      // long name instead).
      const left = Math.max(end.start, Math.min(end.right + 10, end.limit - 6 - r.width));
      const top = end.midY - r.height / 2;
      const shown = t.scrollers.every((s) => {
        const b = s.getBoundingClientRect();
        return left >= b.left - 1 && left + r.width <= b.right + 1 && top >= b.top - 1 && top + r.height <= b.bottom + 1;
      });
      moves.push({ t, x: Math.round(left - ox), y: Math.round(top - oy), shown });
    }
    for (const { t, x, y, shown } of moves) {
      const set = (prop, v) => { if (t.style[prop] !== v) t.style[prop] = v; };
      set('left', `${x}px`);
      set('top', `${y}px`);
      set('visibility', shown ? '' : 'hidden');
      if (!shown && M.current() && M.current().trigger === t) M.close();
    }
  }

  let placeQueued = false;
  function schedulePlace() {
    if (placeQueued || !triggers.size) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; placeAll(); });
  }

  function refresh(t) {
    const id = t.dataset.listId;
    const color = settings.listColors[id];
    t.setColor(C.isColor(color) ? color : null);
    const label = `Color for “${listName(id)}”`;
    t.title = label;
    t.setAttribute('aria-label', label);
    M.update(t, color, null);
  }

  function makeTrigger(id) {
    const t = P.trigger({
      label: 'List color',
      onClick: () => {
        M.toggle(t, {
          value: settings.listColors[id],
          fallback: null,
          defaultTitle: `No color for “${listName(id)}” (keep Google’s default)`,
          onPick: (color) => S.setListColor(id, color),
        });
      },
    });
    t.dataset.listId = id;
    t.classList.add('rcc-list-trigger');
    t.setAttribute('aria-expanded', 'false');
    t.style.left = '0px';
    t.style.top = '0px';
    t.scrollers = [];
    // Don't let the header (e.g. the list switcher) react to our clicks/keys.
    for (const type of ['click', 'mousedown', 'pointerdown', 'keydown']) t.addEventListener(type, (e) => e.stopPropagation());
    refresh(t);
    return t;
  }

  function removeTrigger(id) {
    const t = triggers.get(id);
    if (!t) return;
    if (M.current() && M.current().trigger === t) M.close();
    t.remove();
    triggers.delete(id);
  }

  // Re-place the buttons when a scrolling box around them changes size
  // (e.g. the full-page app's side nav opens or closes).
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePlace) : null;
  function observeScrollers() {
    if (!resizeObserver) return;
    resizeObserver.disconnect();
    for (const t of triggers.values()) for (const s of t.scrollers) resizeObserver.observe(s);
  }

  function check() {
    M.closeIfDetached();
    if (!settings.enabled) {
      for (const id of [...triggers.keys()]) removeTrigger(id);
      return;
    }
    const want = new Map(); // listId -> header
    for (const h of findHeaders()) {
      if (h.ids.length === 1) want.set(h.ids[0], h);
      else if (!loggedAmbiguous.has(h.key)) {
        loggedAmbiguous.add(h.key);
        log('list header name is ambiguous:', h.key, h.ids);
      }
    }
    // A button still in place after the same header keeps its anchor, so a
    // check never moves it unless Google re-rendered the header. Two headers
    // resolving to one anchor would make their buttons displace each other
    // on every check; only the first gets one.
    const claimed = new Set();
    for (const [id, h] of want) {
      const t = triggers.get(id);
      const kept = t && t.isConnected && t.headerEl === h.el && t.previousElementSibling === t.anchor && t.anchor.contains(h.el);
      const anchor = kept ? t.anchor : anchorFor(h.el);
      if (claimed.has(anchor)) want.delete(id);
      else { claimed.add(anchor); h.anchor = anchor; }
    }
    for (const id of [...triggers.keys()]) if (!want.has(id)) removeTrigger(id);
    let moved = false;
    for (const [id, h] of want) {
      let t = triggers.get(id);
      if (!t) {
        t = makeTrigger(id);
        triggers.set(id, t);
        log('list header button for', id, listName(id));
      }
      const { anchor } = h;
      if (!t.isConnected || t.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', t);
        t.scrollers = multi ? scrollParents(anchor) : [];
        moved = true;
      }
      t.textNode = h.node;
      t.headerEl = h.el;
      t.anchor = anchor;
    }
    if (moved) observeScrollers();
    placeAll();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled || !ready) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; check(); }, inTasks ? 120 : 300);
  }

  injectStyles();
  window.addEventListener('resize', schedulePlace);
  window.addEventListener('scroll', schedulePlace, { capture: true, passive: true });
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
      loggedAmbiguous.clear();
    }
    for (const t of triggers.values()) refresh(t);
    schedule();
  });
})();
