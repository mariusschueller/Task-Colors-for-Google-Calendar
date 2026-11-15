// Finds Google Tasks list/task records inside the nested-array payloads Google
// embeds in its pages (AF_initDataCallback) and returns from its RPC endpoints.
// Records are matched by shape rather than fixed paths, so the wrapper
// structure can change without breaking extraction.
//
// Observed shapes (see ../Calendar/cal/content.js for a captured sample):
//   list: ["<listId>", ["<name>", null, "user"], [], null, null, [ts, ns], ...]
//   task: ["<taskId>", [1, "<title>", null, [y, m, d]?, [ts, ns]], [ts, ns], "<listId>", ...]
// TasksApiService/Sync (json+protobuf) differs slightly: int64 seconds are
// strings and the first body field may be null, and list records carry the
// ids of their tasks:
//   list: ["<listId>", ["<name>", null, "user"], [[["<taskId>"], ...]], null, null, ["<secs>", ns], ...]
//   task: ["<taskId>", [null, "<title>", null, [y, m, d]?], ["<secs>", ns], "<listId>", ...]
//
// Loaded in both the page (MAIN) world and the extension (ISOLATED) world.
(function (g) {
  if (g.RCCParser) return;

  const ID_RE = /^[\w~-]{4,64}$/;
  const MAX_NODES = 2e6;
  // Cheap pre-filter so we only walk payloads that could contain records.
  // Tolerates the backslash-escaped quotes of JSON nested inside JSON strings.
  const HINT_RE = /\[\\*"[\w~-]{4,64}\\*",\s*\[\s*(?:(?:\d+|null),\s*\\*"|\\*"[^"\\]*\\*",)/;

  // [seconds, nanos]. AF_initDataCallback blobs use numbers; the
  // application/json+protobuf RPCs (e.g. TasksApiService/Sync) encode int64
  // seconds as strings: ["1759083598", 695203000].
  const isSeconds = (s) =>
    (typeof s === 'number' && s > 1e9 && s < 1e10) || (typeof s === 'string' && /^\d{10}$/.test(s));
  const isTs = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 2 && isSeconds(v[0]);

  const isDate = (v) =>
    Array.isArray(v) && v.length === 3 && v.every(Number.isInteger) &&
    v[0] > 1970 && v[0] < 3000 && v[1] >= 1 && v[1] <= 12 && v[2] >= 1 && v[2] <= 31;

  const pad = (n) => String(n).padStart(2, '0');

  function asTask(r) {
    if (r.length < 4 || typeof r[0] !== 'string' || !ID_RE.test(r[0])) return null;
    const body = r[1];
    if (!Array.isArray(body) || !(body[0] == null || typeof body[0] === 'number') || typeof body[1] !== 'string') return null;
    if (!(r[2] == null || isTs(r[2]))) return null;
    if (typeof r[3] !== 'string' || !ID_RE.test(r[3])) return null;
    const d = isDate(body[3]) ? body[3] : null;
    return {
      id: r[0],
      title: body[1].slice(0, 300),
      listId: r[3],
      date: d ? `${d[0]}-${pad(d[1])}-${pad(d[2])}` : null,
    };
  }

  function asList(r) {
    if (r.length < 3 || typeof r[0] !== 'string' || !ID_RE.test(r[0])) return null;
    const meta = r[1];
    if (!Array.isArray(meta) || meta.length < 3 || meta.length > 4) return null;
    if (typeof meta[0] !== 'string' || !meta[0] || typeof meta[2] !== 'string') return null;
    if (!r.some(isTs)) return null;
    const members = [];
    collectIds(r[2], members, 0);
    return { id: r[0], name: meta[0].slice(0, 200), members };
  }

  // Task ids nested in a list record's ordering field, e.g. [[["id1"], ["id2"]]].
  function collectIds(v, out, depth) {
    if (depth > 8 || out.length > 5000) return;
    if (typeof v === 'string') { if (ID_RE.test(v)) out.push(v); }
    else if (Array.isArray(v)) for (const x of v) collectIds(x, out, depth + 1);
  }

  function extract(root) {
    const lists = {};
    const tasks = {};
    const membership = {}; // taskId -> listId, from list records
    const stack = [[root, 0]];
    let n = 0;
    while (stack.length) {
      const [v, d] = stack.pop();
      if (++n > MAX_NODES) break;
      if (typeof v === 'string') {
        // batchexecute responses nest JSON documents inside strings.
        if (v.length > 20 && v[0] === '[' && d < 40 && HINT_RE.test(v)) {
          try { stack.push([JSON.parse(v), d + 1]); } catch (_) { /* not JSON */ }
        }
        continue;
      }
      if (!v || typeof v !== 'object' || d > 80) continue;
      if (Array.isArray(v)) {
        const t = asTask(v);
        if (t) tasks[t.id] = t;
        else {
          const l = asList(v);
          if (l) {
            lists[l.id] = l.name;
            for (const tid of l.members) if (tid !== l.id) membership[tid] = l.id;
          }
        }
        for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i] !== 'number') stack.push([v[i], d + 1]);
      } else {
        for (const k in v) stack.push([v[k], d + 1]);
      }
    }
    // Backup: tasks we only know through their list's membership. No title;
    // background.js keeps any title learned elsewhere.
    for (const [id, listId] of Object.entries(membership)) {
      if (!tasks[id]) tasks[id] = { id, title: '', listId, date: null };
    }
    return { lists, tasks };
  }

  const isEmpty = (r) => !r || (!Object.keys(r.lists).length && !Object.keys(r.tasks).length);

  function mergeInto(out, r) {
    if (!r) return out;
    Object.assign(out.lists, r.lists);
    Object.assign(out.tasks, r.tasks);
    return out;
  }

  // Parse an HTTP response body: plain JSON, ")]}'"-prefixed JSON, or the
  // length-prefixed, line-delimited batchexecute format.
  function parseText(text) {
    if (typeof text !== 'string' || text.length < 20 || !HINT_RE.test(text)) return null;
    const s = text.replace(/^\)\]\}'\s*/, '');
    try { return extract(JSON.parse(s)); } catch (_) { /* fall through */ }
    const out = { lists: {}, tasks: {} };
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (t[0] !== '[') continue;
      try { mergeInto(out, extract(JSON.parse(t))); } catch (_) { /* skip */ }
    }
    return out;
  }

  // Return the balanced [...] starting at text[start], honoring string literals.
  function sliceBalanced(text, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  // Parse the text of an inline <script> containing AF_initDataCallback({... data:[...] ...}).
  function parseInitScript(text) {
    if (typeof text !== 'string' || !HINT_RE.test(text)) return null;
    const out = { lists: {}, tasks: {} };
    const re = /AF_initDataCallback\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      const di = text.indexOf('data:', m.index);
      if (di < 0) break;
      const bi = text.indexOf('[', di);
      if (bi < 0) break;
      const arr = sliceBalanced(text, bi);
      if (!arr) continue;
      try { mergeInto(out, extract(JSON.parse(arr))); } catch (_) { /* not strict JSON */ }
      re.lastIndex = bi + arr.length;
    }
    return out;
  }

  g.RCCParser = { extract, parseText, parseInitScript, isEmpty, mergeInto };
})(globalThis);
