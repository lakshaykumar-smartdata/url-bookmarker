const $ = id => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const folderOf = b => b.folder || 'Unsorted';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ALL = '\0all';
const HOME = '\0home';
const TODO = '\0todo';
const NOTES = '\0notes';
const CB = '\0cb:'; // + a Chrome bookmark folder id

// The browser's own bookmarks, read-only: every folder that holds links, e.g. "Bookmarks bar / Work".
let chromeFolders = [];
async function loadChrome() {
  const out = [];
  const walk = (node, path) => {
    const links = (node.children || []).filter(c => c.url).map(c => ({ url: c.url, title: c.title }));
    if (links.length) out.push({ key: CB + node.id, name: node.title || 'Bookmarks', path: path.join(' / '), links });
    for (const c of node.children || []) if (!c.url) walk(c, [...path, c.title]);
  };
  try { for (const root of (await chrome.bookmarks.getTree())[0].children) walk(root, [root.title]); } catch {}
  chromeFolders = out;
  if (selected.startsWith(CB) && !out.some(f => f.key === selected)) selected = ALL;
  render();
}
const chromeFolder = key => chromeFolders.find(f => f.key === key);
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'])
  chrome.bookmarks?.[ev]?.addListener(() => loadChrome());

// Line icon from the <symbol> sprite in bookmarks.html.
function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

