// Home tab: Unsplash slideshow + world clocks. Loaded by bookmarks.html.

// Built-in photos from Unsplash collection 1263731, used when no API key is set.
const BUILTIN_PHOTOS = [
  ['photo-1581701561598-d78d4f564829', 'ocean-waves-crashing-on-shore-G_Llmg7o8eo'],
  ['photo-1481018592018-a0ba374d1e4f', 'a-large-building-on-a-foggy-night-eiOCOsKjgDE'],
  ['photo-1538947378928-4561e14354fe', 'archictetural-photography-road-5lgC0sAa6Gg'],
  ['photo-1704739324680-c1ceac015f32', 'a-snow-covered-forest-with-a-sunset-in-the-background-q9-YNofpxVI'],
  ['photo-1547171011-b095a962dd34', 'pine-trees-U7-jcQlVH7E'],
  ['photo-1639846002840-7cb39e6fe149', 'a-snowy-landscape-with-trees-covered-in-snow-vB6y_XU-arE'],
  ['photo-1608990953596-7d3412dbcfa5', 'person-walking-on-snow-covered-ground-near-bare-trees-during-daytime-45z2v93A_ww'],
  ['photo-1675013888017-6d4c99b70eb1', 'a-group-of-trees-covered-in-snow-on-a-hill-B8URe1S8HAA'],
  ['photo-1658054041772-f3aedb276eda', 'a-couple-trees-in-a-snowy-area-4rEim8tVq_U'],
  ['photo-1735985953781-cf64e230a950', 'a-lone-tree-in-the-middle-of-a-snowy-field-Dv4bkubAhSk'],
  ['photo-1613574125920-1f9bf3d7d41e', 'green-pine-trees-covered-with-snow-during-daytime-0uwsCRS-Py0'],
  ['photo-1697814174264-9229edc5184f', 'a-car-driving-down-a-road-surrounded-by-trees-r0qCOLWFsIU'],
  ['photo-1657920217095-60d43aae6756', 'a-field-of-flowers-with-a-mountain-in-the-background-myFHvpwtEvs'],
  ['photo-1640900067523-5e681d34d51c', 'a-group-of-pine-trees-covered-in-snow-qo-5W5yLnRA'],
  ['photo-1738081359154-44d50176b2d0', 'a-snow-covered-forest-filled-with-lots-of-trees-95iZ2UVvv0A'],
  ['photo-1632411316884-3f9bcff1c23c', 'a-couple-of-trees-that-are-standing-in-the-snow-GwU4seaTEuo'],
  ['photo-1572287017457-c81dffd012df', 'photo-of-white-trees-nzRw_dPajGc'],
  ['photo-1643740164958-4aa4c36ede4d', 'a-couple-of-trees-that-are-standing-in-the-snow-2SLDucBscdo'],
  ['photo-1643450548452-9e291d65e85d', 'a-couple-of-trees-that-are-standing-in-the-snow-1l-iJC5TzDo'],
  ['photo-1707918227985-5b995913e61d', 'a-lone-tree-in-the-middle-of-a-snowy-field-Oy0WDugngts'],
  ['photo-1549146050-a0586b6e6c81', 'aerial-photography-of-snow-covered-pine-trees-during-daytime-slBgGBQvso8'],
].map(([id, slug]) => ({
  url: `https://images.unsplash.com/${id}?auto=format&fit=crop&crop=entropy&w=2400&h=1350&q=80`,
  page: `https://unsplash.com/photos/${slug}`,
  author: '',
}));

const ZONES = [
  { label: 'India', tz: 'Asia/Kolkata' },
  { label: 'US Central', tz: 'America/Chicago' },
  { label: 'Israel', tz: 'Asia/Jerusalem' },
];
const HOME_DEFAULTS = { name: '', interval: 60, key: '', collection: '1263731', paused: false };
const UTM = '?utm_source=url_bookmarker&utm_medium=referral';

