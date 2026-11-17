importScripts('shared.js');

// 1) On install / reload: merge the bundled bookmarks.json into storage.
chrome.runtime.onInstalled.addListener(async () => {
  await seedFromBundle();
  await chrome.storage.local.remove('reopenPage'); // old flag, no longer used
  ensurePage();
});

// Right-click a link (or the page) -> "Save to URL Bookmarker": opens the normal save popup
// for that link, so the folder suggestion works the same.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => // reload/update: don't add it twice
    chrome.contextMenus.create({ id: 'save', title: 'Save to URL Bookmarker…', contexts: ['link', 'page'] }));
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl;
  const title = info.linkUrl ? (info.selectionText || info.linkText || '').trim() || url : tab?.title || url;
  await chrome.storage.session.set({ pendingSave: { url, title, favIconUrl: info.linkUrl ? undefined : tab?.favIconUrl } });
  try { await chrome.action.openPopup(); } catch {
    // Older browser or no toolbar button: show the same popup in a small window.
    chrome.windows.create({ url: 'popup.html', type: 'popup', width: 380, height: 480 });
  }
});

// 2) The bookmarks page always stays open as a pinned tab.
//    Chrome doesn't let extensions block closing a tab, so if it's closed we open it again.
const PAGE = chrome.runtime.getURL(PINNED_PAGE);

let pending; // startup fires several events at once; only open one tab
// windowId: where to open it if it's missing. Default: the window you used last.
function ensurePage(windowId) {
  pending ??= (async () => {
    if (await findPinnedPage()) return;
    if (windowId === undefined) {
      windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null))?.id;
    }
    if (windowId !== undefined) await chrome.tabs.create({ url: PAGE, pinned: true, active: false, windowId });
  })().catch(console.error).finally(() => setTimeout(() => (pending = null), 1000));
  return pending;
}

chrome.runtime.onStartup.addListener(() => ensurePage());
chrome.windows.onCreated.addListener(() => ensurePage()); // covers Chrome starting with no windows yet
chrome.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
  // Closed by itself: reopen in the same window. Closing the whole window / quitting
  // Chrome is fine; it comes back next start.
  if (!isWindowClosing) setTimeout(() => ensurePage(windowId), 300);
});

// 2) Every change is backed up silently to Downloads/URL Bookmarker/bookmarks.json.
let timer;
const backupIds = new Set();

chrome.storage.onChanged.addListener(changes => {
  if (!changes.bookmarks && !changes.folders) return;
  clearTimeout(timer);
  timer = setTimeout(backup, 1000);
});

async function backup() {
  const { bookmarks = [], folders = [] } = await chrome.storage.local.get(['bookmarks', 'folders']);
  const json = JSON.stringify({ folders, bookmarks }, null, 2);
  // ponytail: hides Chrome's download bubble only while our backup is saving.
  await chrome.downloads.setUiOptions({ enabled: false });
  try {
    backupIds.add(await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(json),
      filename: 'URL Bookmarker/bookmarks.json',
      conflictAction: 'overwrite',
      saveAs: false,
    }));
  } catch (e) {
    console.error('Backup failed', e);
    chrome.downloads.setUiOptions({ enabled: true });
  }
}

// 4) Sync through a secret GitHub Gist, so Chrome, Edge and other PCs share one list.
const GIST_FILE = 'url-bookmarker.json';
let chain = Promise.resolve(); // stamping and syncing run one at a time
const queue = fn => (chain = chain.then(fn).catch(console.error));

// Stamp every add/remove. A write that includes syncStamps came from sync itself: skip it.
chrome.storage.onChanged.addListener((changes, area) => {
  const hs = changes.homeSettings;
  const changed = k => JSON.stringify(hs?.oldValue?.[k] ?? null) !== JSON.stringify(hs?.newValue?.[k] ?? null);
  const settings = hs ? ['name', 'zones'].filter(changed) : [];
  if (area !== 'local' || changes.syncStamps || (!changes.bookmarks && !changes.folders && !changes.todos && !changes.notes && !settings.length)) return;
  queue(async () => {
    const now = Date.now();
    const { syncStamps = {} } = await chrome.storage.local.get('syncStamps');
    for (const k of settings) syncStamps[`p:${k}`] = { t: now };
    const diff = (ch, key) => { // added or edited -> {t}, removed -> {t, del}
      if (!ch) return;
      const before = new Map((ch.oldValue || []).map(x => [key(x), JSON.stringify(x)]));
      const after = new Map((ch.newValue || []).map(x => [key(x), JSON.stringify(x)]));
      for (const [k, v] of after) if (before.get(k) !== v) syncStamps[k] = { t: now };
      for (const k of before.keys()) if (!after.has(k)) syncStamps[k] = { t: now, del: true };
    };
    diff(changes.bookmarks, bKey);
    diff(changes.folders, fKey);
    // You dragged a folder: the folders both lists share are now in a different order.
    // (Comparing only shared folders still works when a folder was added or renamed at the same time.)
    const { oldValue: was = [], newValue: is = [] } = changes.folders || {};
    const shared = list => list.filter(f => was.includes(f) && is.includes(f)).join('\n');
    if (shared(was) !== shared(is)) syncStamps['o:folders'] = { t: now };
    diff(changes.todos, tKey);
    diff(changes.notes, nKey);
    await chrome.storage.local.set({ syncStamps });
  });
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => queue(sync), 2000);
});
let syncTimer;

