// Autopay on the calendar, import amount limits, and a first sync never bringing back a deleted record.
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
check('a device that syncs is not asked for a backup file it has never made', !/full backup/.test($('backup-notes').textContent), $('backup-notes').textContent);
localStorage.removeItem('budgetApp.syncConfig.v1'); updateQuickSync(); renderBackupNotes();
check('a device that does not sync still is', /full backup/.test($('backup-notes').textContent), $('backup-notes').textContent);
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
check('Pay Period, Projected Income, Spending Plan, Paid History and Recurring Income are folds, open to start with', document.querySelectorAll('details.fold').length === 5 && payFold.open === true);
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
check('the day has a Projected box holding it, and a hollow dot', document.querySelector(`.budget-day-projected-input[data-date-key="${dk(0)}"]`).value === '300' && !!document.querySelector(`.budget-day-cell[data-date-key="${dk(0)}"] .budget-projected-dot`));
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
check('the same projection shows in the calendar day box', document.querySelector(`.budget-day-projected-input[data-date-key="${dk(2)}"]`).value === '400');
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
check('a source is saved on a projected day', income.find((r) => r.id === `projected-${dk(3)}`).source === 'Side gig');
check('suggestions are the recurring income names plus sources used before', JSON.stringify(incomeSourceNames()) === JSON.stringify(['Paycheck', 'Side gig', 'Tips']) && document.querySelectorAll('#income-source-options option').length === 3, JSON.stringify(incomeSourceNames()));
check('the projected list shows the source', /Side gig/.test(document.querySelector('#projected-income-list .recurring-income-start').textContent));
const srcBox = (id) => document.querySelector(`.budget-day-source-input[aria-label="${id}"]`);
showTab('home'); renderBudget();
check('a day with an amount has an enabled source box holding the source', [...document.querySelectorAll('.budget-day-source-input')].some((b) => !b.disabled && b.value === 'Tips') && [...document.querySelectorAll('.budget-day-source-input')].some((b) => !b.disabled && b.value === 'Side gig'));
check('every day ends each section with an empty new-entry row', document.querySelectorAll('.budget-day-source-input[aria-label$="(new entry)"]').length === 2 * document.querySelectorAll('.budget-day-cell').length && ![...document.querySelectorAll('.budget-day-source-input')].some((b) => b.disabled));
setProjectedForDate(dk(3), '350', 'Side gig'); await sleep(30);
check('changing only the amount keeps the source', income.find((r) => r.id === `projected-${dk(3)}`).source === 'Side gig');
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
check('the calendar day shows a row per entry plus an empty one', document.querySelectorAll(`.budget-day-manual-input[data-date-key="${dk(1)}"]`).length === 3);
setIncomeForDate(dk(1), '', 'tips'); await sleep(30);
check('clearing one entry leaves the other', dayEntries().length === 1 && dayEntries()[0].source === 'Job');
check('a source cannot be changed to one the day already has', (setIncomeForDate(dk(1), '5', 'Gift'), true) && (await sleep(30), setIncomeSource(dayEntries().find((r) => r.source === 'Gift').id, 'job') === false));
check('an entry with no source and one with a source can share a day', (setIncomeForDate(dk(1), '7'), dayEntries().filter((r) => !r.source).length === 1));
setProjectedForDate(dk(2), '200', 'Job'); setProjectedForDate(dk(2), '50', 'Gift'); await sleep(30);
check('projected income also holds one entry per source', projectedByDate(income).get(dk(2)).length === 2);
hideUndoToast(); income.length = 0; showTab('home'); renderBudget();

// ---- the Plan tab (estimated spending per category) ----
bills.length = 0; income.length = 0; recurringIncome.length = 0; planScenarioOn = false; showTab('plan'); renderBudget(); hideUndoToast();
check('the Plan tab is the fourth tab and starts empty', TABS.length === 4 && $('tab-plan').hidden === false && $('tab-home').hidden === true && $('plan-empty-state').hidden === false && $('plan-total-line').textContent === '');
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
check('the overall totals add every category in both views', $('plan-total-line').textContent === `Total: $${weeklySum.toFixed(2)} per week \u00b7 $${monthlySum.toFixed(2)} per month.`, $('plan-total-line').textContent);
check('business and personal are totalled separately', /Business: \$120\.00 per week \u00b7 \$520\.00 per month\./.test($('plan-split-line').textContent), $('plan-split-line').textContent);
check('the what-if line is empty while the switch is off', $('plan-scenario-line').textContent === '');
$('plan-scenario-input').checked = true; $('plan-scenario-input').dispatchEvent(new Event('change'));
const whatIfMonthly = monthlySum - (30 * 52) / 12 + (10 * 52) / 12;
check('the What-if switch swaps in the what-if amounts and shows the difference', $('plan-total-line').textContent.includes(`$${whatIfMonthly.toFixed(2)} per month`) && /less than the plan/.test($('plan-scenario-line').textContent), $('plan-total-line').textContent + ' | ' + $('plan-scenario-line').textContent);
check('the switch is remembered on this device under a budgetApp key', localStorage.getItem('budgetApp.planScenario.v1') === '1');
$('plan-scenario-input').checked = false; $('plan-scenario-input').dispatchEvent(new Event('change'));
check('switching back restores the plan totals', $('plan-total-line').textContent.includes(`$${monthlySum.toFixed(2)} per month`) && $('plan-scenario-line').textContent === '');
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
