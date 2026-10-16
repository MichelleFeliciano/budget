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
so it falls as you pay. Unpaid bills from earlier weeks are not carried into this week's figures, but a week's Net and Projected net roll forward
into the next week (see "The weekly Net rolls forward"). Category
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

## Five tabs, everything always drawn
Home (the calendar), Income, Bills (the list, the Add bill form and Paid History), Plan and Expenses only show one part of the page at a time, which replaced the long scroll and the jump links. Every part
is still redrawn on every change, so switching tabs is instant and no code has to know which tab is showing. The
banners and reminders stay above all of them, and the + button opens the Add bill form from any tab but Income, Plan and Expenses.

## Projected income is a record in the income list
A day's projected income (what you expect to receive) is saved as `{ id: 'projected-<date>', projectedFor, projected }`
in the existing `income` list, so it syncs, undoes and exports with no change to the sync server (which merges
income by id). It deliberately has no `dateKey`, so every actual-income total ignores it and a copy of the app that
has not updated yet ignores it too instead of counting it as money received. A week shows Projected (the typed
projections for days that have no real income yet) and Projected net (income plus that, minus the week's bills);
typing real income for a day replaces that day's projection, so nothing is counted twice. The Income tab's Projected
Income section lists the days from today on (add, edit the amount, delete) and shows the total still expected; it is the only place to enter them. Real one-off income is entered the same way in the Income Received section (the calendar days no longer have income boxes; their weekly and monthly totals still count everything).

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
undo bar appears after a delete, a Mark paid, a new bill or recurring income, or a logged expense (so a Quick Add is undoable), never for edits or other additions.

## A day can hold several income entries, one per source
A day's real income and its projected income each hold one entry per source (case does not matter; no source counts as
its own). Typing an amount with the same source updates that entry, a different source adds another, and every total adds
them all. The first entry of a day keeps the date as its id and later ones get a fresh id, so a copy of the app from before
this change still reads only one entry per day: update every device. A source is otherwise only a label (chosen from the
Recurring Income names and sources already used, or typed); changing an entry's source to one the day already has is
refused, since that would be two entries from one source.

## The Spending Plan lives in the income list, and the what-if is per category
The server only knows bills, income and recurringIncome, so a plan category is a record in the `income` list
(`{ id: 'plan-<id>', planName, amount, frequency, business, notes, altAmount }`), the same trick as projected income:
it syncs, undoes and exports with no server change, and has no `dateKey`, so no income total sees it. Each category stores
its amount in the frequency it was entered in and everything else is worked out from that (weekly x 52 / 12, monthly x
12 / 52, never x 4), so there is one source of truth. A what-if amount is optional per category, in the same frequency;
the What-if switch (kept on the device, not synced) swaps those in for every total. A copy of the app from before this
change ignores plan records. The plan is estimates, not bills: it has no due dates and nothing in it affects the calendar,
the Due figures or the net.

## Expenses are logged against the Spending Plan categories
An expense is a record in the `income` list too (`{ id: 'expense-<id>', spentOn, amount, planId, categoryName, notes }`),
for the same reasons as the plan and projected income: no server change, no `dateKey`, so no income total sees it, and a
copy of the app from before this change ignores it. The category is a plan category (by id, so renaming a category keeps its
expenses), not a separate list, so spent and planned line up one to one. If a category is deleted, its expenses keep the name
saved with them and are totalled under "Other (no plan category)". A category's average per week waits for 14 days of entries
(counted from its first expense to today) because a shorter stretch is too noisy to replace an estimate with.

## The weekly Net rolls forward
A calendar week's Net (and Projected net) is what the weeks before it left over plus its own income minus its own bills,
so a surplus or a shortfall carries into the next week. The running total starts at the Monday of the earliest income there
is (a typed entry or a recurring source's first date), looks back at most 104 weeks, and is worked out once for the first
week shown and then carried through the three weeks, so sliding the calendar stays consistent. Bills due before that start
are left out, and the month and pay-period nets do not roll. The amount that came from earlier weeks is only in the line's hover text, so the figures stay short.

## Quick Add logs in one tap, and amounts show with thousands separators
Each plan category with expenses offers its last three different amounts as buttons that log that amount for today
(with an Undo bar saying what was logged), so a purchase at the pump is two taps. The three date boxes for adding income,
projected income and expenses have a Today button. Money is shown as $1,234.50 through one function (`formatMoney`, and
`formatSignedCurrency` for amounts that can be negative) instead of formatting each figure by hand.

## Wide screens get their own tidy layout
Only above 900px: the content is centred beside the Menu, a week's totals run across in one row under its days (the stacked
right-aligned column left most of the box empty), add forms use two columns, and a card's details run along a line under its
name as they already do on a phone. Phone and tablet layouts are untouched.