let toastTimer;
function toast(text, action) {
  const t = $('toast');
  t.replaceChildren(el('span', { textContent: text }));
  if (action) {
    const b = el('button', { textContent: action.label });
    b.onclick = () => { t.classList.remove('show'); action.run(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2200);
}

// Snapshot of storage that an "Undo" button puts back.
async function snapshot() {
  return structuredClone(await chrome.storage.local.get(['bookmarks', 'folders']));
}
const undo = (before, folder) => ({
  label: 'Undo',
  run: async () => { await chrome.storage.local.set(before); select(folder); },
});

// Page edits apply on refresh, but manifest changes (e.g. the "favicon" permission that
// website icons need) only apply after the extension reloads. Do that automatically when
// manifest.json on disk has a newer version than the one Chrome loaded.
fetch(chrome.runtime.getURL('manifest.json')).then(r => r.json()).then(async m => {
  if (m.version === chrome.runtime.getManifest().version) return;
  chrome.runtime.reload(); // background reopens this page as a pinned tab afterwards
}).catch(() => {});

// Keep the main copy (opened as bookmarks.html#pinned) pinned so it stays put and is hard to
// close by accident.
if (location.hash === '#pinned') chrome.tabs.getCurrent(t => t && !t.pinned && chrome.tabs.update(t.id, { pinned: true }));

let data = { bookmarks: [], folders: [], todos: [], notes: [] };
let uses = {}; // url -> { n: times opened, last: when }, for "Frequently used" on Home
let draft = null; // unsaved new note, see Notes below
let selected = HOME; // the page always opens on Home

async function load() {
  const { bookmarks = [], folders = [], todos = [], notes = [], linkUses = {} } = await chrome.storage.local.get(['bookmarks', 'folders', 'todos', 'notes', 'linkUses']);
  uses = linkUses;
  data = { bookmarks, folders: [...new Set([...folders, ...bookmarks.map(folderOf)])], todos,
    notes: draft && !notes.some(n => n.id === draft.id) ? [draft, ...notes] : notes };
  if (![ALL, HOME, TODO, NOTES].includes(selected) && !selected.startsWith(CB) && !data.folders.includes(selected)) selected = ALL;
  render();
}

function select(name) {
  selected = name;
  $('q').value = '';
  render();
  document.querySelector('main').scrollTop = 0;
}

function navButton(name, label, count, icon) {
  const b = el('button', { className: selected === name && !$('q').value ? 'active' : '' });
  b.append(svgIcon(icon), el('span', { className: 'name', textContent: label, title: label }),
    el('span', { className: 'count', textContent: count ?? '' }));
  b.onclick = () => select(name);
  return b;
}

function row(b, i, showFolder) {
  const fav = el('span', { className: 'fav' });
  fav.append(siteIcon(b.url, 'favimg', b.icon));

  const info = el('div', { className: 'info' });
  info.append(
    trackOpens(el('a', { href: safeHref(b.url), target: '_blank', rel: 'noopener', title: b.url, textContent: b.title || b.url }), b.url),
    el('div', { className: 'meta', textContent: host(b.url) })
  );

  const li = el('li');
  li.append(fav, info);

  if (showFolder) {
    const chip = el('button', { className: 'chip', title: `Open ${folderOf(b)}` });
    chip.append(svgIcon('folder'), el('span', { textContent: folderOf(b) }));
    chip.onclick = () => select(folderOf(b));
    li.append(chip);
  }

  const actions = el('div', { className: 'row-actions' });
  const copy = el('button', { className: 'icon-btn', title: 'Copy link' });
  copy.append(svgIcon('copy'));
  copy.onclick = async () => {
    await navigator.clipboard.writeText(b.url);
    copy.replaceChildren(svgIcon('check'));
    copy.classList.add('done');
    setTimeout(() => { copy.replaceChildren(svgIcon('copy')); copy.classList.remove('done'); }, 1200);
  };
  const del = el('button', { className: 'icon-btn danger', title: 'Delete' });
  del.append(svgIcon('trash'));
  del.onclick = async () => {
    if (!confirm(`Delete "${b.title || b.url}" from ${folderOf(b)}?`)) return;
    const before = await snapshot();
    data.bookmarks.splice(i, 1);
    await chrome.storage.local.set({ bookmarks: data.bookmarks }); // onChanged reloads
    toast('Bookmark deleted', undo(before, selected));
  };
  actions.append(copy);
  if (i >= 0) actions.append(del);
  li.append(actions);
  return li;
}

// ---------- Frequently used (Home) ----------
const safeHref = url => /^\s*(javascript|data|vbscript):/i.test(url) ? '#' : url;

// Count a link each time it's opened from this page: click, Ctrl+click or middle click.
function trackOpens(a, url) {
  const count = () => {
    const u = uses[url];
    uses = { ...uses, [url]: { n: (u?.n || 0) + 1, last: Date.now() } };
    chrome.storage.local.set({ linkUses: uses });
  };
  a.addEventListener('click', count);
  a.addEventListener('auxclick', e => e.button === 1 && count());
  return a;
}

// The 8 most-opened links that are still saved (here or in Chrome's bookmarks).
function topLinks() {
  const known = new Map();
  for (const f of chromeFolders) for (const b of f.links) known.set(b.url, b);
  for (const b of data.bookmarks) known.set(b.url, b); // your own titles win
  return Object.entries(uses).filter(([url]) => known.has(url))
    .sort(([, a], [, b]) => b.n - a.n || b.last - a.last).slice(0, 8).map(([url]) => known.get(url));
}

function renderFrequent() {
  const top = topLinks();
  $('frequent').hidden = !top.length;
  $('frequentList').replaceChildren(...top.map(b => {
    const name = b.title || host(b.url);
    const icon = el('span', { className: 'fq-icon' });
    icon.append(siteIcon(b.url, 'favimg', b.icon));
    const a = trackOpens(el('a', { href: safeHref(b.url), target: '_blank', rel: 'noopener', title: `${name}\n${b.url}` }), b.url);
    a.append(icon, el('span', { className: 'fq-name', textContent: name }));
    const x = el('button', { className: 'fq-x', type: 'button', title: 'Remove from Frequently used' });
    x.append(svgIcon('x'));
    x.onclick = () => {
      const before = uses;
      uses = { ...uses };
      delete uses[b.url];
      chrome.storage.local.set({ linkUses: uses });
      toast(`Removed “${name}” from Frequently used`, { label: 'Undo', run: () => chrome.storage.local.set({ linkUses: before }) });
    };
    const tile = el('div', { className: 'fq' });
    tile.append(a, x);
    return tile;
  }));
}
chrome.storage.onChanged.addListener(c => {
  if (!c.linkUses) return;
  uses = c.linkUses.newValue || {};
  if (!$('home').hidden) renderFrequent();
});

function render() {
  const { bookmarks, folders } = data;
  const q = $('q').value.trim().toLowerCase();

  const focused = document.activeElement?.closest?.('nav [data-folder]')?.dataset.folder; // keep focus across redraws
  $('nav').replaceChildren(
    navButton(HOME, 'Home', null, 'home'),
    navButton(TODO, 'To-do', data.todos.filter(t => !t.done).length || null, 'todo'),
    navButton(NOTES, 'Notes', data.notes.length || null, 'note'),
    navButton(ALL, 'All bookmarks', bookmarks.length, 'all'),
    el('div', { className: 'label', textContent: 'Folders', title: 'Drag a folder to reorder, or Alt+Up / Alt+Down' }),
    ...folders.map(folderButton),
    ...(chromeFolders.length ? [el('div', { className: 'label', textContent: 'Chrome bookmarks', title: 'Your browser bookmarks (read-only here)' })] : []),
    ...chromeFolders.map(f => { const b = navButton(f.key, f.name, f.links.length, 'bookmark'); b.title = f.path; return b; })
  );
  $('nav').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focused !== undefined) $('nav').querySelector(`[data-folder="${CSS.escape(focused)}"]`)?.focus();

  // Home tab: slideshow + clocks (home.js). A search always shows results instead.
  const homeMode = !q && selected === HOME;
  $('home').hidden = !homeMode;
  $('wrap').hidden = homeMode;
  document.body.classList.toggle('home-mode', homeMode); // photo behind the whole page
  if (typeof setHomeVisible === 'function') setHomeVisible(homeMode);
  const todoMode = !q && selected === TODO;
  $('todo').hidden = !todoMode;
  const notesMode = !q && selected === NOTES;
  if (!notesMode) dropDraft();
  $('notes').hidden = !notesMode;
  if (homeMode) return renderFrequent();
  if (todoMode) { $('wrap').hidden = true; return renderTodos(); }
  if (notesMode) { $('wrap').hidden = true; return renderNotes(); }

  // Search always looks across every folder.
  let rows = bookmarks.map((b, i) => [b, i]);
  const words = q.split(/\s+/);
  if (q) rows = rows.filter(([b]) => {
    const text = `${b.title} ${b.url} ${folderOf(b)}`.toLowerCase();
    return words.every(w => text.includes(w)); // every word, any order
  });
  else if (selected.startsWith(CB)) rows = (chromeFolder(selected)?.links ?? []).map(b => [b, -1]);
  else if (selected !== ALL) rows = rows.filter(([b]) => folderOf(b) === selected);
  const showFolder = !!q || selected === ALL || selected === HOME;

  $('title').textContent = q ? `Results for “${$('q').value.trim()}”` : selected === ALL ? 'All bookmarks' : chromeFolder(selected)?.path ?? selected;
  $('title').hidden = renaming;
  $('renameInput').hidden = !renaming;
  $('folderActions').hidden = renaming || !!q || selected === ALL || selected.startsWith(CB);
  $('sub').textContent = plural(rows.length, 'link');

  $('list').hidden = !rows.length;
  $('empty').hidden = !!rows.length;
  $('empty-icon').firstElementChild.setAttribute('href', q ? '#i-search' : bookmarks.length ? '#i-folder' : '#i-bookmark');
  $('empty-title').textContent = q ? 'No matches' : bookmarks.length ? 'This folder is empty' : 'No bookmarks yet';
  $('empty-text').textContent = q ? 'Try a different word, or part of the URL.'
    : 'Click the extension icon on any page to save it here.';

  $('list').replaceChildren(...rows.map(([b, i]) => row(b, i, showFolder)));
}

// ---------- Folder rename / delete ----------
let renaming = false;

$('renameBtn').onclick = () => {
  renaming = true;
  render();
  $('renameInput').value = selected;
  $('renameInput').focus();
  $('renameInput').select();
};
$('renameInput').onkeydown = e => {
  if (e.key === 'Enter') commitRename();
  if (e.key === 'Escape') { renaming = false; render(); }
};
$('renameInput').onblur = () => renaming && commitRename();

async function commitRename() {
  const old = selected, name = $('renameInput').value.trim();
  renaming = false;
  render();
  if (!name || name === old) return;

  const merge = data.folders.includes(name);
  if (merge && !confirm(`A folder named "${name}" already exists. Move all links from "${old}" into it?`)) return;

  const before = await snapshot();
  const { bookmarks = [], folders = [] } = structuredClone(before);
  const inTarget = new Set(bookmarks.filter(b => folderOf(b) === name).map(b => b.url));
  const next = bookmarks
    .filter(b => !(folderOf(b) === old && inTarget.has(b.url))) // already in target: drop the duplicate
    .map(b => (folderOf(b) === old ? { ...b, folder: name } : b));
  let nextFolders = folders.filter(f => f !== old);
  if (!merge) {
    nextFolders = [...folders];
    const at = folders.indexOf(old);
    if (at >= 0) nextFolders[at] = name; else nextFolders.push(name); // keep its place in the list
  }

  const { lastFolder } = await chrome.storage.local.get('lastFolder');
  selected = name;
  await chrome.storage.local.set({ bookmarks: next, folders: nextFolders, ...(lastFolder === old && { lastFolder: name }) });
  toast(merge ? `Moved links into “${name}”` : `Renamed to “${name}”`, undo(before, old));
}

$('deleteBtn').onclick = async () => {
  const name = selected;
  const count = data.bookmarks.filter(b => folderOf(b) === name).length;
  if (!confirm(count ? `Delete the folder "${name}" and its ${plural(count, 'link')}?` : `Delete the empty folder "${name}"?`)) return;

  const before = await snapshot();
  const { bookmarks = [], folders = [] } = before;
  select(ALL);
  await chrome.storage.local.set({
    bookmarks: bookmarks.filter(b => folderOf(b) !== name),
    folders: folders.filter(f => f !== name),
  });
  toast(`Deleted “${name}”`, undo(before, name));
};

$('q').oninput = render;
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); $('q').focus(); }
  if (e.key === 'Escape' && document.activeElement === $('q')) { $('q').value = ''; render(); }
});

