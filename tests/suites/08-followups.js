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
check('adding a bill shows no undo toast', $('undo-toast').hidden === true);
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