const home = { settings: { ...HOME_DEFAULTS }, photos: BUILTIN_PHOTOS, index: 0, visible: false, timer: null, layer: 0 };

// ---------- Clocks ----------
const fmt = (tz, opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
const partsIn = tz => Object.fromEntries(fmt(tz, {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZoneName: 'short',
}).formatToParts(new Date()).map(p => [p.type, p.value]));

function zoneInfo(tz) {
  const p = partsIn(tz), local = partsIn(undefined);
  const asUTC = q => Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute);
  const diffMin = Math.round((asUTC(p) - asUTC(local)) / 60000);
  const dayDiff = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(local.year, local.month - 1, local.day)) / 864e5);
  const abs = Math.abs(diffMin), h = Math.floor(abs / 60), m = abs % 60;
  return {
    time: fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date()),
    abbr: tz === 'Asia/Kolkata' ? 'IST' : tz === 'Asia/Jerusalem' ? (p.timeZoneName === 'GMT+3' ? 'IDT' : 'IST') : p.timeZoneName,
    day: ['Yesterday', 'Today', 'Tomorrow'][dayDiff + 1] ?? '',
    offset: diffMin === 0 ? 'Same as you' : `${diffMin > 0 ? '+' : '−'}${h ? `${h}h` : ''}${m ? ` ${m}m` : ''}`.trim(),
  };
}

function tick() {
  const now = new Date();
  const [hm, ampm] = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).split(' ');
  $('bigTime').firstChild.textContent = hm;
  $('bigAmpm').textContent = ampm || '';
  $('bigDate').textContent = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  const hr = now.getHours();
  $('greet').textContent = (hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (home.settings.name ? `, ${home.settings.name}` : '');

  // A zone showing the same time as this PC is just the big clock again: skip it.
  $('zones').replaceChildren(...(home.settings.zones || ZONES).map(z => [z, zoneInfo(z.tz)]).filter(([, i]) => i.offset !== 'Same as you').map(([z, info]) => {
    const card = el('div', { className: 'zone' });
    const top = el('div', { className: 'zone-top' });
    top.append(el('span', { textContent: z.label }), el('span', { className: 'abbr', textContent: info.abbr }));
    card.append(top, el('div', { className: 'zone-time', textContent: info.time }),
      el('div', { className: 'zone-meta', textContent: `${info.day} · ${info.offset}` }));
    return card;
  }));
}

// ---------- Slideshow ----------
function showPhoto(i) {
  const p = home.photos[(i + home.photos.length) % home.photos.length];
  home.index = home.photos.indexOf(p);
  const img = new Image();
  img.onload = () => {
    home.layer ^= 1;
    const [on, off] = home.layer ? [$('bgB'), $('bgA')] : [$('bgA'), $('bgB')];
    on.style.backgroundImage = `url("${p.url}")`;
    on.classList.add('on');
    off.classList.remove('on');
    $('credit').href = p.page + UTM;
    $('credit').textContent = p.author ? `Photo by ${p.author} on Unsplash` : 'Photo on Unsplash';
  };
  img.onerror = () => { if (home.photos.length > 1) showPhoto(home.index + 1); };
  img.src = p.url;
  schedule();
}

// The photo sits behind every view, so the slideshow always runs (paused while the tab is hidden).
function schedule() {
  clearTimeout(home.timer);
  if (home.settings.paused) return; // ‹ › still change the photo by hand
  home.timer = setTimeout(() => (document.hidden ? schedule() : showPhoto(home.index + 1)), home.settings.interval * 1000);
}