$('export').onclick = exportJson;
$('import').onclick = () => $('file').click();
$('file').onchange = async () => {
  try {
    const added = await mergeBookmarks(JSON.parse(await $('file').files[0].text()));
    toast(`Imported ${plural(added, 'new item')}. Nothing you already had was changed.`);
  } catch (e) {
    toast(`Couldn't import that file: ${e.message}`);
  }
  $('file').value = '';
};

load();
loadChrome();

// ---------- Backup into the extension's own folder ----------
// Browsers only let an extension save into Downloads by itself. Writing anywhere else needs a folder
// you pick once; the handle is kept in IndexedDB. The file is bookmarks.json (git-ignored), which a
// reinstall reads back in (background.js). The Downloads backup keeps running as a fallback.
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('backup', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode), req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  };
});
const folderState = { dir: null, at: null, error: '' };
async function showFolder() {
  const { dir, at, error } = folderState;
  const allowed = dir && await dir.queryPermission({ mode: 'readwrite' }) === 'granted';
  $('folderState').textContent = !dir ? 'Not set. Pick the extension folder (bookmark-extension) to keep a backup there too.'
    : error ? `${dir.name}: ${error}`
    : !allowed ? `${dir.name}: paused until you allow the browser to save there.`
    : `Saving to ${dir.name}\\bookmarks.json${at ? `, last at ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.`;
  $('folderBtn').textContent = dir && !allowed ? 'Allow' : dir ? 'Change folder' : 'Choose folder';
  return allowed;
}
async function writeFolderBackup() {
  try {
    if (!(await showFolder())) return;
    const file = await (await folderState.dir.getFileHandle('bookmarks.json', { create: true })).createWritable();
    await file.write(await backupJson(true));
    await file.close();
    Object.assign(folderState, { at: Date.now(), error: '' });
  } catch (e) {
    folderState.error = `couldn't save (${e.message})`;
  }
  showFolder();
}
let folderTimer;
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local' || !['bookmarks', 'folders', 'todos', 'notes', 'homeSettings', 'syncSettings'].some(k => c[k])) return;
  clearTimeout(folderTimer);
  folderTimer = setTimeout(writeFolderBackup, 1500);
});
$('folderBtn').onclick = async () => {
  try {
    const { dir } = folderState;
    if (dir && await dir.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      await dir.requestPermission({ mode: 'readwrite' });
      return writeFolderBackup();
    }
    const pick = await showDirectoryPicker({ id: 'url-bookmarker-backup', mode: 'readwrite' });
    // Catch picking the wrong folder: the extension folder has this extension's manifest.json.
    const name = await pick.getFileHandle('manifest.json').then(h => h.getFile()).then(f => f.text()).then(t => JSON.parse(t).name).catch(() => null);
    if (name !== chrome.runtime.getManifest().name
      && !confirm(`"${pick.name}" isn't the extension folder, so a reinstall won't find the backup there. Use it anyway?`)) return;
    await idb('readwrite', s => s.put(pick, 'dir'));
    Object.assign(folderState, { dir: pick, error: '' });
    writeFolderBackup();
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Couldn't use that folder: ${e.message}`);
  }
};
// On load: save once (changes may have come in while this page was closed). If the browser
// wants your OK again (it can after a restart), say so once instead of failing silently.
idb('readonly', s => s.get('dir')).then(async dir => {
  folderState.dir = dir || null;
  if (await showFolder()) return writeFolderBackup();
  if (dir) toast('Backup to the extension folder is paused.', { label: 'Allow', run: () => $('folderBtn').click() });
}).catch(console.error);

