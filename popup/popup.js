const C = globalThis.RCCColors;
const S = globalThis.RCCStore;
const MAX_TASKS = 60;

const $ = (id) => document.getElementById(id);

// Shared picker styles (the same menu the Calendar popup uses).
const pickerStyle = document.createElement('style');
pickerStyle.textContent = globalThis.RCCPicker.CSS;
document.head.appendChild(pickerStyle);

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
// Inline menu sized for the 360px popup: 12 columns of 20px swatches.
const menu = (opts) => globalThis.RCCPicker.create({ inline: true, dark: dark(), cols: 12, size: 20, gap: 6, ...opts });
let state = null;
const open = new Set(); // keys of expanded rows, kept across re-renders

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function row(key, { color, name, meta, badge, picker }) {
  const r = el('div', 'row');
  if (open.has(key)) r.classList.add('open');
  const main = el('button', 'row-main');
  main.type = 'button';
  main.setAttribute('aria-expanded', String(open.has(key)));
  const dot = el('span', 'dot' + (color ? ' set' : ''));
  if (color) dot.style.background = color;
  const label = el('span', 'label');
  label.append(el('span', 'name', name));
  if (meta) label.append(el('span', 'meta', meta));
  main.append(dot, label);
  if (badge) main.append(el('span', 'badge', badge));
  main.addEventListener('click', () => {
    if (open.has(key)) open.delete(key); else open.add(key);
    render();
  });
  r.append(main);
  if (open.has(key)) r.append(picker());
  return r;
}

function renderLists() {
  const box = $('lists');
  box.replaceChildren();
  const lists = C.allLists(state.taskIndex);
  if (!lists.length) {
    box.append(el('div', 'empty', 'No lists yet. Open Google Calendar with tasks visible and they’ll appear here.'));
    return;
  }
  for (const l of lists) {
    const color = state.listColors[l.id];
    box.append(row(`l:${l.id}`, {
      color,
      name: l.name,
      meta: `${l.count} task${l.count === 1 ? '' : 's'}`,
      picker: () => menu({
        value: color,
        defaultTitle: 'No list color (keep Google’s default)',
        onPick: (c) => S.setListColor(l.id, c),
      }),
    }));
  }
}

function renderTasks() {
  const box = $('tasks');
  box.replaceChildren();
  const q = $('search').value.trim().toLowerCase();
  const onlyCustom = $('onlyCustom').checked;
  const idx = state.taskIndex;
  let tasks = Object.values(idx.tasks).filter((t) => {
    if (onlyCustom && !state.taskColors[t.id]) return false;
    if (!q) return true;
    return t.title.toLowerCase().includes(q) || C.listName(idx, t.listId).toLowerCase().includes(q) || (t.date || '').includes(q);
  });
  tasks.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  const total = tasks.length;
  tasks = tasks.slice(0, MAX_TASKS);

  if (!total) {
    box.append(el('div', 'empty', Object.keys(idx.tasks).length ? 'No matching tasks.' : 'No tasks found yet.'));
    return;
  }
  for (const t of tasks) {
    const r = C.resolve(t.id, state, idx);
    const meta = [C.listName(idx, t.listId), t.date].filter(Boolean).join(' · ');
    box.append(row(`t:${t.id}`, {
      color: r && r.color,
      name: t.title || '(untitled)',
      meta,
      badge: r && r.source === 'task' ? 'custom' : null,
      picker: () => menu({
        value: state.taskColors[t.id],
        fallback: state.listColors[t.listId],
        defaultTitle: 'Use the list color',
        onPick: (c) => S.setTaskColor(t.id, c),
      }),
    }));
  }
  if (total > tasks.length) box.append(el('div', 'empty', `Showing ${tasks.length} of ${total}. Refine the search to see more.`));
}

function render() {
  $('enabled').checked = state.enabled;
  $('debug').checked = state.debug;
  renderLists();
  renderTasks();
}

async function loadStatus() {
  const idx = state.taskIndex;
  const nLists = C.allLists(idx).length;
  const nTasks = Object.keys(idx.tasks).length;
  let text = `${nLists} list${nLists === 1 ? '' : 's'} · ${nTasks} task${nTasks === 1 ? '' : 's'} cached.`;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const stats = tab && await chrome.tabs.sendMessage(tab.id, { type: 'rcc:stats' });
    if (stats) {
      text += ` This tab: ${stats.matched} task chip${stats.matched === 1 ? '' : 's'} recognized.`;
      if (stats.unmatchedTaskLike.length) {
        text += ` ${stats.unmatchedTaskLike.length} task-like chip(s) didn't match (ids logged to this popup's console).`;
        console.log('[rcc] unmatched task-like chip ids:', stats.unmatchedTaskLike);
      }
    }
  } catch (_) {
    text += ' Open Google Calendar to color your tasks.';
  }
  $('status').textContent = text;
}

async function init() {
  state = await S.get();
  render();
  loadStatus();

  $('enabled').addEventListener('change', (e) => S.set({ enabled: e.target.checked }));
  $('debug').addEventListener('change', (e) => S.set({ debug: e.target.checked }));
  $('search').addEventListener('input', renderTasks);
  $('onlyCustom').addEventListener('change', renderTasks);
  $('copyDiag').addEventListener('click', async () => {
    const btn = $('copyDiag');
    let report;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      report = await chrome.tabs.sendMessage(tab.id, { type: 'rcc:diagnostics' }, { frameId: 0 });
    } catch (e) {
      report = { error: `Couldn't reach the extension in this tab (${e.message}). Is this a Google Calendar tab, reloaded after installing/updating the extension?` };
    }
    report.storage = { lists: Object.keys(state.taskIndex.lists).length, tasks: Object.keys(state.taskIndex.tasks).length, listColors: state.listColors };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy diagnostics'; }, 1500);
  });
  $('clearIndex').addEventListener('click', async () => {
    if (!confirm('Forget all cached lists and tasks? Your colors are kept; tasks reappear the next time Calendar loads them.')) return;
    await S.set({ taskIndex: { lists: {}, tasks: {} } });
  });

  S.onChange(async () => {
    state = await S.get();
    render();
    loadStatus();
  });
}

init();
