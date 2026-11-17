// Used by background.js, popup.js and bookmarks.js.

// Bonjourr export -> { folders, bookmarks }. Nested Bonjourr folders become "Group / Folder".
function fromBonjourr(d) {
  const items = Object.values(d).filter(v => v && typeof v === 'object' && String(v._id || '').startsWith('links'));
  const byId = Object.fromEntries(items.map(i => [i._id, i]));
  const name = p => byId[p]?.folder ? `${name(byId[p].parent)} / ${byId[p].title}` : p;
  const links = items.filter(i => !i.folder && i.url).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    folders: [...(d.linkgroups?.groups || []), ...items.filter(i => i.folder).map(i => name(i._id))],
    bookmarks: links.map(l => ({ url: l.url, title: l.title || l.url, folder: name(l.parent) })),
  };
}

// Adds links that aren't already saved (same URL in same folder). Never removes anything.
async function mergeBookmarks(data) {
  if (data?.linkgroups) data = fromBonjourr(data);
  const incoming = Array.isArray(data) ? data : data?.bookmarks || [];
  const { bookmarks = [], folders = [] } = await chrome.storage.local.get(['bookmarks', 'folders']);
  const seen = new Set(bookmarks.map(b => `${b.folder}\n${b.url}`));
  let added = 0;

  for (const f of [...(data?.folders || []), ...incoming.map(b => b.folder || 'Unsorted')]) {
    if (!folders.includes(f)) folders.push(f);
  }
  for (const b of incoming) {
    const folder = b?.folder || 'Unsorted';
    if (!b?.url || seen.has(`${folder}\n${b.url}`)) continue;
    seen.add(`${folder}\n${b.url}`);
    bookmarks.push({ url: b.url, title: b.title || b.url, folder, icon: b.icon, savedAt: b.savedAt || new Date().toISOString() });
    added++;
  }
  await chrome.storage.local.set({ bookmarks, folders });
  return added;
}

