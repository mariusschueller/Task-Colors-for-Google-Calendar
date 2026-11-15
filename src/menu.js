// Floating color-menu controller shared by every in-page color button (task
// details popup, Tasks panel list header). One menu is open at a time; it
// closes on outside click, Escape, or after a pick.
(function (g) {
  if (g.RCCMenu) return;
  const C = g.RCCColors;
  const P = g.RCCPicker;
  let open = null; // { menu, trigger }

  function rgbToHex(rgb) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(rgb || '');
    if (!m || m[4] === '0') return null;
    return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
  }

  // Google's light/dark theme, judged by the text color around `el`.
  function isDark(el) {
    const hex = rgbToHex(getComputedStyle(el).color);
    if (!hex) return matchMedia('(prefers-color-scheme: dark)').matches;
    return C.textOn(hex) === '#202124'; // light text => dark theme
  }

  // As many swatch columns (max 13, like Google) as fit the window, so the
  // menu also works inside the narrow Tasks side panel.
  function fitCols() {
    const size = 22, gap = 9, pad = 32;
    const avail = innerWidth - 16 - pad;
    return Math.max(6, Math.min(13, Math.floor((avail + gap) / (size + gap))));
  }

  function close() {
    if (!open) return;
    open.menu.remove();
    open.trigger.setAttribute('aria-expanded', 'false');
    open = null;
  }

  function place(menu, trig) {
    const r = trig.getBoundingClientRect();
    menu.style.left = '0px';
    menu.style.top = '0px';
    // Measure where (0,0) lands: a transformed ancestor would shift it.
    const o = menu.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 6;
    if (left + o.width > innerWidth - 8) left = Math.max(8, innerWidth - 8 - o.width);
    if (top + o.height > innerHeight - 8) top = Math.max(8, r.top - 6 - o.height);
    menu.style.left = `${left - o.left}px`;
    menu.style.top = `${top - o.top}px`;
  }

  // opts: { value, fallback, defaultTitle, onPick(colorOrNull), host }
  function toggle(trig, opts) {
    if (open) {
      const same = open.trigger === trig;
      close();
      if (same) return;
    }
    const menu = P.create({
      value: opts.value,
      fallback: opts.fallback,
      defaultTitle: opts.defaultTitle,
      dark: isDark(trig),
      cols: fitCols(),
      onPick: (color) => {
        close();
        trig.focus({ preventScroll: true });
        opts.onPick(color);
      },
    });
    menu.classList.add('rcc-floating');
    // Keep the page's handlers (shortcuts, click-outside-to-close) out of it.
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'wheel']) {
      menu.addEventListener(type, (e) => e.stopPropagation());
    }
    (opts.host || document.body).appendChild(menu);
    place(menu, trig);
    open = { menu, trigger: trig };
    trig.setAttribute('aria-expanded', 'true');
    const focus = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.rcc-default');
    if (focus) focus.focus({ preventScroll: true });
  }

  // Refresh the open menu if it belongs to `trig` (e.g. after a storage change).
  function update(trig, value, fallback) {
    if (open && open.trigger === trig) open.menu.update(value, fallback);
  }

  function closeIfDetached() {
    if (open && !open.trigger.isConnected) close();
  }

  document.addEventListener('pointerdown', (e) => {
    if (open && !open.menu.contains(e.target) && !open.trigger.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') {
      const trig = open.trigger;
      e.stopPropagation(); // close just the menu, not the popup/panel around it
      e.preventDefault();
      close();
      trig.focus({ preventScroll: true });
    }
  }, true);
  const reposition = () => { if (open) place(open.menu, open.trigger); };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  g.RCCMenu = { toggle, close, update, closeIfDetached, current: () => open, isDark, rgbToHex };
})(globalThis);
