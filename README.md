# Budget

A small, local-first bills and income tracker, extracted from the Budget tab of Second Memory. It
runs fully offline in any modern browser, stores everything in that browser's `localStorage`, and has
no dependencies, no build step and no CDN scripts.

It has one screen:

- a five-week calendar with weekly and monthly totals (bills, income and net), where each day has a box for extra income
- the **Current Pay Period** (enter a recent payday and how often you are paid)
- **Paid History** by month and category
- **Bills** (add, edit, delete, mark paid, autopay, category filter, search, sort)
- **Recurring Income** (a paycheck, for example)
- a banner at the top for bills due within two days or overdue (autopay bills are never counted as overdue)

The Menu has Undo/Redo, Sync, Export/Import, Theme (Auto, Light, Dark), App lock and the version.

## Run it

Open `index.html` through any static web server (a service worker and the app lock need `http://localhost` or `https`):

```
python -m http.server 5191
```

then go to http://localhost:5191/. It can be hosted in a folder next to Second Memory (for example
`/budget/`): every path in the app, the manifest and the service worker is relative.

## Moving your data over from Second Memory

1. In Second Memory, tap **Export data** in the Menu. You get a file such as `second-memory-export-YYYY-MM-DD.json`.
2. In Budget, tap **Import data** in the Menu and choose that file.

Budget reads only `bills`, `income` and `recurringIncome` (plus your pay-period settings) and ignores
everything else in the file. Importing never deletes anything, skips records it cannot read, and never
brings back something you deleted here. Budget's own **Export data** file has the same shape but holds
only those three lists, so it can also be imported back into Second Memory.

If you sync Second Memory, you can instead tap **Sync now** here (see below) and the same three lists come down from the server.

## Sync (optional, manual)

Sync talks to the same sync server Second Memory uses, only when you press **Sync now**, and only for
bills, income and recurring income. Type the sync passphrase into the Menu at runtime; it is kept only in
this browser. Never put it in the code, a test or a document. Nothing runs in the background.

## Same address as Second Memory: storage names

When both apps are hosted on `michellefeliciano.github.io`, the browser shares `localStorage` between
every path on that address. To keep the two apps apart, every key this app writes starts with
`budgetApp.` (Second Memory uses `secondMemory.`), the service worker cache is named `budget-v<N>` and it
only ever deletes caches starting with `budget-`, and the manifest uses `start_url` `./index.html` with
scope `./`. "Forgot PIN" on the app lock erases only `budgetApp.*` keys. Data is not shared between the two
apps on one device: use Import or Sync to move it.

## Tests

Browser tests (they load the app in hidden frames with memory-only storage and no network, so they never
touch real data, the sync server or Second Memory's data on the same site):

```
python -m http.server 5191
```

then open http://localhost:5191/tests/tests.html and wait about 15 seconds. The page title ends in `OK n/n`
when everything passes.

File checks that need no browser (version label matches the service worker cache, every shipped file is
cached, element ids, no external requests, storage-key prefix, manifest):

```
python -m unittest discover -s tests
```

## Changing the app

Bump `APP_VERSION` in `app.js` and `CACHE_NAME` in `sw.js` together (same number) whenever you change
`index.html`, `style.css`, `app.js`, `manifest.json` or an icon; a test checks they match. Without a new
`CACHE_NAME` the browser never notices the service worker changed and keeps serving old files.

The app lock hides the screen behind a PIN; it does **not** encrypt the data stored on the device.
