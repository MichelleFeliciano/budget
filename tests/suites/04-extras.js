// Menu extras: the theme button, the version label, and the backup / sync reminders.

// ---- theme ----
const html = document.documentElement;
check('theme starts on Auto (no data-theme)', !html.hasAttribute('data-theme') && $('theme-btn').textContent === 'Theme: Auto');
$('theme-btn').click();
check('first tap picks Light', html.getAttribute('data-theme') === 'light' && $('theme-btn').textContent === 'Theme: Light' && localStorage.getItem('budgetApp.theme.v1') === 'light');
$('theme-btn').click();
check('second tap picks Dark', html.getAttribute('data-theme') === 'dark' && localStorage.getItem('budgetApp.theme.v1') === 'dark');
$('theme-btn').click();
check('third tap goes back to Auto and forgets the choice', !html.hasAttribute('data-theme') && localStorage.getItem('budgetApp.theme.v1') === null);
localStorage.setItem('budgetApp.theme.v1', 'purple');
check('a damaged saved theme means Auto', loadTheme() === 'auto');
localStorage.removeItem('budgetApp.theme.v1');
localStorage.setItem('secondMemory.theme.v1', 'dark');
check('a Second Memory theme on the same site is not picked up', loadTheme() === 'auto');
localStorage.removeItem('secondMemory.theme.v1');

// ---- version label ----
check('the Menu shows the version', $('app-version').textContent === 'Version ' + APP_VERSION && Number.isInteger(APP_VERSION));

// ---- backup reminder ----
const noteText = () => $('backup-notes').hidden ? '' : $('backup-notes').textContent;
localStorage.removeItem('budgetApp.exportAt.v1'); backupNotesDismissed = false;
bills.length = 0; income.length = 0; recurringIncome.length = 0; renderBackupNotes();
check('no backup reminder when there is nothing to back up', $('backup-notes').hidden);
addBill({ name: 'Rent', amount: '900', dueDate: dk(3), frequency: 'monthly', category: '', autopay: false });
backupNotesDismissed = false; renderBackupNotes();
check('with data and no backup yet, it offers a full backup', /saved a full backup/.test(noteText()) && [...$('backup-notes').querySelectorAll('button')].some((x) => x.textContent === (CAN_SHARE_FILES ? 'Share backup' : 'Download full backup')), noteText());
localStorage.setItem('budgetApp.exportAt.v1', new Date().toISOString()); backupNotesDismissed = false; renderBackupNotes();
check('a recent backup clears it', $('backup-notes').hidden);
localStorage.setItem('budgetApp.exportAt.v1', new Date(Date.now() - 40 * 86400000).toISOString()); backupNotesDismissed = false; renderBackupNotes();
check('after 40 days it says so', /in 40 days/.test(noteText()), noteText());
check('the reminder never mentions a journal', !/journal/i.test(noteText()));
localStorage.setItem('budgetApp.exportAt.v1', new Date().toISOString());

// ---- stale sync reminder ----
localStorage.removeItem('budgetApp.syncConfig.v1');
localStorage.removeItem('budgetApp.lastSyncAt.v1');
backupNotesDismissed = false; renderBackupNotes();
check('no sync reminder when sync is not set up', !/synced in/.test(noteText()));
localStorage.setItem('budgetApp.syncConfig.v1', JSON.stringify({ token: 'tok' }));
renderBackupNotes();
check('turning sync on starts the clock without nagging', !/synced in/.test(noteText()) && !!localStorage.getItem('budgetApp.lastSyncAt.v1'));
localStorage.setItem('budgetApp.lastSyncAt.v1', new Date(Date.now() - 10 * 86400000).toISOString());
backupNotesDismissed = false;
renderBackupNotes();
check('after 10 days it says so, with a Sync now button', /synced in 10 days/.test(noteText()) && [...$('backup-notes').querySelectorAll('button')].some((x) => x.textContent === 'Sync now'), noteText());
localStorage.setItem('budgetApp.lastSyncAt.v1', new Date().toISOString());
backupNotesDismissed = false;
renderBackupNotes();
check('a recent sync clears the reminder', !/synced in/.test(noteText()));
[...$('backup-notes').querySelectorAll('button')];
localStorage.setItem('budgetApp.lastSyncAt.v1', new Date(Date.now() - 10 * 86400000).toISOString());
backupNotesDismissed = false; renderBackupNotes();
$('backup-notes').querySelector('button[aria-label="Dismiss backup reminders"]').click();
check('Dismiss hides the reminders', $('backup-notes').hidden);
localStorage.removeItem('budgetApp.syncConfig.v1');
bills.length = 0;
