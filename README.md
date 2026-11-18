# URL Bookmarker

A Chrome extension (Manifest V3) for saving pages into folders, with a bookmarks page that has search, folder rename/delete, and a Home tab with an Unsplash slideshow and world clocks (India, US Central, Israel).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension. Click it on any page to save that page into a folder.

## Bringing in existing bookmarks

- **Import** on the bookmarks page accepts this extension's JSON export or a Bonjourr backup. It only adds what's missing (links, to-dos, notes); nothing you have is changed.
- Every change is also backed up to `Downloads/URL Bookmarker/bookmarks.json`, with links, folders, to-dos and notes. **Export** saves the same file.
- Or put a `bookmarks.json` (same format as **Export**) in this folder and reload the extension. It's merged in once and is git-ignored, so personal links stay out of the repo.

## Sync between browsers

Click **Sync** on the bookmarks page and paste a GitHub token that has only the `gist` permission. Do the same in each browser (Chrome, Edge, another PC) with the same token. Links are kept in a secret Gist named `url-bookmarker.json`. Each browser syncs every minute and right after a change. Deletes, folder renames, the To-do list, Notes, your Home greeting name and world clocks sync too.

You paste the token once per browser account: it is also kept in the browser's own sync (your Google account in Chrome, Microsoft account in Edge), so another PC signed in to the same account turns sync on by itself within a minute or two. The `key` in manifest.json fixes the extension ID (`dahemekchifjfjfbccdkpagnfdgebdbl`) in every browser and folder, so this works wherever you clone it. Removing the extension deletes its copy of the token from browser sync too; reloading it is fine. **Turn off** only turns sync off on that PC.

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
