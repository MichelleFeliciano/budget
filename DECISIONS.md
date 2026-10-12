# Decisions

Short notes on choices that are not obvious from the code.

## Separate names from Second Memory
Both apps are served from `michellefeliciano.github.io`, which shares one `localStorage` and one
service-worker cache namespace. Budget therefore uses `budgetApp.*` keys and `budget-vN` caches, only
deletes `budget-*` caches, and "Forgot PIN" erases only `budgetApp.*` keys. Data is not shared between the
apps on a device: use Import or Sync.

## Sync covers only bills, income and recurringIncome
Budget sends only those three lists. `sync_server.py` (in the Second Memory repo) replies to every sync with
all of its lists (`response_collections` is built from the whole `COLLECTION_NAMES`), and has no way to ask
for a subset. Budget reads the three it needs and ignores the rest, so the extra download is accepted: the
server cannot be changed from this repo. If the server ever offers a filter, send it
from `postSync`. The three names must stay in `COLLECTION_NAMES` or Budget stops syncing.

## Code copied from Second Memory
Sync client, import merge, undo, app lock, theme and the base CSS are copies. They are kept identical on
purpose so behaviour matches; a bug found in one is reported rather than fixed only here.

## Income id is the date
An `income` record's `id` is its own date key (one manual income entry per day), unlike every other
collection, which uses a fresh UUID. This gives "one entry per date" an identity-level guarantee across sync
and import merges.

## Calendar totals mix cumulative and period figures
A week's or month's bill total includes every still-unpaid bill from earlier weeks, while income is summed
only inside the period. This is deliberate, and the net tooltip explains it. Category filters never change
these totals.

## Autopay bills are never flagged
A bill with autopay is not "overdue" or "due soon" anywhere: not in the banner and not on the calendar
(`computeBillReminders` and the calendar use the same rule and the same two-day window). Totals still count
it as owed until it is ticked paid.

## Import and first sync are stricter than Second Memory's
These two differences are bug fixes that Second Memory probably needs too:
- Import refuses a bill or recurring income whose amount is under $0.01 or over $1,000,000,000 (what the forms
  allow). A day of income may be negative but is held to the same size limit.
- The first sync on a device keeps a record the server has deleted deleted, even if this device edited it later.

## Look: vine and sage
The corner vines and the sidebar sprig are CSS masks filled with `--accent`, so one drawing serves Light and
Dark. The palette is the variables at the top of `style.css`. The icon is a cream vine and coin on sage.

## Comments do not cite design notes
Second Memory's `docs/specs/...` were not copied here, so comments state the rule directly.
