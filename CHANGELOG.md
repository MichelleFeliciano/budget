# Change log

Every shipped version, newest first, with its date. Add an entry here (and one to `WHATS_NEW` in app.js) with every version bump.

## v70 (2026-11-09)
- Spending next to the totals: each calendar week, the month and the pay period show **Spent** (expenses logged or imported from your own money; an expense marked Paid by Mom is left out) and **Net after spending** (that period's Net minus what was spent). They show only once something was spent. Net itself is unchanged: income minus bills

## v69 (2026-11-08)
- Bank import: every row (spending or money in) has a Remove button that takes it off the review list, for a bill or deposit already in the app. It only drops the row from the list so it is not imported; nothing in the app is deleted

## v68 (2026-11-08)
- Bank import reads PDF statements. Choose the PDF in the file box (the app reads the text inside it, with no library: compressed streams, object streams and fonts with a ToUnicode table), or paste text copied from the PDF into the new box and tap Read pasted text. Lines that start with a date (a year is taken from the statement when the date has none) and end with an amount become rows; an amount is negative with a minus sign, brackets or DR, otherwise by the heading above it (withdrawals, purchases and fees go out; deposits, credits and refunds come in); a running balance at the end of a line is ignored. A scanned or protected PDF cannot be read, and says so

## v67 (2026-11-08)
- Bank import reads more files: the file box no longer limits the choice to .csv (a phone could grey out a statement saved as .txt, .qfx and so on); comma, semicolon and tab separated files; lines above the column names (an account name, a date range) are skipped; more column names (Posted Date, Payee, Name, Memo, Withdrawals, Deposits...); dates like 10/20/26, 2026/10/20, Oct 20, 2026 and 20-Oct-2026, with or without a time; an amount with the minus after it; UTF-16 text; and QFX/OFX statements

## v66 (2026-11-08)
- Bills: a **Paid by Mom** button in a bill card's Other... form marks the oldest unpaid date as paid directly by Mom. It leaves the amount due (and stops being overdue) but is stored as a payment of 0, so it is not money spent: Paid History, the week/month/pay-period totals and the business totals leave it out. The calendar shows it as "paid by Mom", Undo says so, and the amount Mom covered is kept on the bill (`momPaid`). Unticking the date clears it
- Income Quick Add: tapping an amount when today already has one for that source says it was set, replacing the earlier amount
- Phone tab bar scrolls sideways instead of wrapping to two rows over the floating buttons; phone side margins are 16px
- Hover looks only apply on devices that hover, so they no longer stick after a tap; buttons and fields use the page font; month boxes are styled like the other fields
- Import refuses a bill or recurring income with an empty name, and checks `momPaid`
- Sync server: a request with a wrong passphrase waits half a second before it is answered

## v65 (2026-11-07)
- Fixes from a full code review of the app, style sheet and sync server:
  - A debt month set to $0 (or below that month's interest) no longer makes the whole debt read "never pays off"
  - Editing a debt's balance on a day that has an extra payment keeps both (the extra payment is no longer rewritten)
  - Unpaid totals, Mark oldest paid and Catch up use a debt-linked bill's planned amounts; changing a bill's schedule drops planned amounts for dates it no longer has
  - Undo/Redo of an edit no longer brings back a record that another device deleted
  - Import: a backup's delete is applied to the record instead of adding a deleted copy, and an already deleted record is left alone
  - Resetting a week's carry-over adjustment clears every copy two devices may have made
  - A savings edit that lands exactly on $0.00 is no longer refused by rounding; the repeating-expense bills question uses the expense as it is now; the phone Menu toggle no longer reads open after Help
  - Sync server: after the server restarts (versions start again at 1) a device holding an older copy with a higher version no longer overwrites a newer one or undoes a delete
  - Style sheet: the bank panels stay hidden until a file is loaded, a chosen file no longer widens the page on a small phone, the No buttons are outlined, keyboard focus shows on every summary line, bigger tap targets, text boxes follow the Text size setting, and the corner vines are not printed

## v64 (2026-11-06)
- Projected Income: each entry has an Add to income button that records the amount as real income on that day and source and removes the projection (not shown when that day and source already has real income)

## v63 (2026-11-05)
- Adding a repeating expense (Money tab) asks Yes or No whether to put it on the Bills list too, with the same amount and how often it repeats; a repeating expense or a debt's monthly payment that is not on the Bills list has an Add to bills button, for when the question was missed or answered No

## v62 (2026-11-04)
- Fixed: Sync and Import rejected a debt whose payment change is on a chosen day (the v61 form), because the check only allowed a month; such a debt now syncs and imports, the older month form still works, and a bad day is still refused

## v61 (2026-11-03)
- A debt's different payment takes a specific day (this month or later, one per month) instead of a month; this month's counts as paid now in the payoff plan, and the linked bill follows
- Extra payments are listed under their debt with a Remove button that takes the amount back off what has been paid (a debt paid off by extra payments stays listed so one can be removed)

## v60 (2026-11-03)
- Changing a debt's payment for one month also changes that month's bill on the Bills list (the bill called "<debt> payment", unpaid occurrences only; shown on the calendar, in the week totals and used when marking it paid); Remove puts the usual amount back

## v59 (2026-11-03)
- Debt Payoff: a debt with a monthly payment can pay a different amount in one coming month (Change that month; $0 skips the month, Remove puts the usual payment back); the payoff date and interest follow it

## v58 (2026-11-03)
- Pay extra on a debt takes a date (today to start, never in the future); a payment dated in the past also lowers the balances recorded after it, so what is owed now is right
- Adding a monthly payment to an existing debt by editing it also asks "add this to your bills list?" (not asked when a bill called "<debt> payment" is already there)

## v57 (2026-11-03)
- Debt Payoff: a Pay extra form on each debt takes an extra payment off what is owed today (it cannot be more than is owed) and shows the extra paid so far
- Adding a debt with a monthly payment asks "add this to your bills list?" (Yes adds a monthly bill from a chosen date, No adds nothing)

## v56 (2026-11-03)
- The cash-flow forecast counts projected income for days still to come (when no real income is typed for that day); its "spending" figure is now labelled "Spending Plan"

## v55 (2026-11-03)
- Recurring income can end: a last payday, or a number of paydays that works the date out; after it the income stops counting in the weeks, the forecast, the pay period and the Paycheck Planner

## v54 (2026-11-02)
- Projected income for a day that has passed, and never got real income, no longer counts in Projected net or the weekly Projected line (only today and later projections do)

## v53 (2026-10-26)
- Help, history & settings page: settings check, what is new, recent changes, recently deleted things with a Restore button, and help
- Importing a backup shows what it would do first (new, updated, already here, unreadable) and saves only when you tap Import
- The Menu shows the last backup date and the date of this version; backup files carry the format and the app version
- An offline bar when the device has no connection, and Add one now buttons on empty screens
- Merging two categories asks for a second tap
- Tests run on GitHub before anything is deployed

## v52 (2026-10-26)
- Business tab is only business bills: removed the expense log, summary, CSV and tax set-aside

## v51 (2026-10-24)
- Business bills: a Business tab list, and their payments in the summary, tax profit, report and CSV

## v50 (2026-10-23)
- Paid by Mom: an expense that does not come out of your money

## v49 (2026-10-23)
- Bill end dates, printable report, search, shops and unusual spending, yearly set-asides, other banks' CSV, merge categories

## v48 (2026-10-23)
- Balance from the Chase file, split rows, rollover plans, last-week review, paycheck planner, setup checklist

## v47 (2026-10-23)
- Money tab (accounts and net worth, debt payoff, forecast, trends, subscriptions), tax set-aside, Chase rules

## v46 (2026-10-23)
- Home: this-week line and savings goals strip; Quick Add for income; Charts and Paid History start closed

## v45 (2026-10-23)
- Business tab: log business expenses, summary, list and CSV

## v44 (2026-10-23)
- Import money in from the Chase file as income, added to its day and source, with undo

## v43 (2026-10-23)
- Import expenses from a downloaded Chase CSV: review, categorise, remembered categories, no double imports, undo

## v42 (2026-10-23)
- Edit the entries in a goal's savings history

## v41 (2026-10-22)
- Home shows this month's carry-forward corrections; checklist notes the phone checks passed

## v40 (2026-10-22)
- Business summary with a CSV download of the period's expenses

## v39 (2026-10-22)
- Repeating expenses: offered when due, logged with one tap

## v38 (2026-10-22)
- Mark an expected cost as spent; savings history with delete

## v37 (2026-10-16)
- Edit the costs under a savings goal

## v36 (2026-10-16)
- Adjust the rolled-forward number: type what you really have carried into a week

## v35 (2026-10-16)
- Savings goals can be split into costs; the target becomes their total

## v34 (2026-10-16)
- Line-by-line review: fix next due date for rare repeats, sync reminder clock, edit forms closing after save, Expenses redraw losing edits, import checks, CSS fixes, server 1e999 guard; comments brought up to date

## v33 (2026-10-16)
- Bills can repeat every N weeks or months (custom repeat)

## v32 (2026-10-16)
- Savings goals: target, optional date, deposits and withdrawals, progress bar and monthly pace

## v31 (2026-10-16)
- Expected one-time costs: guess a cost for a month (like car maintenance) and take this month's off left after plan

## v30 (2026-10-15)
- Weekly backup nudge with one-tap share, import summary, plan from average, budget warnings, left after plan, expense filters, editable Quick Add, remembered choices, charts, last-synced time

## v29 (2026-10-15)
- CSS review fixes: tab bar wraps, dots not clipped, no gap at 900px, dimmed Sync while running, dead rules and stale comments removed

## v28 (2026-10-15)
- Fixes from the line-by-line review: server delete rules for non-date income ids, ids per day and source, open edit forms survive redraws, one undo step per edit, tidy comments

## v27 (2026-10-15)
- Tidy the desktop layout: centred content, week totals in a row, two-column forms, compact cards

## v26 (2026-10-15)
- Drop the long carried-over note under the weekly nets

## v25 (2026-10-15)
- Quick Add for expenses, Today buttons, thousands separators and comment cleanup

## v24 (2026-10-15)
- Roll the weekly Net and Projected net forward into the next week

## v23 (2026-10-15)
- Add an Expenses tab: log spending against Spending Plan categories, spent vs plan and averages

## v22 (2026-10-15)
- Add an Income Received section to the Income tab

## v21 (2026-10-15)
- Remove income and projected income boxes from calendar days; weekly and monthly totals keep counting them

## v20 (2026-10-15)
- Keep the Menu in view on wide screens

## v19 (2026-10-15)
- Add a Plan tab: estimated spending by category with weekly and monthly views, business or personal, notes and a what-if switch

## v18 (2026-10-15)
- Several income and projected entries per day, one per source

## v17 (2026-10-15)
- Choose a source for real and projected income

## v16 (2026-10-15)
- Add a Projected Income section to the Income tab

## v15 (2026-10-15)
- Three tabs (Home, Income, Bills), projected income per day, and Paid History credits the labelled live bill

## v14 (2026-10-14)
- Line-by-line review: fix the undo bar, reduced motion and calendar file bugs, tidy and comment the code

## v13 (2026-10-14)
- Pay a different amount or skip a date, category suggestions, Add bill sheet on phones, accessibility pass

## v12 (2026-10-14)
- Catch-up for old repeating bills, update bar, text size, payday countdown, share backup, calendar reminders, device checklist

## v11 (2026-10-14)
- Seven more ease-of-use changes: calendar Earlier/Later, pay period from income, faster adding, calmer Bills list, folding parts, sync retry, day names

## v10 (2026-10-14)
- Friendlier phone use: undo bar, Mark paid in the banner, top-bar Sync, quieter reminders, + button, plain-words due dates

## v9 (2026-10-14)
- Lay a week's four numbers out two by two on phones
- Net moves only with income; add a weekly Due line for what is left to pay

## v8 (2026-10-14)
- Marking a bill paid changes only the net, not the totals

## v7 (2026-10-14)
- Make the phone screen easier to read: slimmer header, 3-week calendar, compact cards

## v6 (2026-10-12)
- Comment every rule and top-level statement, remove dead code, stop the 401 reset

## v5 (2026-10-12)
- Run the sync server on Render's free plan (no disk) and cope with a reset server

## v4 (2026-10-12)
- Point the app at its own sync server and finish separating from Second Memory
