# Budget

Personal bills and income tracker. Vanilla HTML/CSS/JS, zero dependencies, no build step, no CDN. The only
network call is the optional manual "Sync now" to `SYNC_SERVER_URL`, Budget's own server (`server/sync_server.py`,
deployed with `render.yaml`). Repo: MichelleFeliciano/budget, main, live at
https://michellefeliciano.github.io/budget/. See README.md for what it does and DECISIONS.md for why.
Budget began as a tab of another app (Second Memory) and is now fully separate from it.

## Rules
- Keep scope tight. Personal tool: no features or abstractions that were not asked for.
- Every localStorage key starts with `budgetApp.`; the service worker cache is `budget-vN`. Browsers share
  storage per web address, so these names must never match another app's (Second Memory used `secondMemory.*` and
  `second-memory-vN`; the site shared an address with it until Budget gets its own).
- `APP_VERSION` in app.js must equal the `CACHE_NAME` number in sw.js. Bump both together on every shipped
  change (index.html, style.css, app.js, manifest.json, icons). A unit test checks it.
- Never put the sync passphrase, real financial data or real bills in code, tests, commits or docs.
  Test with made-up sample data only.
- Sync and import: never resurrect a deleted record (deletes are tombstones) and never let an older
  backup overwrite a newer record. The server owns `version`.
- The sync server lives here (`server/sync_server.py`). Its `COLLECTION_NAMES` must stay exactly `bills`,
  `income` and `recurringIncome`: the app sends and expects those names. Changing the server's merge rules
  changes every device's data, so test it (`tests/test_sync_server.py`) and treat it carefully.
- The sync server runs on Render's FREE plan with no disk (`render.yaml`: `plan: free`, no `disk:`,
  `DATA_DIR=/tmp/budget-data`). Its data is temporary and is lost whenever it sleeps or redeploys, so devices hold
  the real copy and re-send everything after a reset (`runSync` does this in one tap). Never add a disk or a paid
  plan back without being asked, and never default `DATA_DIR` to a path that needs a disk. Pushing changes
  `render.yaml`, which Render applies automatically, so ask before pushing.
- Comments must say what the rule is. Do not cite design notes that are not in this repo.
- Every top-level function in app.js has a comment directly above it (a test checks), and every CSS rule has one too.
  A reduced-motion rule must come after the rule it turns off (a test checks that as well).

## Testing
- Browser: `python -m http.server 5191` in this folder, open http://localhost:5191/tests/tests.html and wait
  about 15 seconds. The title ends `OK n/n` (currently 370/370).
- Python: `python -m unittest discover -s tests` (app file checks plus the sync server tests).
- Clear service workers, caches and localStorage in the test browser before and after each run.
- Stop the server with PowerShell:
  `Get-CimInstance Win32_Process | Where CommandLine -match 'http.server 5191' | Stop-Process`
  (no pkill/kill).
- Write patch scripts as files with the Write tool, not heredocs.

## Git
Commit in small steps. Ask before pushing.

## Not yet verified
Service-worker install, offline use and add-to-home-screen on a real device; a live sync against a deployed
server.
