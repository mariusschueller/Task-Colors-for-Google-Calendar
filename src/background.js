// Background service worker:
//  * Enables the toolbar button only on Google Calendar / Tasks pages.
//  * Merges task data reported by content scripts (from any frame) into
//    chrome.storage.local.taskIndex. Merges run one at a time so concurrent
//    reports from the Calendar page and the Tasks iframe can't clobber each other.

// --- Toolbar button: grayed out everywhere except Calendar and Tasks --------
// Our content script only runs on calendar.google.com / tasks.google.com, so
// "is our script in this tab's top frame?" is the relevance test. No tabs or
// host permissions needed.
const ORIGIN_RE = /^https:\/\/(calendar|tasks)\.google\.com\//;

// Disabled by default. Runs each time the worker starts; the onStartup
// listener makes it start (and run this) when the browser launches.
chrome.action.disable();
chrome.runtime.onStartup.addListener(() => {});

async function syncTab(tabId) {
  let relevant = false;
  try {
    relevant = (await chrome.tabs.sendMessage(tabId, { type: 'rcc:ping' }, { frameId: 0 })) === true;
  } catch (_) { /* no content script there: not a Calendar/Tasks page */ }
  try {
    await (relevant ? chrome.action.enable(tabId) : chrome.action.disable(tabId));
  } catch (_) { /* tab closed meanwhile */ }
}

// Re-check whenever a tab (re)loads or changes URL, e.g. leaving Calendar.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status || info.url) syncTab(tabId);
});

// --- Task index ---------------------------------------------------------------
const ID_RE = /^[\w~-]{4,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let chain = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !ORIGIN_RE.test(sender.url || '')) return;
  // A Calendar/Tasks page just loaded in this tab: light up the button now
  // rather than waiting for the tab's "complete" status.
  if (msg.type === 'rcc:page' && sender.tab && sender.frameId === 0) {
    chrome.action.enable(sender.tab.id).catch(() => {});
    return;
  }
  if (msg.type !== 'rcc:index') return;
  chain = chain.then(() => merge(msg)).catch((e) => console.warn('[rcc] merge failed', e));
});

async function merge({ lists, tasks }) {
  const { taskIndex } = await chrome.storage.local.get({ taskIndex: { lists: {}, tasks: {} } });
  let changed = false;

  for (const [id, name] of Object.entries(lists || {})) {
    if (!ID_RE.test(id) || typeof name !== 'string' || !name) continue;
    const clean = name.slice(0, 200);
    if (taskIndex.lists[id] !== clean) { taskIndex.lists[id] = clean; changed = true; }
  }

  for (const [id, t] of Object.entries(tasks || {})) {
    if (!ID_RE.test(id) || !t || typeof t.title !== 'string' || !ID_RE.test(t.listId || '')) continue;
    const next = {
      id,
      title: t.title.slice(0, 300),
      listId: t.listId,
      date: typeof t.date === 'string' && DATE_RE.test(t.date) ? t.date : null,
    };
    const prev = taskIndex.tasks[id];
    // Keep a known title/date if a later payload omits it (membership-only
    // entries from list records have neither).
    if (prev && !next.title) next.title = prev.title;
    if (prev && !next.date) next.date = prev.date;
    if (!prev || prev.title !== next.title || prev.listId !== next.listId || prev.date !== next.date) {
      taskIndex.tasks[id] = next;
      changed = true;
    }
  }

  if (changed) {
    taskIndex.updated = Date.now();
    await chrome.storage.local.set({ taskIndex });
  }
}