// After a reinstall the background pulls the Downloads backup back in (see background.js).
const restoredToast = r => {
  if (!r) return;
  const { added = r, sync } = typeof r === 'object' ? r : {};
  toast(`Restored ${plural(added, 'item')} from your backup in Downloads. ${sync ? 'Sync is back on.' : 'Paste your GitHub token in Sync to sync again.'}`);
  chrome.storage.local.remove('restoredNotice');
};
chrome.storage.local.get('restoredNotice').then(r => restoredToast(r.restoredNotice));
chrome.storage.onChanged.addListener(c => restoredToast(c.restoredNotice?.newValue));
chrome.storage.onChanged.addListener(c => (c.bookmarks || c.folders || c.todos || c.notes) && load());

// ---------- Sync (the work happens in background.js) ----------
async function showSync() {
  const { syncSettings, syncStatus = {} } = await chrome.storage.local.get(['syncSettings', 'syncStatus']);
  const on = !!syncSettings?.token, err = on && syncStatus.error;
  const time = syncStatus.at && new Date(syncStatus.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('syncOff').hidden = !on;
  $('syncNote').textContent = err || '';
  $('syncState').textContent = !on ? 'Sync is off.' : time ? `Last synced at ${time}.` : 'Syncing…';
  $('syncBtn').classList.toggle('on', on && !err);
  $('syncBtn').classList.toggle('err', !!err);
  $('syncBtn').title = !on ? 'Sync is off' : err ? `Sync problem: ${err}` : time ? `Synced at ${time}` : 'Syncing…';
}
$('syncBtn').onclick = async () => {
  const open = $('syncPanel').hidden;
  $('syncPanel').hidden = !open;
  if (!open) return;
  $('syncToken').value = (await chrome.storage.local.get('syncSettings')).syncSettings?.token || '';
  showSync();
  $('syncToken').focus();
};
$('syncPanel').onsubmit = async e => {
  e.preventDefault();
  const token = $('syncToken').value.trim();
  if (!token) return ($('syncNote').textContent = 'Paste a GitHub token first.');
  const { syncSettings } = await chrome.storage.local.get('syncSettings');
  const gistId = syncSettings?.token === token ? syncSettings.gistId : undefined; // new token: find the Gist again
  await chrome.storage.local.set({ syncSettings: { token, gistId }, syncStatus: {}, syncDisabled: false });
  chrome.runtime.sendMessage({ sync: true }).catch(() => {});
};
$('syncOff').onclick = async () => {
  await chrome.storage.local.remove(['syncSettings', 'syncStatus']);
  await chrome.storage.local.set({ syncDisabled: true }); // don't pick the token up again from browser sync
  $('syncToken').value = '';
  toast('Sync turned off on this PC. Your links stay here.');
};
chrome.storage.onChanged.addListener(c => (c.syncSettings || c.syncStatus) && showSync());
document.addEventListener('visibilitychange', () => document.hidden || chrome.runtime.sendMessage({ sync: true }).catch(() => {}));
showSync();

// ---------- To-do (synced with the Gist like bookmarks) ----------
const saveTodos = todos => chrome.storage.local.set({ todos }); // onChanged re-renders

function renderTodos() {
  const todos = [...data.todos].sort((a, b) => a.done - b.done); // open first, newest on top
  const open = todos.filter(t => !t.done).length;
  $('todoSub').textContent = `${open} open`;
  $('todoClear').hidden = open === todos.length;
  $('todoEmpty').hidden = !!todos.length;
  $('todoList').replaceChildren(...todos.map(t => {
    const li = el('li', { className: t.done ? 'done' : '' });
    const box = el('input', { type: 'checkbox', checked: t.done, title: t.done ? 'Mark as not done' : 'Mark as done' });
    box.onchange = () => saveTodos(data.todos.map(x => (x.id === t.id ? { ...x, done: box.checked } : x)));
    const del = el('button', { className: 'icon-btn danger', title: 'Delete task' });
    del.append(svgIcon('trash'));
    del.onclick = () => saveTodos(data.todos.filter(x => x.id !== t.id));
    li.append(box, el('span', { className: 'todo-text', textContent: t.text }), del);
    return li;
  }));
}
$('todoForm').onsubmit = e => {
  e.preventDefault();
  const text = $('todoInput').value.trim();
  if (!text) return;
  $('todoInput').value = '';
  saveTodos([{ id: crypto.randomUUID(), text, done: false, at: new Date().toISOString() }, ...data.todos]);
};
$('todoClear').onclick = async () => {
  const before = await chrome.storage.local.get('todos');
  await saveTodos(data.todos.filter(t => !t.done));
  toast('Finished tasks cleared', { label: 'Undo', run: () => chrome.storage.local.set(before) });
};

// ---------- Notes (synced with the Gist like bookmarks) ----------
// A note is {id, title, html, body, updated}. html is the formatted text; body is the same as plain
// text for the list preview. Notes from before formatting have only body.
let noteId = null; // the open note
// A new note stays a draft (not saved, not synced) until you type in it, so clicking
// New note and walking away doesn't leave an empty "Untitled" behind.
const isEmptyNote = n => !(n.title || '').trim() && !(n.body || '').trim();
function dropDraft(keepId) {
  if (!draft || draft.id === keepId) return;
  data.notes = data.notes.filter(n => n.id !== draft.id);
  draft = null;
}
let noteTimer;
const when = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return ''; // synced note without a date
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};
const textToHtml = s => (s || '').split('\n').map(l => `<div>${el('div', { textContent: l }).innerHTML || '<br>'}</div>`).join('');

