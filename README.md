# URL Bookmarker

A Chrome extension (Manifest V3) for saving pages into folders, with a bookmarks page that has search, folder rename/delete, and a Home tab with an Unsplash slideshow and world clocks (India, US Central, Israel).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension. Click it on any page to save that page into a folder.

## Bringing in existing bookmarks

- **Import** on the bookmarks page accepts this extension's JSON export or a Bonjourr backup.
- Or put a `bookmarks.json` (same format as **Export**) in this folder and reload the extension. It's merged in once and is git-ignored, so personal links stay out of the repo.

Every change is also backed up to `Downloads/URL Bookmarker/bookmarks.json`.

## Files

| File | What it does |
| --- | --- |
| `popup.html/js` | Save the current tab into a folder |
| `bookmarks.html/js` | Bookmarks page: folders, search, rename/delete, undo |
| `home.js` | Home tab: slideshow and clocks |
| `shared.js` | Import/merge, site icons, export |
| `background.js` | Import on install, auto-backup, keeps the bookmarks tab pinned |
| `icons/make_icons.py` | Regenerates the toolbar icons (needs Pillow) |
