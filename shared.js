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
