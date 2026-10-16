// Regression tests for money bugs found in code reviews: each check
// fails if its bug comes back.
const old = '2026-01-01T00:00:00.000Z';
const rb = { dateAdded: old, updatedAt: old, deviceId: 'test', deleted: false, version: 0 };
const tt = new Date().toISOString();
const r2 = { dateAdded: tt, updatedAt: tt, deviceId: 'test', deleted: false, version: 0 };

// ---- importing an older backup never duplicates a bill that was edited since ----
bills.length = 0;
const billRec = (over) => ({ ...rb, id: 'bk1', name: 'Edited later', amount: 10, dueDate: '2026-10-01', frequency: 'monthly', category: '', paidDates: [], ...over });
bills.push(billRec({ version: 3, updatedAt: '2026-06-01T00:00:00.000Z' }));
const oldBackup = { collections: { bills: [billRec({ name: 'Old name', version: 1, updatedAt: '2026-02-01T00:00:00.000Z' })] } };
importData(oldBackup); importData(oldBackup);
check('an older backup of an edited bill adds no duplicate, even imported twice', bills.length === 1 && bills[0].name === 'Edited later', JSON.stringify(bills.map((b) => b.name)));
importData({ collections: { bills: [billRec({ name: 'Newer than local', version: 1, updatedAt: '2026-09-01T00:00:00.000Z' })] } });
check('a genuinely newer backup copy is still kept (as a copy, nothing is lost)', bills.length === 2 && bills.some((b) => b.name === 'Newer than local'));
bills.length = 0;

// ---- import refuses records that would break a screen ----
check('import refuses text fields that are not text', !isValidImportRecord('bills', { id: 'x', name: 5, amount: 5, dueDate: dk(1), frequency: 'monthly' }) && !isValidImportRecord('recurringIncome', { id: 'x', name: null, amount: 5, dueDate: dk(1), frequency: 'monthly' }));
check('import still accepts normal records', isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly' }) && isValidImportRecord('recurringIncome', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'weekly' }) && isValidImportRecord('income', { id: dk(1), dateKey: dk(1), amount: -5 }));
check('a bill with a missing or text category is accepted, a number is not', isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly' }) && isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', category: 'Food' }) && !isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', category: 7 }));
check('a recurring income source cannot be one-time, and paid dates must be text', !isValidImportRecord('recurringIncome', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'one_time' }) && !isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', paidDates: [5] }));

// ---- a damaged saved list cannot stop the app loading ----
localStorage.setItem('budgetApp.testlist.v1', JSON.stringify([null, 5, 'x', { id: 'ok' }, [1]]));
check('stray non-records in a saved list are dropped on load', loadCollection('budgetApp.testlist.v1').length === 1);
localStorage.removeItem('budgetApp.testlist.v1');

// ---- money ----
bills.length = 0;
check('an amount is rounded to whole cents', validateBillFields({ name: 'x', amount: '19.999', dueDate: dk(1), frequency: 'monthly', category: '' }).amount === 20);
check('an amount that rounds to $0.00 is refused', !validateBillFields({ name: 'x', amount: '0.001', dueDate: dk(1), frequency: 'monthly', category: '' }).ok);
check('an absurd amount is refused', !validateBillFields({ name: 'x', amount: '1e21', dueDate: dk(1), frequency: 'monthly', category: '' }).ok && !validateRecurringIncomeFields({ name: 'x', amount: '5000000000', dueDate: dk(1), frequency: 'biweekly', category: '' }).ok);
// payments stay in paid history when a bill's schedule changes
addBill({ name: 'Gym', amount: '100', dueDate: '2026-01-01', frequency: 'monthly', category: 'Health', autopay: false });
const gym = bills[0];
gym.paidDates = ['2026-01-01', '2026-02-01', '2026-03-01'];
updateBill(gym.id, { name: 'Gym', amount: '100', dueDate: '2026-01-01', frequency: 'one_time', category: 'Health', autopay: false });
const paidFeb = computePaidByCategory(bills.filter((b) => !b.deleted), 2026, 1);
check('changing a bill to one-time does not make earlier payments vanish from paid history', paidFeb.length === 1 && paidFeb[0].total === 100, JSON.stringify(paidFeb));
// duplicate paid dates never undercount what is owed
bills.length = 0;
addBill({ name: 'Water', amount: '30', dueDate: dk(-10), frequency: 'one_time', category: '', autopay: false });
bills[0].paidDates = [dk(-10), dk(-10)];
check('the same payment listed twice is counted once', unpaidAmountThrough(bills[0], todayKey()) === 0);
// autopay bills are not "overdue"
bills.length = 0;
addBill({ name: 'Auto', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: true });
addBill({ name: 'Manual', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: false });
const homeBills = computeBillReminders(bills.filter((b) => !b.deleted));
check('a past-due autopay bill is not listed as overdue, a manual one still is', homeBills.overdue.length === 1 && homeBills.overdue[0].bill.name === 'Manual');
// income: a clear is never undone by an older duplicate, and clearing removes copies
income.length = 0;
const inc = (id, dateKey, amount, updatedAt, deleted) => ({ id, dateKey, amount, dateAdded: old, updatedAt, deviceId: 'x', deleted: !!deleted, version: 1 });
income.push(inc('2026-10-01', '2026-10-01', 50, '2026-10-01T10:00:00.000Z', false), inc('copy-1', '2026-10-01', 70, '2026-10-03T10:00:00.000Z', true));
check('a newer cleared record hides an older live duplicate for the date', uniqueIncomeEntries(income).filter((r) => !r.deleted).length === 0);
income.length = 0;
income.push(inc('2026-10-02', '2026-10-02', 20, old, false), inc('clone-2', '2026-10-02', 25, '2026-10-03T00:00:00.000Z', false));
setIncomeForDate('2026-10-02', '');
check('clearing a day clears every live record for it', income.filter((r) => r.dateKey === '2026-10-02' && !r.deleted).length === 0);
income.length = 0;


