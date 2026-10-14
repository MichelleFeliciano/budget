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
check('Pay Period, Paid History and Recurring Income are folds, open to start with', document.querySelectorAll('details.fold').length === 3 && payFold.open === true);
payFold.open = false; await sleep(30);
check('folding one up is remembered on this device', JSON.parse(localStorage.getItem('budgetApp.folds.v1') || '{}')['fold-pay-period'] === false);
document.querySelector('[data-jump="fold-pay-period"]').click();
check('a jump link opens the part it points to', payFold.open === true);
check('there is a jump link for every part', ['budget-month', 'fold-pay-period', 'fold-paid-history', 'budget-bills', 'fold-recurring-income'].every((id) => !!document.querySelector(`[data-jump="${id}"]`) && !!$(id)));
await sleep(30);
localStorage.removeItem('budgetApp.folds.v1');

// ---- a bill's name shows on its day in the compact calendar ----
bills.length = 0; renderBudget();
addBill({ name: 'Peek one', amount: '5', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
addBill({ name: 'Peek two', amount: '5', dueDate: dk(1), frequency: 'one_time', category: '', autopay: false });
const peekCell = document.querySelector(`.budget-day-cell[data-date-key="${dk(1)}"]`);
check('a day with bills carries the first name and how many more', !!peekCell && /Peek/.test(peekCell.querySelector('.budget-day-peek-name').textContent) && peekCell.querySelector('.budget-day-peek-more').textContent === '+1');
check('a day with nothing has no name line', !document.querySelector(`.budget-day-cell[data-date-key="${dk(2)}"] .budget-day-peek`));
hideUndoToast(); bills.length = 0; renderBudget();
