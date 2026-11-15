// chrome.storage.local wrapper. Everything lives in local storage: the scraped
// task index can be large, and per-task overrides would quickly exceed
// chrome.storage.sync's 8 KB-per-item quota.
(function (g) {
  if (g.RCCStore) return;
  const area = chrome.storage.local;

  const defaults = () => ({
    enabled: true,
    debug: false,
    listColors: {},
    taskColors: {},
    taskIndex: { lists: {}, tasks: {} },
  });

  async function setEntry(key, id, color) {
    const cur = (await area.get({ [key]: {} }))[key] || {};
    if (color) cur[id] = color;
    else delete cur[id];
    await area.set({ [key]: cur });
  }

  g.RCCStore = {
    get: () => area.get(defaults()),
    set: (obj) => area.set(obj),
    setTaskColor: (id, color) => setEntry('taskColors', id, color),
    setListColor: (id, color) => setEntry('listColors', id, color),
    onChange(fn) {
      chrome.storage.onChanged.addListener((changes, name) => { if (name === 'local') fn(changes); });
    },
  };
})(globalThis);