// Keep only simple formatting. Notes come from the Gist and from pasted web pages, so drop
// scripts, styles, colours, images and every attribute except links and checklist ticks.
const NOTE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H1', 'H2', 'H3', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'CODE', 'PRE']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK']);
function cleanHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const walk = node => {
    for (const c of [...node.children]) {
      walk(c);
      const tag = c.tagName.toUpperCase();
      if (!NOTE_TAGS.has(tag)) { c.replaceWith(...(DROP_WITH_CONTENT.has(tag) ? [] : c.childNodes)); continue; }
      const cls = [...c.classList].filter(x => x === 'checklist' || x === 'checked');
      for (const a of [...c.attributes]) {
        if (!(a.name === 'href' && tag === 'A' && /^(https?:|mailto:)/i.test(a.value.trim()))) c.removeAttribute(a.name);
      }
      if (cls.length) c.className = cls.join(' ');
    }
  };
  walk(t.content);
  return t.innerHTML;
}

function renderNotes() {
  const typingIn = $('noteEditor').contains(document.activeElement) ? noteId : null;
  const junk = data.notes.filter(n => n.id !== draft?.id && n.id !== typingIn && isEmptyNote(n));
  if (junk.length) {
    data.notes = data.notes.filter(n => !junk.includes(n));
    chrome.storage.local.set({ notes: data.notes.filter(n => n.id !== draft?.id) });
  }
  const notes = [...data.notes].sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))); // last edited on top
  if (!notes.some(n => n.id === noteId)) noteId = notes[0]?.id ?? null;
  $('notesSub').textContent = plural(notes.length, 'note');
  $('notesEmpty').hidden = !!notes.length;
  $('notesBody').hidden = !notes.length;
  $('noteList').replaceChildren(...notes.map(n => {
    const b = el('button', { className: `note-item${n.id === noteId ? ' active' : ''}` });
    b.append(
      el('strong', { textContent: (n.title || '').trim() || 'Untitled' }),
      el('span', { textContent: (n.body || '').trim().slice(0, 90) || 'No text' }),
      el('small', { textContent: when(n.updated) })
    );
    b.onclick = () => { flushNote(); dropDraft(n.id); noteId = n.id; renderNotes(); };
    return b;
  }));
  const n = notes.find(x => x.id === noteId);
  if (!n) return;
  // Don't overwrite what you're typing: only refill for another note, or when the editor isn't focused.
  const ed = $('noteEditor');
  if (ed.dataset.id !== n.id || !ed.contains(document.activeElement)) {
    ed.dataset.id = n.id;
    $('noteTitle').value = n.title || '';
    $('noteText').innerHTML = cleanHtml(n.html ?? textToHtml(n.body));
    ed.dataset.loaded = $('noteText').innerHTML; // so just opening a note doesn't count as an edit
    $('noteSaved').textContent = `Edited ${when(n.updated)}`;
    updateTools();
  }
}

