# Change log

Every shipped version, newest first, with its date. Add an entry here (and one to `WHATS_NEW` in app.js) with every version bump.

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
