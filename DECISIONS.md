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

Each cost is its own record in the `income` list (`goalItemFor` = the goal's id, `itemName`, `amount`, id `item-<id>`), like deposits, so two devices adding costs at once both count and the server needs no change (the id is not a date id). While a goal has any live costs its target is their total (`goalTarget`); with none it uses its own `target`, so older goals are untouched. Costs can be added, edited (name and amount, in place on the card) and removed, and Undo works for each; saving a cost with nothing changed records nothing. Deleting a goal hides its costs and deposits together, and Undo brings them back.

## The rolled-forward number can be adjusted by week

The Net carried into a week is worked out from bills and income, so it drifts when real spending differs. You type what you actually have carried into a week and the app stores the difference as an adjustment: a record in the `income` list (`adjustWeek` = that week's Monday, signed `amount`, `notes`, id `adjust-<id>`) added to the carry into that week and, by rolling, every week after. It adjusts the Net and the Projected net by the same amount. One adjustment per week: the newest live record counts, and typing the amount the app already works out removes it. It is a difference, not a fixed value, so a bill or income added to an earlier week later still moves the later weeks. Month totals do not roll forward and are unaffected. No server change: the id is not a date id.

## Marking a guess as spent, and the savings history

Mark as spent is two ordinary changes, not a new record kind: the expense is logged (dated today, the guess's name as its note, in the chosen Spending Plan category, because every expense needs one) and the guess is deleted as a tombstone. They are two Undo steps; nothing is changed if the expense would be refused. The savings history only lists the deposit records that already existed and lets one be deleted, so a wrong entry no longer needs a matching Take out.

## Repeating expenses are offered, never logged automatically

A repeating expense is a record in the `income` list (`recurPlanId`, `amount`, `frequency`, `recurStart`, `skippedDates`, id `rexp-<id>`), with no server change. Each due date is offered on the Expenses tab (Log it / Skip) instead of being logged when the app opens, because two devices opening the app would both log it and create duplicates. A logged date is an ordinary expense carrying `recurId` and `recurDate`, which is how it stops being offered; deleting that expense offers the date again. Only the last 45 days are offered so an old repeat does not bury you in dates. If two devices both tap Log it for the same date before syncing there are two expenses; the Recent Expenses list lets you delete one. The schedule reuses `occursOnDate`, so month-end days behave like a monthly bill.

## The business summary is worked out, not stored

An expense is Business or Personal by its Spending Plan category's flag, so changing a category's flag on the Plan tab changes how its past expenses are counted too; nothing about the split is kept on the expense. The CSV has one line per expense in the chosen period and a text cell that begins with =, +, - or @ is prefixed with an apostrophe so a spreadsheet treats it as text rather than a formula. The backup, calendar and CSV downloads share one `downloadBlob` helper.

## Bank import is a downloaded CSV, read on the device, expenses only

There is no live connection to Chase: that would mean handing a bank login or an aggregator service access to the data, which this app (no server beyond its own sync copy, no third party) deliberately avoids. The CSV is read locally and nothing is kept from it except what an expense holds: its date, amount, category and the bank description as the note, plus a `bankKey` (date, cents, the first words of the description, and a count for identical rows) that stops the same row being imported twice, a deleted expense included. Undo this import deletes the batch and removes those keys so the rows can be imported again. Money going out becomes expenses and money coming in is added to the income entry for its day and source (v44): deposits on the same day and source add up, an amount already there is added to rather than replaced, and the entry keeps the keys it took in (`bankKeys`) so a row is not added twice; Undo this import puts each entry back to what it was. Rows that read like a payment or transfer are left on Skip because importing both the card purchases and the payment that settles them would count the same money twice. The category for each description is remembered on this device only.

## Savings history entries can be edited

A deposit or withdrawal can change its date and amount (a negative amount is money taken out), but never so far that the goal would have less than nothing saved.

## Business has its own tab (v45)

The Business Summary moved off the Expenses tab onto a sixth tab, with a form that logs expenses against Business categories only and a list of the period's business expenses (the same cards as Recent Expenses, so they edit and delete the same way). A business expense is still an ordinary expense: nothing new is stored, and the Business or Personal split still comes from the category's flag. The CSV is now business expenses only.

## Home shows the week and the savings goals (v46)

The week line is the current week's Net (what is carried in, with any adjustment, plus income, minus the bills due that week) minus whichever is more of the weekly plan or what has been spent so far this week: the Net does not count expenses, so spending comes off here, and the larger of plan and actual is used so a week that has gone over the plan is not shown as better than it is. The Home goals strip only adds savings (to take money out or edit a goal, use the Plan tab). Income Quick Add sets today's entry for that source to the chosen amount (it does not add to an amount already there). The bills-due banner with Mark paid buttons already sits above the tabs, so no second bills strip was added.

## The Money tab, tax set-aside and Chase rules (v47)

All of it is stored as records in the `income` list (`acct-`, `bal-`, `tax-`, `rule-` ids, none with a date id), so the server is unchanged. An account's balance is a series of dated entries and the current one is the newest, not a number on the account: two devices that both update a balance cannot overwrite each other, and net worth over time is just the entries read back. A debt is kept as a positive amount owed and subtracts from net worth. The debt payoff is a fixed-payment schedule with monthly compounding, and says plainly when a payment never gets ahead of the interest. The forecast starts this week from today (income and unpaid bills still to come, and the plan not yet spent), counts each month's expected one-time costs once, in the first forecast week that ends in that month, and starts from the sum of the asset accounts; with none it shows the change per week instead. Trends count income and bills the way the calendar does (recurring included) and spending as logged. A subscription's monthly cost uses 365.25 days a year for weekly repeats; a price change is the first amount paid against the amount now. The tax setting is one record whose newest live copy counts (so two devices settle on the later change); the figure is the percentage of business profit, never below zero, and is only a planning aid. A Chase rule beats the category remembered from an earlier import, and the first matching rule (oldest first) wins. The phone tab bar uses a smaller label size so seven tabs fit on one row.

## Balance from Chase, split rows, rollover plans, last week, paycheck planner and the setup checklist (v48)

The balance offered after a Chase import is the balance of the newest-dated row in the file (the first such row wins a tie) and only an asset account can take it; it is recorded as that day's balance entry like any other. A split row is made into one expense per part, each keyed `<row key>~<index>`, and only imports when every part has a category and an amount and the parts add up to the row to the cent: a split that does not is left out and counted, never partly imported. A rollover category (`rollover: true` on the plan) starts each period with its own amount plus what earlier periods left unspent, counting from the period it was added (at most two years back); overspending is not carried as a debt, and the carry only applies to the period the category was entered in (its week for a weekly plan, its month for a monthly one). Last Week is worked out when drawn, not stored. The paycheck planner divides one paycheck until the day before the next payday of the same source (fourteen days when there is only one payday in sight), takes the bills due in that time, the weekly plan for those days, and for each goal with a date what would reach it on time spread evenly over the days left; it is a suggestion, nothing is reserved. The setup checklist is closed per device (`budgetApp.setupChecklistDismissed.v1`) and ticks from the data itself.

## Bill end dates, report, search, shops, yearly set-asides, other banks and merging (v49)

A bill's end is one optional `endDate` (the last payment date); a number of payments typed in the form is only a shortcut that works the date out and is not stored, so editing later shows the date. Every schedule function treats the end as the last date: nothing is due after it, the count of payments stops there, and `nthOccurrenceDate` returns null past it, which is how the calendar, forecast, paid-history catch-up and calendar file (`UNTIL`) all stop together. A bill whose every date is paid shows "Finished". The printable report is built when asked for into a block that is hidden on screen and is the only thing shown when printing (`body.printing-report`), so there is no separate page to keep in step. Search looks at names and notes only, never amounts, and shows at most thirty matches. Shops are grouped by the first two words of an expense's note (the shop, not its town); a category is flagged as unusual only when this month is at least 30% and $20 above its average full month of the previous three. Yearly set-asides cover bills that repeat every three months or less often, spread evenly over the months until the next date. A CSV from a bank whose headers are not recognised asks for the date, description and amount columns once and remembers the choice against that file's header line on this device (a checkbox covers banks that list spending as positive numbers); separate Debit and Credit columns are read without asking. Merging a category moves its expenses, repeating expenses and rules and deletes it; Undo brings the category back but does not move them back, which the status line says.

## Paid by Mom (v50)

An expense with `paidByMom: true` is kept (it happened, and it can be edited or deleted) but is not your spending. The app has two lists of expenses: `allExpenseRecords` (every live one, which the Recent Expenses list shows) and `expenseRecords` (only those you paid), and every figure that adds up spending starts from the second, so nothing can forget to leave Mom's out: plans and their carry-forward, the week and last-week lines, charts, trends, the forecast, shops, the report and the business and tax figures. Search and the bank import's duplicate check still see all of them. Only expenses have the option (not bills, which are scheduled and marked paid separately), and a Chase import never marks a row as Mom's, since a bank statement only holds what you paid.

## Business bills (v51)

A bill with `business: true` is a business cost but otherwise an ordinary bill: it is scheduled, due and marked paid on the Bills tab and counted by the calendar, forecast and totals, so nothing about your own money changes. The flag only feeds the Business tab. What counts as business bill spending in a period is what was actually paid (the dates marked paid, at the amount paid, skipped dates excluded), not what was due, because that is the figure a tax preparer needs; it is added to the business expenses in the summary line, the tax profit, the report and the CSV (as rows of type Business bill). The Business and Personal split of expenses is unchanged: it still comes from the Spending Plan category's flag.

## The Business tab is only business bills (v52)

The business is funded out of your own money, so there is nothing to keep apart: the Business tab now holds only the bills marked Business, as a list with their cost and what is due next. The business expense log, the Business Summary, the business CSV and the tax set-aside were removed (a Spending Plan category can still be marked Business or Personal, and the printable report still splits spending that way and shows what was paid on business bills). Old backups that hold a tax setting still import: the record is accepted and ignored.

## Help page, check-first import, recently deleted, offline bar and CI (v53)

The Help, history & settings page is the `more` tab: shown by the same `showTab` as the others but not in the tab bar (the Menu button opens it), so there is no eighth button to squeeze onto a phone. Importing a file runs `mergeCollectionFromImport` on copies first and shows the counts; only the Import button calls `importData`, and `importData` itself is unchanged (it still never overwrites newer work or brings back a deleted record). Recently Deleted reads the tombstones the app already keeps (any record deleted in the last 60 days, up to 50) and restores them with the same restore functions Undo uses, so nothing new is stored. History is the Undo list in words; it starts empty each time the app is opened because the Undo list is not saved. Each version's note lives in `WHATS_NEW` beside `APP_VERSION`, with the date shown next to the version; `CHANGELOG.md` is the dated list a person reads in the repository. The workflow runs the Python tests and the page's own tests in headless Chrome; its deploy job is switched on by a repository variable so it cannot break the site before Pages is set to publish from Actions.