// Saves 0.6 s after you stop typing, and when you leave the note.
function flushNote() {
  clearTimeout(noteTimer);
  const ed = $('noteEditor');
  const n = data.notes.find(x => x.id === ed.dataset.id);
  if (!n) return;
  const title = $('noteTitle').value, html = $('noteText').innerHTML;
  if ((n.title || '') === title && html === ed.dataset.loaded) return;
  ed.dataset.loaded = html;
  const body = $('noteText').innerText;
  if (draft?.id === n.id && !title.trim() && !body.trim()) return; // still blank: keep it a draft
  data.notes = data.notes.map(x => (x.id === n.id ? { ...x, title, html, body, updated: new Date().toISOString() } : x));
  if (draft?.id === n.id) draft = null;
  $('noteSaved').textContent = 'Saved';
  chrome.storage.local.set({ notes: data.notes.filter(x => x.id !== draft?.id) });
}
function onNoteInput() {
  const t = $('noteText');
  if (/^(<br>|<div><br><\/div>)$/.test(t.innerHTML)) t.innerHTML = ''; // so the placeholder comes back
  $('noteSaved').textContent = 'Saving…';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 600);
}
$('noteTitle').oninput = $('noteText').oninput = onNoteInput;
$('noteEditor').addEventListener('focusout', flushNote);
$('noteTitle').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('noteText').focus(); } };
window.addEventListener('beforeunload', flushNote);