// ---------- Folder suggestion for the popup ----------
// 1. A folder whose name shows up in the page's URL or title ("EligibilityOS" in
//    github.com/sdeitech/EligibilityOS-Frontend). Longest match wins.
// 2. Else the folder that already holds the most links from the same site.
// 3. Else nothing (the popup shows the first folder).
const GENERIC_WORDS = new Set(['home', 'link', 'links', 'docs', 'misc', 'other', 'unsorted', 'test', 'tools', 'apps']);
function suggestFolder(url = '', title = '', folders = [], bookmarks = []) {
  const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hay = squash(url.replace(/^[a-z]+:\/\//i, '') + ' ' + title);
  const score = f => {
    const whole = squash(f);
    if (whole.length >= 3 && !GENERIC_WORDS.has(whole) && hay.includes(whole)) return whole.length * 2;
    // "Crystal Care CRM" -> any of its words of 4+ letters, e.g. "crystal" in crystalcare.com.au
    return f.toLowerCase().split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !GENERIC_WORDS.has(w) && hay.includes(w))
      .reduce((n, w) => n + w.length, 0);
  };
  let best = null, top = 0;
  for (const f of folders) { const s = score(f); if (s > top) { best = f; top = s; } }
  if (best) return best;
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const host = hostOf(url), count = {};
  if (host) for (const b of bookmarks) if (hostOf(b.url) === host) count[b.folder || 'Unsorted'] = (count[b.folder || 'Unsorted'] || 0) + 1;
  return folders.filter(f => count[f]).sort((a, b) => count[b] - count[a])[0] ?? null;
}

// ---------- Sync merge ----------
// Every bookmark/folder add or remove gets a stamp {t, del}. Removes stay as tombstones,
// so a delete in one browser deletes everywhere instead of coming back on the next merge.
const bKey = b => `b:${b.url}\n${b.folder || 'Unsorted'}`;
const fKey = f => `f:${f}`;
const tKey = t => `t:${t.id}`; // to-do items
const nKey = n => `n:${n.id}`; // notes

// a = this browser, b = the Gist. Each is {bookmarks, folders, todos, notes, stamps}. Newest stamp wins,
// for edits too (a to-do ticked in Edge shows ticked in Chrome).
// Items with no stamp (saved before sync existed) count as added at time 0.
function mergeSync(a, b) {
  const sa = a.stamps || {}, sb = b.stamps || {};
  const stamps = { ...sa };
  for (const [k, s] of Object.entries(sb)) if (!stamps[k] || s.t > stamps[k].t) stamps[k] = s;
  const alive = k => !stamps[k]?.del;
  const pick = (mine = [], theirs = [], key) => {
    const other = new Map(theirs.map(x => [key(x), x]));
    const newer = k => other.has(k) && (sb[k]?.t ?? 0) > (sa[k]?.t ?? 0);
    const own = mine.filter(x => alive(key(x))).map(x => (newer(key(x)) ? other.get(key(x)) : x));
    const have = new Set(own.map(key));
    const fresh = theirs.filter(x => alive(key(x)) && !have.has(key(x)) && have.add(key(x)));
    return [own, fresh];
  };
  const [ownB, freshB] = pick(a.bookmarks, b.bookmarks, bKey);
  const [ownF, freshF] = pick(a.folders, b.folders, fKey);
  const [ownT, freshT] = pick(a.todos, b.todos, tKey);
  // ponytail: a note edited in both browsers before they sync keeps only the newer edit; merge text if that bites.
  const [ownN, freshN] = pick(a.notes, b.notes, nKey);
  const bookmarks = [...freshB, ...ownB]; // links from the other browser go on top, like a new save
  const folders = [...ownF, ...freshF];
  // Folder order: whoever reordered last wins (stamp 'o:folders'). On a tie the Gist's order wins,
  // so two browsers that disagree always settle on one order. Folders it doesn't know go last.
  if ((sb['o:folders']?.t ?? 0) >= (sa['o:folders']?.t ?? 0)) {
    const rank = new Map((b.folders || []).map((f, i) => [f, i]));
    folders.sort((x, y) => (rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity));
  }
  for (const x of bookmarks) if (!folders.includes(x.folder || 'Unsorted')) folders.push(x.folder || 'Unsorted');
  // Home settings that follow you (greeting name, world clocks): newest wins, Gist wins a tie.
  // An old Gist without the setting keeps yours.
  const setting = k => (b[k] !== undefined && (sb[`p:${k}`]?.t ?? 0) >= (sa[`p:${k}`]?.t ?? 0) ? b[k] : a[k]);
  return { name: setting('name') || '', zones: setting('zones'), bookmarks, folders, todos: [...freshT, ...ownT], notes: [...freshN, ...ownN], stamps: Object.fromEntries(Object.entries(stamps).sort(([x], [y]) => (x < y ? -1 : 1))) };
}

// Fingerprint of what's synced. Link order is ignored, so two browsers with the same links in a
// different order don't keep re-uploading.
const syncFingerprint = s => JSON.stringify([
  s.name || '', s.zones ?? null, s.bookmarks.map(bKey).sort(), s.folders, s.stamps, // folder order matters, it's shown in the sidebar
  (s.todos || []).map(t => JSON.stringify([t.id, t.text, t.done])).sort(),
  (s.notes || []).map(n => JSON.stringify([n.id, n.title, n.html ?? n.body])).sort(),
]);

// Merge the bundled bookmarks.json into storage. Skipped if the file hasn't changed
// since the last import, so links you deleted don't come back.
async function seedFromBundle() {
  // bookmarks.json is optional (it's git-ignored, so a fresh clone has none).
  const res = await fetch(chrome.runtime.getURL('bookmarks.json')).catch(() => null);
  if (!res?.ok) return 0;
  const text = await res.text();
  const { seedText } = await chrome.storage.local.get('seedText');
  if (text === seedText) return 0;
  const added = await mergeBookmarks(JSON.parse(text));
  await chrome.storage.local.set({ seedText: text });
  return added;
}

// Chrome's favicon cache. When it has no icon for a page it returns a generic globe
// instead of an error, so compare against that globe and treat a match as "no icon".
const faviconUrl = page => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(page)}&size=32`);
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer()).join();
let globe;
async function chromeIcon(page) {
  try {
    globe ??= fetch(faviconUrl('https://no-icon.invalid/')).then(r => r.blob()).then(bytesOf);
    const r = await fetch(faviconUrl(page));
    if (!r.ok) return null;
    const blob = await r.blob();
    return (await bytesOf(blob)) === (await globe) ? null : URL.createObjectURL(blob);
  } catch { return null; }
}

// Website icon, first that works: icon the tab reported when saved → Chrome's cache for
// this page → Chrome's cache for the site's home page → the site's /favicon.ico → letter badge.
function siteIcon(url, className = 'icon', knownIcon) {
  let u; try { u = new URL(url); } catch {}
  const steps = [];
  if (knownIcon?.startsWith('http')) steps.push(() => knownIcon);
  steps.push(() => chromeIcon(url));
  if (u?.protocol.startsWith('http')) steps.push(() => chromeIcon(`${u.origin}/`), () => `${u.origin}/favicon.ico`);

  const img = Object.assign(document.createElement('img'), { className, alt: '' });
  const next = async () => {
    while (steps.length) {
      const src = await steps.shift()();
      if (src) return void (img.src = src); // a failed load calls next() again via onerror
    }
    const name = u?.hostname.replace(/^www\./, '') || '?';
    const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    img.replaceWith(Object.assign(document.createElement('span'), {
      id: img.id, className: `${className} letter`, textContent: name[0].toUpperCase(),
      style: `background:hsl(${hue} 60% 92%);color:hsl(${hue} 55% 35%)`,
    }));
  };
  img.onerror = next;
  next();
  return img;
}

async function exportJson() {
  const { bookmarks = [], folders = [] } = await chrome.storage.local.get(['bookmarks', 'folders']);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ folders, bookmarks }, null, 2)], { type: 'application/json' }));
  a.download = 'bookmarks.json';
  a.click();
}
