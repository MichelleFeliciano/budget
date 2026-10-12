# Decisions

Short notes on choices that are not obvious from the code.

## Budget is fully separate from Second Memory
Budget began as a tab of Second Memory. It now has its own repository, its own sync server
(`server/sync_server.py`, deployed from `render.yaml` as `budget-sync`) with its own passphrase and its own
stored data, and no code or data in common with it at runtime. The code that was copied over (sync client, import
merge, undo, app lock, theme, base CSS) is now just Budget's code and evolves on its own.
Bills, income and recurring income can be brought over once with Export (Second Memory) and Import (Budget);
the import still accepts a Second Memory export for that reason.

## Own storage names
Browsers share `localStorage` and service-worker caches between every path on one web address. While Budget and
Second Memory shared `michellefeliciano.github.io`, that was a real risk, so Budget uses `budgetApp.*` keys and
`budget-vN` caches, only deletes `budget-*` caches, and "Forgot PIN" erases only `budgetApp.*` keys. The names are
kept even if Budget moves to its own address, because they cost nothing and the tests guard them.

## The server only knows three lists
`COLLECTION_NAMES` in `server/sync_server.py` is exactly `bills`, `income` and `recurringIncome`, the same three
the app sends. Anything else found in the data file is dropped on the next save. Allowed website addresses (CORS)
come from the `ALLOWED_ORIGINS` environment variable, so moving the site only needs a settings change.

## Income id is the date
An `income` record's `id` is its own date key (one manual income entry per day), unlike every other
collection, which uses a fresh UUID. This gives "one entry per date" an identity-level guarantee across sync
and import merges, and the server has a matching rule for it.

## Calendar totals mix cumulative and period figures
A week's or month's bill total includes every still-unpaid bill from earlier weeks, while income is summed
only inside the period. This is deliberate, and the net tooltip explains it. Category filters never change
these totals.

## Autopay bills are never flagged
A bill with autopay is not "overdue" or "due soon" anywhere: not in the banner and not on the calendar
(`computeBillReminders` and the calendar use the same rule and the same two-day window). Totals still count
it as owed until it is ticked paid.

## Import and first sync are strict
- Import refuses a bill or recurring income whose amount is under $0.01 or over $1,000,000,000 (what the forms
  allow). A day of income may be negative but is held to the same size limit.
- The first sync on a device keeps a record the server has deleted deleted, even if this device edited it later.

## Look: vine and sage
The corner vines and the sidebar sprig are CSS masks filled with `--accent`, so one drawing serves Light and
Dark. The palette is the variables at the top of `style.css`. The icon is a cream vine and coin on sage.

## Comments do not cite design notes
Second Memory's design notes were not copied here, so comments state the rule directly.
