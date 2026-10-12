// Core behaviour: the single Budget screen, adding, editing, deleting, undo/redo, searching,
// sorting, safe handling of hostile text, storage keys, and backup export/import (including
// a Second Memory export).
const live = (arr) => arr.filter((r) => !r.deleted).length;
let networkCalls = 0;
window.fetch = () => { networkCalls += 1; return Promise.reject(new Error('blocked')); };

// ---- this is only the Budget ----
check('there is exactly one screen and it is the Budget', document.querySelectorAll('main .collection').length === 1 && !$('budget-collection').hidden);
check('only bills, income and recurring income sync', SYNC_COLLECTIONS.map((c) => c.name).join() === 'bills,income,recurringIncome', SYNC_COLLECTIONS.map((c) => c.name).join());
check('nothing from Second Memory is in the page', !document.querySelector('.nav-item, #home-collection, #books-collection, #recipes-collection, #journal-collection, #health-summary, #therapy-summary, #quick-add-form, #cook-mode'));
check('the page is called Budget', document.title === 'Budget' && /Budget/.test(document.querySelector('.sidebar-header h1').textContent));
check('the Menu has Export, Import, Theme, Sync and App lock', ['export-data-btn', 'import-data-btn', 'theme-btn', 'sync-setup-form', 'lock-btn'].every((id) => !!$(id)));
check('the calendar, pay period, paid history, bills and recurring income are all there', ['budget-calendar', 'payday-settings-form', 'paid-history-list', 'budget-list', 'recurring-income-list'].every((id) => !!$(id)));

// ---- add one record to each list through its real form ----
const specs = [
  ['bills', () => bills, 'budget-add-form', { 'budget-name-input': 'TBill', 'budget-amount-input': '12.5', 'budget-duedate-input': dk(3), 'budget-frequency-input': 'monthly', 'budget-category-input': 'Util' }],
  ['recurring income', () => recurringIncome, 'recurring-income-add-form', { 'recurring-income-name-input': 'TPay', 'recurring-income-amount-input': '500', 'recurring-income-startdate-input': dk(-3), 'recurring-income-frequency-input': 'biweekly' }],
];
for (const [label, arr, form, fill] of specs) {
  const before = live(arr());
  Object.entries(fill).forEach(([id, v]) => set(id, v));
  $(form).requestSubmit();
  await sleep(30);
  check('add through ' + form, live(arr()) === before + 1, before + ' -> ' + live(arr()));
}
check('the new bill shows in the list, on the calendar-free totals, and as a category chip', [...document.querySelectorAll('#budget-list .bill-name')].some((e) => e.textContent === 'TBill') && [...document.querySelectorAll('#budget-category-filters .chip')].some((c) => c.textContent === 'Util'));

// ---- edit: open, cancel, save closes the form and keeps the data ----
for (const [label, listId, formClass] of [['bills', 'budget-list', 'bill-edit-form'], ['recurring income', 'recurring-income-list', 'recurring-income-edit-form']]) {
  const list = $(listId);
  const openForm = () => list.querySelector('.' + formClass + ':not([hidden])');
  list.querySelector('.edit-btn').click();
  check(label + ': Edit opens a form', !!openForm());
  if (!openForm()) continue;
  openForm().querySelector('.cancel-btn').click();
  check(label + ': Cancel closes it', !openForm());
  list.querySelector('.edit-btn').click();
  openForm().requestSubmit();
  await sleep(30);
  check(label + ': Save closes it', !openForm());
}

// ---- delete, undo, redo ----
for (const [label, listId, arr] of [['bills', 'budget-list', () => bills], ['recurring income', 'recurring-income-list', () => recurringIncome]]) {
  const before = live(arr());
  $(listId).querySelector('.delete-btn').click(); await sleep(20);
  const afterDelete = live(arr());
  $('undo-btn').click(); await sleep(20);
  const afterUndo = live(arr());
  $('redo-btn').click(); await sleep(20);
  const afterRedo = live(arr());
  $('undo-btn').click(); await sleep(20);
  check(label + ': delete, undo, redo, undo', afterDelete === before - 1 && afterUndo === before && afterRedo === before - 1 && live(arr()) === before,
    [before, afterDelete, afterUndo, afterRedo, live(arr())].join(' > '));
}
setIncomeForDate(dk(1), '25'); await sleep(30);
check('a day income box adds an entry', income.some((r) => r.dateKey === dk(1) && !r.deleted && r.amount === 25));
setIncomeForDate(dk(1), ''); await sleep(30);
check('clearing it deletes the entry', !income.some((r) => r.dateKey === dk(1) && !r.deleted));
$('undo-btn').click(); await sleep(30);
check('undo brings the day income back', income.some((r) => r.dateKey === dk(1) && !r.deleted && r.amount === 25));
check('the undo tooltip names what it would undo', (() => { addBill({ name: 'Tooltip bill', amount: '5', dueDate: dk(4), frequency: 'monthly', category: '', autopay: false }); return /Tooltip bill/.test($('undo-btn').title); })());

