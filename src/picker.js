// Google-Calendar-style color controls, shared by the in-Calendar task popup
// and the toolbar popup:
//   trigger(): a colored circle with a ▾ caret (opens the menu)
//   create():  the menu: custom-color pencil, 24-color grid, "Default" button
// Built with DOM APIs only (no innerHTML): Calendar enforces Trusted Types.
(function (g) {
  if (g.RCCPicker) return;
  const { PALETTE, isColor, textOn } = g.RCCColors;

  const ICONS = {
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    pencil: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    caret: 'M7 10l5 5 5-5z',
  };

  const CSS = `
.rcc-menu{--rcc-bg:#fff;--rcc-fg:#1f1f1f;--rcc-btn:#f0f4f9;--rcc-btn-hover:#e1e5ea;--rcc-ring:#747775;--rcc-sw:22px;--rcc-gap:9px;--rcc-cols:13;
  all:initial;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:12px;
  background:var(--rcc-bg);color:var(--rcc-fg);font:500 14px/20px "Google Sans",Roboto,system-ui,sans-serif;
  box-shadow:0 4px 8px 3px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.3)}
.rcc-menu.rcc-dark{--rcc-bg:#1e1f20;--rcc-fg:#e3e3e3;--rcc-btn:#333537;--rcc-btn-hover:#404244;--rcc-ring:#8e918f}
.rcc-menu.rcc-inline{box-shadow:none;background:transparent;padding:8px 0 12px}
.rcc-menu.rcc-floating{position:fixed;z-index:2147483000}
.rcc-menu *{box-sizing:border-box}
.rcc-menu .rcc-custom{position:relative;width:36px;height:36px;border-radius:50%;border:1px solid var(--rcc-ring);
  display:grid;place-items:center;cursor:pointer;color:var(--rcc-fg);overflow:hidden}
.rcc-menu .rcc-custom:hover{background:var(--rcc-btn)}
.rcc-menu .rcc-custom svg{width:18px;height:18px;fill:currentColor;pointer-events:none}
.rcc-menu .rcc-custom input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0;margin:0}
.rcc-menu .rcc-grid{display:grid;grid-template-columns:repeat(var(--rcc-cols),var(--rcc-sw));gap:var(--rcc-gap)}
.rcc-menu .rcc-sw{all:unset;width:var(--rcc-sw);height:var(--rcc-sw);border-radius:50%;cursor:pointer;display:grid;place-items:center;
  transition:transform .1s}
.rcc-menu .rcc-sw:hover{transform:scale(1.15)}
.rcc-menu .rcc-sw:focus-visible,.rcc-menu .rcc-default:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}
.rcc-menu .rcc-sw svg{width:16px;height:16px}
.rcc-menu .rcc-default{all:unset;display:flex;align-items:center;justify-content:center;gap:10px;height:44px;border-radius:10px;
  background:var(--rcc-btn);color:var(--rcc-fg);cursor:pointer;font:inherit}
.rcc-menu .rcc-default:hover{background:var(--rcc-btn-hover)}
.rcc-menu .rcc-default .rcc-dot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center}
.rcc-menu .rcc-default .rcc-dot.rcc-none{border:1px dashed var(--rcc-ring)}
.rcc-menu .rcc-default svg{width:16px;height:16px}
.rcc-trigger{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:2px;padding:4px 2px 4px 6px;border-radius:8px;
  cursor:pointer;vertical-align:middle;color:inherit;background:rgba(127,127,127,.14);flex:none}
.rcc-trigger:hover{background:rgba(127,127,127,.24)}
.rcc-trigger:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}
.rcc-trigger .rcc-dot{width:18px;height:18px;border-radius:50%}
.rcc-trigger .rcc-dot.rcc-none{background:transparent;box-shadow:inset 0 0 0 1.5px currentColor;opacity:.55}
.rcc-trigger svg{width:20px;height:20px;fill:currentColor;opacity:.75}
`;

  function icon(name, fill) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (fill) svg.setAttribute('fill', fill);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  // opts: { value, fallback, onPick(colorOrNull), defaultTitle, dark, inline, cols, size, gap }
  function create(opts) {
    const menu = el('div', 'rcc-menu');
    if (opts.dark) menu.classList.add('rcc-dark');
    if (opts.inline) menu.classList.add('rcc-inline');
    if (opts.cols) menu.style.setProperty('--rcc-cols', opts.cols);
    if (opts.size) menu.style.setProperty('--rcc-sw', `${opts.size}px`);
    if (opts.gap) menu.style.setProperty('--rcc-gap', `${opts.gap}px`);
    menu.setAttribute('role', 'menu');

    const top = el('div');
    const custom = el('label', 'rcc-custom');
    custom.title = 'Custom color';
    const input = el('input');
    input.type = 'color';
    input.setAttribute('aria-label', 'Custom color');
    input.addEventListener('change', () => opts.onPick(input.value));
    custom.append(icon('pencil'), input);
    top.appendChild(custom);

    const grid = el('div', 'rcc-grid');
    const def = el('button', 'rcc-default');
    def.type = 'button';
    def.title = opts.defaultTitle || 'Default color';
    const defDot = el('span', 'rcc-dot');
    def.append(defDot, document.createTextNode('Default'));
    def.addEventListener('click', () => opts.onPick(null));

    menu.append(top, grid, def);

    menu.update = (value, fallback) => {
      const v = isColor(value) ? value.toLowerCase() : null;
      const colors = PALETTE.slice();
      if (v && !colors.some(([, hex]) => hex === v)) colors.push(['Custom', v]);
      grid.replaceChildren(...colors.map(([name, hex]) => {
        const b = el('button', 'rcc-sw');
        b.type = 'button';
        b.title = name;
        b.setAttribute('aria-label', name);
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(hex === v));
        b.style.background = hex;
        if (hex === v) b.appendChild(icon('check', textOn(hex)));
        b.addEventListener('click', () => opts.onPick(hex));
        return b;
      }));
      input.value = v || (isColor(fallback) ? fallback : '#039be5');
      defDot.replaceChildren();
      defDot.classList.toggle('rcc-none', !isColor(fallback));
      defDot.style.background = isColor(fallback) ? fallback : '';
      if (!v) defDot.appendChild(icon('check', isColor(fallback) ? textOn(fallback) : 'currentColor'));
      def.setAttribute('aria-pressed', String(!v));
    };
    menu.update(opts.value, opts.fallback);
    return menu;
  }

  // The circle + caret button that opens the menu.
  function trigger({ onClick, label }) {
    const b = el('button', 'rcc-trigger');
    b.type = 'button';
    b.title = label || 'Task color';
    b.setAttribute('aria-label', label || 'Task color');
    b.setAttribute('aria-haspopup', 'menu');
    const dot = el('span', 'rcc-dot');
    b.append(dot, icon('caret'));
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    // A falsy color shows an empty ring ("no color set").
    b.setColor = (c) => {
      dot.classList.toggle('rcc-none', !c);
      dot.style.background = c || '';
    };
    return b;
  }

  g.RCCPicker = { create, trigger, icon, CSS };
})(globalThis);