// With an Unsplash Access Key, pull fresh photos from the collection (cached for 12 hours
// to stay inside the API's hourly limit). Without one, use the built-in list.
async function loadPhotos() {
  const { key, collection } = home.settings;
  $('homeNote').textContent = '';
  if (!key) { home.photos = BUILTIN_PHOTOS; return; }
  const { homePhotos } = await chrome.storage.local.get('homePhotos');
  if (homePhotos?.key === key && homePhotos?.collection === collection && Date.now() - homePhotos.at < 12 * 36e5) {
    home.photos = homePhotos.list;
    return;
  }
  try {
    const r = await fetch(`https://api.unsplash.com/photos/random?count=30&orientation=landscape&collections=${encodeURIComponent(collection)}`,
      { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
    if (!r.ok) throw new Error(`Unsplash said ${r.status}`);
    const list = (await r.json()).map(p => ({
      url: `${p.urls.raw}&auto=format&fit=crop&w=2400&q=80`, page: p.links.html, author: p.user?.name || '',
    }));
    if (!list.length) throw new Error('collection is empty');
    home.photos = list;
    await chrome.storage.local.set({ homePhotos: { key, collection, at: Date.now(), list } });
    $('homeNote').textContent = '';
  } catch (e) {
    home.photos = BUILTIN_PHOTOS;
    $('homeNote').textContent = `Couldn't load from Unsplash (${e.message}). Showing built-in photos.`;
  }
}

// Called by bookmarks.js whenever the Home tab is shown or hidden (clocks only tick on Home).
function setHomeVisible(visible) {
  if (visible === home.visible) return;
  home.visible = visible;
  if (visible) tick();
  else $('homeSettings').hidden = true;
}

// ---------- Pause / resume ----------
function updatePauseBtn() {
  const paused = home.settings.paused;
  $('homePause').setAttribute('aria-pressed', String(paused));
  $('homePause').title = paused ? 'Resume slideshow' : 'Pause slideshow';
  $('homePause').querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
}
$('homePause').onclick = async () => {
  home.settings.paused = !home.settings.paused;
  updatePauseBtn();
  schedule();
  await chrome.storage.local.set({ homeSettings: home.settings });
  toast(home.settings.paused ? 'Slideshow paused' : 'Slideshow resumed');
};

// ---------- Settings panel ----------
$('homePrev').onclick = () => showPhoto(home.index - 1);
$('homeNext').onclick = () => showPhoto(home.index + 1);
$('homeSettingsBtn').onclick = () => {
  const open = $('homeSettings').hidden;
  $('homeSettings').hidden = !open;
  if (open) {
    renderZoneEditor();
    $('hsName').value = home.settings.name;
    $('hsInterval').value = String(home.settings.interval);
    $('hsKey').value = home.settings.key;
    $('hsCollection').value = home.settings.collection;
  }
};
$('homeSettings').onsubmit = async e => {
  e.preventDefault();
  home.settings = {
    ...home.settings,
    name: $('hsName').value.trim(),
    interval: Number($('hsInterval').value) || HOME_DEFAULTS.interval,
    key: $('hsKey').value.trim(),
    collection: $('hsCollection').value.trim() || HOME_DEFAULTS.collection,
  };
  await chrome.storage.local.set({ homeSettings: home.settings });
  $('homeSettings').hidden = true;
  tick();
  await loadPhotos();
  if ($('homeNote').textContent) $('homeSettings').hidden = false; // keep the error visible
  showPhoto(Math.floor(Math.random() * home.photos.length));
};

// ---------- World clocks: add, rename, remove (in Home settings) ----------
const cityOf = tz => tz.split('/').pop().replace(/_/g, ' ');
const zones = () => home.settings.zones || ZONES;
function saveZones(list) {
  home.settings.zones = list;
  tick();
  chrome.storage.local.set({ homeSettings: home.settings });
}
function renderZoneEditor() {
  $('hsZones').replaceChildren(...zones().map((z, i) => {
    const label = el('input', { value: z.label, maxLength: 30, title: z.tz });
    label.setAttribute('aria-label', `Name for ${z.tz}`);
    label.onchange = () => saveZones(zones().map((x, j) => (j === i ? { ...x, label: label.value.trim() || cityOf(x.tz) } : x)));
    const del = el('button', { type: 'button', className: 'icon-btn danger', title: `Remove ${z.label}` });
    del.append(svgIcon('trash'));
    del.onclick = () => { saveZones(zones().filter((_, j) => j !== i)); renderZoneEditor(); };
    const li = el('li');
    // Drag by the handle (dragging the whole row would fight with selecting text in the label),
    // or focus the handle and press Alt+Up / Alt+Down.
    const grip = el('span', { className: 'grip', draggable: true, tabIndex: 0, title: 'Drag to reorder, or Alt+Up / Alt+Down' });
    grip.setAttribute('aria-label', `Move ${z.label}`);
    grip.append(svgIcon('grip'));
    grip.ondragstart = e => {
      e.dataTransfer.setData('text/x-zone', String(i));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setDragImage(li, 10, li.offsetHeight / 2);
      li.classList.add('dragging');
    };
    grip.ondragend = () => { li.classList.remove('dragging'); clearZoneDrop(); };
    grip.onkeydown = e => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= zones().length) return;
      moveZone(i, to);
      $('hsZones').children[to].querySelector('.grip').focus();
    };
    li.ondragover = e => {
      if (!e.dataTransfer.types.includes('text/x-zone')) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      clearZoneDrop();
      li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    };
    li.ondragleave = () => li.classList.remove('drop-before', 'drop-after');
    li.ondrop = e => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/x-zone'));
      const after = li.classList.contains('drop-after');
      clearZoneDrop();
      if (from === i) return;
      // Index in the list once the dragged clock is taken out.
      moveZone(from, i - (from < i ? 1 : 0) + (after ? 1 : 0));
    };
    li.append(grip, label, el('span', { className: 'tz', textContent: zoneInfo(z.tz).abbr }), del);
    return li;
  }));
}
const clearZoneDrop = () => document.querySelectorAll('#hsZones .drop-before, #hsZones .drop-after')
  .forEach(x => x.classList.remove('drop-before', 'drop-after'));