// ---- budget: day income boxes ----
income.length = 0;
setIncomeForDate('2026-10-05', '10.999');
check('a day amount is rounded to whole cents', income.find((r) => r.dateKey === '2026-10-05').amount === 11);
income.length = 0;
renderBudget();
const boxDate = todayKey();
setIncomeForDate(boxDate, '50');
await sleep(30);
setIncomeForDate(boxDate, '9999999999');
await sleep(30);
check('an out-of-range amount is refused and the saved one stays', income.find((r) => r.dateKey === boxDate).amount === 50);
income.length = 0;
// pay period message
savePaydaySettings({ payDateKey: null, frequency: 'biweekly' }); renderPayPeriod();
check('with no payday set the pay period says to set one', /Set a recent payday/.test($('pay-period-empty-state').textContent), $('pay-period-empty-state').textContent);
savePaydaySettings({ payDateKey: dk(-3), frequency: 'biweekly' }); renderPayPeriod();
check('with a payday set the pay period shows bills or the usual empty message', !/Set a recent payday/.test($('pay-period-empty-state').textContent));


// ---- sync reminder counts a sync that reported a conflict ----
check('the stale-sync clock is reset by any sync that reached the server', (() => {
  const src = runSync.toString();
  const beforeBranches = src.indexOf('recordBackupTime(LAST_SYNC_AT_KEY)');
  return beforeBranches > -1 && beforeBranches < src.indexOf('collectedConflicts.length > 0');
})());


// ---- third review: missing optional fields and bad optional values ----
bills.length = 0; income.length = 0;
bills.push({ ...r2, id: 'bc1', name: 'Rent', amount: 900, dueDate: dk(5), frequency: 'monthly', paidDates: [] });
renderBudget();
check('a bill with no category is not found by searching "undefined"', matchesBillSearch(bills[0], 'undefined') === false);
document.querySelector('#budget-list .edit-btn').click();
check('Edit opens for a bill with no category without showing "undefined"', document.querySelector('#budget-list .bill-edit-category').value === '');
bills.length = 0;

const realClick = HTMLAnchorElement.prototype.click;
let downloadName = '';
HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
exportData();
HTMLAnchorElement.prototype.click = realClick;
check('backup file names use the local date', downloadName === `budget-export-${todayKey()}.json`, downloadName);

// ---- the payday form survives a full disk ----
__mem.failWrites = true;
let paydayThrew = false;
let paydaySaved = true;
try { paydaySaved = savePaydaySettings({ payDateKey: dk(-3), frequency: 'weekly' }); } catch { paydayThrew = true; }
__mem.failWrites = false;
check('saving the payday while storage is full does not throw and shows the storage warning', !paydayThrew && paydaySaved === false && !!$('storage-warning'));
if ($('storage-warning')) $('storage-warning').remove();
check('saving the payday works again once storage is free', savePaydaySettings({ payDateKey: dk(-3), frequency: 'weekly' }) === true && loadPaydaySettings().frequency === 'weekly');

// ---- fourth review: import bookkeeping types, sync passphrase save failure ----
const okBill = { id: 'bk-ok', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly' };
check('import refuses a text "deleted" flag, a text version and a numeric updatedAt', !isValidImportRecord('bills', { ...okBill, deleted: 'false' }) && !isValidImportRecord('bills', { ...okBill, version: '3' }) && !isValidImportRecord('bills', { ...okBill, updatedAt: 5 }));
check('import still accepts real bookkeeping fields', isValidImportRecord('bills', { ...rb, ...okBill }) && isValidImportRecord('income', { ...rb, id: dk(1), dateKey: dk(1), amount: 5 }));
localStorage.removeItem('budgetApp.syncConfig.v1');
window.__mem.failWrites = true;
$('sync-token-input').value = 'full-disk-passphrase';
let setupThrew = false;
try { $('sync-setup-form').requestSubmit(); await sleep(50); } catch { setupThrew = true; }
window.__mem.failWrites = false;
check('a full disk when saving the passphrase is reported and keeps the form open', !setupThrew && !$('sync-setup').hidden && /Could not save the sync passphrase/.test($('data-io-status').textContent) && !loadSyncConfig(), $('data-io-status').textContent);
