importScripts('shared.js');

// 1) On install / reload: merge the bundled bookmarks.json into storage.
chrome.runtime.onInstalled.addListener(async () => {
  await seedFromBundle();
  await chrome.storage.local.remove('reopenPage'); // old flag, no longer used
  ensurePage();
});

// 2) The bookmarks page always stays open as a pinned tab.
//    Chrome doesn't let extensions block closing a tab, so if it's closed we open it again.
const PAGE = chrome.runtime.getURL('bookmarks.html');

let pending; // startup fires several events at once; only open one tab
// windowId: where to open it if it's missing. Default: the window you used last.
function ensurePage(windowId) {
  pending ??= (async () => {
    const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [PAGE] });
    if (ctx) return chrome.tabs.update(ctx.tabId, { pinned: true });
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

chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!backupIds.has(id) || !state || state.current === 'in_progress') return;
  backupIds.delete(id);
  chrome.downloads.erase({ id }); // removes the history entry only; the file stays
  chrome.downloads.setUiOptions({ enabled: true });
});
