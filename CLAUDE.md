# Budget

Personal bills and income tracker, split out of Second Memory. Vanilla HTML/CSS/JS, zero dependencies,
no build step, no CDN. The only network call is the optional manual "Sync now" to
`SYNC_SERVER_URL` (Second Memory's server). Repo: MichelleFeliciano/budget, main, live at
https://michellefeliciano.github.io/budget/. See README.md for what it does and DECISIONS.md for why.

## Rules
- Keep scope tight. Personal tool: no features or abstractions that were not asked for.
- Every localStorage key starts with `budgetApp.`; the service worker cache is `budget-vN`. GitHub Pages
  serves this app and Second Memory from one origin, so never use or touch `secondMemory.*` or `second-memory-vN`.
- `APP_VERSION` in app.js must equal the `CACHE_NAME` number in sw.js. Bump both together on every shipped
  change (index.html, style.css, app.js, manifest.json, icons). A unit test checks it.
- Never put the sync passphrase, real financial data or real bills in code, tests, commits or docs.
  Test with made-up sample data only.
- Sync and import: never resurrect a deleted record (deletes are tombstones) and never let an older
  backup overwrite a newer record. The server owns `version`.
- `sync_server.py` lives in the Second Memory repo and cannot be changed from here. `bills`, `income` and
  `recurringIncome` must stay in its `COLLECTION_NAMES`.
- Much of the code is copied from Second Memory (sync client, import merge, undo, app lock, theme, base CSS).
  A bug in one of those probably exists there too: tell the owner instead of fixing it silently.
- Comments must say what the rule is. Do not cite `docs/specs/...` (Second Memory's notes, not copied here).

## Testing
- Browser: `python -m http.server 5191` in this folder, open http://localhost:5191/tests/tests.html and wait
  about 15 seconds. The title ends `OK n/n` (currently 227/227).
- Python: `python -m unittest discover -s tests` (currently 15/15).
- Clear service workers, caches and localStorage in the test browser before and after each run.
- Stop the server with PowerShell:
  `Get-CimInstance Win32_Process | Where CommandLine -match 'http.server 5191' | Stop-Process`
  (no pkill/kill).
- Write patch scripts as files with the Write tool, not heredocs.

## Git
Commit in small steps. Ask before pushing.

## Not yet verified
Service-worker install, offline use and add-to-home-screen on a real device; a live sync against the real server.