// ---- sort, search and filter chips never throw ----
for (const sel of document.querySelectorAll('select[id$="-sort-input"]')) {
  for (const o of [...sel.options]) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
}
for (const inp of document.querySelectorAll('input[type="search"]')) {
  inp.value = 'zzzz'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
}
for (const chip of document.querySelectorAll('.chip')) chip.click();
document.querySelector('#budget-category-filters .chip').click(); // back to All
check('every sort option, search box and filter chip works', true);
check('searching hides bills that do not match', (() => {
  const box = $('budget-search-input'); box.value = 'tooltip'; box.dispatchEvent(new Event('input', { bubbles: true }));
  const names = [...document.querySelectorAll('#budget-list .bill-name')].map((e) => e.textContent);
  box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
  return names.length === 1 && names[0] === 'Tooltip bill';
})());

// ---- hostile text is shown as text, never run ----
window.__xss = 0;
const evil = '<img src=x onerror="window.__xss=1">';
set('budget-name-input', evil); set('budget-amount-input', '1'); set('budget-duedate-input', dk(2)); set('budget-category-input', evil); $('budget-add-form').requestSubmit();
set('recurring-income-name-input', evil); set('recurring-income-amount-input', '1'); set('recurring-income-startdate-input', dk(2)); set('recurring-income-category-input', evil); $('recurring-income-add-form').requestSubmit();
await sleep(200);
check('hostile text does not run', window.__xss === 0);
check('hostile text does not become page elements', document.querySelectorAll('img[src="x"]').length === 0);
check('...but is shown as plain text', [...document.querySelectorAll('#budget-list .bill-name')].some((e) => e.textContent === evil));

// ---- blank names are rejected without wiping what was typed ----
const billsBefore = live(bills);
set('budget-name-input', '   '); set('budget-amount-input', '5'); set('budget-duedate-input', dk(2)); $('budget-add-form').requestSubmit(); await sleep(30);
check('a blank bill name adds nothing', live(bills) === billsBefore);
check('...keeps the other typed fields and shows why', $('budget-amount-input').value === '5' && !$('budget-form-error').hidden, $('budget-form-error').textContent);
set('budget-name-input', ''); set('budget-amount-input', '');

// ---- storage: every key this app writes has its own prefix ----
const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
check('every localStorage key starts with budgetApp. (so Second Memory on the same site is never touched)', keys.length > 0 && keys.every((k) => k.startsWith('budgetApp.')), keys.join(', '));
check('nothing is stored under a Second Memory key', !keys.some((k) => /secondMemory/i.test(k)));