// Pasting from a web page keeps bold/lists/links but not its fonts and colours.
$('noteText').addEventListener('paste', e => {
  const html = e.clipboardData.getData('text/html');
  if (!html) return; // plain text pastes as it is
  e.preventDefault();
  document.execCommand('insertHTML', false, cleanHtml(html));
});

$('noteText').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a && (e.ctrlKey || e.metaKey)) return window.open(a.href, '_blank', 'noopener');
  // The tick box is drawn just left of the list item.
  const li = e.target.closest('ul.checklist > li');
  if (li && e.clientX < li.getBoundingClientRect().left) { li.classList.toggle('checked'); onNoteInput(); }
});

// ---------- Formatting toolbar ----------
// ponytail: execCommand is deprecated but every Chromium browser supports it; swap for a
// small editor library if it is ever removed.
const listOf = () => {
  const n = getSelection().anchorNode;
  return (n?.nodeType === 1 ? n : n?.parentElement)?.closest('#noteText ul');
};
const isHeading = () => /^h2$/i.test(document.queryCommandValue('formatBlock'));
function updateTools() {
  const inNote = $('noteText').contains(getSelection().anchorNode);
  for (const b of document.querySelectorAll('#noteTools [data-cmd]')) {
    const c = b.dataset.cmd;
    let on = false;
    if (inNote) try {
      on = c === 'heading' ? isHeading()
        : c === 'checklist' ? !!listOf()?.classList.contains('checklist')
        : c === 'insertUnorderedList' ? !!listOf() && !listOf().classList.contains('checklist')
        : ['bold', 'italic', 'underline', 'strikeThrough', 'insertOrderedList'].includes(c) && document.queryCommandState(c);
    } catch {}
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
}
document.addEventListener('selectionchange', () => $('noteText').contains(getSelection().anchorNode) && updateTools());

$('noteTools').addEventListener('mousedown', e => e.preventDefault()); // keep the text selected
$('noteTools').addEventListener('click', e => {
  const cmd = e.target.closest('button')?.dataset.cmd;
  if (!cmd) return;
  if (!$('noteText').contains(getSelection().anchorNode)) $('noteText').focus();
  if (cmd === 'heading') document.execCommand('formatBlock', false, isHeading() ? 'div' : 'h2');
  else if (cmd === 'checklist') {
    if (listOf()?.classList.contains('checklist')) document.execCommand('insertUnorderedList'); // turn it off
    else {
      if (!listOf()) document.execCommand('insertUnorderedList');
      listOf()?.classList.add('checklist');
    }
  } else if (cmd === 'insertUnorderedList' && listOf()?.classList.contains('checklist')) {
    listOf().classList.remove('checklist'); // checklist -> plain bullets
  } else if (cmd === 'createLink') {
    const url = prompt('Link address (Ctrl+click a link to open it)', 'https://')?.trim();
    if (url && /^(https?:|mailto:)/i.test(url)) document.execCommand('createLink', false, url);
  } else document.execCommand(cmd);
  onNoteInput();
  updateTools();
});

const newNote = () => {
  flushNote();
  if (!draft) {
    draft = { id: crypto.randomUUID(), title: '', html: '', body: '', updated: new Date().toISOString() };
    data.notes = [draft, ...data.notes];
  }
  noteId = draft.id;
  renderNotes();
  $('noteSaved').textContent = 'New note';
  $('noteTitle').focus();
};
$('newNote').onclick = $('newNoteEmpty').onclick = newNote;

$('deleteNote').onclick = async () => {
  const n = data.notes.find(x => x.id === noteId);
  if (!n) return;
  clearTimeout(noteTimer);
  if (n.id === draft?.id) { dropDraft(); noteId = null; return renderNotes(); } // never saved: nothing to confirm
  if (!confirm(`Delete "${(n.title || '').trim() || 'Untitled'}"?`)) return;
  const before = await chrome.storage.local.get('notes');
  await chrome.storage.local.set({ notes: data.notes.filter(x => x.id !== n.id) });
  toast('Note deleted', { label: 'Undo', run: () => { noteId = n.id; chrome.storage.local.set(before); } });
};

// ---------- Reorder folders: drag in the sidebar, or Alt+Up / Alt+Down on a folder ----------
function moveFolder(name, to) {
  const list = data.folders.filter(f => f !== name);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, name);
  if (list.join('\n') === data.folders.join('\n')) return;
  data.folders = list;
  render();
  chrome.storage.local.set({ folders: list });
}
const clearDrop = () => document.querySelectorAll('nav .drop-before, nav .drop-after')
  .forEach(x => x.classList.remove('drop-before', 'drop-after'));

