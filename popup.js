const $ = id => document.getElementById(id);
let tab;

const target = () => $('newFolder').value.trim() || $('folder').value;
const updateLabel = () => { $('saveLabel').textContent = target() ? `Save to ${target()}` : 'Save bookmark'; };

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { folders = [], lastFolder } = await chrome.storage.local.get(['folders', 'lastFolder']);
  $('title').textContent = tab?.title || 'Untitled page';
  let shown = tab?.url || 'No URL on this tab';
  try { const u = new URL(tab.url); shown = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch {}
  $('url').textContent = shown;
  $('url').title = tab?.url || '';
  if (tab?.url) $('icon').replaceWith(Object.assign(siteIcon(tab.url, '', tab.favIconUrl), { id: 'icon' }));

  $('folder').replaceChildren(...folders.map(f => new Option(f, f, false, f === lastFolder)));
  $('pick').hidden = !folders.length;
  (folders.length ? $('folder') : $('newFolder')).focus();
  updateLabel();
})();

$('folder').onchange = $('newFolder').oninput = () => { $('status').textContent = ''; updateLabel(); };

$('form').onsubmit = async e => {
  e.preventDefault();
  if (!tab?.url) return ($('status').textContent = 'This tab has no URL to save.');
  const folder = target();
  if (!folder) return ($('status').textContent = 'Type a folder name first.');

  const { bookmarks = [], folders = [] } = await chrome.storage.local.get(['bookmarks', 'folders']);
  if (bookmarks.some(b => b.url === tab.url && b.folder === folder)) {
    return ($('status').textContent = `Already saved in ${folder}.`);
  }
  if (!folders.includes(folder)) folders.push(folder);
  bookmarks.unshift({ url: tab.url, title: tab.title, folder, icon: tab.favIconUrl, savedAt: new Date().toISOString() });
  await chrome.storage.local.set({ bookmarks, folders, lastFolder: folder });

  $('save').classList.add('saved');
  $('save').querySelector('use').setAttribute('href', '#i-check');
  $('saveLabel').textContent = `Saved to ${folder}`;
  setTimeout(() => window.close(), 900);
};

// Bring the pinned bookmarks tab into this window and switch to it (no second copy).
$('open').onclick = async () => {
  const page = chrome.runtime.getURL('bookmarks.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [page] });
  if (!ctx) return chrome.tabs.create({ url: page, pinned: true });
  const here = await chrome.windows.getCurrent();
  if (ctx.windowId !== here.id) await chrome.tabs.move(ctx.tabId, { windowId: here.id, index: 0 });
  await chrome.tabs.update(ctx.tabId, { active: true, pinned: true });
  window.close();
};
$('export').onclick = exportJson;
