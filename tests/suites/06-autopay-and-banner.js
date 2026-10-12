// Autopay bills and the bills banner.

// ================= autopay bills =================
bills.length = 0;
addBill({ name: 'Manual bill', amount: '40', dueDate: dk(1), frequency: 'monthly', category: '', autopay: false });
addBill({ name: 'Auto bill', amount: '90', dueDate: dk(1), frequency: 'monthly', category: '', autopay: true });
check('autopay is saved on the bill', bills.find((b) => b.name === 'Auto bill').autopay === true && bills.find((b) => b.name === 'Manual bill').autopay === false);
const autoCard = [...document.querySelectorAll('#budget-list .bill-card')].find((c) => c.querySelector('.bill-name').textContent === 'Auto bill');
const manualCard = [...document.querySelectorAll('#budget-list .bill-card')].find((c) => c.querySelector('.bill-name').textContent === 'Manual bill');
check('an autopay bill shows an Autopay label and a manual one does not', !autoCard.querySelector('.bill-autopay').hidden && manualCard.querySelector('.bill-autopay').hidden);
const bannerText = () => ($('reminder-banner').hidden ? '' : $('reminder-banner-text').textContent);
reminderBannerDismissed = false; renderBudget();
check('the top banner mentions the manual bill due tomorrow but not the autopay one', /Manual bill/.test(bannerText()) && !/Auto bill/.test(bannerText()), bannerText());
bills.find((b) => b.name === 'Manual bill').dueDate = dk(3); saveCollection(BILLS_KEY, bills); reminderBannerDismissed = false; renderBudget();
check('the banner only looks two days ahead (a bill in 3 days is not in it)', !/Manual bill/.test(bannerText()), bannerText());
// editing keeps/changes the flag
updateBill(bills.find((b) => b.name === 'Manual bill').id, { name: 'Manual bill', amount: '40', dueDate: dk(3), frequency: 'monthly', category: '', autopay: true });
check('editing can turn autopay on', bills.find((b) => b.name === 'Manual bill').autopay === true);
check('import accepts a true/false autopay and refuses anything else', isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', autopay: true }) && !isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', autopay: 'yes' }));
// the add form checkbox
set('budget-name-input', 'Form bill'); set('budget-amount-input', '12'); set('budget-duedate-input', dk(5));
$('budget-autopay-input').checked = true; $('budget-add-form').requestSubmit(); await sleep(30);
check('the add form saves the autopay box and then clears it', bills.find((b) => b.name === 'Form bill').autopay === true && $('budget-autopay-input').checked === false);


// a past-due autopay bill is not overdue, a manual one is
bills.length = 0;
addBill({ name: 'Auto', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: true });
addBill({ name: 'Manual', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: false });
const reminders = computeBillReminders(bills.filter((b) => !b.deleted));
check('a past-due autopay bill is not listed as overdue, a manual one still is', reminders.overdue.length === 1 && reminders.overdue[0].bill.name === 'Manual');
reminderBannerDismissed = false; renderBudget();
check('the banner counts one overdue bill, not two', /1 overdue \(\$10\.00\)/.test(bannerText()), bannerText());
bills.length = 0; renderBudget();
