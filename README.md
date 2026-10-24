# Budget

A small, local-first bills and income tracker. It runs fully offline in any modern browser, stores
everything in that browser's `localStorage`, and has no dependencies, no build step and no CDN scripts.
Optional manual sync goes to its own small server (`server/`).

It has five tabs (a bar along the bottom on a phone, pills above the page on a wide screen), and the last one used is remembered:

- **Home**: a three-week calendar (last week, this week, next week; Earlier and Later slide it, Today brings it back; on a phone each day shows its first bill's name) with weekly and monthly totals (bills, income and net) and a weekly Due line (what is left to pay). Each week's Net and Projected net roll forward into the next week. A week with projected income also shows Projected and Projected net; real income entered for a day replaces that day's projection
- **Plan**: a **Spending Plan** of estimated spending by category. Each category keeps the amount in the way you entered it (weekly or monthly) and shows both views (weekly × 52 ÷ 12 for a month, monthly × 12 ÷ 52 for a week), is marked Business or Personal, can carry notes, and can have an optional what-if amount that a switch applies to every total. Totals are shown for everything and for business and personal.
- **Expected one-time costs** (on the Plan tab): guesses for a one-off cost in a chosen month, such as car maintenance. This month's guesses are taken off "left after plan" on Home; guesses for other months wait until their month.
- **Import from Chase** (Expenses tab): the app never connects to a bank. Download your transactions from Chase as a CSV file (checking or credit card), choose the file, and it is read on your device only. Money going out is listed so you can pick a Spending Plan category for each row (or put every unassigned row in one category), then Import makes the expenses. Money coming in is listed too, with a box for the income source to give each deposit (several deposits on one day and source add up, and an amount already typed for that day and source is added to); payments and transfers are left alone. A category or source you chose for a shop is remembered for next time, importing an overlapping file again skips what is already in, and Undo this import takes the whole batch back.
- **Business bills**: tick Business when you add or edit a bill. The Business tab lists those bills with their cost, what is due next and their monthly total, and what you pay on them counts in the Business summary, the tax set-aside profit, the printable report and the business CSV, next to the business expenses. They stay ordinary bills everywhere else (the calendar, forecast and totals count them).
- **Paid by Mom**: an expense can be marked Paid by Mom (a box when you log it, and when you edit it). It still shows in Recent Expenses with a badge, but it does not come out of your money: it is left out of Spent vs Plan, the week line, charts, trends, the forecast, the report and the business totals. A line says how much Mom paid this month.
- **Bills that end**: a repeating bill can have a last payment date, or a number of payments that works the date out (a loan or payment plan). After it the bill stops coming due everywhere (calendar, forecast, subscriptions, the calendar file), and the card says how many payments are left.
- **Printable report** (Money tab): a one-page summary of a period (income, bills, spending by category, business and personal, savings, the tax set-aside and net worth) to print or save as a PDF.
- **Search** (Home): one box that finds bills, expenses, income, goals, accounts and the rest by name or note, with a button that opens the right tab.
- **Where It Goes** (Expenses tab): this month's biggest shops from the expense notes, and any category running well above its usual (the average of the last three months).
- **Set aside for yearly bills** (Money tab): for bills that come around every three months or less often, what to put aside each month, with a button that makes the bill a savings goal with its due date.
- **Other banks**: Import from Chase also reads any CSV with date, description and amount columns (or separate Debit and Credit columns). When the column names are not recognised it asks which is which, once, and remembers it for that bank.
- **Merge categories**: in a Spending Plan category's edit form, Merge into another moves its expenses, repeating expenses and Chase rules to the other category and removes it.
- **Setup checklist** (Home): six first steps (add a bill, income and a Spending Plan category, set up sync, sync once, save a backup) that tick themselves, each with a Go button to the right tab, until all are done or you hide it on that device.
- **Last Week** (Home): last week's income, bills, spending and savings, any correction to the carried-in amount, and each Spending Plan category against its weekly plan with the biggest overshoot first.
- **Paycheck Planner** (Income tab): for a recurring paycheck, the bills due until the next payday, the Spending Plan for those days, what to put toward savings goals that have a date, and what is left over.
- **Carry unspent money forward**: a Spending Plan category can carry what it did not spend into the next week or month (overspending is not carried as a debt), and Spent vs Plan shows the carried amount.
- **Chase: balance and splits**: Import from Chase can set an asset account's balance from the file's newest balance, and a spending row can be split between several categories (the parts must add up to the amount).
- **Money tab**: **Accounts and net worth** (what you have and what you owe, with each balance change kept as a dated entry so net worth builds a history), **Debt payoff** (payoff month and interest at each debt's monthly payment, and what an extra amount a month would save), a **cash-flow forecast** (the next 4, 8 or 12 weeks from recurring income, bills, the Spending Plan and expected one-time costs, from your asset balance, warning if it would go below zero), **Trends** (the last twelve months of income, bills, spending, savings and what was left, with this year so far) and **Subscriptions** (every repeating bill with its monthly and yearly cost, flagging a bill that costs more than the first time it was paid).
- **Tax set-aside** (Business tab): a percentage of business profit (income from sources you name, minus business expenses) to put aside for the period, as a rough planning figure. This month, last month, this quarter, last quarter, this year and last year are all available.
- **Chase rules**: in Import from Chase, a rule gives a category to every row whose description contains some text (for example SHELL means Gas), ahead of what was chosen last time.
- **Home extras**: a line saying what is left this week after the bills due and whichever is more of your weekly plan or what you have already spent; a Savings goals strip (each goal's progress with a box to add savings in one step, so you do not have to open the Plan tab); and, on the Income tab, Quick Add buttons that add a repeat amount from a source for today in one tap. Charts and Paid History start closed so the tabs are shorter.
- **Business tab**: log expenses straight to a Spending Plan category marked Business, see this month, last month, this year or last year with Business, Personal and total spending, review and edit the period's business expenses, and download a CSV of them (date, category, type, amount, note) for a tax preparer.
- **Repeating expenses** (Expenses tab): costs that come around again (every week, every 2 weeks or every month) for a Spending Plan category. When a date is due, Log it records the expense for that day, or Skip passes it over. Nothing logs itself, and only the last 45 days are offered.
- **Mark as spent**: an expected one-time cost has a Mark as spent button. Enter what it really cost and its Spending Plan category, and it becomes an expense dated today and the guess is removed, so it is not counted twice.
- **Savings history**: each savings goal lists every deposit and withdrawal (newest first) under a folding line, and any entry can be deleted if it was typed wrongly (Undo brings it back). Each entry can be edited (its date and amount, with a negative amount for money taken out), but never to less than nothing saved.
- **Adjusting the rolled-forward number**: every week on Home has an Adjust carried in button. Type what you really have carried into that week (extra spending the app does not know about) and that week and every week after it follow, with an optional note saying why. Reset removes it. Month totals are not affected. Home also says how much you corrected the carried-in amount this month and which way, so a plan that keeps needing the same correction stands out.
- **Custom repeats**: a bill can repeat every N weeks or months (for example every 6 weeks, or every 3 months) as well as weekly, biweekly, monthly, yearly or once.
- **Savings goals** (on the Plan tab): save up for a large purchase. Give a goal a target (and optionally a date), record each amount you put aside or take back out, and see a progress bar, what is left and, with a date, what to set aside per month. A goal can be split into costs (for example flights and hotel): once it has any, its target is their total.
- **Expenses**: **Quick Add** (one tap logs a category's recent amount for today; Edit amounts removes one you do not want), then log what you actually spent (a date, an amount, a Spending Plan category and an optional note), see this week and this month against the plan for each category, and, once a category has two weeks of entries, its average per week, so the plan's estimates can be replaced with real numbers (a button sets the plan to that average). A category turns amber at 80% of its plan and red when over. Charts show this month by category and the last 8 weeks, and Recent Expenses can be filtered by category, dates and note text. Home also shows what is left after the plan for the month.
- **Income**: the **Current Pay Period** (taken from your biggest Recurring Income source until you save a payday by hand), **Income Received** (one-off income you actually got: a date, an amount and an optional source, edited or deleted from a list), **Projected Income** (add an amount you expect on a date, then edit or delete it in a list of the days ahead; a day can hold several real and several projected entries, one per **Source**, chosen from your Recurring Income names and earlier sources or typed new) and **Recurring Income** (a paycheck, for example)
- **Bills**: the bills list (add, edit, delete, mark paid, autopay, category filter, search, sort by the next date to pay, a "due in the next 2 weeks" filter) and **Paid History** by month and category (the Uncategorized row lists which bills are in it)
- a banner at the top for bills due within two days or overdue (autopay bills are never flagged, in the banner or on the calendar)
  with a Mark paid button for each bill listed
- a + button that opens the Add bill form (switching to Bills first), and a bar with Undo after every delete or Mark paid

Pay Period, Paid History and Recurring Income fold up (and stay folded).
Adding a repeating bill with an old date offers "I'm caught up" (earlier dates start paid), and a card can mark its
earlier dates paid in one tap. The pay period shows the next payday and what is left after unpaid bills. The Menu also
has Text size (Normal, Large, Largest), Share backup (where the phone can share files) and Calendar reminders (a
calendar file with each bill as a repeating event). When a newer version of the app has installed itself, a bar at the
top offers Update now. `DEVICE-CHECKLIST.md` lists what to try on real phones.
A bill card's **Other…** button pays its oldest unpaid date with a different amount (for a bill that varies, like
power) or skips that date. The category box suggests the categories already in use and keeps one spelling for each.
On a phone the Add bill form is a bottom sheet opened by the + button, so the Bills list sits right under its filters.
Colours meet WCAG contrast in both themes (a test checks it), fields and buttons have names for screen readers, and
animations and smooth scrolling are turned off when the device asks for less motion.
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
