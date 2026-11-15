// Palette, contrast and color-resolution helpers shared by content.js and the popup.
(function (g) {
  if (g.RCCColors) return;

  // Google Calendar's 24 colors, in the order its color menu shows them.
  const PALETTE = [
    ['Radicchio', '#ad1457'], ['Cherry blossom', '#d81b60'], ['Flamingo', '#e67c73'], ['Tomato', '#d50000'],
    ['Tangerine', '#f4511e'], ['Pumpkin', '#ef6c00'], ['Mango', '#f09300'], ['Banana', '#f6bf26'],
    ['Citron', '#e4c441'], ['Avocado', '#c0ca33'], ['Pistachio', '#7cb342'], ['Basil', '#0b8043'],
    ['Sage', '#33b679'], ['Eucalyptus', '#009688'], ['Peacock', '#039be5'], ['Cobalt', '#4285f4'],
    ['Lavender', '#7986cb'], ['Blueberry', '#3f51b5'], ['Wisteria', '#b39ddb'], ['Amethyst', '#9e69af'],
    ['Grape', '#8e24aa'], ['Cocoa', '#795548'], ['Graphite', '#616161'], ['Birch', '#a79b8e'],
  ];

  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const isColor = (c) => typeof c === 'string' && HEX_RE.test(c);

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  // White text unless the fill is light (contrast with white < 2.5:1), which
  // matches how Google Calendar labels its own event colors.
  function textOn(hex) {
    const vsWhite = 1.05 / (luminance(hex) + 0.05);
    return vsWhite >= 2.5 ? '#ffffff' : '#202124';
  }

  function listName(index, listId) {
    return (index && index.lists && index.lists[listId]) || (listId === '~default' ? 'My Tasks' : 'Unnamed list');
  }

  // Task override > list color > null (leave Google's default).
  function resolve(taskId, settings, index) {
    const tc = settings.taskColors && settings.taskColors[taskId];
    if (isColor(tc)) return { color: tc, source: 'task' };
    const task = index && index.tasks && index.tasks[taskId];
    const lc = task && settings.listColors && settings.listColors[task.listId];
    if (isColor(lc)) return { color: lc, source: 'list' };
    return null;
  }

  // Every list we know about, including ones only referenced by tasks.
  function allLists(index) {
    const out = new Map();
    for (const [id, name] of Object.entries((index && index.lists) || {})) out.set(id, { id, name, count: 0 });
    for (const t of Object.values((index && index.tasks) || {})) {
      if (!out.has(t.listId)) out.set(t.listId, { id: t.listId, name: listName(index, t.listId), count: 0 });
      out.get(t.listId).count++;
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // CSS for one chip selector. Only elements Calendar itself colors (inline
  // background-color / border-color) are recolored, so their shape (rounded
  // corners, shadows) is kept; the chip's outer container is a plain
  // rectangle and must stay transparent. Text is recolored only inside a
  // fill. In the schedule (agenda) view, rows aren't filled; only dots change.
  function chipCss(sel, color, agenda) {
    const t = textOn(color);
    const fill = [`${sel}[style*="background-color"]`, `${sel} [style*="background-color"]`];
    const line = [`${sel}[style*="border-color"]`, `${sel} [style*="border-color"]`];
    let css =
      `${line.join(',')}{border-color:${color}!important}` +
      `${fill.join(',')}{background-color:${color}!important}`;
    if (!agenda) {
      css +=
        `${fill.join(',')},${fill.map((f) => `${f} *`).join(',')}{color:${t}!important}` +
        `${fill.map((f) => `${f} svg`).join(',')}{fill:${t}!important}`;
    }
    return css;
  }

  g.RCCColors = { PALETTE, isColor, textOn, listName, resolve, allLists, chipCss };
})(globalThis);