## Income ids are built from the day and the source, and only date ids get the "newer edit wins" rules
A day's first income entry has the date as its id, and an entry with a source has `<date>#<source>` (projected ones have
`projected-` in front), so two devices that add different sources on the same day never share an id (which used to drop one
amount in a sync) and the same day and source still merge. The server's special income rules (a newer edit beats an
older delete, a stale delete is ignored, a conflict never forks) apply only to those date ids; plan categories (`plan-`),
expenses (`expense-`) and the fallback unique ids merge like bills: a delete always wins, and a real conflict keeps both
sides. The client does the matching thing on a server reset: a delete on the server that is newer than this device's last
edit is taken, so a stale device cannot bring a deleted record back.

## Backups are nudged weekly, and the app says what an import left it holding
The backup reminder comes back every 7 days on every device (a syncing one too), because the sync server's data is temporary
and a backup file is the only safe copy; on a phone that can share files, its button shares the backup in one tap. After an
import the status says how many bills, income entries, plan categories and so on the app now holds, so a restore can be
checked at a glance. The top-bar Sync note reads the last sync time back from storage ("Synced 3h ago", "Synced 4 days ago"),
and its button is highlighted after 3 days without one.

## Spending warnings, left-after-plan and "use this average"
A category's line turns amber at 80% of its plan and red once it is over, and also says so in words ("90% used", "$20.00 over"),
so colour is never the only sign. The Home month line "left after plan" is the month's net minus a month of planned spending.
The Expenses tab's average per week (14 days of entries or more) can be made the plan amount in one tap (in the category's own
weekly or monthly frequency) with an Undo. Quick Add amounts can be removed per device (they are only hidden, not deleted), and
the form remembers the last expense category and the last income source typed.

## Expected one-time costs are guesses stored in the income list, by month

A one-off cost you expect (car maintenance) is a record in the `income` list with `guessName`, `amount` and `guessMonth` ('YYYY-MM'), id `guess-<id>`. Like plan categories it needs no server change: the id is not a date id, so it merges like a bill (delete always wins). It has no `dateKey`, so income totals ignore it. Only the current month's guesses reduce "left after plan"; other months' stay listed on the Plan tab. A guess is a month, not a day, because the point is "roughly when", and it is not tied to the Expenses tab, so logging the real cost does not remove the guess: delete it or edit it to the real number.

## Savings goals keep each deposit as its own record

A goal (`goalName`, `target`, optional `goalDate`, id `goal-<id>`) and each deposit (`savedFor` = the goal's id, `savedOn`, signed `amount`, id `save-<id>`) are records in the `income` list. Deposits are separate records, not a running total on the goal, so two devices saving at the same time both count instead of one overwriting the other. Neither has a `dateKey`, so income totals ignore them, and neither id is a date id, so the server merges them like bills. Deleting a goal hides its deposits (Undo brings both back). Taking out more than is saved is refused. Savings do not change "left after plan": what you set aside is your choice.

## Custom repeats are a frequency of 'custom' with a number and a unit

A bill can repeat every N weeks or months (N a whole number from 1 to 99): `frequency: 'custom'`, `every`, `unit` ('weeks' or 'months'). The built-in frequencies stay as they are, so older bills and older copies of the app are untouched. All schedule maths goes through `schedulePeriod`, which turns every frequency into a step in days or in months (weekly 7 days, biweekly 14, monthly 1 month, yearly 12), so one rule handles them all. A month-step schedule lands on the same day of the month, or the last day of a shorter month, like Monthly. A custom bill with an unreadable number or unit never comes due and is rejected on import. Recurring income and the pay period keep their own shorter lists. A device older than v33 does not know 'custom' and would show such a bill as never due, so update every device.

## Line-by-line review fixes (v34)

Found by reading every line of the code, CSS, HTML and server. Rules worth remembering: "last synced" and "first noticed sync was on" are two different clocks (`LAST_SYNC_AT_KEY` stays empty until a sync really happens, because the top bar reads it as "Synced ... ago"); a card's Edit form is closed before saving, because a redraw reopens any form still showing; the Expenses tab redraws on its own, so it keeps open Edit forms too; a bill's next due date is found from its occurrence numbers, so a yearly bill or one every 24 months shows the right date once paid; import refuses empty names and bad paid dates; the server also refuses a number such as 1e999, which would turn into `Infinity` in every reply. Not changed on purpose: the server still overwrites when a client version is ahead of its own, which only happens right after a server reset and is covered by the app reconciling first.

## A savings goal can be split into costs

Each cost is its own record in the `income` list (`goalItemFor` = the goal's id, `itemName`, `amount`, id `item-<id>`), like deposits, so two devices adding costs at once both count and the server needs no change (the id is not a date id). While a goal has any live costs its target is their total (`goalTarget`); with none it uses its own `target`, so older goals are untouched. Costs are added and removed (Undo works), not edited: remove one and add it again. Deleting a goal hides its costs and deposits together, and Undo brings them back.

