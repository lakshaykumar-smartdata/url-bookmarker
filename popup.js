const $ = id => document.getElementById(id);
let tab;
let savedIn = []; // folders that already hold this page

// Same page even if the URL differs by a trailing slash or #fragment.
const sameUrl = (a, b) => {
  const n = u => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; } };
  return n(a) === n(b);
};
const listFolders = names => names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const target = () => $('newFolder').value.trim() || $('folder').value;
const updateLabel = () => {
  const exists = savedIn.includes(target());
  $('save').classList.toggle('exists', exists);
  $('save').querySelector('use').setAttribute('href', exists ? '#i-check' : '#i-bookmark');
  $('saveLabel').textContent = exists ? `Already in ${target()}` : target() ? `Save to ${target()}` : 'Save bookmark';
};

(async () => {
  // Opened from the right-click menu: save that link instead of the current tab.
  const { pendingSave } = await chrome.storage.session.get('pendingSave');
  if (pendingSave) chrome.storage.session.remove('pendingSave');
  [tab] = pendingSave ? [pendingSave] : await chrome.tabs.query({ active: true, currentWindow: true });
  const { folders = [], bookmarks = [] } = await chrome.storage.local.get(['folders', 'bookmarks']);
  savedIn = tab?.url ? [...new Set(bookmarks.filter(b => sameUrl(b.url, tab.url)).map(b => b.folder || 'Unsorted'))] : [];
  if (savedIn.length) {
    $('alreadyText').textContent = `Already saved in ${listFolders(savedIn)}`;
    $('already').hidden = false;
  }
  $('title').textContent = tab?.title || 'Untitled page';
  let shown = tab?.url || 'No URL on this tab';
  try { const u = new URL(tab.url); shown = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch {}
  $('url').textContent = shown;
  $('url').title = tab?.url || '';
  if (tab?.url) $('icon').replaceWith(Object.assign(siteIcon(tab.url, '', tab.favIconUrl), { id: 'icon' }));

  // Already saved: show where. Else a folder matching the page, else the first folder.
  const suggested = suggestFolder(tab?.url, tab?.title, folders, bookmarks);
  const preselect = savedIn.find(f => folders.includes(f)) ?? suggested ?? folders[0];
  $('folder').replaceChildren(...folders.map(f => new Option(f, f, false, f === preselect)));
  $('suggested').hidden = !suggested || preselect !== suggested;
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
  if (bookmarks.some(b => sameUrl(b.url, tab.url) && (b.folder || 'Unsorted') === folder)) {
    return ($('status').textContent = `Already saved in ${folder}. Pick another folder to save a copy.`);
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
  const t = await findPinnedPage();
  if (!t) return chrome.tabs.create({ url: chrome.runtime.getURL(PINNED_PAGE), pinned: true });
  const here = await chrome.windows.getCurrent();
  if (t.windowId !== here.id) await chrome.tabs.move(t.id, { windowId: here.id, index: 0 });
  await chrome.tabs.update(t.id, { active: true, pinned: true });
  window.close();
};
$('export').onclick = exportJson;