function moveZone(from, to) {
  const list = [...zones()];
  const [z] = list.splice(from, 1);
  list.splice(to, 0, z);
  if (list.every((x, j) => x === zones()[j])) return;
  saveZones(list);
  renderZoneEditor();
}
const allZones = Intl.supportedValuesOf('timeZone');
$('tzList').replaceChildren(...allZones.map(tz => el('option', { value: tz })));
function addZone() {
  const q = $('hsZoneTz').value.trim().toLowerCase().replace(/ /g, '_');
  if (!q) return;
  // Accept "Europe/London", "london" or "new york".
  const tz = allZones.find(z => z.toLowerCase() === q) || allZones.find(z => cityOf(z).toLowerCase().replace(/ /g, '_') === q);
  if (!tz) return toast('Pick a time zone from the list, e.g. Europe/London');
  if (zones().some(z => z.tz === tz)) return toast(`${cityOf(tz)} is already there`);
  saveZones([...zones(), { label: cityOf(tz), tz }]);
  $('hsZoneTz').value = '';
  renderZoneEditor();
}
$('hsZoneAdd').onclick = addZone;
$('hsZoneTz').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addZone(); } };

// Name and clocks can arrive from the other browser through sync.
chrome.storage.onChanged.addListener(({ homeSettings: c }) => {
  if (!c?.newValue) return;
  const { name, zones: z } = c.newValue;
  if (name === home.settings.name && JSON.stringify(z) === JSON.stringify(home.settings.zones)) return;
  Object.assign(home.settings, { name, zones: z });
  tick();
  if (!$('homeSettings').hidden) renderZoneEditor();
});

(async () => {
  const { homeSettings } = await chrome.storage.local.get('homeSettings');
  home.settings = { ...HOME_DEFAULTS, ...homeSettings };
  updatePauseBtn();
  await loadPhotos();
  showPhoto(Math.floor(Math.random() * home.photos.length));
  setInterval(() => home.visible && !document.hidden && tick(), 1000);
})();