// The token also goes into the browser's own profile sync (chrome.storage.sync), so a new PC
// signed in to the same Google (Chrome) or Microsoft (Edge) account picks it up by itself.
// Only works where this extension has the same ID, see README.
// "Turn off" only turns it off on this PC (syncDisabled); other PCs keep syncing.
async function sync() {
  let { syncSettings: s, syncStatus = {}, syncDisabled } = await chrome.storage.local.get(['syncSettings', 'syncStatus', 'syncDisabled']);
  const { ghToken } = await chrome.storage.sync.get('ghToken').catch(() => ({}));
  if (!s?.token) {
    if (!ghToken || syncDisabled) return;
    s = { token: ghToken };
    await chrome.storage.local.set({ syncSettings: s }); // new PC: sync turns itself on
  } else if (ghToken !== s.token) {
    chrome.storage.sync.set({ ghToken: s.token }).catch(console.error);
  }
  const gh = async (path, method = 'GET', body) => {
    const r = await fetch('https://api.github.com' + path, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!r.ok) throw Object.assign(new Error(
      r.status === 401 ? 'GitHub rejected the token. Check it and save again.'
        : r.status === 403 || r.status === 404 && !path.startsWith('/gists/') ? 'The token needs the "gist" permission.'
        : `GitHub error ${r.status}`), { status: r.status });
    return r.json();
  };
  try {
    let gistId = s.gistId, remote = { bookmarks: [], folders: [], todos: [], notes: [], stamps: {} };
    // Second browser: find the Gist the first one made, so only the token has to be pasted.
    if (!gistId) gistId = (await gh('/gists?per_page=100')).find(g => g.files[GIST_FILE])?.id;
    if (gistId) {
      try {
        const f = (await gh(`/gists/${gistId}`)).files[GIST_FILE];
        if (f) remote = { ...remote, ...JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content) };
      } catch (e) {
        if (e.status !== 404) throw e;
        gistId = null; // Gist was deleted: make a new one
      }
    }
    const local = await chrome.storage.local.get(['bookmarks', 'folders', 'todos', 'notes', 'syncStamps', 'homeSettings']);
    const mine = { name: local.homeSettings?.name || '', zones: local.homeSettings?.zones, bookmarks: local.bookmarks || [], folders: local.folders || [], todos: local.todos || [], notes: local.notes || [], stamps: local.syncStamps || {} };
    const merged = mergeSync(mine, remote);
    // ponytail: an edit landing between this read and the write below (a few ms) is lost locally; its stamp survives.
    if (syncFingerprint(merged) !== syncFingerprint(mine)) {
      await chrome.storage.local.set({ bookmarks: merged.bookmarks, folders: merged.folders, todos: merged.todos, notes: merged.notes, syncStamps: merged.stamps,
        homeSettings: { ...local.homeSettings, name: merged.name, ...(merged.zones && { zones: merged.zones }) } });
    }
    const content = JSON.stringify(merged);
    if (!gistId) {
      gistId = (await gh('/gists', 'POST', { description: 'URL Bookmarker sync', public: false, files: { [GIST_FILE]: { content } } })).id;
    } else if (syncFingerprint(merged) !== syncFingerprint(remote)) {
      await gh(`/gists/${gistId}`, 'PATCH', { files: { [GIST_FILE]: { content } } });
    }
    if (gistId !== s.gistId) await chrome.storage.local.set({ syncSettings: { ...s, gistId } });
    await chrome.storage.local.set({ syncStatus: { at: Date.now() } });
  } catch (e) {
    await chrome.storage.local.set({ syncStatus: { at: syncStatus.at, error: e.message || 'Sync failed. Check your connection.' } });
  }
}

chrome.alarms.get('sync', a => a || chrome.alarms.create('sync', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(a => {
  if (a.name !== 'sync') return;
  queue(sync);
  reloadIfUpdated();
});
// New files on disk (git pull, an edit) apply within a minute in every browser, even if the
// bookmarks tab is never refreshed. The bookmarks tab reopens by itself afterwards.
async function reloadIfUpdated() {
  try {
    const m = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    if (m.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch {}
}
chrome.runtime.onStartup.addListener(() => queue(sync));
chrome.runtime.onMessage.addListener((m, _, reply) => {
  if (!m?.sync) return;
  queue(sync).then(() => reply(true));
  return true;
});

chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!backupIds.has(id) || !state || state.current === 'in_progress') return;
  backupIds.delete(id);
  chrome.downloads.erase({ id }); // removes the history entry only; the file stays
  chrome.downloads.setUiOptions({ enabled: true });
});
