// The app lock (PIN screen).

// ================= app lock =================
const waitFor = async (condition, ms = 8000) => { const start = Date.now(); while (!condition() && Date.now() - start < ms) await sleep(30); }; // wait for something slow (the PIN hash) instead of guessing a delay
const idle = async () => { for (let i = 0; i < 80 && lockChecking; i++) await sleep(50); await sleep(40); }; // wait for a PIN check to finish (it takes longer on a slow phone)
check('no lock to begin with', loadLock() === null && $('lock-btn').textContent === 'App lock: Off' && $('lock-now-btn').hidden);
check('a PIN must be 4 to 12 digits', !(await setAppLock('12')) && !(await setAppLock('abcd')) && !(await setAppLock('1234567890123')) && loadLock() === null);
check('a good PIN is saved', await setAppLock('4821') && loadLock() !== null);
check('only a salted hash is stored, never the PIN', !localStorage.getItem('budgetApp.lock.v1').includes('4821'));
check('the right PIN checks out and a wrong one does not', (await checkPin('4821')) && !(await checkPin('4822')));
check('the Menu shows the lock is on', $('lock-btn').textContent === 'App lock: On' && !$('lock-now-btn').hidden);
const lockedAttr = () => document.documentElement.hasAttribute('data-locked');
check('not locked until asked', !lockedAttr());
$('lock-now-btn').click();
check('Lock now shows the lock screen', lockedAttr() && getComputedStyle($('lock-screen')).display === 'flex');
set('lock-pin-input', '0000'); $('lock-form').requestSubmit(); await idle();
check('a wrong PIN stays locked and says so', lockedAttr() && !$('lock-error').hidden && /not right/.test($('lock-error').textContent));
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('the right PIN unlocks', !lockedAttr() && $('lock-pin-input').value === '');

// too many tries
lockNow();
for (let i = 0; i < 5; i++) { set('lock-pin-input', '1111'); $('lock-form').requestSubmit(); await idle(); }
check('five wrong tries pause further tries', /Wait 30 seconds/.test($('lock-error').textContent), $('lock-error').textContent);
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('even the right PIN waits during the pause', lockedAttr());
lockBlockedUntil = 0; lockFailures = 0;
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('and works once the pause is over', !lockedAttr());

// turning it off from the Menu
$('lock-btn').click();
check('the Menu button opens the turn-off dialog asking for the PIN', !$('lock-setup').hidden && !$('lock-setup-current').hidden && $('lock-setup-new').hidden);
set('lock-setup-current', '9999'); $('lock-setup-form').requestSubmit(); await waitFor(() => !$('lock-setup-error').hidden);
check('a wrong PIN does not turn it off', loadLock() !== null && !$('lock-setup-error').hidden);
set('lock-setup-current', '4821'); $('lock-setup-form').requestSubmit(); await waitFor(() => loadLock() === null);
check('the right PIN turns it off', loadLock() === null && $('lock-setup').hidden && $('lock-btn').textContent === 'App lock: Off');

// turning it on from the Menu
$('lock-btn').click();
check('with no lock, the button opens the new-PIN dialog', !$('lock-setup').hidden && $('lock-setup-current').hidden && !$('lock-setup-new').hidden);
set('lock-setup-new', '5566'); set('lock-setup-confirm', '5567'); $('lock-setup-form').requestSubmit(); await sleep(300);
check('PINs that do not match are refused', loadLock() === null && /do not match/.test($('lock-setup-error').textContent));
set('lock-setup-new', '55'); set('lock-setup-confirm', '55'); $('lock-setup-form').requestSubmit(); await sleep(300);
check('a short PIN is refused', loadLock() === null && /4 to 12 digits/.test($('lock-setup-error').textContent));
set('lock-setup-new', '5566'); set('lock-setup-confirm', '5566'); $('lock-setup-form').requestSubmit(); await waitFor(() => loadLock() !== null && $('lock-setup').hidden);
check('matching PINs turn it on', loadLock() !== null && $('lock-setup').hidden);
check('a damaged saved lock counts as no lock', (() => { localStorage.setItem('budgetApp.lock.v1', '{"salt":"x"}'); const none = loadLock() === null; localStorage.removeItem('budgetApp.lock.v1'); return none; })());
clearAppLock();

// forgot-PIN erases this device's data, but nothing else
localStorage.setItem('budgetApp.testKey.v1', 'x'); localStorage.setItem('unrelated', 'keep');
const erased = wipeDeviceData();
check('forgot-PIN wipes only the app data, nothing else', erased >= 1 && localStorage.getItem('budgetApp.testKey.v1') === null && localStorage.getItem('unrelated') === 'keep');
localStorage.removeItem('unrelated');

// ---- app lock ----
localStorage.removeItem('budgetApp.lockTries.v1');
await setAppLock('8642');
lockNow();
lockFailures = 0; lockBlockedUntil = 0;
for (let i = 0; i < 5; i++) { set('lock-pin-input', '0000'); $('lock-form').requestSubmit(); await idle(); }
const savedTries = JSON.parse(localStorage.getItem('budgetApp.lockTries.v1') || 'null');
check('the wrong-try pause is saved, so reloading the page cannot skip it', savedTries && savedTries.until > Date.now());
lockBlockedUntil = 0; lockFailures = 0; saveLockTries();
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await idle();
check('the right PIN unlocks and resets the saved tries', !document.documentElement.hasAttribute('data-locked') && JSON.parse(localStorage.getItem('budgetApp.lockTries.v1')).fails === 0);

// ---- locking closes what is open, and the lock only touches this app's data ----
clearAppLock();
localStorage.setItem('secondMemory.lock.v1', '{"salt":"x"}');
check('a Second Memory lock on the same site does not lock this app', loadLock() === null);
localStorage.removeItem('secondMemory.lock.v1');
await setAppLock('8642');
$('lock-btn').click();
check('the lock settings dialog is open', !$('lock-setup').hidden);
lockNow();
check('locking closes the lock settings dialog', $('lock-setup').hidden && document.documentElement.hasAttribute('data-locked'));
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await idle();
check('the page says Budget is locked, not Second Memory', /Budget is locked/.test($('lock-screen-title').textContent));
clearAppLock();
localStorage.setItem('secondMemory.books.v1', '[]'); localStorage.setItem('secondMemory.lock.v1', '{}');
wipeDeviceData();
check('Forgot PIN erases only budgetApp.* keys and never any Second Memory key',localStorage.getItem('secondMemory.books.v1') === '[]' && localStorage.getItem('secondMemory.lock.v1') === '{}');
localStorage.removeItem('secondMemory.books.v1'); localStorage.removeItem('secondMemory.lock.v1');
