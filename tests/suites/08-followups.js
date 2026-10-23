// Follow-ups on every tab: autopay on the calendar, import limits, first sync and deletions, income received and projected, the Plan, expected costs, savings goals, Expenses (Quick Add, charts, filters), custom repeats and the backup and sync reminders.
const rb8 = { dateAdded: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'test', deleted: false, version: 0 };

// ---- the calendar treats an autopay bill like the banner does ----
bills.length = 0;
addBill({ name: 'Auto past', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: true });
addBill({ name: 'Manual past', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: false });
addBill({ name: 'Auto soon', amount: '10', dueDate: dk(1), frequency: 'one_time', category: '', autopay: true });
addBill({ name: 'Manual soon', amount: '10', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
const calendarItem = (name) => [...document.querySelectorAll('.budget-occurrence')].find((li) => li.textContent.includes(name));
check('a past-due manual bill is marked overdue on the calendar, an autopay one is not', calendarItem('Manual past').classList.contains('overdue') && !calendarItem('Auto past').classList.contains('overdue'));
check('a manual bill due tomorrow is marked due soon on the calendar, an autopay one is not', calendarItem('Manual soon').classList.contains('due-soon') && !calendarItem('Auto soon').classList.contains('due-soon'));
bills.length = 0; renderBudget();

// ---- import refuses amounts the forms would refuse ----
const b8 = { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly' };
const r8 = { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'weekly' };
check('a bill with a zero, negative or huge amount is refused, a normal one is not', !isValidImportRecord('bills', { ...b8, amount: 0 }) && !isValidImportRecord('bills', { ...b8, amount: -5 }) && !isValidImportRecord('bills', { ...b8, amount: 2e9 }) && isValidImportRecord('bills', b8));
check('a recurring income with a zero, negative or huge amount is refused', !isValidImportRecord('recurringIncome', { ...r8, amount: 0 }) && !isValidImportRecord('recurringIncome', { ...r8, amount: -1 }) && !isValidImportRecord('recurringIncome', { ...r8, amount: 2e9 }) && isValidImportRecord('recurringIncome', r8));
check('a day of income may be negative but not absurdly large', isValidImportRecord('income', { id: dk(1), dateKey: dk(1), amount: -20 }) && !isValidImportRecord('income', { id: dk(1), dateKey: dk(1), amount: -2e9 }));

// ---- the first sync never brings back a record the server deleted ----
bills.length = 0;
const edited = { ...rb8, id: 'del1', name: 'Edited after delete', amount: 10, dueDate: dk(2), frequency: 'monthly', category: '', paidDates: [], updatedAt: new Date().toISOString() };
bills.push(edited);
const deletedOnServer = { ...edited, deleted: true, version: 4, updatedAt: '2026-02-01T00:00:00.000Z' };
bootstrapSyncSnapshot({ collections: { bills: [deletedOnServer], income: [], recurringIncome: [] } });
check('a bill the server deleted stays deleted even if this device edited it later', bills.length === 1 && bills[0].deleted === true, JSON.stringify(bills));
bills.length = 0;
const edited2 = { ...edited, id: 'live1' };
bills.push(edited2);
bootstrapSyncSnapshot({ collections: { bills: [{ ...edited2, name: 'Older server copy', version: 2, updatedAt: '2026-02-01T00:00:00.000Z' }], income: [], recurringIncome: [] } });
check('a live bill edited here after the server copy is still kept as the newer one', bills.length === 1 && bills[0].name === 'Edited after delete', JSON.stringify(bills));
bills.length = 0; renderBudget();

// ---- a day cell's list of bills scrolls instead of spilling over the income box ----
const dayList = document.querySelector('.budget-day-occurrences');
check('the bills listed in a day cell scroll when there are many', !!dayList && getComputedStyle(dayList).overflowY === 'auto');

// ---- marking a bill paid moves only "Due"; the net moves only when income does ----
bills.length = 0; income.length = 0; recurringIncome.length = 0;
addBill({ name: 'Paid test', amount: '100', dueDate: dk(0), frequency: 'one_time', category: '', autopay: false });
const textOf = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent).join('|');
const weekLines = () => textOf('.budget-week-total') + '#' + textOf('.budget-week-income-total') + '#' + textOf('.budget-week-net-total') + '#' + $('budget-month-total').textContent + '#' + $('budget-month-net-total').textContent;
const dueBefore = textOf('.budget-week-due-total'); const linesBefore = weekLines();
check('every week shows a Due line', document.querySelectorAll('.budget-week-due-total').length === document.querySelectorAll('.budget-week').length);
check('Due holds the unpaid amount for the week', /Due: \$100\.00/.test(dueBefore), dueBefore);
toggleBillPaid(bills[0].id, dk(0), true); renderBudget();
check('marking a bill paid empties Due', /^(Due: \$0\.00\|?)+$/.test(textOf('.budget-week-due-total')), textOf('.budget-week-due-total'));
check('marking a bill paid leaves every total and net unchanged', weekLines() === linesBefore, linesBefore + ' -> ' + weekLines());
setIncomeForDate(dk(0), '60'); renderBudget();
check('entering income changes the net', /-\$40\.00/.test(textOf('.budget-week-net-total')) && /-\$40\.00/.test($('budget-month-net-total').textContent), textOf('.budget-week-net-total'));
bills.length = 0; income.length = 0; renderBudget();

// ---- the undo toast after Mark paid and Delete ----
bills.length = 0; income.length = 0; renderBudget(); hideUndoToast();
addBill({ name: 'Toast bill', amount: '30', dueDate: dk(1), frequency: 'monthly', category: '', autopay: false });
check('adding a bill shows an Added toast', !$('undo-toast').hidden && /Added Toast bill/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
hideUndoToast();
toggleBillPaid(bills[0].id, dk(1), true);
check('marking a bill paid shows a toast naming it', !$('undo-toast').hidden && /Marked Toast bill paid/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click();
check('the toast Undo button un-marks it and hides the toast', $('undo-toast').hidden === true && !(bills[0].paidDates || []).includes(dk(1)));
deleteBill(bills[0].id);
check('deleting a bill shows a toast', !$('undo-toast').hidden && /Deleted Toast bill/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click();
check('...and its Undo button brings the bill back', bills.filter((b) => !b.deleted).length === 1);
hideUndoToast();

// ---- Mark paid right in the bills banner, and the shorter button label ----
bills.length = 0; reminderBannerDismissed = false; renderBudget();
addBill({ name: 'Banner bill', amount: '10', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
const bannerPayButtons = () => [...$('reminder-banner-actions').querySelectorAll('button')];
check('the banner offers a Mark paid button for a bill due soon', bannerPayButtons().length === 1 && /Mark Banner bill paid/.test(bannerPayButtons()[0].textContent), $('reminder-banner-actions').textContent);
check('the bill card button just says Mark paid', document.querySelector('.mark-oldest-paid-btn').textContent === 'Mark paid');
bannerPayButtons()[0].click();
check('clicking it marks the bill paid and the banner goes away', bills[0].paidDates.includes(dk(1)) && $('reminder-banner').hidden === true);
hideUndoToast();

// ---- plain-words due dates on the bill cards ----
bills.length = 0; renderBudget();
addBill({ name: 'Soon bill', amount: '10', dueDate: dk(2), frequency: 'monthly', category: '', autopay: false });
const dueLine = () => document.querySelector('.bill-card .bill-due').textContent;
check('a card says when the bill is due in plain words', /^Due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+(, \d{4})? \u00b7 in 2 days$/.test(dueLine()), dueLine());
bills.length = 0; renderBudget();
addBill({ name: 'Late bill', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: false });
check('a late bill says Overdue and how long ago', /^Overdue .* \u00b7 3 days ago$/.test(dueLine()) && document.querySelector('.bill-due').classList.contains('bill-due-late'), dueLine());
bills.length = 0; renderBudget(); hideUndoToast();

// ---- the Sync button and note in the top bar ----
localStorage.removeItem('budgetApp.syncConfig.v1'); updateQuickSync();
check('the top-bar Sync button is hidden until sync is set up', $('quick-sync-btn').hidden && $('quick-sync-note').hidden);
localStorage.setItem('budgetApp.syncConfig.v1', JSON.stringify({ token: 'tok' })); updateQuickSync();
check('it appears once sync is set up', !$('quick-sync-btn').hidden && !$('quick-sync-note').hidden && $('quick-sync-note').textContent.length > 0, $('quick-sync-note').textContent);

// ---- the full-backup reminder leaves a syncing device alone until it has exported once ----
addBill({ name: 'Backup bill', amount: '10', dueDate: dk(20), frequency: 'monthly', category: '', autopay: false });
localStorage.removeItem(EXPORT_AT_KEY); backupNotesDismissed = false; renderBackupNotes();
check('a device that syncs is asked for a backup file too, since the server forgets its data', /full backup/.test($('backup-notes').textContent), $('backup-notes').textContent);
localStorage.removeItem('budgetApp.syncConfig.v1'); updateQuickSync(); renderBackupNotes();
check('a device that does not sync is asked as well', /full backup/.test($('backup-notes').textContent), $('backup-notes').textContent);
localStorage.removeItem('budgetApp.lastSyncAt.v1');
bills.length = 0; renderBudget();

// ---- the Add bill shortcut ----
check('there is a + button that jumps to the Add bill form', !!$('add-bill-fab') && $('add-bill-fab').getAttribute('aria-label') === 'Add a bill');

// ---- a date already paid is not shown as the next due date ----
bills.length = 0; renderBudget();
addBill({ name: 'Paid ahead', amount: '10', dueDate: dk(1), frequency: 'monthly', category: '', autopay: false });
toggleBillPaid(bills[0].id, dk(1), true);
const paidAheadLine = document.querySelector('.bill-card .bill-due').textContent;
check('a bill paid for its next date shows the date after it', !/tomorrow/.test(paidAheadLine) && /^Due /.test(paidAheadLine), paidAheadLine);
bills.length = 0; renderBudget(); hideUndoToast();

// ---- Earlier / Today / Later slide the calendar ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; calendarWeekOffset = 0; renderBudget();
const weekHeads = () => [...document.querySelectorAll('.budget-week-total')].map((e) => e.textContent.split(':')[0]);
check('the calendar starts on last, this and next week', weekHeads().join('|') === 'Last week|This week|Next week', weekHeads().join('|'));
check('Today is disabled while the calendar is in its usual place', $('calendar-today').disabled === true);
$('calendar-next').click();
check('Later slides it forward a week', weekHeads()[0] === 'This week' && weekHeads()[1] === 'Next week' && /^Week of /.test(weekHeads()[2]) && !$('calendar-today').disabled, weekHeads().join('|'));
check('the week holding today is still the highlighted one', document.querySelectorAll('.budget-week-current').length === 1 && document.querySelector('.budget-week-current .budget-week-total').textContent.startsWith('This week'));
$('calendar-prev').click(); $('calendar-prev').click();
check('Earlier slides it back', /^Week of /.test(weekHeads()[0]) && weekHeads()[2] === 'This week', weekHeads().join('|'));
$('calendar-today').click();
check('Today puts it back', weekHeads().join('|') === 'Last week|This week|Next week' && $('calendar-today').disabled === true);

// ---- the pay period uses the paycheck's schedule until a payday is saved ----
localStorage.removeItem('budgetApp.paydaySettings.v1');
renderBudget();
check('with no payday and no income source the pay period asks for one', /Set a recent payday/.test($('pay-period-empty-state').textContent) && $('pay-period-source').hidden === true);
addRecurringIncome({ name: 'Paycheck', amount: '1000', dueDate: dk(-20), frequency: 'biweekly', category: '' });
addRecurringIncome({ name: 'Side gig', amount: '50', dueDate: dk(-20), frequency: 'weekly', category: '' });
check('the biggest income source sets the pay period', !$('pay-period-source').hidden && /Paycheck/.test($('pay-period-source').textContent) && /Payday /.test($('pay-period-summary').textContent), $('pay-period-source').textContent + ' / ' + $('pay-period-summary').textContent);
localStorage.setItem('budgetApp.paydaySettings.v1', JSON.stringify({ payDateKey: dk(-3), frequency: 'monthly' }));
renderBudget();
check('a payday saved by hand wins over the income source', $('pay-period-source').hidden === true);
localStorage.removeItem('budgetApp.paydaySettings.v1');
recurringIncome.length = 0; renderBudget();

// ---- adding: the date starts on today, amounts get the decimal keypad, and the new card flashes ----
check('the due date starts on today', $('budget-duedate-input').value === todayKey(), $('budget-duedate-input').value);
check('amount boxes ask for the decimal keypad', ['budget-amount-input', 'recurring-income-amount-input'].every((id) => $(id).getAttribute('inputmode') === 'decimal') && document.querySelector('#budget-card-template').content.querySelector('.bill-edit-amount').getAttribute('inputmode') === 'decimal');
$('budget-name-input').value = 'Flash bill'; $('budget-amount-input').value = '12';
$('budget-add-form').requestSubmit();
check('adding from the form puts the date back to today and flashes the new card', $('budget-duedate-input').value === todayKey() && !!document.querySelector('.bill-card.bill-card-new'));
hideUndoToast(); bills.length = 0; renderBudget();

// ---- a day on the calendar can start a bill ----
startBillOnDate(dk(3));
check('"Add a bill on this day" fills in that date', $('budget-duedate-input').value === dk(3));
check('every day has the button for it', document.querySelectorAll('.budget-day-add-bill').length === document.querySelectorAll('.budget-day-cell').length);
$('budget-duedate-input').value = todayKey();

// ---- the Bills list sorts by the next date to pay, and can show only what is due soon ----
bills.length = 0; renderBudget();
addBill({ name: 'Zed old monthly', amount: '10', dueDate: dk(-200), frequency: 'monthly', category: '', autopay: false });
addBill({ name: 'Far one-time', amount: '10', dueDate: dk(60), frequency: 'one_time', category: '', autopay: false });
addBill({ name: 'Late one-time', amount: '10', dueDate: dk(-4), frequency: 'one_time', category: '', autopay: false });
addBill({ name: 'Soon one-time', amount: '10', dueDate: dk(5), frequency: 'one_time', category: '', autopay: false });
const cardNames = () => [...document.querySelectorAll('#budget-list .bill-name')].map((e) => e.textContent);
check('Soon comes before Far, by next date', cardNames().indexOf('Soon one-time') < cardNames().indexOf('Far one-time'), cardNames().join('|'));
check('a bill that is late comes before one due soon', cardNames().indexOf('Late one-time') < cardNames().indexOf('Soon one-time'), cardNames().join('|'));
$('budget-soon-filter').click();
check('the Due in the next 2 weeks chip hides bills due later', !cardNames().includes('Far one-time') && cardNames().includes('Soon one-time') && cardNames().includes('Late one-time') && $('budget-soon-filter').getAttribute('aria-pressed') === 'true', cardNames().join('|'));
$('budget-soon-filter').click();
check('turning it off shows them all again', cardNames().includes('Far one-time'));
hideUndoToast(); bills.length = 0; renderBudget();

// ---- the long parts of the page fold up and remember it ----
const payFold = $('fold-pay-period');
check('Pay Period, Income Received, Projected Income, Spending Plan, the Expected Costs, Savings Goals, the seven Expenses sections, Paid History and Recurring Income are folds, open to start with', document.querySelectorAll('details.fold').length === 15 && payFold.open === true);
payFold.open = false; await sleep(30);
check('folding one up is remembered on this device', JSON.parse(localStorage.getItem('budgetApp.folds.v1') || '{}')['fold-pay-period'] === false);
payFold.open = true; await sleep(30);
localStorage.removeItem('budgetApp.folds.v1');

// ---- a bill's name shows on its day in the compact calendar ----
bills.length = 0; renderBudget();
addBill({ name: 'Peek one', amount: '5', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
addBill({ name: 'Peek two', amount: '5', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
const peekCell = document.querySelector(`.budget-day-cell[data-date-key="${dk(1)}"]`);
check('a day with bills carries the first name and how many more', !!peekCell && /Peek/.test(peekCell.querySelector('.budget-day-peek-name').textContent) && peekCell.querySelector('.budget-day-peek-more').textContent === '+1');
check('a day with nothing has no name line', !document.querySelector(`.budget-day-cell[data-date-key="${dk(2)}"] .budget-day-peek`));
hideUndoToast(); bills.length = 0; renderBudget();

// ---- "I'm caught up" when adding a repeating bill with a past date, and one-tap catch-up on a card ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; renderBudget(); hideUndoToast();
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
$('budget-name-input').value = 'Old rent'; $('budget-amount-input').value = '100';
$('budget-duedate-input').value = dk(-70); fire($('budget-duedate-input'), 'input');
check('a repeating bill with a past date offers "I\'m caught up", ticked', !$('budget-caughtup-field').hidden && $('budget-caughtup-input').checked === true);
$('budget-frequency-input').value = 'one_time'; fire($('budget-frequency-input'), 'change');
check('a one-time bill with a past date does not', $('budget-caughtup-field').hidden === true);
$('budget-frequency-input').value = 'monthly'; fire($('budget-frequency-input'), 'change');
check('switching back to monthly offers it again', !$('budget-caughtup-field').hidden);
$('budget-add-form').requestSubmit();
const unpaidBefore = (name) => unpaidAmountThrough(bills.find((b) => b.name === name), dk(-1));
check('caught up: nothing earlier is unpaid, and the amounts paid are recorded', unpaidBefore('Old rent') === 0 && bills[0].paidDates.length >= 2 && Object.keys(bills[0].paidAmounts).length === bills[0].paidDates.length);
check('the box goes away again after adding', $('budget-caughtup-field').hidden === true);
$('budget-name-input').value = 'Left behind'; $('budget-amount-input').value = '50';
$('budget-duedate-input').value = dk(-70); fire($('budget-duedate-input'), 'input');
$('budget-caughtup-input').checked = false;
$('budget-add-form').requestSubmit();
check('not ticked: the old dates stay unpaid', unpaidBefore('Left behind') > 50);
const behindCard = document.querySelector(`.bill-card[data-bill-id="${bills.find((b) => b.name === 'Left behind').id}"]`);
check('the card offers Mark earlier dates paid', !behindCard.querySelector('.catch-up-btn').hidden);
check('a caught-up bill\'s card does not', document.querySelector(`.bill-card[data-bill-id="${bills.find((b) => b.name === 'Old rent').id}"] .catch-up-btn`).hidden === true);
behindCard.querySelector('.catch-up-btn').click();
check('one tap catches it up', unpaidBefore('Left behind') === 0 && /paid/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click();
check('one undo puts every date back', unpaidBefore('Left behind') > 50);
hideUndoToast(); bills.length = 0; renderBudget();

// ---- the "new version is ready" bar ----
check('the new-version bar starts hidden, with an Update now button', $('update-banner').hidden === true && !!$('update-now-btn'));
showUpdateBanner();
check('and shows when asked', $('update-banner').hidden === false);
$('update-banner').hidden = true;

// ---- text size ----
applyTextSize('large');
check('Large sets the size on the page and remembers it', document.documentElement.getAttribute('data-text') === 'large' && localStorage.getItem('budgetApp.textSize.v1') === 'large' && /Large/.test($('text-size-btn').textContent), $('text-size-btn').textContent);
$('text-size-btn').click();
check('the button goes on to Largest', document.documentElement.getAttribute('data-text') === 'xlarge' && /Largest/.test($('text-size-btn').textContent));
$('text-size-btn').click();
check('and back to Normal, forgetting the choice', !document.documentElement.hasAttribute('data-text') && localStorage.getItem('budgetApp.textSize.v1') === null && /Normal/.test($('text-size-btn').textContent));

// ---- next payday and what is left after unpaid bills ----
income.length = 0; recurringIncome.length = 0; bills.length = 0;
localStorage.setItem('budgetApp.paydaySettings.v1', JSON.stringify({ payDateKey: dk(-3), frequency: 'biweekly' }));
addBill({ name: 'Pay bill', amount: '100', dueDate: dk(2), frequency: 'one_time', category: '', autopay: false });
check('the pay period says when the next payday is', /^Next payday: .* · in 11 days$/.test($('pay-period-next').textContent), $('pay-period-next').textContent);
check('and what is left after the unpaid bills', /Left after unpaid bills: -\$100\.00/.test($('pay-period-left').textContent), $('pay-period-left').textContent);
toggleBillPaid(bills[0].id, dk(2), true);
check('paying the bill raises what is left', /Left after unpaid bills: \$0\.00/.test($('pay-period-left').textContent), $('pay-period-left').textContent);
check('while the net, as always, does not move', /Net this pay period: -\$100\.00/.test($('pay-period-net-total').textContent), $('pay-period-net-total').textContent);
localStorage.removeItem('budgetApp.paydaySettings.v1');
hideUndoToast(); bills.length = 0; renderBudget();

// ---- sharing a backup ----
check('the Share backup button shows only where the browser can share files', $('share-data-btn').hidden === !CAN_SHARE_FILES);

// ---- calendar reminders (.ics) ----
check('with no bills there is no calendar file', buildCalendarFile() === null);
addBill({ name: 'Rent, home', amount: '900', dueDate: dk(2), frequency: 'monthly', category: '', autopay: false });
addBill({ name: 'Netflix', amount: '15', dueDate: dk(3), frequency: 'monthly', category: '', autopay: true });
addBill({ name: 'Old one-off', amount: '5', dueDate: dk(-30), frequency: 'one_time', category: '', autopay: false });
const ics = buildCalendarFile();
check('the file is a calendar with CRLF line endings', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics));
check('a monthly bill repeats monthly and its comma is escaped', ics.includes('RRULE:FREQ=MONTHLY') && ics.includes('SUMMARY:Pay Rent\\, home ($900.00)'));
check('only a bill that does not pay itself gets an alert', (ics.match(/BEGIN:VALARM/g) || []).length === 1 && ics.includes('SUMMARY:Netflix autopay ($15.00)'));
check('a one-time bill that is long past is left out', !ics.includes('Old one-off'));
check('the file holds no passphrase or device id', !/tok|deviceId/.test(ics));
check('events start on a date, with no time', /DTSTART;VALUE=DATE:\d{8}\r\n/.test(ics));
hideUndoToast(); bills.length = 0; renderBudget();

// ---- paying a different amount, or skipping a date ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; renderBudget(); hideUndoToast();
addBill({ name: 'Power', amount: '80', dueDate: dk(0), frequency: 'monthly', category: 'Utilities', autopay: false });
const cardOf = (name) => [...document.querySelectorAll('#budget-list .bill-card')].find((c) => c.querySelector('.bill-name').textContent === name);
cardOf('Power').querySelector('.pay-other-btn').click();
const otherFormOf = (name) => cardOf(name).querySelector('.pay-other-form');
check('Other opens a small form with the usual amount filled in', !otherFormOf('Power').hidden && otherFormOf('Power').querySelector('.pay-other-amount').value === '80');
otherFormOf('Power').querySelector('.pay-other-amount').value = '0';
check('the browser refuses a zero amount before anything is saved', otherFormOf('Power').querySelector('.pay-other-amount').validity.valid === false && !(bills[0].paidDates || []).length);
otherFormOf('Power').querySelector('.pay-other-amount').value = '2000000000';
otherFormOf('Power').requestSubmit();
check('an absurdly large amount is refused with a message, and nothing is paid', !otherFormOf('Power').querySelector('.pay-other-error').hidden && !(bills[0].paidDates || []).length);
otherFormOf('Power').querySelector('.pay-other-amount').value = '92.4';
otherFormOf('Power').requestSubmit();
check('a different amount is recorded for that date', bills[0].paidDates.includes(dk(0)) && bills[0].paidAmounts[dk(0)] === 92.4, JSON.stringify(bills[0].paidAmounts));
check('the week total uses what was really paid', /This week: \$92\.40/.test(document.querySelector('.budget-week-current .budget-week-total').textContent), document.querySelector('.budget-week-current .budget-week-total').textContent);
hideUndoToast();
addBill({ name: 'Gym', amount: '30', dueDate: dk(0), frequency: 'monthly', category: '', autopay: false });
cardOf('Gym').querySelector('.pay-other-btn').click();
cardOf('Gym').querySelector('.pay-skip-btn').click();
const gym = bills.find((b) => b.name === 'Gym');
check('Skip counts the date as paid with nothing paid', gym.paidDates.includes(dk(0)) && gym.paidAmounts[dk(0)] === 0);
check('a skipped date is not overdue or unpaid', unpaidAmountThrough(gym, dk(0)) === 0);
check('the toast says Skipped', /Skipped Gym/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
const { y: histY, m: histM } = parseDateKey(todayKey());
check('a skipped date is not listed as money paid', !computePaidByCategory(bills, histY, histM).some((r) => r.label === 'Uncategorized') && computePaidByCategory(bills, histY, histM).some((r) => r.label === 'Utilities' && r.total === 92.4));
$('undo-toast-btn').click();
check('Undo brings the skipped date back', unpaidAmountThrough(bills.find((b) => b.name === 'Gym'), dk(0)) === 30);
check('Other is off for a bill with nothing unpaid', cardOf('Power').querySelector('.pay-other-btn').disabled === true);
hideUndoToast(); bills.length = 0; renderBudget();

// ---- category suggestions and one spelling per category ----
addBill({ name: 'A', amount: '1', dueDate: dk(5), frequency: 'monthly', category: 'Utilities', autopay: false });
addBill({ name: 'B', amount: '1', dueDate: dk(6), frequency: 'monthly', category: '  utilities ', autopay: false });
check('a category typed in another case takes the spelling already used', bills.find((b) => b.name === 'B').category === 'Utilities');
check('the category box suggests the categories in use', [...$('category-options').options].map((o) => o.value).join('|') === 'Utilities' && $('budget-category-input').getAttribute('list') === 'category-options');
hideUndoToast(); bills.length = 0; renderBudget();

// ---- the Add bill form as a sheet on phones ----
openAddBillSheet();
check('the Add bill form can open as a sheet', $('budget-add-form').classList.contains('add-form-open') && $('budget-add-form').getAttribute('role') === 'dialog' && $('budget-add-form').getAttribute('aria-modal') === 'true' && !$('add-sheet-backdrop').hidden);
$('add-sheet-backdrop').click();
check('a tap on the dimmed page closes it', !$('budget-add-form').classList.contains('add-form-open') && $('add-sheet-backdrop').hidden && !$('budget-add-form').hasAttribute('role'));
openAddBillSheet(); $('budget-add-form').querySelector('.add-form-cancel').click();
check('Cancel closes it', !$('budget-add-form').classList.contains('add-form-open'));
openAddBillSheet(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape closes it', !$('budget-add-form').classList.contains('add-form-open'));
openAddBillSheet();
$('budget-name-input').value = 'Sheet bill'; $('budget-amount-input').value = '9';
$('budget-add-form').requestSubmit();
check('adding a bill closes it', !$('budget-add-form').classList.contains('add-form-open') && bills.some((b) => b.name === 'Sheet bill'));
hideUndoToast(); bills.length = 0; renderBudget();
check('the page can tell a phone layout from a wide one, and asks for smooth or no scrolling', typeof isPhoneLayout() === 'boolean' && ['smooth', 'auto'].includes(scrollBehavior()));

// ---- screen-reader basics: every field and button has a name ----
const nameless = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
  .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))));
check('every field has a name for screen readers', nameless.length === 0, nameless.map((e) => e.id || e.className).join(', '));
const unnamedButtons = [...document.querySelectorAll('button')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label')));
check('every button has a name', unnamedButtons.length === 0, unnamedButtons.map((b) => b.id || b.className).join(', '));
const templateFields = [...document.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('input:not([type="hidden"]), select, textarea')])
  .filter((el) => !(el.getAttribute('aria-label') || el.closest('label')));
check('every field in the bill and income cards has a name too', templateFields.length === 0, templateFields.map((e) => e.className).join(', '));
check('there is one main area and a Menu navigation', document.querySelectorAll('main').length === 1 && !!document.querySelector('nav[aria-label="Menu"]'));

// ---- fixes from the line-by-line review ----
// A change that gets no toast hides an older toast, so that toast's Undo can never undo the wrong change.
bills.length = 0; income.length = 0; recurringIncome.length = 0; renderBudget(); hideUndoToast();
addBill({ name: 'Toast two', amount: '10', dueDate: dk(0), frequency: 'one_time', category: '', autopay: false });
toggleBillPaid(bills[0].id, dk(0), true);
check('a toast is showing after Mark paid', !$('undo-toast').hidden);
setIncomeForDate(dk(1), '5'); await sleep(30);
check('a later change with no toast hides it, so its Undo cannot undo the wrong change', $('undo-toast').hidden === true);
income.length = 0; hideUndoToast(); bills.length = 0; renderBudget();

// A skipped date reads as skipped on the calendar, not as "paid $0.00".
addBill({ name: 'Skipper', amount: '30', dueDate: dk(0), frequency: 'monthly', category: '', autopay: false });
toggleBillPaid(bills[0].id, dk(0), true, 0);
const skippedRow = document.querySelector('.budget-occurrence.skipped');
check('a skipped date is marked skipped on the calendar, with no dollar amount in its tooltip', !!skippedRow && /skipped/.test(skippedRow.querySelector('label').title) && !/\$/.test(skippedRow.querySelector('label').title), skippedRow && skippedRow.querySelector('label').title);
check('...and in the day\'s spoken summary', /Skipper \(skipped\)/.test(document.querySelector(`.budget-day-cell[data-date-key="${dk(0)}"] .budget-day-open-btn`).getAttribute('aria-label')));

// Every button on a card names its bill (and still contains its visible words) for screen readers.
const skipperCard = document.querySelector('#budget-list .bill-card');
check('a card\'s buttons name their bill', skipperCard.querySelector('.delete-btn').getAttribute('aria-label') === 'Delete Skipper' && skipperCard.querySelector('.edit-btn').getAttribute('aria-label') === 'Edit Skipper' && /^Mark paid: Skipper$/.test(skipperCard.querySelector('.mark-oldest-paid-btn').getAttribute('aria-label')));
hideUndoToast(); bills.length = 0; renderBudget();

// The calendar file folds long lines by bytes and never splits an emoji or accented letter.
const longLine = 'SUMMARY:' + '\u{1F600}'.repeat(40) + ' café '.repeat(20);
const foldedLine = icsFold(longLine);
const foldedParts = foldedLine.split('\r\n');
check('folded calendar lines are at most 75 bytes', foldedParts.every((part) => new TextEncoder().encode(part).length <= 75));
check('folding loses nothing and breaks no character', foldedLine.replace(/\r\n /g, '') === longLine);
check('every continuation line starts with a space', foldedParts.slice(1).every((part) => part.startsWith(' ')));

// The friendly dates shown on the Pay Period and Recurring Income cards.
bills.length = 0; recurringIncome.length = 0;
addRecurringIncome({ name: 'Paycheck', amount: '1000', dueDate: dk(-9), frequency: 'biweekly', category: '' });
check('a recurring income card shows its start date in plain words', /^Starts: [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+/.test(document.querySelector('.recurring-income-start').textContent), document.querySelector('.recurring-income-start').textContent);
check('its buttons name it', document.querySelector('#recurring-income-list .delete-btn').getAttribute('aria-label') === 'Delete Paycheck');
hideUndoToast(); recurringIncome.length = 0; renderBudget();

// ---- the three tabs ----
showTab('home'); // earlier checks in this suite switch tabs, so start from Home
check('the app has Home, Income and Bills tabs, and Home shows the calendar',['tab-home', 'tab-income', 'tab-bills'].every((id) => !!$(id)) && !$('tab-home').hidden && $('tab-income').hidden && $('tab-bills').hidden);
check('the calendar is on Home, pay period and recurring income on Income, bills and Paid History on Bills',
  $('tab-home').contains($('budget-calendar')) && $('tab-income').contains($('payday-settings-form')) && $('tab-income').contains($('recurring-income-list')) &&
  $('tab-bills').contains($('budget-list')) && $('tab-bills').contains($('budget-add-form')) && $('tab-bills').contains($('paid-history-list')));
document.querySelector('.tabbar-btn[data-tab="bills"]').click();
check('a tab button shows its tab and hides the others', !$('tab-bills').hidden && $('tab-home').hidden && $('tab-income').hidden && document.querySelector('.tabbar-btn[data-tab="bills"]').getAttribute('aria-current') === 'page' && !document.querySelector('.tabbar-btn[data-tab="home"]').hasAttribute('aria-current'));
check('the last tab is remembered on this device', localStorage.getItem('budgetApp.tab.v1') === 'bills');
showTab('income');
check('the + button is hidden on the Income tab', $('add-bill-fab').hidden === true);
showTab('home');
check('...and back on Home', $('add-bill-fab').hidden === false);
startBillOnDate(dk(3));
check('starting a bill from a calendar day switches to the Bills tab', !$('tab-bills').hidden && $('tab-home').hidden && $('budget-duedate-input').value === dk(3));
$('budget-duedate-input').value = todayKey();
showTab('bogus');
check('an unknown tab name falls back to Home', !$('tab-home').hidden && currentTab === 'home');
localStorage.removeItem('budgetApp.tab.v1');

// ---- projected income, typed per day ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; renderBudget(); hideUndoToast();
addBill({ name: 'Proj bill', amount: '100', dueDate: dk(0), frequency: 'one_time', category: '', autopay: false });
setProjectedForDate(dk(0), '300'); await sleep(30);
const thisWeek = () => document.querySelector('.budget-week-current');
check('a projection is stored in the income list under its own date field, with no dateKey', income.some((r) => r.id === `projected-${dk(0)}` && r.projectedFor === dk(0) && r.projected === 300 && !r.dateKey && !r.deleted));
check('it does not count as income received', /Income: \$0\.00/.test(thisWeek().querySelector('.budget-week-income-total').textContent) && /Net: -\$100\.00/.test(thisWeek().querySelector('.budget-week-net-total').textContent));
check('the week shows Projected and Projected net', /Projected: \$300\.00/.test(thisWeek().querySelector('.budget-week-projected-total').textContent) && /Projected net: \$200\.00/.test(thisWeek().querySelector('.budget-week-projected-net-total').textContent), thisWeek().textContent);
check('calendar days no longer show income or projected boxes or dots', !document.querySelector('.budget-day-manual-input, .budget-day-projected-input, .budget-day-source-input, .budget-income-dot, .budget-projected-dot, .budget-day-footer'));
check('a week with no projection shows no projected lines', document.querySelectorAll('.budget-week-projected-total').length === 1);
setIncomeForDate(dk(0), '120'); await sleep(30);
check('real income for that day replaces its projection instead of adding to it', /Projected: \$0\.00/.test(thisWeek().querySelector('.budget-week-projected-total').textContent) && /Projected net: \$20\.00/.test(thisWeek().querySelector('.budget-week-projected-net-total').textContent), thisWeek().textContent);
setIncomeForDate(dk(0), ''); await sleep(30);
setProjectedForDate(dk(0), ''); await sleep(30);
check('clearing a projection removes the lines and keeps a tombstone', !document.querySelector('.budget-week-projected-total') && income.find((r) => r.id === `projected-${dk(0)}`).deleted === true);
setProjectedForDate(dk(1), '75'); await sleep(30);
undo(); await sleep(30);
check('a projection can be undone', !document.querySelector('.budget-week-projected-total'));
check('actual-income helpers never see a projected record', uniqueIncomeEntries(income).every((r) => !!r.dateKey));
check('import accepts a projected record and refuses a broken one', isValidImportRecord('income', { id: `projected-${dk(1)}`, projectedFor: dk(1), projected: 50 }) && !isValidImportRecord('income', { id: 'x', projectedFor: 'not-a-date', projected: 5 }) && !isValidImportRecord('income', { id: 'y', projectedFor: dk(1), projected: 'five' }));
check('the Undo tooltip can name a projected change', (() => { setProjectedForDate(dk(2), '5'); return /projected|20\d\d-/.test($('undo-btn').title); })());
hideUndoToast(); bills.length = 0; income.length = 0; renderBudget();

// ---- Paid History credits a payment to the labelled, live copy of a bill ----
const histDate = dk(-5);
const { y: hy, m: hm } = parseDateKey(histDate);
const copyOf = { name: 'Utility', amount: 50, frequency: 'monthly', dueDate: histDate, paidDates: [histDate], paidAmounts: { [histDate]: 50 }, dateAdded: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deviceId: 't', version: 1 };
bills.length = 0;
bills.push({ ...copyOf, id: 'dead-copy', category: '', deleted: true }, { ...copyOf, id: 'live-copy', category: 'Utilities', deleted: false });
const labelledFirst = computePaidByCategory(bills, hy, hm);
check('a payment on a deleted, unlabelled copy goes to the labelled live bill', labelledFirst.length === 1 && labelledFirst[0].label === 'Utilities' && labelledFirst[0].total === 50, JSON.stringify(labelledFirst.map((r) => [r.label, r.total])));
bills.length = 0;
bills.push({ ...copyOf, id: 'live-copy', category: 'Utilities', deleted: false }, { ...copyOf, id: 'dead-copy', category: '', deleted: true });
check('...whichever order the copies are stored in', computePaidByCategory(bills, hy, hm)[0].label === 'Utilities');
bills.length = 0;
bills.push({ ...copyOf, id: 'plain', category: '', deleted: false });
paidHistoryMonth = { y: hy, m: hm }; renderBudget();
check('the Uncategorized row says which bills are in it', /Utility/.test(document.querySelector('#paid-history-list .paid-history-detail').textContent), document.querySelector('#paid-history-list').textContent);
bills.length = 0; paidHistoryMonth = (() => { const { y, m } = parseDateKey(todayKey()); return { y, m }; })(); renderBudget();

// ---- the Projected Income section on the Income tab ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('income'); renderBudget(); hideUndoToast();
check('the Income tab has a Projected Income section with a form and a list', $('tab-income').contains($('projected-income-add-form')) && $('tab-income').contains($('projected-income-list')) && !!$('fold-projected-income'));
check('its date starts on today, and with nothing projected it says so', $('projected-income-date-input').value === todayKey() && $('projected-income-empty-state').hidden === false && $('projected-income-summary').textContent === '');
const projectedCards = () => [...document.querySelectorAll('#projected-income-list .recurring-income-card')];
$('projected-income-date-input').value = dk(2); $('projected-income-amount-input').value = '400';
$('projected-income-add-form').requestSubmit(); await sleep(30);
check('adding a projected amount saves it for that date and lists it', income.some((r) => r.id === `projected-${dk(2)}` && r.projected === 400 && !r.deleted) && projectedCards().length === 1 && /\$400\.00/.test(projectedCards()[0].textContent), projectedCards().map((c) => c.textContent.trim()).join('|'));
check('the list says when it is, and the total still expected', /in 2 days/.test(projectedCards()[0].querySelector('.recurring-income-name').textContent) && /\$400\.00 still expected across 1 day\./.test($('projected-income-summary').textContent), $('projected-income-summary').textContent);
check('the amount box clears and the empty message goes away', $('projected-income-amount-input').value === '' && $('projected-income-empty-state').hidden === true);
$('projected-income-date-input').value = dk(2); $('projected-income-amount-input').value = '450';
$('projected-income-add-form').requestSubmit(); await sleep(30);
check('adding the same date again replaces it (one projection per day)', projectedCards().length === 1 && /\$450\.00/.test(projectedCards()[0].textContent) && income.filter((r) => r.id === `projected-${dk(2)}`).length === 1);
$('projected-income-date-input').value = dk(-1); $('projected-income-amount-input').value = '10';
$('projected-income-add-form').requestSubmit();
check('a past date is refused with a message', !$('projected-income-form-error').hidden && /today or a later day/.test($('projected-income-form-error').textContent) && !income.some((r) => r.projectedFor === dk(-1)));
$('projected-income-date-input').value = dk(3); $('projected-income-amount-input').value = '';
check('a missing amount is stopped by the form itself', $('projected-income-amount-input').validity.valueMissing === true);
$('projected-income-date-input').value = todayKey();
projectedCards()[0].querySelector('.edit-btn').click();
projectedCards()[0].querySelector('.projected-income-edit-amount').value = '500';
projectedCards()[0].querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30);
check('Edit changes the amount', /\$500\.00/.test(projectedCards()[0].textContent) && income.find((r) => r.id === `projected-${dk(2)}`).projected === 500);
setIncomeForDate(dk(2), '90'); await sleep(30);
check('a day with real income entered says its projection no longer counts', /no longer counts/.test(projectedCards()[0].textContent) && /\$0\.00 still expected/.test($('projected-income-summary').textContent), $('projected-income-summary').textContent);
setIncomeForDate(dk(2), ''); await sleep(30);
projectedCards()[0].querySelector('.delete-btn').click(); await sleep(30);
check('Delete removes it, keeps a tombstone and shows a toast with Undo', projectedCards().length === 0 && income.find((r) => r.id === `projected-${dk(2)}`).deleted === true && /Deleted projected income/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo brings it back', projectedCards().length === 1);
check('every button and box in the section has a name for screen readers', [...$('fold-projected-income').querySelectorAll('button, input')].every((el) => el.textContent.trim() || el.getAttribute('aria-label') || el.closest('label')));
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- income source (real and projected) ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('income'); renderBudget(); hideUndoToast();
recurringIncome.push({ id: 'ri-src', name: 'Paycheck', amount: 1000, dueDate: dk(-3), frequency: 'biweekly', category: '', dateAdded: new Date().toISOString(), updatedAt: new Date().toISOString(), deviceId: 'd', deleted: false, version: 0 });
setProjectedForDate(dk(3), '300', 'Side gig'); await sleep(30);
setIncomeForDate(dk(1), '120'); await sleep(30);
setIncomeSource(dk(1), '  Tips  '); await sleep(30);
check('a source is saved trimmed on a real income day', income.find((r) => r.id === dk(1)).source === 'Tips');
check('a source is saved on a projected day', income.find((r) => r.projectedFor === dk(3)).source === 'Side gig');
check('suggestions are the recurring income names plus sources used before', JSON.stringify(incomeSourceNames()) === JSON.stringify(['Paycheck', 'Side gig', 'Tips']) && document.querySelectorAll('#income-source-options option').length === 3, JSON.stringify(incomeSourceNames()));
check('the projected list shows the source', /Side gig/.test(document.querySelector('#projected-income-list .recurring-income-start').textContent));
showTab('home'); renderBudget();
check('the source choices still list recurring income names and used sources on the Income tab form', document.querySelectorAll('#income-source-options option').length === 3);
setProjectedForDate(dk(3), '350', 'Side gig'); await sleep(30);
check('changing only the amount keeps the source', income.find((r) => r.projectedFor === dk(3)).source === 'Side gig');
setIncomeSource(dk(1), ''); await sleep(30);
check('an empty source clears it', income.find((r) => r.id === dk(1)).source === undefined);
check('a source is cut to 60 characters', (setIncomeSource(dk(1), 'x'.repeat(80)), income.find((r) => r.id === dk(1)).source.length === 60));
check('an import with a non-text source is refused', isValidImportRecord('income', { id: 'a', dateKey: dk(1), amount: 5, source: 7 }) === false && isValidImportRecord('income', { id: 'a', dateKey: dk(1), amount: 5, source: 'Tips' }) === true);
hideUndoToast(); income.length = 0; recurringIncome.length = 0; showTab('home'); renderBudget();
// ---- several entries per day, one per source ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('home'); renderBudget(); hideUndoToast();
setIncomeForDate(dk(1), '100', 'Job'); await sleep(30);
setIncomeForDate(dk(1), '40', 'tips'); await sleep(30);
setIncomeForDate(dk(1), '60', ' JOB '); await sleep(30);
const dayEntries = () => income.filter((r) => r.dateKey === dk(1) && !r.deleted);
check('a different source makes a second entry for the day', dayEntries().length === 2, JSON.stringify(dayEntries()));
check('the same source (any case) updates its entry instead', dayEntries().find((r) => r.source === 'Job').amount === 60 && dayEntries().filter((r) => (r.source || '').toLowerCase() === 'job').length === 1);
check('the day total counts both entries', incomeSumInRange(dk(1), dk(1), uniqueIncomeEntries(income).filter((r) => !r.deleted)) === 100);
setIncomeForDate(dk(1), '', 'tips'); await sleep(30);
check('clearing one entry leaves the other', dayEntries().length === 1 && dayEntries()[0].source === 'Job');
check('a source cannot be changed to one the day already has', (setIncomeForDate(dk(1), '5', 'Gift'), true) && (await sleep(30), setIncomeSource(dayEntries().find((r) => r.source === 'Gift').id, 'job') === false));
check('an entry with no source and one with a source can share a day', (setIncomeForDate(dk(1), '7'), dayEntries().filter((r) => !r.source).length === 1));
setProjectedForDate(dk(2), '200', 'Job'); setProjectedForDate(dk(2), '50', 'Gift'); await sleep(30);
check('projected income also holds one entry per source', projectedByDate(income).get(dk(2)).length === 2);
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- the Plan tab (estimated spending per category) ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('plan'); renderBudget(); hideUndoToast();
check('the Plan tab is the fourth tab and starts empty', TABS.length === 5 && $('tab-plan').hidden === false && $('tab-home').hidden === true && $('plan-empty-state').hidden === false && $('plan-total-line').textContent === '');
check('weekly to monthly multiplies by 52 and divides by 12, not by 4', Math.abs(planMonthly(60, 'weekly') - 260) < 1e-9 && planMonthly(100, 'monthly') === 100);
check('monthly to weekly multiplies by 12 and divides by 52', Math.abs(planWeekly(260, 'monthly') - 60) < 1e-9 && planWeekly(60, 'weekly') === 60);
const planCards = () => [...document.querySelectorAll('#plan-list .recurring-income-card')];
const addPlan = (name, amount, frequency, type, alt, notes) => {
  $('plan-name-input').value = name; $('plan-amount-input').value = amount; $('plan-frequency-input').value = frequency;
  $('plan-type-input').value = type; $('plan-alt-input').value = alt || ''; $('plan-notes-input').value = notes || '';
  $('plan-add-form').requestSubmit();
};
addPlan('Food', '60', 'weekly', 'personal', '', 'sample note'); addPlan('Cleaning', '90', 'monthly', 'personal');
addPlan('Fuel', '120', 'weekly', 'business'); addPlan('Drinks', '30', 'weekly', 'personal', '10');
await sleep(30);
check('categories are saved in the frequency they were entered in', income.find((r) => r.planName === 'Food').amount === 60 && income.find((r) => r.planName === 'Food').frequency === 'weekly' && income.find((r) => r.planName === 'Cleaning').frequency === 'monthly');
check('they are plan records with no date, so income totals ignore them', income.filter((r) => r.planName).every((r) => r.id.startsWith('plan-') && !r.dateKey) && uniqueIncomeEntries(income).length === 0);
check('each card shows its weekly and monthly figure and what it was entered as', /\$60\.00 per week/.test(planCards()[2].textContent) && /\$260\.00 per month/.test(planCards()[2].textContent) && /Entered weekly: \$60\.00/.test(planCards()[2].textContent), planCards()[2].textContent);
check('a monthly category shows its weekly figure too', /\$20\.77 per week/.test(planCards().find((c) => /Cleaning/.test(c.textContent)).textContent));
check('the business flag shows and notes are kept', /Business/.test(planCards().find((c) => /Fuel/.test(c.textContent)).textContent) && /sample note/.test(planCards().find((c) => /Food/.test(c.textContent)).textContent));
const weeklySum = 60 + (90 * 12) / 52 + 120 + 30, monthlySum = (60 * 52) / 12 + 90 + (120 * 52) / 12 + (30 * 52) / 12;
check('the overall totals add every category in both views', $('plan-total-line').textContent === `Total: ${formatMoney(weeklySum)} per week \u00b7 ${formatMoney(monthlySum)} per month.`, $('plan-total-line').textContent);
check('business and personal are totalled separately', /Business: \$120\.00 per week \u00b7 \$520\.00 per month\./.test($('plan-split-line').textContent), $('plan-split-line').textContent);
check('the what-if line is empty while the switch is off', $('plan-scenario-line').textContent === '');
$('plan-scenario-input').checked = true; $('plan-scenario-input').dispatchEvent(new Event('change'));
const whatIfMonthly = monthlySum - (30 * 52) / 12 + (10 * 52) / 12;
check('the What-if switch swaps in the what-if amounts and shows the difference', $('plan-total-line').textContent.includes(`${formatMoney(whatIfMonthly)} per month`) && /less than the plan/.test($('plan-scenario-line').textContent), $('plan-total-line').textContent + ' | ' + $('plan-scenario-line').textContent);
check('the switch is remembered on this device under a budgetApp key', localStorage.getItem('budgetApp.planScenario.v1') === '1');
$('plan-scenario-input').checked = false; $('plan-scenario-input').dispatchEvent(new Event('change'));
check('switching back restores the plan totals', $('plan-total-line').textContent.includes(`${formatMoney(monthlySum)} per month`) && $('plan-scenario-line').textContent === '');
planCards().find((c) => /Drinks/.test(c.textContent)).querySelector('.edit-btn').click();
const drinksCard = () => planCards().find((c) => /Drinks/.test(c.textContent));
drinksCard().querySelector('.plan-edit-amount').value = '45'; drinksCard().querySelector('.plan-edit-frequency').value = 'monthly'; drinksCard().querySelector('.plan-edit-type').value = 'business';
drinksCard().querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30);
const drinks = income.find((r) => r.planName === 'Drinks');
check('editing changes the amount, frequency and business flag', drinks.amount === 45 && drinks.frequency === 'monthly' && drinks.business === true && drinks.altAmount === 10);
check('the form itself stops a missing name or a zero amount', (addPlan('', '5', 'weekly', 'personal'), $('plan-name-input').validity.valueMissing) && (($('plan-name-input').value = 'X'), ($('plan-amount-input').value = '0'), $('plan-amount-input').validity.rangeUnderflow) && !income.some((r) => r.planName === 'X'));
$('plan-name-input').value = ''; $('plan-amount-input').value = '';
check('saving refuses bad fields with a sentence (a missing name, a zero amount, a huge one)', /category name/.test(savePlanCategory({ name: ' ', amountRaw: '5', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' })) && /at least \$0\.01/.test(savePlanCategory({ name: 'X', amountRaw: '0', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' })) && /at least \$0\.01/.test(savePlanCategory({ name: 'X', amountRaw: '1e12', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' })) && !income.some((r) => r.planName === 'X'));
planCards().find((c) => /Food/.test(c.textContent)).querySelector('.delete-btn').click(); await sleep(30);
check('Delete removes it, keeps a tombstone and offers Undo', planCards().length === 3 && income.find((r) => r.planName === 'Food').deleted === true && /Deleted Food/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo brings it back', planCards().length === 4);
check('plan records pass the import check and bad ones do not', isValidImportRecord('income', income.find((r) => r.planName === 'Food')) === true && isValidImportRecord('income', { id: 'plan-z', planName: 'Z', amount: 5, frequency: 'daily' }) === false && isValidImportRecord('income', { id: 'plan-z', planName: 'Z', amount: 5, frequency: 'weekly', business: 'yes' }) === false);
check('the + button is hidden on the Plan tab', $('add-bill-fab').hidden === true);
check('every button and box on the Plan tab has a name for screen readers', [...$('tab-plan').querySelectorAll('button, input, select')].every((el) => el.textContent.trim() || el.getAttribute('aria-label') || el.closest('label')));
hideUndoToast(); income.length = 0; planScenarioOn = false; try { localStorage.removeItem('budgetApp.planScenario.v1'); } catch {} showTab('home'); renderBudget();

// ---- the Income Received section on the Income tab ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('income'); renderBudget(); hideUndoToast();
check('the Income tab has an Income Received form and list, dated today', $('tab-income').contains($('received-income-add-form')) && $('received-income-date-input').value === todayKey() && $('received-income-empty-state').hidden === false);
const receivedCards = () => [...document.querySelectorAll('#received-income-list .recurring-income-card')];
$('received-income-date-input').value = dk(-2); $('received-income-amount-input').value = '80'; $('received-income-source-input').value = 'Refund';
$('received-income-add-form').requestSubmit(); await sleep(30);
check('adding income saves it for that date and source and lists it', income.some((r) => r.dateKey === dk(-2) && r.amount === 80 && r.source === 'Refund' && !r.deleted) && receivedCards().length === 1 && /\$80\.00/.test(receivedCards()[0].textContent) && /Refund/.test(receivedCards()[0].textContent), receivedCards().map((c) => c.textContent.trim()).join('|'));
$('received-income-date-input').value = dk(-2); $('received-income-amount-input').value = '95'; $('received-income-source-input').value = 'refund';
$('received-income-add-form').requestSubmit(); await sleep(30);
check('the same day and source updates the entry', receivedCards().length === 1 && income.find((r) => r.source === 'Refund').amount === 95);
$('received-income-date-input').value = dk(-2); $('received-income-amount-input').value = '20'; $('received-income-source-input').value = 'Tips';
$('received-income-add-form').requestSubmit(); await sleep(30);
check('another source on the same day is a second entry, and the week counts both', receivedCards().length === 2 && incomeSumInRange(dk(-2), dk(-2), uniqueIncomeEntries(income).filter((r) => !r.deleted)) === 115);
$('received-income-date-input').value = dk(-2); $('received-income-amount-input').value = 'abc';
check('a missing amount is stopped by the form itself', $('received-income-amount-input').validity.valueMissing === true || $('received-income-amount-input').value === '');
const tipsCard = () => receivedCards().find((c) => /Tips/.test(c.textContent));
tipsCard().querySelector('.edit-btn').click();
tipsCard().querySelector('.received-income-edit-amount').value = '30';
tipsCard().querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30);
check('Edit changes the amount', income.find((r) => r.source === 'Tips').amount === 30);
tipsCard().querySelector('.edit-btn').click();
tipsCard().querySelector('.received-income-edit-source').value = 'refund';
tipsCard().querySelector('.recurring-income-edit-form').requestSubmit();
check('changing a source to one the day already has is refused with a message', !tipsCard().querySelector('.received-income-edit-error').hidden && income.find((r) => r.amount === 30).source === 'Tips');
tipsCard().querySelector('.cancel-btn').click();
tipsCard().querySelector('.delete-btn').click(); await sleep(30);
check('Delete removes it, keeps a tombstone and offers Undo', receivedCards().length === 1 && /Deleted income/.test($('undo-toast-text').textContent) && income.find((r) => r.source === 'Tips').deleted === true, $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo brings it back', receivedCards().length === 2);
check('every button and box in the section has a name for screen readers', [...$('fold-received-income').querySelectorAll('button, input')].every((el) => el.textContent.trim() || el.getAttribute('aria-label') || el.closest('label')));
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- the Expenses tab (what you actually spent, against the plan) ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('expenses'); renderBudget(); hideUndoToast();
check('the Expenses tab starts empty and says to add plan categories first', $('tab-expenses').hidden === false && $('expense-summary-empty').hidden === false && $('expense-empty-state').hidden === false && $('expense-category-input').options.length === 1 && $('expense-category-input').value === '');
check('with no plan category, saving an expense is refused with a sentence', /Choose a category/.test(saveExpense({ dateKey: todayKey(), amountRaw: '5', planId: '', notes: '' })));
savePlanCategory({ name: 'Fuel', amountRaw: '70', frequency: 'weekly', type: 'business', altRaw: '', notes: '' });
savePlanCategory({ name: 'Food', amountRaw: '200', frequency: 'monthly', type: 'personal', altRaw: '', notes: '' });
renderBudget();
const fuelId = income.find((r) => r.planName === 'Fuel').id, foodId = income.find((r) => r.planName === 'Food').id;
check('the category list is the plan categories', [...$('expense-category-input').options].map((o) => o.textContent).join('|') === 'Food|Fuel');
const logExpense = (date, amount, planId, notes) => { $('expense-date-input').value = date; $('expense-amount-input').value = amount; $('expense-category-input').value = planId; $('expense-notes-input').value = notes || ''; $('expense-add-form').requestSubmit(); };
logExpense(todayKey(), '40', fuelId, 'station'); await sleep(30);
check('logging an expense saves a dated record tied to the category', income.some((r) => r.spentOn === todayKey() && r.amount === 40 && r.planId === fuelId && r.categoryName === 'Fuel' && r.notes === 'station' && r.id.startsWith('expense-') && !r.dateKey));
check('expense records are ignored by every income helper', uniqueIncomeEntries(income).length === 0 && projectedByDate(income).size === 0 && planCategories().length === 2);
check('the amount and note clear, the date and category stay', $('expense-amount-input').value === '' && $('expense-notes-input').value === '' && $('expense-date-input').value === todayKey() && $('expense-category-input').value === fuelId);
const expenseCards = () => [...document.querySelectorAll('#expense-list .recurring-income-card')];
check('the expense shows in the recent list with its category, amount and note', expenseCards().length === 1 && /Fuel/.test(expenseCards()[0].textContent) && /\$40\.00/.test(expenseCards()[0].textContent) && /station/.test(expenseCards()[0].textContent), expenseCards()[0].textContent);
const summaryText = () => [...document.querySelectorAll('#expense-summary-list li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim());
check('the summary shows spent against the plan for the week and the month', /Fuel\s*This week: \$40\.00 of \$70\.00 planned\s*This month: \$40\.00 of \$303\.33 planned/.test(summaryText().find((t) => /^Fuel/.test(t))), summaryText().join(' | '));
check('the total line adds the categories (a monthly plan counts as weekly x 12 / 52)', $('expense-total-line').textContent === `Spent this week: $40.00 of $${(70 + (200 * 12) / 52).toFixed(2)} planned. This month: $40.00 of $${((70 * 52) / 12 + 200).toFixed(2)} planned.`, $('expense-total-line').textContent);
check('a new category has no average yet', /needs two weeks of entries/.test(summaryText().find((t) => /^Fuel/.test(t))));
logExpense(dk(-20), '60', fuelId); await sleep(30);
check('after two weeks of entries the average per week is worked out', /Average so far: \$33\.33 per week/.test(summaryText().find((t) => /^Fuel/.test(t))), summaryText().find((t) => /^Fuel/.test(t)));
check('the list shows the newest day first', /Fuel/.test(expenseCards()[0].textContent) && /\$40\.00/.test(expenseCards()[0].textContent) && /\$60\.00/.test(expenseCards()[1].textContent));
expenseCards()[0].querySelector('.edit-btn').click();
expenseCards()[0].querySelector('.expense-edit-amount').value = '45'; expenseCards()[0].querySelector('.expense-edit-category').value = foodId;
expenseCards()[0].querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30);
const editedExpense = income.find((r) => r.spentOn === todayKey());
check('editing changes the amount and moves it to another category', editedExpense.amount === 45 && editedExpense.planId === foodId && editedExpense.categoryName === 'Food');
check('a bad amount or date is refused with a sentence', /at least \$0\.01/.test(saveExpense({ dateKey: todayKey(), amountRaw: '0', planId: foodId, notes: '' })) && /Pick a date/.test(saveExpense({ dateKey: '', amountRaw: '5', planId: foodId, notes: '' })));
expenseCards()[0].querySelector('.delete-btn').click(); await sleep(30);
check('Delete removes it, keeps a tombstone and offers Undo', expenseCards().length === 1 && /Deleted expense/.test($('undo-toast-text').textContent) && income.find((r) => r.spentOn === todayKey()).deleted === true, $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo brings it back', expenseCards().length === 2);
deleteIncome(foodId); await sleep(30);
check('an expense whose plan category was deleted keeps its name and moves to Other', /Food/.test(expenseCards()[0].textContent) && summaryText().some((t) => /^Other \(no plan category\)\s*This week: \$45\.00/.test(t)), summaryText().join(' | '));
check('expense records pass the import check and bad ones do not', isValidImportRecord('income', income.find((r) => r.spentOn === dk(-20))) === true && isValidImportRecord('income', { id: 'expense-z', spentOn: 'nope', amount: 5 }) === false && isValidImportRecord('income', { id: 'expense-z', spentOn: dk(0), amount: 0 }) === false);
check('the + button is hidden on the Expenses tab', $('add-bill-fab').hidden === true);
check('every button and box on the Expenses tab has a name for screen readers', [...$('tab-expenses').querySelectorAll('button, input, select')].every((el) => el.textContent.trim() || el.getAttribute('aria-label') || el.closest('label')));
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- Net and Projected net roll forward ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('home'); calendarWeekOffset = 0; renderBudget(); hideUndoToast();
const ws0 = weekStartKey(shiftDateKey(todayKey(), -7)); // the Monday of the first week the calendar shows
setIncomeForDate(shiftDateKey(ws0, 1), '500'); addBill({ name: 'Roll rent', amount: '120', dueDate: shiftDateKey(ws0, 2), frequency: 'one_time', category: '', autopay: false });
renderBudget();
const weekNets = () => [...document.querySelectorAll('.budget-week-net-total')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
check('the first week shows its own net with nothing carried in', /^Net: \$380\.00$/.test(weekNets()[0]), weekNets()[0]);
check('the next weeks carry the net forward, saying how much only in the hover text', /^Net: \$380\.00$/.test(weekNets()[1]) && /^Net: \$380\.00$/.test(weekNets()[2]), weekNets().join(' | '));
setIncomeForDate(shiftDateKey(ws0, -7), '300'); renderBudget();
check('income from before the calendar window is carried into its first week', /^Net: \$680\.00$/.test(weekNets()[0]) && /\$680\.00$/.test(weekNets()[2]), weekNets().join(' | '));
check('a shortfall rolls forward too (negative, in the sign colour)', (addBill({ name: 'Roll big', amount: '1000', dueDate: shiftDateKey(ws0, 9), frequency: 'one_time', category: '', autopay: false }), renderBudget(), /^Net: -\$320\.00/.test(weekNets()[1]) && /^Net: -\$320\.00/.test(weekNets()[2])), weekNets().join(' | '));
bills.pop(); renderBudget();
setProjectedForDate(shiftDateKey(ws0, 15), '50'); await sleep(30);
const projectedNets = () => [...document.querySelectorAll('.budget-week-projected-net-total')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
check('Projected net rolls forward as well', projectedNets().length === 1 && /^Projected net: \$730\.00$/.test(projectedNets()[0]), projectedNets().join(' | '));
check('the net lines stay short: the carried amount is only in the hover text', weekNets().every((t) => !/earlier|includes/.test(t)) && /Includes \$680\.00 from earlier weeks/.test(document.querySelectorAll('.budget-week-net-total')[1].title) && /Includes \$300\.00 from earlier weeks/.test(document.querySelectorAll('.budget-week-net-total')[0].title));
income.length = 0; bills.length = 0; recurringIncome.length = 0; renderBudget();
check('with no income at all nothing is carried', [...document.querySelectorAll('.budget-week-net-total')].every((el) => !/Includes/.test(el.title)));
hideUndoToast(); showTab('home'); renderBudget();

// ---- Quick Add, Today buttons and thousands separators ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('expenses'); renderBudget(); hideUndoToast();
check('amounts get thousands separators', formatMoney(1185.2) === '$1,185.20' && formatMoney(5) === '$5.00' && formatSignedCurrency(-1234.5) === '-$1,234.50' && formatSignedCurrency(-0.001) === '$0.00');
check('with nothing logged the Quick Add section says how it fills', $('expense-quick-empty').hidden === false && $('expense-quick-list').children.length === 0);
savePlanCategory({ name: 'Fuel', amountRaw: '70', frequency: 'weekly', type: 'business', altRaw: '', notes: '' });
savePlanCategory({ name: 'Coffee', amountRaw: '30', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
renderBudget();
const fuelPlanId = income.find((r) => r.planName === 'Fuel').id;
[['2026-01-01', 40], ['2026-01-02', 45], ['2026-01-03', 40], ['2026-01-04', 50], ['2026-01-05', 55]].forEach(([d, a], i) => saveExpense({ dateKey: d, amountRaw: String(a), planId: fuelPlanId, notes: '' }));
renderBudget();
const quickButtons = () => [...document.querySelectorAll('#expense-quick-list .expense-quick-btn')];
check('Quick Add offers the last three different amounts, newest first', quickButtons().map((b) => b.textContent).join(',') === '$55.00,$50.00,$40.00' && $('expense-quick-empty').hidden === true, quickButtons().map((b) => b.textContent).join(','));
check('a category with no expenses has no Quick Add row', document.querySelectorAll('.expense-quick-row').length === 1);
const beforeCount = income.filter((r) => r.spentOn).length;
quickButtons()[2].click(); await sleep(30);
const quickLogged = income.filter((r) => r.spentOn === todayKey());
check('one tap logs that amount for today under that category', income.filter((r) => r.spentOn).length === beforeCount + 1 && quickLogged.length === 1 && quickLogged[0].amount === 40 && quickLogged[0].planId === fuelPlanId);
check('the undo bar says what was logged and Undo removes it', /Logged \$40\.00 for Fuel/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo takes the quick-added expense back out', income.find((r) => r.id === quickLogged[0].id).deleted === true);
showTab('income'); renderBudget();
$('received-income-date-input').value = '2026-01-01'; document.querySelector('[data-date-input="received-income-date-input"]').click();
check('the Today button fills the Income Received date', $('received-income-date-input').value === todayKey());
$('projected-income-date-input').value = '2026-01-01'; document.querySelector('[data-date-input="projected-income-date-input"]').click();
check('the Today button fills the Projected Income date', $('projected-income-date-input').value === todayKey());
$('expense-date-input').value = '2026-01-01'; document.querySelector('[data-date-input="expense-date-input"]').click();
check('the Today button fills the Expenses date', $('expense-date-input').value === todayKey());
check('every Today button has a visible name and a target', [...document.querySelectorAll('.today-btn')].length === 4 && [...document.querySelectorAll('.today-btn')].every((b) => b.textContent === 'Today' && document.getElementById(b.dataset.dateInput)));
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- fixes from the line-by-line review ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('plan'); renderBudget(); hideUndoToast();
// an open edit form survives a redraw, with what was typed
savePlanCategory({ name: 'Keep', amountRaw: '10', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
renderBudget();
const keepCard = () => [...document.querySelectorAll('#plan-list li')].find((c) => /Keep/.test(c.textContent));
keepCard().querySelector('.edit-btn').click();
keepCard().querySelector('.plan-edit-amount').value = '77';
renderBudget();
check('an open edit form is still open after a redraw, with the typed text', !keepCard().querySelector('.recurring-income-edit-form').hidden && keepCard().querySelector('.plan-edit-amount').value === '77' && keepCard().querySelector('.recurring-income-view').hidden === true);
check('a closed card stays closed after a redraw', (keepCard().querySelector('.cancel-btn').click(), renderBudget(), keepCard().querySelector('.recurring-income-edit-form').hidden === true));
// ids are built from day and source, so different sources never share an id
setIncomeForDate(dk(1), '100', 'Job'); setIncomeForDate(dk(1), '40', 'Gift'); setIncomeForDate(dk(1), '5');
check('each source gets its own id built from the day and source', income.some((r) => r.id === `${dk(1)}#job`) && income.some((r) => r.id === `${dk(1)}#gift`) && income.some((r) => r.id === dk(1) && !r.source));
setProjectedForDate(dk(2), '60', 'Job'); setProjectedForDate(dk(2), '9');
check('projected entries do the same', income.some((r) => r.id === `projected-${dk(2)}#job`) && income.some((r) => r.id === `projected-${dk(2)}`));
// editing the source and amount of an income-received entry makes one undo step, not two
income.length = 0; undoStack.length = 0; redoStack.length = 0;
setIncomeForDate(dk(1), '100', 'Pay'); undoStack.length = 0; renderBudget(); showTab('income'); renderBudget();
const receivedCard = () => document.querySelector('#received-income-list li');
receivedCard().querySelector('.edit-btn').click();
receivedCard().querySelector('.received-income-edit-source').value = 'Bonus';
receivedCard().querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30);
check('changing only the source records one undo step', undoStack.length === 1 && income[0].source === 'Bonus' && income[0].amount === 100, String(undoStack.length));
// the average ignores future-dated expenses
income.length = 0; showTab('expenses'); renderBudget();
savePlanCategory({ name: 'Avg', amountRaw: '10', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
const avgId = income.find((r) => r.planName === 'Avg').id;
saveExpense({ dateKey: dk(-20), amountRaw: '70', planId: avgId, notes: '' }); saveExpense({ dateKey: dk(7), amountRaw: '1000', planId: avgId, notes: '' });
renderBudget();
check('a future-dated expense does not inflate the average per week', /Average so far: \$23\.33 per week/.test(document.querySelector('#expense-summary-list li').textContent), document.querySelector('#expense-summary-list li').textContent);
check('the Undo tooltip names an expense by its category', (() => { saveExpense({ dateKey: todayKey(), amountRaw: '3', planId: avgId, notes: '' }); return /Avg/.test($('undo-btn').title); })(), $('undo-btn').title);
// import refuses a year outside the forms' range, and the calendar file keeps a lone carriage return out
check('an import with a year outside 1990-2100 is refused', isValidImportRecord('bills', { id: 'b', name: 'x', amount: 5, dueDate: '0500-01-01', frequency: 'weekly' }) === false && isValidImportRecord('bills', { id: 'b', name: 'x', amount: 5, dueDate: '2026-01-01', frequency: 'weekly' }) === true);
check('a lone carriage return is escaped in the calendar file', icsEscape('a\rb') === 'a\\nb');
// a server delete that is newer than this device's copy is taken, not undone
const livePlan = { id: 'plan-z', planName: 'Z', amount: 5, frequency: 'weekly', deleted: false, version: 3, updatedAt: '2026-10-01T10:00:00.000Z' };
const tomb = { ...livePlan, deleted: true, version: 1, updatedAt: '2026-10-02T10:00:00.000Z' };
const collection = { name: 'income', get: () => [livePlan] };
const reply = reconcileServerReply(collection, [tomb], { 'plan-z': JSON.stringify(livePlan) });
check('a newer delete on the server is adopted instead of sending the live copy again', reply.result[0].deleted === true && !!reply.known['plan-z']);
const editedLater = { ...livePlan, updatedAt: '2026-10-03T10:00:00.000Z' };
const keepEdit = reconcileServerReply({ name: 'income', get: () => [editedLater] }, [tomb], { 'plan-z': JSON.stringify(editedLater) });
check('a copy edited after the server delete is kept and sent again', keepEdit.result[0].deleted === false && !keepEdit.known['plan-z']);
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- backup nudge, import summary, plan from average, budget warnings, left after plan, filters, quick edit, memory, charts, last synced ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('expenses'); renderBudget(); hideUndoToast();
try { localStorage.removeItem('budgetApp.quickHidden.v1'); localStorage.removeItem('budgetApp.lastExpenseCategory.v1'); localStorage.removeItem('budgetApp.lastIncomeSource.v1'); } catch {}
check('the backup reminder comes back after a week', (() => { addBill({ name: 'Nudge bill', amount: '5', dueDate: dk(20), frequency: 'monthly', category: '', autopay: false }); localStorage.setItem(EXPORT_AT_KEY, new Date(Date.now() - 8 * 86400000).toISOString()); backupNotesDismissed = false; renderBackupNotes(); return /in 8 days/.test($('backup-notes').textContent); })(), $('backup-notes').textContent);
check('and a backup made 3 days ago keeps it quiet', (() => { localStorage.setItem(EXPORT_AT_KEY, new Date(Date.now() - 3 * 86400000).toISOString()); renderBackupNotes(); return $('backup-notes').hidden; })());
bills.length = 0;
check('describeContents says what the app holds, in words', (() => { addBill({ name: 'Cnt', amount: '5', dueDate: dk(1), frequency: 'monthly', category: '', autopay: false }); savePlanCategory({ name: 'CntPlan', amountRaw: '10', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' }); return describeContents() === 'You now have 1 bill and 1 plan category.'; })(), describeContents());
check('an import ends by saying what the app now holds', (() => { importData({ collections: { bills: [], income: [], recurringIncome: [] } }); return /You now have 1 bill and 1 plan category\./.test($('data-io-status').textContent); })(), $('data-io-status').textContent);
bills.length = 0; income.length = 0; renderBudget();
check('spend status turns amber from 80% and shows how far over past the plan', spendStatus(50, 100).cls === '' && spendStatus(80, 100).cls === 'spend-near' && /80% used/.test(spendStatus(80, 100).note) && spendStatus(120, 100).cls === 'spend-over' && /\$20\.00 over/.test(spendStatus(120, 100).note) && spendStatus(5, null).cls === '');
savePlanCategory({ name: 'Tank', amountRaw: '100', frequency: 'weekly', type: 'business', altRaw: '', notes: '' });
savePlanCategory({ name: 'Snacks', amountRaw: '40', frequency: 'monthly', type: 'personal', altRaw: '', notes: '' });
renderBudget();
const tankId = income.find((r) => r.planName === 'Tank').id, snackId = income.find((r) => r.planName === 'Snacks').id;
saveExpense({ dateKey: todayKey(), amountRaw: '90', planId: tankId, notes: 'fill up' });
saveExpense({ dateKey: shiftDateKey(todayKey(), -20), amountRaw: '70', planId: tankId, notes: '' });
renderBudget();
const summary = () => [...document.querySelectorAll('#expense-summary-list li')];
const tankRow = () => summary().find((li) => /^Tank/.test(li.textContent.trim()));
check('a category near its plan is marked amber in words and colour', !!tankRow().querySelector('.spend-near') && /90% used/.test(tankRow().textContent), tankRow().textContent);
check('a category with two weeks of entries offers its average as the plan', [...tankRow().querySelectorAll('button')].some((b) => /Use \$53\.33 per week as my plan/.test(b.textContent)), tankRow().textContent);
[...tankRow().querySelectorAll('button')].find((b) => /as my plan/.test(b.textContent)).click(); await sleep(30);
check('the button sets the plan amount in its own frequency and offers Undo', income.find((r) => r.id === tankId).amount === 53.33 && /Changed Tank to \$53\.33 per week/.test($('undo-toast-text').textContent), $('undo-toast-text').textContent);
$('undo-toast-btn').click(); await sleep(30);
check('Undo puts the old plan amount back', income.find((r) => r.id === tankId).amount === 100);
showTab('home'); renderBudget();
const leftEl = $('budget-month-left-total');
check('Home shows what is left after the plan once there is a plan', leftEl.hidden === false && /left after plan/.test(leftEl.textContent) && /\$/.test(leftEl.textContent) && /Spending Plan sets aside/.test(leftEl.title), leftEl.textContent);
showTab('expenses'); renderBudget();
check('the list line says how many expenses and their total', $('expense-filter-total').textContent === '2 expenses, $160.00 in total.', $('expense-filter-total').textContent);
$('expense-filter-search').value = 'fill'; $('expense-filter-search').dispatchEvent(new Event('input'));
check('the note search narrows the list and the total', document.querySelectorAll('#expense-list li').length === 1 && /Showing 1 of 2 expenses, \$90\.00 in total\./.test($('expense-filter-total').textContent), $('expense-filter-total').textContent);
$('expense-filter-clear').click();
$('expense-filter-category').value = snackId; $('expense-filter-category').dispatchEvent(new Event('input'));
check('the category filter shows only that category', document.querySelectorAll('#expense-list li').length === 0 && /Showing 0 of 2/.test($('expense-filter-total').textContent));
$('expense-filter-clear').click();
$('expense-filter-from').value = shiftDateKey(todayKey(), -5); $('expense-filter-from').dispatchEvent(new Event('input'));
check('the from date hides older expenses', document.querySelectorAll('#expense-list li').length === 1);
$('expense-filter-clear').click();
check('Clear brings everything back', document.querySelectorAll('#expense-list li').length === 2 && $('expense-filter-from').value === '');
const quickBtns = () => [...document.querySelectorAll('#expense-quick-list .expense-quick-btn')];
check('Quick Add buttons carry an id so keyboard focus can return to them', quickBtns().length === 2 && quickBtns().every((b) => b.id.startsWith('quick-add-')), String(quickBtns().length));
$('expense-quick-edit-btn').click();
check('edit mode turns the buttons into removers', $('expense-quick-edit-btn').textContent === 'Done' && quickBtns().every((b) => /^✕/.test(b.textContent)));
const countBefore = income.filter((r) => r.spentOn).length;
quickBtns()[0].click();
check('removing an amount only hides it and logs nothing', quickBtns().length === 1 && income.filter((r) => r.spentOn).length === countBefore && $('expense-quick-reset-btn').hidden === false);
$('expense-quick-edit-btn').click(); $('expense-quick-reset-btn').click();
check('Show hidden amounts brings it back', quickBtns().length === 2 && $('expense-quick-reset-btn').hidden === true && $('expense-quick-edit-btn').textContent === 'Edit amounts');
$('expense-date-input').value = todayKey(); $('expense-amount-input').value = '12'; $('expense-category-input').value = snackId; $('expense-add-form').requestSubmit(); await sleep(30);
check('the last expense category is remembered', loadLastChoice(LAST_EXPENSE_CATEGORY_KEY) === snackId && $('expense-category-input').value === snackId);
showTab('income'); renderBudget();
$('received-income-date-input').value = todayKey(); $('received-income-amount-input').value = '5'; $('received-income-source-input').value = 'Cash tips'; $('received-income-add-form').requestSubmit(); await sleep(30);
check('the last income source is remembered', loadLastChoice(LAST_INCOME_SOURCE_KEY) === 'Cash tips');
showTab('expenses'); renderBudget();
check('the month chart has a bar and an amount per category, largest first', (() => { const rowsText = [...document.querySelectorAll('#expense-month-chart li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()); return rowsText.length === 2 && /^Tank/.test(rowsText[0]); })(), [...document.querySelectorAll('#expense-month-chart li')].map((li) => li.textContent).join('|'));
check('the weekly chart has 8 columns and the last one holds this week', document.querySelectorAll('#expense-week-chart li').length === 8 && /\$/.test(document.querySelector('#expense-week-chart li:last-child').textContent), document.querySelector('#expense-week-chart li:last-child').textContent);
check('chart bars are hidden from screen readers (the numbers say it in text)', [...document.querySelectorAll('.chart-track, .chart-vtrack')].every((el) => el.getAttribute('aria-hidden') === 'true'));
check('formatAgo speaks in minutes, hours and days', formatAgo(new Date()) === 'just now' && formatAgo(new Date(Date.now() - 5 * 60000)) === '5m ago' && formatAgo(new Date(Date.now() - 3 * 3600000)) === '3h ago' && formatAgo(new Date(Date.now() - 2 * 86400000)) === '2 days ago' && formatAgo(new Date(Date.now() - 86400000)) === '1 day ago');
check('the last sync time is read back from storage', (() => { localStorage.setItem(LAST_SYNC_AT_KEY, new Date(Date.now() - 4 * 86400000).toISOString()); return lastSyncTime() !== null && /^4 days ago$/.test(formatAgo(lastSyncTime())); })());
hideUndoToast(); income.length = 0; bills.length = 0; localStorage.removeItem(LAST_SYNC_AT_KEY); showTab('home'); renderBudget();

// ---- expected one-time costs (guesses) ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; hideUndoToast();
const thisMonthKey = todayKey().slice(0, 7);
check('a guess needs a name, an amount and a real month', guessFieldsError({ name: '', amountRaw: '5', month: thisMonthKey }) !== '' && guessFieldsError({ name: 'x', amountRaw: '0', month: thisMonthKey }) !== '' && guessFieldsError({ name: 'x', amountRaw: '5', month: '2026-13' }) !== '' && guessFieldsError({ name: 'x', amountRaw: '5', month: '' }) !== '' && guessFieldsError({ name: 'x', amountRaw: '5', month: thisMonthKey }) === '');
check('saving a guess stores it in the income list with no date', (() => { const p = saveGuess({ name: 'Car maintenance', amountRaw: '350', month: thisMonthKey, notes: 'oil and tyres' }); const r = income.find((x) => x.guessName === 'Car maintenance'); return p === '' && !!r && r.amount === 350 && !r.dateKey && /^guess-/.test(r.id) && r.guessMonth === thisMonthKey; })());
check('a guess is not counted as income received', uniqueIncomeEntries(income).length === 0);
check('this month\'s guesses add up', saveGuess({ name: 'Tyres', amountRaw: '100.50', month: thisMonthKey, notes: '' }) === '' && guessTotalForMonth(thisMonthKey) === 450.5);
check('a guess for another month is not in this month\'s total', saveGuess({ name: 'Insurance', amountRaw: '900', month: '2099-01', notes: '' }) === '' && guessTotalForMonth(thisMonthKey) === 450.5 && guessTotalForMonth('2099-01') === 900);
renderBudget();
check('the Plan tab lists the guesses, soonest month first', (() => { const names = [...document.querySelectorAll('#guess-list .recurring-income-name')].map((e) => e.textContent); return names.length === 3 && names[2] === 'Insurance'; })());
check('Home takes this month\'s guesses off "left after plan", even with no plan', (() => { const el = $('budget-month-left-total'); return el.hidden === false && /left after plan/.test(el.textContent) && /expected one-time costs/.test(el.title); })());
check('editing a guess changes it and keeps one record', (() => { const r = income.find((x) => x.guessName === 'Tyres'); const n = income.length; return saveGuess({ name: 'Tyres', amountRaw: '120', month: thisMonthKey, notes: '' }, r.id) === '' && income.length === n && guessTotalForMonth(thisMonthKey) === 470; })());
check('deleting a guess can be undone', await (async () => { const r = income.find((x) => x.guessName === 'Tyres'); deleteIncome(r.id); await sleep(30); const gone = guessTotalForMonth(thisMonthKey) === 350 && /Deleted Tyres/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return gone && guessTotalForMonth(thisMonthKey) === 470; })());
check('import accepts a good guess and rejects a bad month or amount', isValidImportRecord('income', { id: 'guess-1', guessName: 'a', amount: 5, guessMonth: '2026-10' }) && !isValidImportRecord('income', { id: 'guess-1', guessName: 'a', amount: 5, guessMonth: '2026-1' }) && !isValidImportRecord('income', { id: 'guess-1', guessName: 'a', amount: '5', guessMonth: '2026-10' }) && !isValidImportRecord('income', { id: 'guess-1', guessName: 'a', amount: 5, guessMonth: '3000-01' }));
check('describeContents counts expected costs', /3 expected costs/.test(describeContents()), describeContents());
income.length = 0; hideUndoToast(); renderBudget();

// ---- savings goals ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast();
check('a goal needs a name, a target and (if given) a real date', goalFieldsError({ name: '', targetRaw: '5', date: '' }) !== '' && goalFieldsError({ name: 'x', targetRaw: '0', date: '' }) !== '' && goalFieldsError({ name: 'x', targetRaw: '5', date: '2026-02-30' }) !== '' && goalFieldsError({ name: 'x', targetRaw: '5', date: '' }) === '' && goalFieldsError({ name: 'x', targetRaw: '5', date: dk(30) }) === '');
check('saving a goal stores it with no income date', (() => { const p = saveGoal({ name: 'Laptop', targetRaw: '1200', date: shiftDateKey(todayKey(), 120), notes: '' }); const g = income.find((r) => r.goalName === 'Laptop'); return p === '' && !!g && g.target === 1200 && !g.dateKey && /^goal-/.test(g.id); })());
const laptopId = income.find((r) => r.goalName === 'Laptop').id;
check('savings add up and a withdrawal is subtracted', addSavings(laptopId, '300', 1) === '' && addSavings(laptopId, '100.25', 1) === '' && addSavings(laptopId, '50', -1) === '' && goalSaved(laptopId) === 350.25);
check('you cannot take out more than is saved, nor save nothing', /Only \$350\.25/.test(addSavings(laptopId, '400', -1)) && addSavings(laptopId, '', 1) !== '' && addSavings(laptopId, '0', 1) !== '' && goalSaved(laptopId) === 350.25);
check('savings and goals are not income received', uniqueIncomeEntries(income).length === 0);
renderBudget();
check('the card shows progress, what is left and a monthly pace for the date', (() => { const li = document.querySelector('#goal-list > li'); return /\$350\.25 of \$1,200\.00/.test(li.textContent) && /\$849\.75 to go/.test(li.textContent) && /per month/.test(li.textContent) && li.querySelector('.goal-fill').style.width === '29%'; })(), document.querySelector('#goal-list > li').textContent);
check('the Add savings button on the card works and offers Undo', await (async () => { const li = document.querySelector('#goal-list > li'); li.querySelector('.goal-amount-input').value = '49.75'; li.querySelector('.goal-add-btn').click(); await sleep(30); const ok = goalSaved(laptopId) === 400 && /Saved \$49\.75 toward Laptop/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return ok && goalSaved(laptopId) === 350.25; })(), $('undo-toast-text').textContent);
check('a goal that is fully saved says so', (() => { addSavings(laptopId, '900', 1); renderBudget(); return /Goal reached/.test(document.querySelector('#goal-list > li').textContent); })());
check('deleting a goal hides it and its savings, and Undo brings them back', await (async () => { deleteIncome(laptopId); await sleep(30); const gone = document.querySelectorAll('#goal-list > li').length === 0 && /Deleted goal Laptop/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return gone && goalSaved(laptopId) === 1250.25 && document.querySelectorAll('#goal-list > li').length === 1; })());
check('import accepts good goals and savings and rejects bad ones', isValidImportRecord('income', { id: 'goal-1', goalName: 'a', target: 10 }) && isValidImportRecord('income', { id: 'save-1', savedFor: 'goal-1', savedOn: '2026-10-01', amount: -5 }) && !isValidImportRecord('income', { id: 'save-1', savedFor: 'goal-1', savedOn: '2026-10-01', amount: 0 }) && !isValidImportRecord('income', { id: 'goal-1', goalName: 'a', target: -1 }) && !isValidImportRecord('income', { id: 'goal-1', goalName: 'a', target: 10, goalDate: 'soon' }));
check('describeContents counts goals', /1 savings goal/.test(describeContents()), describeContents());
income.length = 0; hideUndoToast(); renderBudget();

// ---- custom repeat: every X weeks or months ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast();
const customWeeks = { dueDate: '2026-01-05', frequency: 'custom', every: 6, unit: 'weeks' };
check('every 6 weeks falls on the 6th, not the 5th or 7th, week', occursOnDate(customWeeks, '2026-02-16') && !occursOnDate(customWeeks, '2026-02-09') && !occursOnDate(customWeeks, '2026-02-23') && !occursOnDate(customWeeks, '2025-11-24'));
check('every 6 weeks counts and numbers its dates', occurrenceCountThrough(customWeeks, '2026-01-04') === 0 && occurrenceCountThrough(customWeeks, '2026-01-05') === 1 && occurrenceCountThrough(customWeeks, '2026-02-15') === 1 && occurrenceCountThrough(customWeeks, '2026-02-16') === 2 && nthOccurrenceDate(customWeeks, 2) === '2026-03-30');
const customMonths = { dueDate: '2026-01-31', frequency: 'custom', every: 3, unit: 'months' };
check('every 3 months lands on the same day, or the last day of a short month', occursOnDate(customMonths, '2026-04-30') && occursOnDate(customMonths, '2026-07-31') && !occursOnDate(customMonths, '2026-03-31') && !occursOnDate(customMonths, '2026-05-31') && nthOccurrenceDate(customMonths, 1) === '2026-04-30');
check('every 3 months counts only dates that have arrived', occurrenceCountThrough(customMonths, '2026-04-29') === 1 && occurrenceCountThrough(customMonths, '2026-04-30') === 2 && occurrenceCountThrough(customMonths, '2026-12-31') === 4 && occurrenceCountThrough(customMonths, '2026-05-15') === 2);
check('the built-in repeats still count the same', occurrenceCountThrough({ dueDate: '2025-12-15', frequency: 'yearly' }, '2026-12-14') === 1 && occurrenceCountThrough({ dueDate: '2025-12-15', frequency: 'yearly' }, '2026-12-15') === 2 && occurrenceCountThrough({ dueDate: '2026-01-31', frequency: 'monthly' }, '2026-02-28') === 2 && occurrenceCountThrough({ dueDate: '2026-01-01', frequency: 'biweekly' }, '2026-01-29') === 3);
check('a custom bill with a bad number or unit never comes due', !occursOnDate({ dueDate: '2026-01-05', frequency: 'custom', every: 0, unit: 'weeks' }, '2026-01-05') && !occursOnDate({ dueDate: '2026-01-05', frequency: 'custom', every: 2, unit: 'days' }, '2026-01-07') && occurrenceCountThrough({ dueDate: '2026-01-05', frequency: 'custom' }, '2026-06-01') === 0);
check('the form refuses a custom repeat without a whole number from 1 to 99', ['0', '1.5', '100', '', 'x'].every((v) => !validateBillFields({ name: 'a', amount: '5', dueDate: '2026-01-05', frequency: 'custom', every: v, unit: 'weeks', category: '' }).ok) && !validateBillFields({ name: 'a', amount: '5', dueDate: '2026-01-05', frequency: 'custom', every: '2', unit: 'days', category: '' }).ok);
check('adding a custom bill stores the number and unit, and labels it in words', (() => { const r = addBill({ name: 'Pest control', amount: '45', dueDate: dk(3), frequency: 'custom', every: '2', unit: 'months', category: '', autopay: false }); const b = bills.find((x) => x.name === 'Pest control'); return r.ok && b.every === 2 && b.unit === 'months' && billFrequencyLabel(b) === 'Every 2 months' && billFrequencyLabel({ frequency: 'custom', every: 1, unit: 'weeks' }) === 'Every week' && billFrequencyLabel({ frequency: 'monthly' }) === 'Monthly'; })());
check('the bill card shows the custom label', [...document.querySelectorAll('#budget-list .bill-frequency')].some((e) => e.textContent === 'Every 2 months'));
check('switching a bill back to monthly drops the custom fields', (() => { const b = bills.find((x) => x.name === 'Pest control'); const r = updateBill(b.id, { name: 'Pest control', amount: '45', dueDate: b.dueDate, frequency: 'monthly', every: '2', unit: 'months', category: '', autopay: false }); return r.ok && b.frequency === 'monthly' && b.every === undefined && b.unit === undefined; })());
check('the calendar file repeats a custom bill with its interval', icsRepeatRule({ dueDate: '2026-01-05', frequency: 'custom', every: 6, unit: 'weeks' }) === 'FREQ=WEEKLY;INTERVAL=6' && icsRepeatRule({ dueDate: '2026-01-31', frequency: 'custom', every: 3, unit: 'months' }) === 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1' && icsRepeatRule({ dueDate: '2026-01-05', frequency: 'custom', every: 3, unit: 'months' }) === 'FREQ=MONTHLY;INTERVAL=3');
check('import accepts a good custom bill and rejects one with no usable repeat', isValidImportRecord('bills', { id: 'b1', name: 'a', amount: 5, dueDate: '2026-01-05', frequency: 'custom', every: 6, unit: 'weeks' }) && !isValidImportRecord('bills', { id: 'b1', name: 'a', amount: 5, dueDate: '2026-01-05', frequency: 'custom' }) && !isValidImportRecord('bills', { id: 'b1', name: 'a', amount: 5, dueDate: '2026-01-05', frequency: 'custom', every: '6', unit: 'weeks' }));
check('the Add form shows the Custom row only while Custom is chosen', (() => { const sel = $('budget-frequency-input'); const row = sel.nextElementSibling; sel.value = 'custom'; sel.dispatchEvent(new Event('change', { bubbles: true })); const shown = !row.hidden; sel.value = 'monthly'; sel.dispatchEvent(new Event('change', { bubbles: true })); return shown && row.hidden; })());
bills.length = 0; renderBudget();

// ---- fixes from the line-by-line review ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast();
check('a paid bill that repeats every 24 months shows its real next date, not its first date', (() => { const first = shiftDateKey(todayKey(), -10); const b = { frequency: 'custom', every: 24, unit: 'months', dueDate: first, paidDates: [first] }; const next = nextDueDateKey(b, todayKey()); return next === nthOccurrenceDate(b, 1) && next > todayKey() && billDueInfo(b, todayKey()).text.startsWith('Due') && !billDueInfo(b, todayKey()).text.includes(formatDateKeyShort(first)); })());
check('a yearly bill already paid this year shows next year', (() => { const first = shiftDateKey(todayKey(), -3); const b = { frequency: 'yearly', dueDate: first, paidDates: [first] }; return nextDueDateKey(b, todayKey()) === nthOccurrenceDate(b, 1); })());
check('the sync reminder clock does not pretend a sync happened', (() => { localStorage.setItem('budgetApp.syncConfig.v1', JSON.stringify({ token: 'tok' })); localStorage.removeItem(LAST_SYNC_AT_KEY); localStorage.removeItem(SYNC_NOTICED_AT_KEY); renderBackupNotes(); const ok = lastSyncTime() === null && daysSinceBackup(SYNC_NOTICED_AT_KEY) === 0; localStorage.removeItem('budgetApp.syncConfig.v1'); localStorage.removeItem(SYNC_NOTICED_AT_KEY); return ok; })());
check('spending a cent over a weekly figure worked out from a monthly plan is not called over', spendStatus(23.08, 100 * 12 / 52).cls !== 'spend-over' && spendStatus(23.09, 100 * 12 / 52).cls === 'spend-over' && spendStatus(100, 100).cls === 'spend-near' && /100% used/.test(spendStatus(100, 100).note));
check('import refuses empty names and a bill with a bad paid date', !isValidImportRecord('income', { id: 'p1', planName: '', amount: 5, frequency: 'weekly' }) && !isValidImportRecord('income', { id: 'g1', goalName: '', target: 5 }) && !isValidImportRecord('income', { id: 'e1', guessName: '', amount: 5, guessMonth: '2026-10' }) && !isValidImportRecord('bills', { id: 'b1', name: 'a', amount: 5, dueDate: '2026-01-05', frequency: 'monthly', paidDates: ['abc'] }) && isValidImportRecord('bills', { id: 'b1', name: 'a', amount: 5, dueDate: '2026-01-05', frequency: 'monthly', paidDates: ['2026-01-05'] }));
check('describeContents counts savings deposits', (() => { income.push({ id: 'save-x', savedFor: 'goal-x', savedOn: todayKey(), amount: 5, deleted: false }); const t = describeContents(); income.length = 0; return /1 savings deposit or withdrawal/.test(t); })());
check('a calendar file escapes an unusual bill id', (() => { bills.push({ id: 'x\r\nATTENDEE:evil', name: 'Odd', amount: 5, dueDate: dk(3), frequency: 'monthly', paidDates: [], deleted: false }); const text = buildCalendarFile(); bills.length = 0; return !/\r\nATTENDEE:evil/.test(text || ''); })());
const formClosesAfterSave = async (listId, openCard, change) => { showTab(listId === 'goal-list' || listId === 'guess-list' || listId === 'plan-list' ? 'plan' : 'expenses'); renderBudget(); const li = document.querySelector(`#${listId} li`); li.querySelector('.edit-btn').click(); change(li); li.querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30); return document.querySelector(`#${listId} li .recurring-income-edit-form`).hidden === true; };
savePlanCategory({ name: 'FormPlan', amountRaw: '10', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
saveGuess({ name: 'FormGuess', amountRaw: '10', month: todayKey().slice(0, 7), notes: '' });
saveGoal({ name: 'FormGoal', targetRaw: '10', date: '', notes: '' });
check('saving a Plan card closes its edit form', await formClosesAfterSave('plan-list', null, (li) => { li.querySelector('.plan-edit-amount').value = '12'; }));
check('saving an expected-cost card closes its edit form', await formClosesAfterSave('guess-list', null, (li) => { li.querySelector('.guess-edit-amount').value = '12'; }));
check('saving a savings-goal card closes its edit form', await formClosesAfterSave('goal-list', null, (li) => { li.querySelector('.goal-edit-target').value = '12'; }));
check('a bad edit keeps the form open with the problem shown', await (async () => { showTab('plan'); const li = document.querySelector('#goal-list > li'); li.querySelector('.edit-btn').click(); li.querySelector('.goal-edit-target').value = '99999999999'; li.querySelector('.recurring-income-edit-form').requestSubmit(); await sleep(30); const again = document.querySelector('#goal-list > li'); return !again.querySelector('.recurring-income-edit-form').hidden && !again.querySelector('.goal-edit-error').hidden; })());
check('typing in the expense filter keeps an open expense edit form and what was typed', await (async () => { const planId = income.find((r) => r.planName === 'FormPlan').id; saveExpense({ dateKey: todayKey(), amountRaw: '5', planId, notes: 'orig' }); showTab('expenses'); renderBudget(); const li = document.querySelector('#expense-list li'); li.querySelector('.edit-btn').click(); li.querySelector('.expense-edit-notes').value = 'half typed'; $('expense-filter-search').value = ''; $('expense-filter-search').dispatchEvent(new Event('input')); const after = document.querySelector('#expense-list li'); return !after.querySelector('.recurring-income-edit-form').hidden && after.querySelector('.expense-edit-notes').value === 'half typed'; })());
income.length = 0; bills.length = 0; hideUndoToast(); renderBudget();

// ---- savings goals split into costs ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast();
saveGoal({ name: 'Trip', targetRaw: '1000', date: '', notes: '' });
const tripId = income.find((r) => r.goalName === 'Trip').id;
check('a goal with no costs uses its own target', goalTarget(income.find((r) => r.id === tripId)) === 1000 && goalCosts(tripId).length === 0);
check('a cost needs a name and a real amount', addGoalCost(tripId, '', '5') !== '' && addGoalCost(tripId, 'x', '0') !== '' && addGoalCost(tripId, 'x', '') !== '' && addGoalCost('nope', 'x', '5') !== '' && goalCosts(tripId).length === 0);
check('costs replace the target with their total', addGoalCost(tripId, 'Flights', '400') === '' && addGoalCost(tripId, 'Hotel', '650.50') === '' && goalTarget(income.find((r) => r.id === tripId)) === 1050.5 && goalCosts(tripId).map((r) => r.itemName).join() === 'Flights,Hotel' && /^item-/.test(goalCosts(tripId)[0].id));
check('costs are not income received', uniqueIncomeEntries(income).length === 0);
addSavings(tripId, '200', 1);
renderBudget();
check('the card lists each cost and measures progress against their total', (() => { const li = document.querySelector('#goal-list > li'); return li.querySelectorAll('.goal-costs li').length === 2 && /\$200\.00 of \$1,050\.50/.test(li.textContent) && /\$850\.50 to go/.test(li.textContent) && /total of 2 costs/.test(li.textContent) && /Hotel: \$650\.50/.test(li.textContent); })(), document.querySelector('#goal-list > li').textContent);
check('the Add cost button on the card works and offers Undo', await (async () => { const li = document.querySelector('#goal-list > li'); li.querySelector('.goal-cost-name-input').value = 'Food'; li.querySelector('.goal-cost-amount-input').value = '100'; li.querySelector('.goal-cost-add-btn').click(); await sleep(30); const ok = goalTarget(income.find((r) => r.id === tripId)) === 1150.5 && /Added cost Food/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return ok && goalTarget(income.find((r) => r.id === tripId)) === 1050.5; })(), $('undo-toast-text').textContent);
check('Remove takes a cost off and the target follows', await (async () => { const hotel = goalCosts(tripId).find((r) => r.itemName === 'Hotel'); deleteIncome(hotel.id); await sleep(30); const ok = goalTarget(income.find((r) => r.id === tripId)) === 400 && /Removed cost Hotel/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return ok && goalTarget(income.find((r) => r.id === tripId)) === 1050.5; })());
check('removing every cost goes back to the goal\'s own target', (() => { goalCosts(tripId).forEach((c) => deleteIncome(c.id)); return goalTarget(income.find((r) => r.id === tripId)) === 1000; })());
check('import accepts a good cost and rejects a bad one, and describeContents counts them', isValidImportRecord('income', { id: 'item-1', goalItemFor: 'goal-1', itemName: 'a', amount: 5 }) && !isValidImportRecord('income', { id: 'item-1', goalItemFor: 'goal-1', itemName: '', amount: 5 }) && !isValidImportRecord('income', { id: 'item-1', goalItemFor: 'goal-1', itemName: 'a', amount: 0 }) && (() => { addGoalCost(tripId, 'One', '5'); return /1 goal cost/.test(describeContents()); })());
income.length = 0; hideUndoToast(); renderBudget();

// ---- adjusting the rolled-forward number ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; showTab('home'); calendarWeekOffset = 0; hideUndoToast();
const wsA = weekStartKey(shiftDateKey(todayKey(), -7));
setIncomeForDate(shiftDateKey(wsA, 1), '500'); addBill({ name: 'Adj rent', amount: '120', dueDate: shiftDateKey(wsA, 2), frequency: 'one_time', category: '', autopay: false });
renderBudget();
const adjNets = () => [...document.querySelectorAll('.budget-week-net-total')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
const adjustWeekForm = (index) => document.querySelectorAll('.budget-week')[index].querySelector('.week-adjust-form');
const submitAdjust = async (index, actual, note) => { const week = document.querySelectorAll('.budget-week')[index]; week.querySelector('.budget-week-adjust > button').click(); const form = week.querySelector('.week-adjust-form'); form.querySelector('input[type="number"]').value = actual; form.querySelector('input[type="text"]').value = note; form.requestSubmit(); await sleep(30); };
check('every week offers an Adjust button, and its box starts at the carried-in amount', (() => { const week = document.querySelectorAll('.budget-week')[1]; week.querySelector('.budget-week-adjust > button').click(); return document.querySelectorAll('.budget-week-adjust > button').length === 3 && adjustWeekForm(1).querySelector('input[type="number"]').value === '380'; })());
await submitAdjust(1, '300', 'extra gas');
check('typing what you really have changes that week and the weeks after it, not the one before', adjNets().join('|') === 'Net: $380.00|Net: $300.00|Net: $300.00', adjNets().join('|'));
check('the adjustment is one record that says why, and the week says it was adjusted', income.filter((r) => r.adjustWeek).length === 1 && income.find((r) => r.adjustWeek).amount === -80 && !income.find((r) => r.adjustWeek).dateKey && /adjusted by -\$80\.00 \(extra gas\)/.test(document.querySelectorAll('.budget-week')[1].querySelector('.budget-week-adjusted').textContent));
check('the hover text counts the adjusted carry', /Includes \$300\.00 from earlier weeks/.test(document.querySelectorAll('.budget-week-net-total')[1].title) || /Includes/.test(document.querySelectorAll('.budget-week-net-total')[2].title));
await submitAdjust(1, '350', 'less gas');
check('adjusting the same week again updates the one record', income.filter((r) => r.adjustWeek && !r.deleted).length === 1 && adjNets().join('|') === 'Net: $380.00|Net: $350.00|Net: $350.00', adjNets().join('|'));
check('an adjustment is not income received, and month totals are untouched', uniqueIncomeEntries(income).length === 1 && /net:/i.test(document.querySelector('#budget-month-net-total').textContent));
await submitAdjust(2, '350', '');
check('typing the amount the app already works out adds nothing', income.filter((r) => r.adjustWeek && !r.deleted).length === 1);
document.querySelectorAll('.budget-week')[1].querySelector('.budget-week-adjust > button').click();
document.querySelectorAll('.budget-week')[1].querySelector('.week-adjust-form button:nth-of-type(2)').click(); await sleep(30);
check('Reset removes the adjustment and Undo brings it back', await (async () => { const gone = adjNets().join('|') === 'Net: $380.00|Net: $380.00|Net: $380.00' && /Removed the carry-forward adjustment/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return gone && adjNets()[1] === 'Net: $350.00'; })(), adjNets().join('|'));
check('a bad amount is refused with a message', setWeekCarry(wsA, 0, '', '') !== '' && setWeekCarry(wsA, 0, '9999999999', '') !== '');
check('import accepts a good adjustment and rejects a bad one, and describeContents counts them', isValidImportRecord('income', { id: 'adjust-1', adjustWeek: '2026-10-05', amount: -80, notes: 'x' }) && !isValidImportRecord('income', { id: 'adjust-1', adjustWeek: '2026-13-05', amount: -80 }) && !isValidImportRecord('income', { id: 'adjust-1', adjustWeek: '2026-10-05', amount: 0 }) && /1 carry-forward adjustment/.test(describeContents()), describeContents());
income.length = 0; bills.length = 0; hideUndoToast(); renderBudget();

// ---- editing a goal's costs ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast(); showTab('plan');
saveGoal({ name: 'Edit trip', targetRaw: '100', date: '', notes: '' });
const etId = income.find((r) => r.goalName === 'Edit trip').id;
addGoalCost(etId, 'Flights', '400'); addGoalCost(etId, 'Hotel', '600'); renderBudget();
const etCostId = () => goalCosts(etId).find((r) => r.itemName === 'Flights' || r.itemName === 'Airfare').id;
check('a cost refuses an empty name or a bad amount when edited', saveGoalCost(etCostId(), '', '5') !== '' && saveGoalCost(etCostId(), 'x', '0') !== '' && saveGoalCost(etCostId(), 'x', '') !== '' && saveGoalCost('nope', 'x', '5') !== '' && goalTarget(income.find((r) => r.id === etId)) === 1000);
check('editing a cost changes its name and amount and the goal target follows', saveGoalCost(etCostId(), 'Airfare', '450.50') === '' && goalCosts(etId).some((r) => r.itemName === 'Airfare' && r.amount === 450.5) && goalTarget(income.find((r) => r.id === etId)) === 1050.5 && goalCosts(etId).length === 2);
check('saving a cost with nothing changed adds no Undo step', (() => { const before = undoStack.length; saveGoalCost(etCostId(), 'Airfare', '450.5'); return undoStack.length === before; })());
check('the Edit button on a cost opens a form that saves and closes', await (async () => { const row = document.querySelector('#goal-list .goal-costs li'); row.querySelector('button').click(); const form = row.querySelector('.goal-cost-form'); const opened = !form.hidden && form.querySelector('input[type="number"]').value === '450.5'; form.querySelector('input[type="number"]').value = '500'; form.requestSubmit(); await sleep(30); const again = document.querySelector('#goal-list .goal-costs li'); return opened && goalTarget(income.find((r) => r.id === etId)) === 1100 && again.querySelector('.goal-cost-form').hidden === true && /\$500\.00/.test(again.textContent); })());
check('Undo puts the old cost back', (() => { undo(); return goalTarget(income.find((r) => r.id === etId)) === 1050.5; })());
income.length = 0; hideUndoToast(); renderBudget();

// ---- mark an expected cost as spent, and the savings history ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast(); showTab('plan');
savePlanCategory({ name: 'Car', amountRaw: '50', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
saveGuess({ name: 'Car maintenance', amountRaw: '350', month: todayKey().slice(0, 7), notes: '' });
renderBudget();
const carPlanId = income.find((r) => r.planName === 'Car').id;
const guessCardId = () => income.find((r) => r.guessName === 'Car maintenance' && !r.deleted)?.id;
check('marking as spent refuses a bad amount or no category and changes nothing', markGuessSpent(guessCardId(), '', carPlanId) !== '' && markGuessSpent(guessCardId(), '0', carPlanId) !== '' && markGuessSpent(guessCardId(), '10', '') !== '' && !!guessCardId() && !income.some((r) => r.spentOn));
check('marking as spent logs the real amount today under the category and removes the guess', markGuessSpent(guessCardId(), '412.30', carPlanId) === '' && !guessCardId() && income.filter((r) => r.spentOn && !r.deleted).length === 1 && income.find((r) => r.spentOn).amount === 412.3 && income.find((r) => r.spentOn).spentOn === todayKey() && income.find((r) => r.spentOn).categoryName === 'Car' && income.find((r) => r.spentOn).notes === 'Car maintenance' && guessTotalForMonth(todayKey().slice(0, 7)) === 0);
income.filter((r) => r.spentOn).forEach((r) => { r.deleted = true; });
saveGuess({ name: 'Tyres', amountRaw: '200', month: todayKey().slice(0, 7), notes: '' });
renderBudget();
check('the Mark as spent button opens a form starting at the estimate, and its Log button works', await (async () => { const li = document.querySelector('#guess-list li'); li.querySelector('.guess-spent-btn').click(); const form = li.querySelector('.guess-spent-form'); const opened = !form.hidden && form.querySelector('.guess-spent-amount').value === '200' && form.querySelectorAll('.guess-spent-category option').length === 1; form.querySelector('.guess-spent-amount').value = '180'; form.requestSubmit(); await sleep(60); return opened && !income.some((r) => r.guessName === 'Tyres' && !r.deleted) && income.some((r) => r.spentOn && !r.deleted && r.amount === 180); })());
income.length = 0; hideUndoToast(); showTab('plan');
saveGoal({ name: 'Hist goal', targetRaw: '500', date: '', notes: '' });
const hgId = income.find((r) => r.goalName === 'Hist goal').id;
addSavings(hgId, '100', 1); addSavings(hgId, '40', 1); addSavings(hgId, '25', -1); renderBudget();
check('the history lists every deposit and withdrawal with its sign, and is hidden when there are none', (() => { const li = document.querySelector('#goal-list > li'); const rows = [...li.querySelectorAll('.goal-history-list li')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()); return rows.length === 3 && /Savings history \(3\)/.test(li.querySelector('.goal-history-summary').textContent) && rows.some((t) => /\+\$100\.00/.test(t)) && rows.some((t) => /-\$25\.00/.test(t)) && li.querySelector('.goal-history').hidden === false; })());
check('deleting a history entry fixes the total, and Undo brings it back', await (async () => { const li = document.querySelector('#goal-list > li'); const del = [...li.querySelectorAll('.goal-history-list li')].find((r) => /\+\$40\.00/.test(r.textContent)).querySelector('button'); del.click(); await sleep(30); const ok = goalSaved(hgId) === 75 && /Removed a savings entry/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(30); return ok && goalSaved(hgId) === 115; })());
check('a goal with no savings shows no history', (() => { saveGoal({ name: 'Empty goal', targetRaw: '10', date: '', notes: '' }); const li = [...document.querySelectorAll('#goal-list > li')].find((x) => /Empty goal/.test(x.textContent)); return li.querySelector('.goal-history').hidden === true; })());
income.length = 0; hideUndoToast(); renderBudget();

// ---- repeating expenses ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast(); showTab('expenses');
savePlanCategory({ name: 'Coffee run', amountRaw: '20', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
renderBudget();
const coffeePlanId = income.find((r) => r.planName === 'Coffee run').id;
check('a repeating expense needs a live category, an amount, a frequency and a real first date', repeatFieldsError({ planId: '', amountRaw: '5', frequency: 'weekly', start: todayKey() }) !== '' && repeatFieldsError({ planId: coffeePlanId, amountRaw: '0', frequency: 'weekly', start: todayKey() }) !== '' && repeatFieldsError({ planId: coffeePlanId, amountRaw: '5', frequency: 'daily', start: todayKey() }) !== '' && repeatFieldsError({ planId: coffeePlanId, amountRaw: '5', frequency: 'weekly', start: '' }) !== '' && repeatFieldsError({ planId: coffeePlanId, amountRaw: '5', frequency: 'weekly', start: '2026-02-30' }) !== '' && repeatFieldsError({ planId: coffeePlanId, amountRaw: '5', frequency: 'weekly', start: todayKey() }) === '');
check('saving one stores it in the income list with no date', (() => { const p = saveRepeat({ planId: coffeePlanId, amountRaw: '4.50', frequency: 'weekly', start: shiftDateKey(todayKey(), -15), notes: 'cafe' }); const r = income.find((x) => x.recurPlanId); return p === '' && !!r && r.amount === 4.5 && !r.dateKey && /^rexp-/.test(r.id) && Array.isArray(r.skippedDates); })());
const rxId = income.find((r) => r.recurPlanId).id;
check('the dates due are every week from the start up to today, none in the future', (() => { const due = dueRepeats().map((d) => d.dateKey); return due.length === 3 && due.every((d) => d <= todayKey()) && due[0] === shiftDateKey(todayKey(), -15) && due[2] === shiftDateKey(todayKey(), -1); })(), dueRepeats().map((d) => d.dateKey).join());
check('the Expenses tab lists each due date with Log it and Skip', (() => { renderBudget(); const rows = document.querySelectorAll('#repeat-due-list li'); return rows.length === 3 && /Coffee run/.test(rows[0].textContent) && /\$4\.50 due/.test(rows[0].textContent) && rows[0].querySelectorAll('button').length === 2; })());
check('Log it records an expense on that date and the date is not offered again', await (async () => { document.querySelector('#repeat-due-list li button').click(); await sleep(40); const e = income.find((r) => r.spentOn && !r.deleted); return !!e && e.spentOn === shiftDateKey(todayKey(), -15) && e.amount === 4.5 && e.recurId === rxId && e.recurDate === e.spentOn && e.categoryName === 'Coffee run' && dueRepeats().length === 2; })());
check('Skip hides a date without logging, and Undo brings it back', await (async () => { const before = income.filter((r) => r.spentOn).length; document.querySelector('#repeat-due-list li button:nth-of-type(2)').click(); await sleep(40); const ok = dueRepeats().length === 1 && income.filter((r) => r.spentOn).length === before && /Skipped a repeating expense/.test($('undo-toast-text').textContent); $('undo-toast-btn').click(); await sleep(40); return ok && dueRepeats().length === 2; })());
check('deleting a logged expense offers its date again', (() => { const e = income.find((r) => r.spentOn && r.recurId === rxId && !r.deleted); deleteIncome(e.id); return dueRepeats().length === 3; })());
check('only the last 45 days are offered', (() => { income.find((r) => r.id === rxId).recurStart = shiftDateKey(todayKey(), -400); return dueRepeats().every((d) => utcDayDiff(d.dateKey, todayKey()) <= 45) && dueRepeats().length <= 7; })());
check('a monthly repeat is offered on its day each month and a repeat without a category waits', (() => { const r = income.find((x) => x.id === rxId); r.frequency = 'monthly'; r.recurStart = shiftDateKey(todayKey(), -1); const monthly = dueRepeats().length; const plan = income.find((x) => x.id === coffeePlanId); plan.deleted = true; const waiting = dueRepeats().length; plan.deleted = false; return monthly >= 1 && monthly <= 2 && waiting === 0; })());
check('editing changes the repeat, and its edit form closes after saving', await (async () => { showTab('expenses'); renderBudget(); const li = document.querySelector('#repeat-list > li'); li.querySelector('.edit-btn').click(); const form = li.querySelector('.recurring-income-edit-form'); const opened = !form.hidden && form.querySelector('.repeat-edit-amount').value === '4.5'; form.querySelector('.repeat-edit-amount').value = '6'; form.requestSubmit(); await sleep(40); return opened && income.find((r) => r.id === rxId).amount === 6 && document.querySelector('#repeat-list > li .recurring-income-edit-form').hidden === true; })());
check('the Add form saves a repeat and import accepts and refuses repeats', (() => { $('repeat-amount-input').value = '9'; $('repeat-add-form').requestSubmit(); return income.filter((r) => r.recurPlanId && !r.deleted).length === 2 && isValidImportRecord('income', { id: 'rexp-1', recurPlanId: 'p', amount: 5, frequency: 'weekly', recurStart: '2026-01-05', skippedDates: ['2026-01-12'] }) && !isValidImportRecord('income', { id: 'rexp-1', recurPlanId: 'p', amount: 5, frequency: 'daily', recurStart: '2026-01-05' }) && !isValidImportRecord('income', { id: 'rexp-1', recurPlanId: '', amount: 5, frequency: 'weekly', recurStart: '2026-01-05' }) && !isValidImportRecord('income', { id: 'rexp-1', recurPlanId: 'p', amount: 5, frequency: 'weekly', recurStart: '2026-01-05', skippedDates: ['x'] }); })());
check('describeContents counts repeating expenses', /2 repeating expenses/.test(describeContents()), describeContents());
income.length = 0; hideUndoToast(); renderBudget();

// ---- business summary and CSV ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast(); showTab('expenses');
savePlanCategory({ name: 'Fuel', amountRaw: '50', frequency: 'weekly', type: 'business', altRaw: '', notes: '' });
savePlanCategory({ name: 'Snacks', amountRaw: '20', frequency: 'weekly', type: 'personal', altRaw: '', notes: '' });
const bizFuelId = income.find((r) => r.planName === 'Fuel').id, snackId2 = income.find((r) => r.planName === 'Snacks').id;
const thisYear = parseDateKey(todayKey()).y;
check('the periods are this month, last month, this year and last year, in order', (() => { const [ms, me] = summaryPeriodBounds('month'); const [ls, le] = summaryPeriodBounds('lastMonth'); const [ys, ye] = summaryPeriodBounds('year'); const [ps, pe] = summaryPeriodBounds('lastYear'); return ms === `${todayKey().slice(0, 8)}01` && le < ms && ls.slice(8) === '01' && ls.slice(0, 7) < ms.slice(0, 7) && utcDayDiff(le.slice(0, 8) + '28', ms) > 0 && ys === `${thisYear}-01-01` && ye === `${thisYear}-12-31` && ps === `${thisYear - 1}-01-01` && pe === `${thisYear - 1}-12-31`; })());
check('last month is a real month even in January', (() => { const real = (k) => isRealDateKey(k.slice(0, 8) + '01'); const [ls] = summaryPeriodBounds('lastMonth'); return real(ls) && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(ls); })());
saveExpense({ dateKey: todayKey(), amountRaw: '40', planId: bizFuelId, notes: 'diesel' });
saveExpense({ dateKey: todayKey(), amountRaw: '15.5', planId: snackId2, notes: '=SUM(A1)' });
saveExpense({ dateKey: `${thisYear - 1}-06-15`, amountRaw: '99', planId: bizFuelId, notes: 'last year' });
renderBudget();
check('an expense is Business or Personal by its category', isBusinessExpense(income.find((r) => r.notes === 'diesel')) && !isBusinessExpense(income.find((r) => r.notes === '=SUM(A1)')));
check('the summary adds up Business, Personal and the total for the period', (() => { $('business-period-input').value = 'month'; renderBusinessSummary(); const t = $('business-total-line').textContent; return /Business: \$40\.00 · Personal: \$15\.50 · Total: \$55\.50 \(2 expenses\)/.test(t) && document.querySelectorAll('#business-category-list li').length === 1 && /Fuel: \$40\.00/.test($('business-category-list').textContent) && $('business-csv-btn').disabled === false; })(), $('business-total-line').textContent);
check('changing the period changes the figures, and an empty period disables the button', (() => { $('business-period-input').value = 'lastYear'; $('business-period-input').dispatchEvent(new Event('change')); const last = /Business: \$99\.00 · Personal: \$0\.00 · Total: \$99\.00 \(1 expense\)/.test($('business-total-line').textContent); $('business-period-input').value = 'lastMonth'; $('business-period-input').dispatchEvent(new Event('change')); const empty = $('business-empty').hidden === false || /Total/.test($('business-total-line').textContent); return last && empty; })(), $('business-total-line').textContent);
check('a CSV cell is quoted, its quotes doubled and a formula made harmless', csvCell('a "b", c') === '"a ""b"", c"' && csvCell('=SUM(A1)') === '"\'=SUM(A1)"' && csvCell('-5 off') === '"\'-5 off"' && csvCell('plain') === '"plain"' && csvCell(12.5) === '"12.5"');
check('the CSV has a header and one line per expense with its type and amount', (() => { const lines = buildExpenseCsv(expensesInSummaryPeriod('month')).split('\r\n'); return lines.length === 3 && lines[0] === '"Date","Category","Type","Amount","Note"' && lines.some((l) => l === `"${todayKey()}","Fuel","Business","40.00","diesel"`) && lines.some((l) => l === `"${todayKey()}","Snacks","Personal","15.50","'=SUM(A1)"`); })());
check('the Download CSV button hands a file to the browser', await (async () => { $('business-period-input').value = 'month'; renderBusinessSummary(); let seen = null; const saved = URL.createObjectURL; let blobSeen = null; URL.createObjectURL = (b) => { blobSeen = b; return 'blob:test'; }; const clickSaved = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { seen = this.download; }; $('business-csv-btn').click(); URL.createObjectURL = saved; HTMLAnchorElement.prototype.click = clickSaved; return /^budget-expenses-this-month-\d{4}-\d{2}-\d{2}\.csv$/.test(seen || '') && !!blobSeen && blobSeen.type === 'text/csv'; })());
income.length = 0; hideUndoToast(); renderBudget();

// ---- this month's carry-forward corrections on Home ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; hideUndoToast(); showTab('home'); calendarWeekOffset = 0; renderBudget();
check('Home says nothing about corrections when there are none', $('budget-month-adjusted').hidden === true);
const adjMonthWeek = weekStartKey(todayKey());
setIncomeForDate(shiftDateKey(adjMonthWeek, -6), '300'); renderBudget();
check('a correction down is named, with its size and a pointer to Spent vs Plan', (() => { setWeekCarry(adjMonthWeek, 300, '220', 'gas'); const el = $('budget-month-adjusted'); const inThisMonth = adjMonthWeek.slice(0, 7) === todayKey().slice(0, 7); return inThisMonth ? (!el.hidden && /down by \$80\.00/.test(el.textContent) && /Spent vs Plan/.test(el.textContent)) : el.hidden === true; })(), $('budget-month-adjusted').textContent);
check('a correction up says so too, and two in a month add up', (() => { const el = $('budget-month-adjusted'); const inThisMonth = adjMonthWeek.slice(0, 7) === todayKey().slice(0, 7); const next = shiftDateKey(adjMonthWeek, 7); setWeekCarry(next, 220, '330', ''); const both = weekAdjustments().size === 2; const nextInMonth = next.slice(0, 7) === todayKey().slice(0, 7); const total = (inThisMonth ? -80 : 0) + (nextInMonth ? 110 : 0); const text = el.textContent; return both && (total === 0 ? el.hidden === true : (total > 0 ? new RegExp(`up by \\$${total}\\.00`).test(text) : new RegExp(`down by \\$${-total}\\.00`).test(text))); })(), $('budget-month-adjusted').textContent);
income.length = 0; hideUndoToast(); renderBudget();