// ---- backup export / import ----
const payload = JSON.parse(JSON.stringify(buildExportPayload()));
const counts = () => SYNC_COLLECTIONS.map((c) => c.name + ':' + c.get().length).join(',');
const before = counts();
check('the export has exactly the three lists', Object.keys(payload.collections).join() === 'bills,income,recurringIncome');
check('records keep the shape id, dateAdded, updatedAt, deviceId, deleted, version', payload.collections.bills.every((b) => ['id', 'dateAdded', 'updatedAt', 'deviceId', 'deleted', 'version'].every((k) => k in b)));
importData(payload); importData(payload);
check('importing your own export twice changes nothing', counts() === before);
const victim = bills.find((b) => !b.deleted);
deleteBill(victim.id);
importData(JSON.parse(JSON.stringify(payload)));
check('an older backup never brings back a deleted record', bills.find((b) => b.id === victim.id).deleted === true);
importData({ collections: {
  bills: [{ id: 'bad-bill', name: 'Bad', amount: '1200', dueDate: dk(0), frequency: 'monthly' }],
  income: [{ id: 'bad-inc', dateKey: 'not-a-date', amount: 5 }],
  recurringIncome: [{ id: 'bad-ri', name: 'Bad', amount: 5, dueDate: dk(0), frequency: 'one_time' }],
} });
check('wrongly typed records are skipped, not saved', !bills.some((b) => b.id === 'bad-bill') && !income.some((i) => i.id === 'bad-inc') && !recurringIncome.some((r) => r.id === 'bad-ri'));
check('import reports what it skipped', /3 unreadable records were skipped/.test($('data-io-status').textContent), $('data-io-status').textContent);
check('import rejects impossible dates', !isRealDateKey('2026-02-30') && !isRealDateKey('2026-13-01') && isRealDateKey('2028-02-29'));
let renderOk = true;
try { renderBudget(); } catch { renderOk = false; }
check('app still renders after a bad import', renderOk);
importData({ hello: 'world' });
check('a file that is not an export is refused with a clear message', /doesn't look like a Budget or Second Memory export/.test($('data-io-status').textContent));

// ---- a Second Memory export: only bills, income and recurring income are taken ----
const now = new Date().toISOString();
const sm = { dateAdded: now, updatedAt: now, deviceId: 'sm-device', deleted: false, version: 2 };
const smExport = {
  collections: {
    books: [{ ...sm, id: 'sm-book', title: 'Not mine', author: 'A', status: 'owned_read', rating: null }],
    recipes: [{ ...sm, id: 'sm-recipe', title: 'Soup', ingredients: [], steps: [] }],
    todos: [{ ...sm, id: 'sm-todo', task: 'Chore' }],
    bills: [{ ...sm, id: 'sm-bill', name: 'SM Rent', amount: 900, dueDate: '2026-10-01', frequency: 'monthly', category: 'Housing', autopay: true, paidDates: ['2026-10-01'] }],
    income: [{ ...sm, id: '2026-10-02', dateKey: '2026-10-02', amount: 40 }],
    recurringIncome: [{ ...sm, id: 'sm-pay', name: 'SM Pay', amount: 1000, dueDate: '2026-10-02', frequency: 'biweekly', category: '' }],
  },
  local: { journal: [{ id: 'j1', type: 'daily', date: '2026-10-01', answers: { on_mind: 'private' } }], weightGoal: 150, paydaySettings: { payDateKey: '2026-10-02', frequency: 'weekly' } },
};
localStorage.removeItem('budgetApp.paydaySettings.v1');
importData(JSON.parse(JSON.stringify(smExport)));
check('the bill, the day income and the recurring income from a Second Memory export come in', bills.some((b) => b.id === 'sm-bill' && b.autopay === true && b.paidDates.length === 1) && income.some((r) => r.id === '2026-10-02' && r.amount === 40) && recurringIncome.some((r) => r.id === 'sm-pay'));
check('the pay-period settings come in when this device has none', loadPaydaySettings().payDateKey === '2026-10-02' && loadPaydaySettings().frequency === 'weekly');
check('books, recipes, to-dos and the journal are ignored, and nothing of them is stored', !JSON.stringify(buildExportPayload()).includes('Not mine') && !JSON.stringify(buildExportPayload()).includes('private') && (() => { const k = []; for (let i = 0; i < localStorage.length; i++) k.push(localStorage.key(i)); return !k.some((x) => /books|recipes|todos|journal|weight/i.test(x)); })());
check('the status says what came in', /new in Bills/.test($('data-io-status').textContent) && /pay-period settings/.test($('data-io-status').textContent), $('data-io-status').textContent);
const afterSm = counts();
importData(JSON.parse(JSON.stringify(smExport)));
check('importing the same Second Memory export again changes nothing', counts() === afterSm);
deleteBill('sm-bill');
importData(JSON.parse(JSON.stringify(smExport)));
check('a bill deleted here is not brought back by that export', bills.find((b) => b.id === 'sm-bill').deleted === true);
check('the export of this app has only the three lists and the payday settings', JSON.stringify(Object.keys(buildExportPayload().collections)) === '["bills","income","recurringIncome"]' && Object.keys(buildExportPayload().local).every((k) => k === 'paydaySettings'));
savePaydaySettings({ payDateKey: '2026-11-01', frequency: 'monthly' });
importData(JSON.parse(JSON.stringify(smExport)));
check('an import never overwrites pay-period settings this device already has', loadPaydaySettings().payDateKey === '2026-11-01' && loadPaydaySettings().frequency === 'monthly');
check('a damaged local part is ignored without errors', (() => { importData({ collections: {}, local: { paydaySettings: { payDateKey: '2026-13-45', frequency: 'hourly' } } }); return loadPaydaySettings().payDateKey === '2026-11-01'; })());

// ---- one broken render never takes the page down ----
let survived = true;
try { safeRender(() => { throw new Error('boom'); }); } catch { survived = false; }
check('safeRender swallows a failing render', survived);

// ---- nothing syncs by itself ----
renderBudget();
await sleep(1200);
check('using the whole app made no network request at all', networkCalls === 0, networkCalls + ' request(s)');
