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

## Free hosting: the server's data is temporary
`budget-sync` runs on Render's free plan with no disk, so the data file is in `/tmp/budget-data` and is erased
whenever the service sleeps (about 15 idle minutes) or redeploys. Daily server backups are erased with it. This is
a deliberate cost trade-off, accepted because every device keeps a full copy:
- The server is a meeting point, not a backup. Real backups are the app's **Export data** file.
- The app copes with an empty server: `runSync` sees that records it had confirmed are missing from the reply
  (the server never removes records, only marks them deleted), then immediately sends everything again in the
  same tap and says the server had been reset.
- The first sync after a sleep can take a minute or more, so the timeout is 90 seconds and a wake-up notice shows
  after 5 seconds.
- Known weakness: after a reset, if a stale device that never saw a delete syncs first, it re-uploads the deleted
  item as live and the delete is lost. Sync first from the device you trust most after a long gap.
- `render.yaml` is Blueprint-managed, so it overrides the dashboard; the plan and the missing disk are set there.

## Income id is the date
An `income` record's `id` is its own date key (one manual income entry per day), unlike every other
collection, which uses a fresh UUID. This gives "one entry per date" an identity-level guarantee across sync
and import merges, and the server has a matching rule for it.

## The net moves only when income does; Due tracks what is left to pay
A week's, month's or pay period's bill total is everything due in it, paid or not, and the net is the income in
that period minus that total. So ticking a bill paid changes neither; only entering or editing income moves the
net. Each calendar week also has a fourth number, Due: the bills due in that week that are not ticked paid yet,
so it falls as you pay. Unpaid bills from earlier weeks are not carried into this week's figures. Category
filters never change these totals.

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

## The pay period follows the paycheck
Until a payday is saved by hand, the Current Pay Period uses the biggest weekly, biweekly or monthly Recurring Income
source that has started, so the schedule is only entered once. A payday saved by hand always wins, and saving the
form with an empty date goes back to the paycheck.

## Bills sort by the next date to pay
The two due date sorts use each bill's next unpaid date (late bills first), not the date it was first due, because
for a monthly bill that was added months ago the first date says nothing about what is coming. A bill with nothing
left to pay sorts last.

## A failed sync is tried once more
If the server does not answer (a sleeping free server often fails the first request while it wakes), the app waits
a moment and retries once on its own. A wrong passphrase or an out-of-date copy is never retried. While waiting, the
status counts the seconds so it does not look stuck.

## A repeating bill with an old date can start caught up
A monthly bill first due months ago would show every month since as unpaid and overdue. The Add bill form offers
"I'm caught up" (ticked) for a repeating bill whose date is in the past, which marks every date before today paid in
the bill's first save, so one Undo still removes the whole bill. One-time bills are never offered it, because an old
one-time bill really is overdue. A card with two or more unpaid earlier dates can do the same in one tap.

## Three tabs, everything always drawn
Home (the calendar), Income (Pay Period and Recurring Income) and Bills (the list, the Add bill form and Paid
History) only show one part of the page at a time, which replaced the long scroll and the jump links. Every part
is still redrawn on every change, so switching tabs is instant and no code has to know which tab is showing. The
banners and reminders stay above all three, and the + button opens the Add bill form from any tab but Income.

## Projected income is a record in the income list
A day's projected income (what you expect to receive) is saved as `{ id: 'projected-<date>', projectedFor, projected }`
in the existing `income` list, so it syncs, undoes and exports with no change to the sync server (which merges
income by id). It deliberately has no `dateKey`, so every actual-income total ignores it and a copy of the app that
has not updated yet ignores it too instead of counting it as money received. A week shows Projected (the typed
projections for days that have no real income yet) and Projected net (income plus that, minus the week's bills);
typing real income for a day replaces that day's projection, so nothing is counted twice. The Income tab's Projected
Income section lists the days from today on (add, edit the amount, delete) and shows the total still expected; it reads
and writes the same records as the day boxes, one projection per date.

## A payment is credited to the labelled, live copy of a bill
When the same payment is on several copies of a bill (a sync conflict, an import), Paid History counts it once. It
used to credit whichever copy came first, which could be a deleted or unlabelled one, so labelled bills showed up
under Uncategorized. Live bills now go first, and labelled ones before unlabelled ones.

## A skipped date is a payment of nothing
Skipping a date (a paused subscription, a waived bill) records it as paid with an amount of 0 rather than adding a
new kind of record. Every existing rule then just works: it is not owed, not overdue, not counted in totals, it syncs
and merges like any payment, and Undo or unticking it brings it back. Paid History leaves a date paid at 0 out, since
no money was paid. Paying a different amount stores that amount for the date the same way.

## The Add bill form is a sheet only on phones
On the narrow layout the form is hidden until the + button opens it as a bottom sheet (Cancel, Escape, a tap on the
dimmed page or adding the bill closes it), which keeps the Bills list close to the top. On wide screens it stays in
the page, so nothing changes there.

## Calendar reminders are a file, not notifications
The app cannot push alerts (there is no server that knows when you are away), so the Menu can export the bills as an
.ics file for the phone's own calendar, which does send reminders. Each bill starts at its next unpaid date, because
the file cannot know what is paid. A bill due on the 29th or 30th is skipped by calendars in months without that day.

## Reminders stay out of the way
The "download a full backup" reminder is only shown to a device that has never exported and does not sync (a
syncing device's data also lives on its other devices), and again once an export is older than 30 days. The
undo bar appears only after a delete or a Mark paid, never for adds, edits or typing a day's income.

## A day can hold several income entries, one per source
A day's real income and its projected income each hold one entry per source (case does not matter; no source counts as
its own). Typing an amount with the same source updates that entry, a different source adds another, and every total adds
them all. The first entry of a day keeps the date as its id and later ones get a fresh id, so a copy of the app from before
this change still reads only one entry per day: update every device. A source is otherwise only a label (chosen from the
Recurring Income names and sources already used, or typed); changing an entry's source to one the day already has is
refused, since that would be two entries from one source.