function folderButton(f) {
  const b = navButton(f, f, data.bookmarks.filter(x => folderOf(x) === f).length, 'folder');
  b.draggable = true;
  b.dataset.folder = f;
  b.ondragstart = e => {
    e.dataTransfer.setData('text/x-folder', f);
    e.dataTransfer.effectAllowed = 'move';
    b.classList.add('dragging');
  };
  b.ondragend = () => { b.classList.remove('dragging'); clearDrop(); };
  b.ondragover = e => {
    if (!e.dataTransfer.types.includes('text/x-folder')) return;
    e.preventDefault();
    const r = b.getBoundingClientRect();
    const row = getComputedStyle($('nav')).display === 'flex'; // narrow window: folders are a horizontal strip
    const after = row ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    clearDrop();
    b.classList.add(after ? 'drop-after' : 'drop-before');
  };
  b.ondragleave = () => b.classList.remove('drop-before', 'drop-after');
  b.ondrop = e => {
    e.preventDefault();
    const from = e.dataTransfer.getData('text/x-folder');
    const after = b.classList.contains('drop-after');
    clearDrop();
    if (!from || from === f) return;
    moveFolder(from, data.folders.filter(x => x !== from).indexOf(f) + (after ? 1 : 0));
  };
  b.onkeydown = e => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveFolder(f, data.folders.indexOf(f) + (e.key === 'ArrowUp' ? -1 : 1)); // render() keeps it focused
  };
  return b;
}
