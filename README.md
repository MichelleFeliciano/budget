# Budget

A small, local-first bills and income tracker. It runs fully offline in any modern browser, stores
everything in that browser's `localStorage`, and has no dependencies, no build step and no CDN scripts.
Optional manual sync goes to its own small server (`server/`).

It has one screen:

- a three-week calendar (last week, this week, next week; Earlier and Later slide it, Today brings it back; on a phone each day shows its first bill's name) with weekly and monthly totals (bills, income and net) and a weekly Due line (what is left to pay), where each day has a box for extra income
- the **Current Pay Period** (taken from your biggest Recurring Income source until you save a payday by hand)
- **Paid History** by month and category
- **Bills** (add, edit, delete, mark paid, autopay, category filter, search, sort by the next date to pay, a "due in the next 2 weeks" filter)
- **Recurring Income** (a paycheck, for example)
- a banner at the top for bills due within two days or overdue (autopay bills are never flagged, in the banner or on the calendar)
  with a Mark paid button for each bill listed
- a + button that jumps to the Add bill form, and a bar with Undo after every delete or Mark paid

Pay Period, Paid History and Recurring Income fold up (and stay folded), and a row of jump links near the top scrolls to each part.
Adding a repeating bill with an old date offers "I'm caught up" (earlier dates start paid), and a card can mark its
earlier dates paid in one tap. The pay period shows the next payday and what is left after unpaid bills. The Menu also
has Text size (Normal, Large, Largest), Share backup (where the phone can share files) and Calendar reminders (a
calendar file with each bill as a repeating event). When a newer version of the app has installed itself, a bar at the
top offers Update now. `DEVICE-CHECKLIST.md` lists what to try on real phones.
On a phone the top bar also has a Sync button and a one-line sync note, so syncing does not need the Menu.
The Menu has Undo/Redo, Sync, Export/Import, Theme (Auto, Light, Dark), App lock and the version.

## Run it

Open `index.html` through any static web server (a service worker and the app lock need `http://localhost` or `https`):

```
python -m http.server 5191
```

then go to http://localhost:5191/. Every path in the app, the manifest and the service worker is relative, so it
can be hosted at the root of an address or in a folder (for example `/budget/`).

## Sync (optional, manual)

Sync talks to Budget's own server only when you press **Sync now**, and only for bills, income and recurring
income. It runs on a free host whose data is temporary, so keep your own backups (see below). Type the sync passphrase into the Menu at runtime; it is kept only in this browser. Never put it in the
code, a test or a document. Nothing runs in the background.

The server is `server/sync_server.py` (Python standard library only, no installs). The address the app calls is
`SYNC_SERVER_URL` in `app.js`; the server's allowed website addresses and passphrase come from environment
variables (`ALLOWED_ORIGINS`, `SYNC_TOKEN`), described in the file's header.

### Deploy the server (Render)

1. Render dashboard > **New** > **Blueprint** > choose this repository. It reads `render.yaml` (service
   `budget-sync`, **Free** plan, no disk).
2. When asked for `SYNC_TOKEN`, type a new sync passphrase.
3. If the service address Render gives you is not `https://budget-sync.onrender.com`, change
   `SYNC_SERVER_URL` in `app.js` to it, bump the version (see below) and redeploy the site.
4. If the app is hosted somewhere other than `https://michellefeliciano.github.io`, set `ALLOWED_ORIGINS` in the
   Render dashboard to that address (no trailing slash; several can be comma-separated).

### What the free plan means (read this)

The free plan has no persistent disk, so the server keeps its data in a temporary folder (`DATA_DIR`, set to
`/tmp/budget-data` in `render.yaml`). **That data is erased whenever the service goes to sleep (about 15 minutes
without a request) or redeploys, and the server's own daily backups go with it.** So:

- **Your devices hold the real copy.** The server is only a meeting point. Never treat it as a backup; use
  **Export data** in the Menu for real backups (the app reminds you every 30 days).
- **After a reset, one tap on Sync now refills it.** The app notices the server lost records it had confirmed and
  sends everything again straight away. The status line says so.
- **The first sync after a sleep can take a minute or more** while the server wakes up. The status line says
  "Still syncing. The server may be waking up…" after a few seconds, and the app waits up to 90 seconds.
- **A delete can come back.** If the server was reset and a device that never saw the delete syncs first, it
  re-uploads the deleted item as live. After a long gap, sync first from the device you trust most (the one
  with the latest, correct list), then the others.
- If you ever want the server's data to survive, move the service to a paid plan, add a disk, and set `DATA_DIR`
  to its mount path.

## Bringing data in from Second Memory (one time)

1. In Second Memory, tap **Export data** in the Menu. You get a file such as `second-memory-export-YYYY-MM-DD.json`.
2. In Budget, tap **Import data** in the Menu and choose that file.

Budget reads only `bills`, `income` and `recurringIncome` (plus your pay-period settings) and ignores
everything else in the file. Importing never deletes anything, skips records it cannot read, and never
brings back something you deleted here. Budget's own **Export data** file has the same shape but holds
only those three lists.

## Storage names

Browsers share `localStorage` between every path on one web address. To stay safe if another app is ever hosted at
the same address, every key this app writes starts with `budgetApp.`, the service worker cache is named
`budget-v<N>` and it only ever deletes caches starting with `budget-`, and the manifest uses `start_url`
`./index.html` with scope `./`. "Forgot PIN" on the app lock erases only `budgetApp.*` keys.

## Tests

Browser tests (they load the app in hidden frames with memory-only storage and no network, so they never
touch real data or the sync server):

```
python -m http.server 5191
```

then open http://localhost:5191/tests/tests.html and wait about 15 seconds. The page title ends in `OK n/n`
when everything passes.

File checks and the sync server's own tests, which need no browser (version label matches the service worker
cache, every shipped file is cached, element ids, no external requests, storage-key prefix, manifest, server merge
rules and endpoints):

```
python -m unittest discover -s tests
```

## Changing the app

Bump `APP_VERSION` in `app.js` and `CACHE_NAME` in `sw.js` together (same number) whenever you change
`index.html`, `style.css`, `app.js`, `manifest.json` or an icon; a test checks they match. Without a new
`CACHE_NAME` the browser never notices the service worker changed and keeps serving old files.

The app lock hides the screen behind a PIN; it does **not** encrypt the data stored on the device.
