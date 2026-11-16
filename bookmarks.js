const $ = id => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const folderOf = b => b.folder || 'Unsorted';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ALL = '\0all';
const HOME = '\0home';
const TODO = '\0todo';

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

// Keep this tab pinned so it stays put and is hard to close by accident.
chrome.tabs.getCurrent(t => t && !t.pinned && chrome.tabs.update(t.id, { pinned: true }));

let data = { bookmarks: [], folders: [], todos: [] };
let selected = HOME; // the page always opens on Home

async function load() {
  const { bookmarks = [], folders = [], todos = [] } = await chrome.storage.local.get(['bookmarks', 'folders', 'todos']);
  data = { bookmarks, folders: [...new Set([...folders, ...bookmarks.map(folderOf)])], todos };
  if (![ALL, HOME, TODO].includes(selected) && !data.folders.includes(selected)) selected = ALL;
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
    el('a', { href: b.url, target: '_blank', title: b.url, textContent: b.title || b.url }),
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
  actions.append(copy, del);
  li.append(actions);
  return li;
}

function render() {
  const { bookmarks, folders } = data;
  const q = $('q').value.trim().toLowerCase();

  $('nav').replaceChildren(
    navButton(HOME, 'Home', null, 'home'),
    navButton(TODO, 'To-do', data.todos.filter(t => !t.done).length || null, 'todo'),
    navButton(ALL, 'All bookmarks', bookmarks.length, 'all'),
    el('div', { className: 'label', textContent: 'Folders' }),
    ...folders.map(f => navButton(f, f, bookmarks.filter(b => folderOf(b) === f).length, 'folder'))
  );
  $('nav').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // Home tab: slideshow + clocks (home.js). A search always shows results instead.
  const homeMode = !q && selected === HOME;
  $('home').hidden = !homeMode;
  $('wrap').hidden = homeMode;
  document.body.classList.toggle('home-mode', homeMode); // photo behind the whole page
  if (typeof setHomeVisible === 'function') setHomeVisible(homeMode);
  const todoMode = !q && selected === TODO;
  $('todo').hidden = !todoMode;
  if (homeMode) return;
  if (todoMode) { $('wrap').hidden = true; return renderTodos(); }

  // Search always looks across every folder.
  let rows = bookmarks.map((b, i) => [b, i]);
  const words = q.split(/\s+/);
  if (q) rows = rows.filter(([b]) => {
    const text = `${b.title} ${b.url} ${folderOf(b)}`.toLowerCase();
    return words.every(w => text.includes(w)); // every word, any order
  });
  else if (selected !== ALL) rows = rows.filter(([b]) => folderOf(b) === selected);
  const showFolder = !!q || selected === ALL || selected === HOME;

  $('title').textContent = q ? `Results for “${$('q').value.trim()}”` : selected === ALL ? 'All bookmarks' : selected;
  $('title').hidden = renaming;
  $('renameInput').hidden = !renaming;
  $('folderActions').hidden = renaming || !!q || selected === ALL;
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
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
  if (e.key === 'Escape' && document.activeElement === $('q')) { $('q').value = ''; render(); }
});

$('export').onclick = exportJson;
$('import').onclick = () => $('file').click();
$('file').onchange = async () => {
  try {
    const added = await mergeBookmarks(JSON.parse(await $('file').files[0].text()));
    toast(`Imported ${plural(added, 'new link')}. Existing links were kept.`);
  } catch (e) {
    toast(`Couldn't import that file: ${e.message}`);
  }
  $('file').value = '';
};

seedFromBundle().finally(load); // also here, in case the background import didn't run
chrome.storage.onChanged.addListener(c => (c.bookmarks || c.folders || c.todos) && load());

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
  await chrome.storage.local.set({ syncSettings: { token, gistId }, syncStatus: {} });
  chrome.runtime.sendMessage({ sync: true }).catch(() => {});
};
$('syncOff').onclick = async () => {
  await chrome.storage.local.remove(['syncSettings', 'syncStatus']);
  $('syncToken').value = '';
  toast('Sync turned off. Your links stay here.');
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
