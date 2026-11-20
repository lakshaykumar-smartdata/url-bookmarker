# URL Bookmarker

A Chrome extension (Manifest V3) for saving pages into folders, with a bookmarks page that has search, folder rename/delete, and a Home tab with an Unsplash slideshow and world clocks (India, US Central, Israel).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension. Click it on any page to save that page into a folder.

## Bringing in existing bookmarks

- **Edit titles.** Hover a link and click the pencil to rename it (Enter or click away saves, Esc cancels). In the popup, click the title to change it before saving. Renames sync to your other browsers.
- **Frequently used.** Home shows the 8 links you open most from the bookmarks page (click, Ctrl+click or middle click), as shortcut tiles under Google search. Hover a tile and click × to drop it from the row. Counts stay in this browser; they aren't synced or backed up.
- **Chrome bookmarks.** The sidebar lists your browser's own bookmark folders under *Chrome bookmarks*, below your folders. They're read-only here and update live; edit them in Chrome's bookmark manager.
- **Import** on the bookmarks page accepts this extension's JSON export or a Bonjourr backup. It only adds what's missing (links, to-dos, notes); nothing you have is changed.
- **Backups.** Every change is saved as `bookmarks.json` (links, folders, to-dos, notes, greeting name, clocks and the GitHub token) in two places:
  - **This extension's folder**, once you pick it: **Sync → Backup folder → Choose folder**, then select `bookmark-extension`. Browsers only let an extension write outside Downloads to a folder you picked, and they may ask again after a restart. The page then shows "Backup to the extension folder is paused"; click **Allow**. The file is git-ignored.
  - **Downloads/URL Bookmarker/**, always, as a fallback.
  **Export** saves the same data without the token, because that's the file you might share.
- **Reinstalled?** On first start the extension reads both backups back in by itself, before any new backup overwrites them. Nothing is replaced; missing items are added. The token comes back too, so sync turns itself on again. After a reinstall, pick the backup folder once more. Reading Downloads needs "Allow access to file URLs", which is on by default for an unpacked extension.
- The backups are read only on a fresh install, never later. Chrome and Edge both write them, so reading them again would bring back links the other browser deleted.
- Anyone who can open these folders can read the token, so give it only the `gist` permission. Turning sync off removes the token from the backups.

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
