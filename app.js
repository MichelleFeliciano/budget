// Budget: bills, income and the pay period, as a small standalone app.
// All persistence is local (localStorage). No dependencies. The only network call is the
// optional manual "Sync now" to this app's own sync server (server/sync_server.py).
//
// This app began as the Budget tab of another app (Second Memory) and is now fully separate: its own
// repository, storage names and sync server.
//
// How this file is organised (top to bottom):
//   Shared helpers, filter/sort helpers, keyboard-focus keeping, device identity & sync
//   metadata, undo/redo, Budget (bills, income, recurring income, paid history, pay period,
//   calendar), backup reminders, the due/overdue bills banner, Device Sync (server address,
//   sync client, undo/redo application), data export/import, day rollover, theme and version,
//   App lock, and Init (which also wires the phone Menu button and registers the service worker).
//
// Each list is an array of plain records kept in memory and saved whole to its own
// localStorage key. A record looks like:
//   { id, ...its own fields..., dateAdded, updatedAt, deviceId, deleted, version }
// - updatedAt / deviceId are stamped on every change (see stampSync).
// - Deleting never removes a record: it sets deleted:true (a "tombstone") so a later sync
//   can tell "deleted here" apart from "never existed here". Screens skip deleted records.
// - version is the server's counter for the record; 0 means the server hasn't confirmed it yet.
//
// There are three lists: bills, income (one entry per day) and recurringIncome. Syncing is
// manual only (the user presses "Sync now"); nothing runs in the background.
//
// Every localStorage key starts with "budgetApp." so that, if another app is ever hosted at the same
// web address (browsers share storage per address), the two cannot overwrite each other's data.

// ---- Shared helpers ----

// A unique id for a new record (falls back to time + random where randomUUID is missing).
function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Reads a saved list from localStorage; anything missing or corrupt becomes an empty list.
function loadCollection(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    // Keep only real records; a stray null or number in the saved list would otherwise crash the load.
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  } catch {
    return [];
  }
}

// Shown when the browser refuses to save (storage full, blocked, or private mode).
// Without this the change would stay on screen and quietly vanish on reload.
function reportStorageProblem() {
  if (document.getElementById('storage-warning')) return;
  const box = document.createElement('div');
  box.id = 'storage-warning';
  box.className = 'storage-warning';
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = "Couldn't save: this browser's storage is full or blocked. Your latest change is only on " +
    'screen and will be lost if you close or reload. Use Export data, then free up space.';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Dismiss';
  close.addEventListener('click', () => box.remove());
  box.append(text, close);
  document.body.appendChild(box);
}

// Writes a whole list to localStorage. Returns false (and shows the warning) if the browser refuses.
function saveCollection(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
    scheduleSyncPending();
    return true;
  } catch {
    reportStorageProblem();
    return false;
  }
}

// Runs a redraw but logs instead of throwing, so one broken screen can't stop the others.
function safeRender(fn) {
  try {
    fn();
  } catch (err) {
    console.error('render failed:', err);
  }
}

// ---- Shared filter/sort helpers ----
// Used by the Bills sort <select> and the category chips so the
// null-last convention and chip-grouping logic are implemented once.

// Builds a comparator for Array.prototype.sort() from a value-extractor.
// Missing values (null/undefined/empty string — never a falsy-but-real value
// like 0) always sort last, regardless of `direction`. `direction` is 1 for
// ascending, -1 for descending. By default, string values compare
// case-insensitively via localeCompare (for genuine text fields like title/
// author/name). Pass `{ text: false }` for ISO date/timestamp strings (and
// numbers) so they compare directly with `<`/`>` instead — locale collation
// is unnecessary for fixed-format dates and safer to avoid entirely. Sorts a
// fresh, already-filtered array — never mutates it in a way that touches the
// underlying collection's insertion order.
function compareByField(getValue, direction = 1, { text = true } = {}) {
  return (a, b) => {
    const valueA = getValue(a);
    const valueB = getValue(b);
    const missingA = valueA === null || valueA === undefined || valueA === '';
    const missingB = valueB === null || valueB === undefined || valueB === '';
    if (missingA && missingB) return 0;
    if (missingA) return 1;
    if (missingB) return -1;
    if (text && typeof valueA === 'string' && typeof valueB === 'string') {
      return direction * valueA.localeCompare(valueB, undefined, { sensitivity: 'base' });
    }
    if (valueA < valueB) return -direction;
    if (valueA > valueB) return direction;
    return 0;
  };
}

// Trims and case-folds a free-text chip value so near-duplicates ("Rent"
// vs. "rent ") group into one chip instead of two.
function normalizeChipKey(value) {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

// Derives the distinct chip groups from a live, non-deleted array: one entry
// per normalized key, displayed using the first-seen original casing/spacing
// for that group, sorted alphabetically. Blank/missing values are excluded —
// the caller adds the "All" option on top of this.
function deriveChipOptions(items, getValue) {
  const byKey = new Map();
  items.forEach((item) => {
    const value = getValue(item);
    const raw = (typeof value === 'string' ? value : '').trim();
    if (!raw) return;
    const key = normalizeChipKey(raw);
    if (!byKey.has(key)) byKey.set(key, raw);
  });
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

// Shared chip-filter renderer: renders one chip per option, auto-resets the
// current selection to 'all' if it disappeared from `options` (e.g. the last
// item with that value was deleted), and wires click handlers via the
// caller's own get/set for its module-level selection variable. `options`
// must include the `{ key: 'all', label: 'All' }` entry itself.
function renderChipFilter(container, options, getSelected, setSelected, onSelect) {
  if (!container) return;
  const keys = options.map((o) => o.key);
  if (getSelected() !== 'all' && !keys.includes(getSelected())) {
    setSelected('all');
  }

  container.innerHTML = '';
  options.forEach(({ key, label }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = label;
    chip.classList.toggle('chip-active', getSelected() === key);
    chip.setAttribute('aria-pressed', String(getSelected() === key));
    chip.addEventListener('click', () => {
      setSelected(key);
      onSelect();
    });
    container.appendChild(chip);
  });
}

// ---- Keep keyboard focus when a list redraws ----
// Every screen rebuilds its cards from scratch after a change. That used to throw away the
// control you were on (tick a paid box with Space and focus fell back to the top of the page).
// withFocusRestore() remembers which control had focus, lets the screen redraw, then puts
// focus back on the equivalent control in the new cards.

// What counts as one card/row when working out where focus was.
const FOCUS_UNIT = 'li, .budget-day-cell, tr';

// A control's visible text with whitespace collapsed, used to recognise it after a redraw.
function focusText(node) {
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

// A fingerprint of what kind of control this is (tag, classes, label, input type).
function focusKind(node) {
  return [node.tagName, [...node.classList].sort().join('.'), node.getAttribute('aria-label') || '', node.type || ''].join('|');
}

// Identifies one card/row by its date (calendar cells) and the start of its text.
function focusUnitSignature(unit) {
  return (unit.dataset.dateKey || '') + '|' + focusText(unit).slice(0, 160);
}

// Notes down which control currently has focus (and where it sits) so it can be found again
// after the screen redraws. Returns null when focus isn't inside a list screen.
function describeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const section = el.closest('[id$="-collection"]');
  if (!section) return null;
  const chip = el.closest('.chip');
  if (chip && chip.parentElement && chip.parentElement.id) {
    return { sectionId: section.id, mode: 'chip', containerId: chip.parentElement.id, label: focusText(chip) };
  }
  const unit = el.closest(FOCUS_UNIT);
  if (unit && section.contains(unit)) {
    const units = [...section.querySelectorAll(FOCUS_UNIT)];
    const signature = focusUnitSignature(unit);
    const unitIndex = units.indexOf(unit);
    const kind = focusKind(el);
    return {
      sectionId: section.id,
      mode: 'unit',
      signature,
      sameBefore: units.slice(0, unitIndex).filter((u) => focusUnitSignature(u) === signature).length,
      unitIndex,
      kind,
      controlIndex: Math.max(0, [...unit.querySelectorAll('*')].filter((n) => focusKind(n) === kind).indexOf(el)),
    };
  }
  if (el.id) return { sectionId: section.id, mode: 'id', id: el.id };
  return { sectionId: section.id, mode: 'loose', kind: focusKind(el), label: focusText(el) };
}

// Puts focus back on the control described by describeFocus, trying the closest match first.
function restoreFocus(d) {
  if (!d) return;
  const active = document.activeElement;
  // Something (e.g. the budget screen's own income-box logic) already put focus back.
  if (active && active !== document.body && document.contains(active)) return;
  const section = document.getElementById(d.sectionId);
  if (!section || section.hidden) return;
  let target = null;
  if (d.mode === 'chip') {
    const container = document.getElementById(d.containerId);
    const chips = container ? [...container.querySelectorAll('.chip')] : [];
    target = chips.find((c) => focusText(c) === d.label) || chips[0] || null;
  } else if (d.mode === 'id') {
    target = document.getElementById(d.id);
  } else if (d.mode === 'unit') {
    const units = [...section.querySelectorAll(FOCUS_UNIT)];
    const same = units.filter((u) => focusUnitSignature(u) === d.signature);
    const unit = same[d.sameBefore] || same[0] || null;
    if (unit) {
      const matches = [...unit.querySelectorAll('*')].filter((n) => focusKind(n) === d.kind);
      target = matches[d.controlIndex] || matches[0] || null;
    } else if (units.length) {
      // The card is gone (deleted, or filtered out). Land on the first control of the card now
      // in its place, never on its Delete button, so pressing Enter again can't remove the next item.
      const next = units[Math.min(d.unitIndex, units.length - 1)];
      target = next.querySelector('input:not([type=hidden]), select, textarea, a[href], button:not(.delete-btn)');
    }
  } else if (d.mode === 'loose') {
    target = [...section.querySelectorAll('button, input, select, textarea, a[href]')]
      .find((n) => focusKind(n) === d.kind && focusText(n) === d.label) || null;
  }
  if (target && !target.disabled && !target.hidden) target.focus({ preventScroll: true });
}

// Wraps a render function so keyboard focus survives the redraw.
function withFocusRestore(render) {
  return function wrappedRender(...args) {
    const snapshot = describeFocus();
    const result = render.apply(this, args);
    restoreFocus(snapshot);
    return result;
  };
}

// Install the focus-keeping wrapper (function declarations are hoisted, so this is safe at the top).
renderBudget = withFocusRestore(renderBudget);

// ---- Device identity & sync metadata ----

// Where this browser's permanent random id is saved.
const DEVICE_KEY = 'budgetApp.device.v1';
// The device id once read, so storage is only parsed once.
let cachedDeviceId = null;

// This browser's permanent random id (created on first use); stamped onto every record it edits.
function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.deviceId === 'string') {
      cachedDeviceId = parsed.deviceId;
      return cachedDeviceId;
    }
  } catch {
    // fall through and generate a new one
  }
  cachedDeviceId = makeId();
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ deviceId: cachedDeviceId, createdAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable: this device id just won't persist across reloads.
  }
  return cachedDeviceId;
}

// Marks a record as just changed on this device. Call on every add/edit/delete/restore.
function stampSync(record) {
  record.updatedAt = new Date().toISOString();
  record.deviceId = getDeviceId();
}

// Backfills sync metadata onto records written before sync existed. Presence
// checks (not truthiness) so it's idempotent and never re-derives a value
// that's already there. `version: 0` means "never confirmed by the server."
function migrateSyncFields(items, key, deviceId) {
  let changed = false;
  items.forEach((item) => {
    if (!('updatedAt' in item)) {
      item.updatedAt = item.dateModified || item.dateAdded;
      changed = true;
    }
    if (!('deviceId' in item)) {
      item.deviceId = deviceId;
      changed = true;
    }
    if (!('deleted' in item)) {
      item.deleted = false;
      changed = true;
    }
    if (!('version' in item)) {
      item.version = 0;
      changed = true;
    }
  });
  if (changed) saveCollection(key, items);
  return items;
}


// ---- Undo/Redo ----
// In-memory only, never persisted. One entry per changed record (never a
// whole-array snapshot).

// Each entry is { collection, id, before, after, timestamp }; before is null for a brand-new record.
let undoStack = [];
// Undone changes that can be re-applied (any new change clears this list).
let redoStack = [];
let isApplyingHistory = false; // guard: undo/redo replays never re-record themselves
// How many changes undo remembers; older ones are dropped.
const MAX_UNDO_DEPTH = 50;

// Remembers one change (the record before and after) so it can be undone; clears the redo list.
function recordUndo(collectionName, id, before, after) {
  if (isApplyingHistory) return;
  undoStack.push({
    collection: collectionName,
    id,
    before: before === null ? null : structuredClone(before),
    after: structuredClone(after),
    timestamp: new Date().toISOString(),
  });
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
  const toastMessage = undoToastMessage(collectionName, before, after);
  if (toastMessage) showUndoToast(toastMessage);
}

// ---- Budget (Bills + rolling 5-week calendar) ----
// Storage key: budgetApp.bills.v1.

// localStorage key for the bills list.
const BILLS_KEY = 'budgetApp.bills.v1';
// How often a bill repeats, and the label shown for each option.
const BILL_FREQUENCIES = ['one_time', 'weekly', 'biweekly', 'monthly', 'yearly'];
// Display text for each bill repeat option.
const BILL_FREQUENCY_LABELS = {
  one_time: 'One-time', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly',
};

// Every bill, including deleted ones (kept as tombstones), loaded and upgraded at startup.
let bills = migrateSyncFields(loadCollection(BILLS_KEY), BILLS_KEY, getDeviceId());

// ---- Date helpers ----
// All date-key values are local-date-derived 'YYYY-MM-DD' strings — never
// `toISOString()`-derived, which is UTC, not local (that was a past bug).
// Comparisons between two date keys use plain string comparison,
// which is correct for this fixed zero-padded format.

// A date key is a 'YYYY-MM-DD' string; this checks the shape (not that the date is real).
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Builds a 'YYYY-MM-DD' key; monthIndex is 0-based (0 = January) like JavaScript dates.
function dateKeyFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The date key for a Date, using the local calendar day.
function dateKeyFromLocalDate(date) {
  return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
}

// Today's date key in local time.
function todayKey() {
  return dateKeyFromLocalDate(new Date());
}

// Splits a date key into { y, m, d } numbers (m is 0-based).
function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d }; // m is 0-indexed to match Date's convention
}

// A real calendar date in YYYY-MM-DD form (rejects 2026-13-45 and 2026-02-30).
function isRealDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const { y, m, d } = parseDateKey(value);
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
}

// How many days a month has (handles leap years); monthIndex is 0-based.
function daysInMonth(year, monthIndex) {
  // The "day 0" trick: day 0 of month M+1 is the last day of month M.
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Whole days from one date key to another (positive if toKey is later), safe across clock changes.
function utcDayDiff(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  // UTC-anchored: never diff local-millisecond timestamps, that's DST-unsafe.
  // Every UTC day is exactly 86,400,000ms.
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
}

// Adds (or subtracts) whole days to a date key. Local calendar-day arithmetic, safe from the
// DST pitfall above because it increments the day-of-month FIELD and lets Date's constructor
// normalize month/year rollover — the same technique the calendar window math uses.
function shiftDateKey(key, deltaDays) {
  const { y, m, d } = parseDateKey(key);
  return dateKeyFromLocalDate(new Date(y, m, d + deltaDays));
}

// ---- Occurrence generation ----

// True if a bill falls due on this date, given its first due date and how often it repeats.
function occursOnDate(bill, dateKey) {
  if (bill.frequency === 'one_time') return dateKey === bill.dueDate;

  const anchor = parseDateKey(bill.dueDate);
  const candidate = parseDateKey(dateKey);

  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    const period = bill.frequency === 'weekly' ? 7 : 14;
    const dayDiff = utcDayDiff(bill.dueDate, dateKey);
    return dayDiff >= 0 && dayDiff % period === 0;
  }

  if (bill.frequency === 'monthly') {
    const monthOffset = (candidate.y - anchor.y) * 12 + (candidate.m - anchor.m);
    if (monthOffset < 0) return false;
    const expectedDay = Math.min(anchor.d, daysInMonth(candidate.y, candidate.m));
    return candidate.d === expectedDay;
  }

  if (bill.frequency === 'yearly') {
    const yearOffset = candidate.y - anchor.y;
    if (yearOffset < 0 || candidate.m !== anchor.m) return false;
    const expectedDay = Math.min(anchor.d, daysInMonth(candidate.y, candidate.m));
    return candidate.d === expectedDay;
  }

  return false;
}

// Closed-form occurrence count through a date, no day-by-day loop — needed
// for the weekly-total carry-forward formula, which must ask "how many
// occurrences has this bill had, on or before this date" for a bill whose
// anchor could be arbitrarily far in the past.
function occurrenceCountThrough(bill, throughKey) {
  if (throughKey < bill.dueDate) return 0;
  if (bill.frequency === 'one_time') return 1;

  const anchor = parseDateKey(bill.dueDate);
  const through = parseDateKey(throughKey);

  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    const period = bill.frequency === 'weekly' ? 7 : 14;
    const dayDiff = utcDayDiff(bill.dueDate, throughKey);
    return Math.floor(dayDiff / period) + 1;
  }

  if (bill.frequency === 'monthly') {
    const monthOffsetMax = (through.y - anchor.y) * 12 + (through.m - anchor.m);
    const expectedDay = Math.min(anchor.d, daysInMonth(through.y, through.m));
    const lastOccurrenceKey = dateKeyFromParts(through.y, through.m, expectedDay);
    // If this month's occurrence hasn't happened yet as of throughKey, don't count it.
    return lastOccurrenceKey <= throughKey ? monthOffsetMax + 1 : monthOffsetMax;
  }

  if (bill.frequency === 'yearly') {
    const yearOffsetMax = through.y - anchor.y;
    const expectedDay = Math.min(anchor.d, daysInMonth(anchor.y + yearOffsetMax, anchor.m));
    const lastOccurrenceKey = dateKeyFromParts(anchor.y + yearOffsetMax, anchor.m, expectedDay);
    return lastOccurrenceKey <= throughKey ? yearOffsetMax + 1 : yearOffsetMax;
  }

  return 0;
}

// A payment is worth what was paid when it was marked paid, not whatever the bill's amount is
// today. Each paid date can carry its amount in `paidAmounts` ({ "2026-09-01": 1000 }). Payments
// recorded before that existed (or by an older copy of the app) have no entry and fall back to the
// bill's amount; they get their amount frozen the moment the bill's amount is edited (updateBill).
function paidAmountFor(bill, dateKey) {
  const map = bill.paidAmounts;
  if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, dateKey)) {
    const stored = map[dateKey];
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  }
  return bill.amount;
}

// Identifies one real payment, so a payment recorded on several copies of the same bill is counted
// once. Copies come from a sync conflict or a restore from a backup: both clone the record and change
// only its id, so a copy keeps the original bill's creation time (dateAdded). Two bills you created
// yourself never share one, even with the same name, amount and paid date (two loans both called
// "Student loan" are two payments, not one). A bill with no creation time is never merged with another.
function paymentIdentity(bill, dateKey) {
  const origin = bill.dateAdded || `id:${bill.id}`;
  return `${origin}|${paidAmountFor(bill, dateKey)}|${dateKey}`;
}

// What one occurrence is worth: the recorded amount if it was paid, the current amount if not.
function occurrenceAmount(bill, dateKey) {
  return (bill.paidDates || []).includes(dateKey) ? paidAmountFor(bill, dateKey) : bill.amount;
}

// Total still owed for a bill's occurrences up to a date (occurrences so far minus paid ones, times the amount).
function unpaidAmountThrough(bill, throughKey) {
  const totalOccurrences = occurrenceCountThrough(bill, throughKey);
  if (totalOccurrences === 0) return 0;
  const paidCount = new Set((bill.paidDates || []).filter((d) => d <= throughKey && occursOnDate(bill, d))).size;
  return Math.max(0, totalOccurrences - paidCount) * bill.amount;
}

// Walks forward from the bill's anchor dueDate to find the single earliest
// occurrence date that is real (per occursOnDate) and not already paid, up
// through and including throughKey. A plain day-by-day walk (not a
// closed-form jump) is deliberately the simplest-correct approach here —
// this only runs on an explicit user click (the "mark oldest unpaid as
// paid" button's handler); render-time code uses the O(1)-ish
// unpaidAmountThrough instead to avoid paying this walk's cost on every render.
function oldestUnpaidOccurrence(bill, throughKey) {
  const paidSet = new Set(bill.paidDates || []);
  let dateKey = bill.dueDate;
  while (dateKey <= throughKey) {
    if (occursOnDate(bill, dateKey) && !paidSet.has(dateKey)) return dateKey;
    dateKey = shiftDateKey(dateKey, 1);
  }
  return null;
}

// ---- Calendar window ----

// How many weeks the calendar is slid from its usual place (0 = last week, this week and next week);
// the Earlier / Later buttons change it and Today resets it.
let calendarWeekOffset = 0;

// The 21 days the budget calendar shows: three Monday-start weeks. Normally last week, this week and next
// week; weekOffset slides the window by whole weeks.
function getCalendarWindowDays(today = new Date(), weekOffset = calendarWeekOffset) {
  const dow = (today.getDay() + 6) % 7; // days since Monday (getDay() is 0 = Sunday)
  const startOfThisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
  const windowStart = new Date(
    startOfThisWeek.getFullYear(),
    startOfThisWeek.getMonth(),
    startOfThisWeek.getDate() - 7 + weekOffset * 7
  );
  const days = [];
  for (let i = 0; i < 21; i++) {
    days.push(new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + i));
  }
  return days.map(dateKeyFromLocalDate); // 21 date-key strings, Monday-start
}

// Month names indexed by 0-based month number.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Heading for a calendar week, from how many weeks it is from this one: Last week, This week or Next week,
// and "Week of Oct 5" for any other.
function calendarWeekLabel(weeksFromThis, firstDayKey) {
  if (weeksFromThis === -1) return 'Last week';
  if (weeksFromThis === 0) return 'This week';
  if (weeksFromThis === 1) return 'Next week';
  const { m, d } = parseDateKey(firstDayKey);
  return `Week of ${MONTH_NAMES[m].slice(0, 3)} ${d}`;
}

// Everything due from startKey to endKey inclusive (a paid occurrence counts at the amount it was paid at).
// With unpaidOnly, paid occurrences are skipped, which is the week's "Due" (what is left to pay). Without it
// this is the week, month and pay-period "total", which marking a bill paid never changes; the net is
// income minus that total, so it moves only when income does.
function amountDueInRange(startKey, endKey, allBills, unpaidOnly = false) {
  const live = allBills.filter((b) => !b.deleted);
  let sum = 0;
  for (let dateKey = startKey; dateKey <= endKey; dateKey = shiftDateKey(dateKey, 1)) {
    live.forEach((b) => {
      if (!occursOnDate(b, dateKey)) return;
      if (unpaidOnly && (b.paidDates || []).includes(dateKey)) return;
      sum += occurrenceAmount(b, dateKey);
    });
  }
  return sum;
}

// ---- Income (per-day manual number, a synced collection) ----
// `id` is deliberately the record's own `dateKey`, not a fresh makeId() UUID like bills and
// recurring income use: it gives "one income entry per date" a real identity-level guarantee
// across the normal sync-merge paths, at the cost of setIncomeForDate needing to find-or-create
// by dateKey instead of blindly pushing.

// localStorage key for the per-day income entries.
const INCOME_KEY = 'budgetApp.income.v1';
// Every per-day income record, loaded and upgraded at startup.
let income = migrateSyncFields(loadCollection(INCOME_KEY), INCOME_KEY, getDeviceId());

// Sets (or clears, when the value is '') the manual income number for one calendar day.
function setIncomeForDate(dateKey, rawValue) {
  const existing = income.find((r) => r.id === dateKey);

  if (rawValue === '') {
    // Clear every live record for the date (a restore or conflict can leave a second one with a
    // different id), otherwise the old value would come back.
    income.filter((r) => r.dateKey === dateKey && !r.deleted).forEach((r) => deleteIncome(r.id));
    return; // already blank/absent — no-op, nothing to record
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_MONEY) {
    setTimeout(renderBudget, 0); // refused: put the saved value back in the box instead of leaving the rejected number showing
    return;
  }
  const amount = Math.round(parsed * 100) / 100; // whole cents, like bills

  if (existing) {
    const before = structuredClone(existing);
    existing.amount = amount;
    existing.deleted = false; // re-entering a value on a previously-cleared date un-tombstones
                               // the same record rather than creating a second one for that id
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', dateKey, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: dateKey, dateKey, amount,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', dateKey, null, structuredClone(record));
  }

  // Deferred, not called synchronously: this fires from the income input's
  // `change` handler, which the browser dispatches as part of a Tab key's
  // default action — moving focus to the next cell is a later step of that
  // same synchronous algorithm. Rebuilding the calendar (which destroys and
  // recreates every cell, including the one about to be focused) inside that
  // window pulls the rug out from under the browser's own focus-move, and it
  // lands on nothing (document.body) instead of the next cell. Deferring to
  // a macrotask lets Tab's native focus-move finish first, so the existing
  // focusedManualInput capture (in renderBudget) correctly sees the *new*
  // cell as focused and restores focus onto its freshly-rebuilt replacement.
  setTimeout(renderBudget, 0);
}

// Soft-deletes a day's income entry (keeps a tombstone so syncing can tell it was cleared).
function deleteIncome(id) {
  const record = income.find((r) => r.id === id);
  if (!record) return;
  const before = structuredClone(record);
  record.deleted = true;
  stampSync(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', id, before, structuredClone(record));
  // Deferred — see the matching comment in setIncomeForDate. Reachable
  // directly from that function's "clear the input" path, which is a Tab
  // key commit exactly like the add/edit path.
  setTimeout(renderBudget, 0);
}

// Brings a cleared income entry back (used by undo).
function restoreIncome(id) {
  const record = income.find((r) => r.id === id);
  if (!record || !record.deleted) return;
  const before = structuredClone(record);
  record.deleted = false;
  stampSync(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', id, before, structuredClone(record));
  renderBudget();
}

// Income is one entry per date. If two live entries for one date ever exist (from an old conflict or
// restore), only the most recently edited one is used, so nothing is counted twice.
function uniqueIncomeByDate(records) {
  const latest = new Map();
  records.forEach((r) => {
    const current = latest.get(r.dateKey);
    if (!current || (r.updatedAt || '') > (current.updatedAt || '')) latest.set(r.dateKey, r);
  });
  return [...latest.values()];
}

// Deliberately NOT cumulative-through-date, unlike unpaidAmountThrough(). Each
// income record is summed into exactly the one week (or month) whose range its dateKey falls
// in — never carried into subsequent periods.
function incomeSumInRange(startKey, endKey, allIncome) {
  return allIncome
    .filter((r) => !r.deleted && r.dateKey >= startKey && r.dateKey <= endKey)
    .reduce((sum, r) => sum + r.amount, 0);
}

// Formats money with a sign ("-$5.00"). Bill figures are non-negative by construction
// (unpaidAmountThrough clamps at 0; a bill's amount is validated > 0), so they use the plain
// `$${x.toFixed(2)}`. Income (a manual amount may be negative) and net totals (can go negative)
// must use this instead.
function formatSignedCurrency(amount) {
  const abs = Math.abs(amount).toFixed(2);
  // Check the sign of the *rounded* magnitude, not the raw value — a tiny
  // negative amount (a near-cancelling net total, a stray floating-point
  // epsilon) that rounds to 0.00 should never display as "-$0.00".
  return (amount < 0 && abs !== '0.00') ? `-$${abs}` : `$${abs}`;
}

// The CSS class for a net/income figure: red when negative, normal otherwise. Separate from
// formatSignedCurrency because only net totals and the day income dot are colored, not income totals.
function signedAmountClass(amount) {
  // Compare in whole cents so float noise (e.g. -5.5e-17) never paints $0.00 red.
  return Math.round(amount * 100) / 100 < 0 ? 'amount-negative' : 'amount-positive';
}

// ---- Bill CRUD ----

// Dates outside this range are almost always a typo (typing "26" for the year gives 0026),
// and a year before 1000 breaks the schedule math and makes the budget screen crawl.
const DATE_YEAR_MIN = 1990;
// Latest year a date field accepts.
const DATE_YEAR_MAX = 2100;
// True if a YYYY-MM-DD string has a year inside the allowed range.
function isReasonableDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return !!m && Number(m[1]) >= DATE_YEAR_MIN && Number(m[1]) <= DATE_YEAR_MAX;
}
// Error text shown when a date is outside that range.
const DATE_RANGE_MESSAGE = `Pick a date between the years ${DATE_YEAR_MIN} and ${DATE_YEAR_MAX}.`;

// The largest amount accepted for a bill or income entry (keeps totals and displays sane).
const MAX_MONEY = 1000000000;

// Checks and cleans a bill's form values (name, amount above $0, due date); unknown frequency becomes monthly.
function validateBillFields(fields) {
  const trimmedName = fields.name.trim();
  if (!trimmedName) return { ok: false, error: 'Bill name is required.' };
  const amount = Math.round(Number(fields.amount) * 100) / 100; // whole cents, as it will be shown
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) {
    return { ok: false, error: 'Amount must be between $0.01 and $1,000,000,000.' };
  }
  const dueDate = fields.dueDate;
  if (!dueDate) return { ok: false, error: 'Due date is required.' };
  if (!isReasonableDateKey(dueDate)) return { ok: false, error: DATE_RANGE_MESSAGE };
  const frequency = BILL_FREQUENCIES.includes(fields.frequency) ? fields.frequency : 'monthly';
  return { ok: true, name: trimmedName, amount, dueDate, frequency, category: fields.category.trim(), autopay: !!fields.autopay };
}

// Adds a bill. Returns { ok } or { ok: false, error } if the fields don't validate.
function addBill(fields) {
  const result = validateBillFields(fields);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  const bill = {
    id: makeId(),
    name: result.name,
    amount: result.amount,
    dueDate: result.dueDate,
    frequency: result.frequency,
    category: result.category,
    autopay: result.autopay,
    paidDates: [],
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  bills.push(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', bill.id, null, structuredClone(bill));
  renderBudget();
  return { ok: true, id: bill.id };
}

// The date of a schedule's nth (0-based) occurrence, or null if it has none.
function nthOccurrenceDate(bill, n) {
  const anchor = parseDateKey(bill.dueDate);
  if (bill.frequency === 'one_time') return n === 0 ? bill.dueDate : null;
  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    return shiftDateKey(bill.dueDate, n * (bill.frequency === 'weekly' ? 7 : 14));
  }
  if (bill.frequency === 'monthly') {
    const total = anchor.y * 12 + anchor.m + n;
    const y = Math.floor(total / 12);
    const m = total % 12;
    return dateKeyFromParts(y, m, Math.min(anchor.d, daysInMonth(y, m)));
  }
  if (bill.frequency === 'yearly') {
    const y = anchor.y + n;
    return dateKeyFromParts(y, anchor.m, Math.min(anchor.d, daysInMonth(y, anchor.m)));
  }
  return null;
}

// Saves edits to a bill. Never touches paidDates except to carry existing payments over to a new
// schedule; only toggleBillPaid (and the "mark oldest unpaid as paid" button, which calls it) marks payments.
function updateBill(id, fields) {
  const bill = bills.find((b) => b.id === id);
  if (!bill) return { ok: false, error: 'Bill not found.' };
  const result = validateBillFields(fields);
  if (!result.ok) return result;
  const before = structuredClone(bill);
  const oldSchedule = { dueDate: bill.dueDate, frequency: bill.frequency };
  // Changing the amount must not rewrite money that was already paid: record each existing
  // payment at the amount it was actually paid before the new amount takes effect.
  if (result.amount !== bill.amount) {
    const frozen = { ...(bill.paidAmounts || {}) };
    (bill.paidDates || []).forEach((d) => {
      if (!Object.prototype.hasOwnProperty.call(frozen, d)) frozen[d] = bill.amount;
    });
    bill.paidAmounts = frozen;
  }
  bill.name = result.name;
  bill.amount = result.amount;
  bill.dueDate = result.dueDate;
  bill.frequency = result.frequency;
  bill.category = result.category;
  bill.autopay = result.autopay;
  // Changing when a bill is due must not orphan the payments already marked
  // paid: each paid occurrence moves to the same-numbered occurrence of the
  // new schedule (the 3rd payment stays the 3rd payment), so totals don't jump.
  if (oldSchedule.dueDate !== bill.dueDate || oldSchedule.frequency !== bill.frequency) {
    const moved = [];
    const movedAmounts = {};
    (bill.paidDates || []).forEach((d) => {
      let target = d; // already unmatched: leave alone
      if (occursOnDate(oldSchedule, d)) {
        const next = nthOccurrenceDate(bill, occurrenceCountThrough(oldSchedule, d) - 1);
        target = next || d; // no matching slot in the new schedule: keep the payment as recorded
      }
      moved.push(target);
      // the payment keeps its recorded amount when its date moves
      if (bill.paidAmounts && Object.prototype.hasOwnProperty.call(bill.paidAmounts, d) && !(target in movedAmounts)) {
        movedAmounts[target] = bill.paidAmounts[d];
      }
    });
    bill.paidDates = [...new Set(moved)].sort();
    if (bill.paidAmounts) bill.paidAmounts = movedAmounts;
  }
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
  return { ok: true };
}

// Soft-deletes a bill (keeps a tombstone so syncing can tell it was deleted).
function deleteBill(id) {
  const bill = bills.find((b) => b.id === id);
  if (!bill) return;
  const before = structuredClone(bill);
  bill.deleted = true;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
}

// Brings a deleted bill back (used by undo).
function restoreBill(id) {
  const bill = bills.find((b) => b.id === id);
  if (!bill || !bill.deleted) return;
  const before = structuredClone(bill);
  bill.deleted = false;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
}

// Marks one occurrence of a bill paid or unpaid (and remembers the amount paid). Snapshot before,
// mutate, stampSync, save, recordUndo, re-render. paidDates is otherwise only moved by
// updateBill when the schedule changes.
function toggleBillPaid(billId, dateKey, paid) {
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return;
  const before = structuredClone(bill);
  const paidSet = new Set(bill.paidDates || []);
  const amounts = { ...(bill.paidAmounts || {}) };
  if (paid) {
    paidSet.add(dateKey);
    // Remember what this payment was worth (keep an amount already recorded for this date).
    if (!Object.prototype.hasOwnProperty.call(amounts, dateKey)) amounts[dateKey] = bill.amount;
  } else {
    paidSet.delete(dateKey);
    delete amounts[dateKey];
  }
  bill.paidDates = [...paidSet];
  // Only keep amounts for dates that are still paid.
  Object.keys(amounts).forEach((d) => { if (!paidSet.has(d)) delete amounts[d]; });
  bill.paidAmounts = amounts;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', billId, before, structuredClone(bill));
  renderBudget();
}

// ---- Recurring Income (scheduled income sources, e.g. a paycheck) ----
// Storage key: budgetApp.recurringIncome.v1. A structural mirror of Bills
// (fresh-UUID id, dueDate + frequency), not a mutation of `income`.
// `dueDate` here means "first occurrence," not "money owed" — reused
// literally so occursOnDate()/occurrenceCountThrough() work unmodified.
// No `paidDates` equivalent: occurrences are purely computed/projected,
// never individually toggled.

// localStorage key for the recurring income sources.
const RECURRING_INCOME_KEY = 'budgetApp.recurringIncome.v1';
// How often a recurring income source repeats (no one-time option), and the label shown for each.
const RECURRING_INCOME_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'yearly'];
// Display text for each recurring income repeat option.
const RECURRING_INCOME_FREQUENCY_LABELS = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly',
};

// Every recurring income source, loaded and upgraded at startup.
let recurringIncome = migrateSyncFields(loadCollection(RECURRING_INCOME_KEY), RECURRING_INCOME_KEY, getDeviceId());

// Checks and cleans a recurring income source's form values (unknown frequency becomes biweekly).
function validateRecurringIncomeFields(fields) {
  const trimmedName = fields.name.trim();
  if (!trimmedName) return { ok: false, error: 'Income source name is required.' };
  const amount = Math.round(Number(fields.amount) * 100) / 100; // whole cents, as it will be shown
  // > 0 required — a deliberate divergence from `income`'s unconstrained
  // amount. A recurring source describes an ongoing schedule, not a single
  // historical fact, so a $0/negative one is meaningless and would propagate
  // into every future total forever.
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) {
    return { ok: false, error: 'Amount must be between $0.01 and $1,000,000,000.' };
  }
  const dueDate = fields.dueDate; // "First occurrence" in the UI
  if (!dueDate) return { ok: false, error: 'First occurrence date is required.' };
  if (!isReasonableDateKey(dueDate)) return { ok: false, error: DATE_RANGE_MESSAGE };
  const frequency = RECURRING_INCOME_FREQUENCIES.includes(fields.frequency) ? fields.frequency : 'biweekly';
  return { ok: true, name: trimmedName, amount, dueDate, frequency, category: fields.category.trim() };
}

// Adds a recurring income source (e.g. a paycheck). Returns { ok } or { ok: false, error }.
function addRecurringIncome(fields) {
  const result = validateRecurringIncomeFields(fields);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  const source = {
    id: makeId(),
    name: result.name,
    amount: result.amount,
    dueDate: result.dueDate,
    frequency: result.frequency,
    category: result.category,
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  recurringIncome.push(source);
  saveCollection(RECURRING_INCOME_KEY, recurringIncome);
  recordUndo('recurringIncome', source.id, null, structuredClone(source));
  renderBudget();
  return { ok: true };
}

// Saves edits to a recurring income source, re-validating the fields first.
function updateRecurringIncome(id, fields) {
  const source = recurringIncome.find((r) => r.id === id);
  if (!source) return { ok: false, error: 'Recurring income source not found.' };
  const result = validateRecurringIncomeFields(fields);
  if (!result.ok) return result;
  const before = structuredClone(source);
  source.name = result.name;
  source.amount = result.amount;
  source.dueDate = result.dueDate;
  source.frequency = result.frequency;
  source.category = result.category;
  stampSync(source);
  saveCollection(RECURRING_INCOME_KEY, recurringIncome);
  recordUndo('recurringIncome', id, before, structuredClone(source));
  renderBudget();
  return { ok: true };
}

// Soft-deletes a recurring income source (keeps a tombstone so syncing can tell it was deleted).
function deleteRecurringIncome(id) {
  const source = recurringIncome.find((r) => r.id === id);
  if (!source) return;
  const before = structuredClone(source);
  source.deleted = true;
  stampSync(source);
  saveCollection(RECURRING_INCOME_KEY, recurringIncome);
  recordUndo('recurringIncome', id, before, structuredClone(source));
  renderBudget();
}

// Brings a deleted recurring income source back (used by undo).
function restoreRecurringIncome(id) {
  const source = recurringIncome.find((r) => r.id === id);
  if (!source || !source.deleted) return;
  const before = structuredClone(source);
  source.deleted = false;
  stampSync(source);
  saveCollection(RECURRING_INCOME_KEY, recurringIncome);
  recordUndo('recurringIncome', id, before, structuredClone(source));
  renderBudget();
}

// Range-sum for a single recurring income source — the recurring-income
// analog of incomeSumInRange, but built on occurrenceCountThrough's
// closed-form counting (the count primitive), NOT unpaidAmountThrough (which
// bakes in paid-filtering income has no equivalent of). A plain
// range-difference, no day-by-day loop.
function recurringIncomeSumInRange(startKey, endKey, source) {
  if (endKey < startKey) return 0;
  const throughEnd = occurrenceCountThrough(source, endKey);
  const throughBeforeStart = occurrenceCountThrough(source, shiftDateKey(startKey, -1));
  return Math.max(0, throughEnd - throughBeforeStart) * source.amount;
}

// The single source of truth for "how much income does the calendar show for
// this period" from this point forward — every income-derived total (week,
// month, and pay period) MUST call this, not the bare
// incomeSumInRange, or the total will silently omit recurring occurrences the
// calendar visibly displays. incomeSumInRange itself stays unchanged and
// still exists as a standalone "manual entries only" helper — this is an
// additive wrapper around it, not a rewrite.
function totalIncomeInRange(startKey, endKey, nonDeletedIncome, nonDeletedRecurringIncome) {
  const manual = incomeSumInRange(startKey, endKey, nonDeletedIncome);
  const recurring = nonDeletedRecurringIncome.reduce(
    (sum, src) => sum + recurringIncomeSumInRange(startKey, endKey, src), 0
  );
  return manual + recurring;
}

// ---- Paid history ----
// Per-category totals of bill occurrences marked paid in one calendar month.
// Reads ALL bills including deleted ones (deleting a bill doesn't un-spend
// money already paid), filtered through occursOnDate.

// The month the Paid history panel is showing (m is 0-based); starts on the current month.
let paidHistoryMonth = (() => { const { y, m } = parseDateKey(todayKey()); return { y, m }; })();

// Totals what was paid in one month per bill category, biggest first.
function computePaidByCategory(allBills, y, m) {
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const byKey = new Map();
  const counted = new Set(); // same payment recorded on duplicate bills counts once (see paymentIdentity)
  allBills.forEach((bill) => {
    // Every recorded payment counts, even one that no longer lines up with the bill's schedule
    // (for example after the schedule was edited): money that was paid should not vanish from history.
    const dates = (bill.paidDates || []).filter((d) => {
      if (typeof d !== 'string' || !d.startsWith(prefix)) return false;
      const paymentKey = paymentIdentity(bill, d);
      if (counted.has(paymentKey)) return false;
      counted.add(paymentKey);
      return true;
    });
    const count = dates.length;
    if (count === 0) return;
    const raw = (bill.category || '').trim();
    const key = normalizeChipKey(raw);
    const entry = byKey.get(key) || { label: raw || 'Uncategorized', total: 0 };
    entry.total += dates.reduce((sum, d) => sum + paidAmountFor(bill, d), 0);
    byKey.set(key, entry);
  });
  return [...byKey.values()].sort((a, b) => b.total - a.total);
}

// Draws the Paid history list for the selected month, with a total row at the bottom.
function renderPaidHistory() {
  const { y, m } = paidHistoryMonth;
  document.getElementById('paid-history-label').textContent = `${MONTH_NAMES[m]} ${y}`;
  const rows = computePaidByCategory(bills, y, m);
  const list = document.getElementById('paid-history-list');
  list.innerHTML = '';
  document.getElementById('paid-history-empty').hidden = rows.length !== 0;
  if (rows.length === 0) return;

  const addRow = (label, total, extraClass) => {
    const li = document.createElement('li');
    li.className = `paid-history-row${extraClass ? ` ${extraClass}` : ''}`;
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('span');
    amount.textContent = `$${total.toFixed(2)}`;
    li.append(name, amount);
    list.appendChild(li);
  };
  rows.forEach((r) => addRow(r.label, r.total));
  addRow('Total paid', rows.reduce((sum, r) => sum + r.total, 0), 'paid-history-total');
}

// Moves the Paid history panel forward or back by whole months.
function shiftPaidHistoryMonth(delta) {
  const d = new Date(paidHistoryMonth.y, paidHistoryMonth.m + delta, 1);
  paidHistoryMonth = { y: d.getFullYear(), m: d.getMonth() };
  renderPaidHistory();
}

// The month arrows on the Paid History panel.
document.getElementById('paid-history-prev').addEventListener('click', () => shiftPaidHistoryMonth(-1));
document.getElementById('paid-history-next').addEventListener('click', () => shiftPaidHistoryMonth(1));

// True if the search text appears in the bill's name or category.
function matchesBillSearch(bill, term) {
  if (!term) return true;
  const haystack = `${bill.name} ${bill.category || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// The selected category chip's key; 'all' is the default.
let selectedBillCategory = 'all';

// True if the bill is in the selected category chip ('all' matches everything).
function matchesBillCategory(bill, categoryKey) {
  return categoryKey === 'all' || normalizeChipKey(bill.category) === categoryKey;
}

// Deterministic category -> palette-color mapping for the calendar's
// occurrence dots. Categories are free-text (no fixed enum), so this hashes
// the normalized string (same normalization matchesBillCategory uses, so
// "Rent"/"rent " share a color) into one of exactly 3 palette colors — never
// var(--accent-2), which is reserved app-wide for error/overdue/destructive
// semantics. Blank categories return null (neutral/no dot)
// rather than being hashed in.
const BILL_CATEGORY_PALETTE = ['var(--accent)', 'var(--accent-rose)', 'var(--accent-lavender)'];

// The palette color for a category (same category always gets the same color); null if blank.
function billCategoryColor(category) {
  const key = normalizeChipKey(category);
  if (!key) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash += key.charCodeAt(i);
  return BILL_CATEGORY_PALETTE[hash % BILL_CATEGORY_PALETTE.length];
}

// Draws the Budget category chips, built from whatever categories the bills currently use.
function renderBillCategoryFilters(nonDeletedBills) {
  const container = document.getElementById('budget-category-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedBills, (b) => b.category)];
  renderChipFilter(
    container,
    options,
    () => selectedBillCategory,
    (key) => { selectedBillCategory = key; },
    renderBudget
  );
}

// 'due_date_asc' is the default/initial state, matching the add-form's sort
// <select>'s first (and pre-selected) option.
let selectedBillsSort = 'due_date_asc';

// When on, the Bills list shows only bills that are overdue or due within DUE_SOON_LIST_DAYS days.
let onlyDueSoon = false;
const DUE_SOON_LIST_DAYS = 14;

// The Bills sort orders, keyed by the values of the sort <select>'s options. The two due date orders
// are not here: they sort by each bill's next date to pay (see renderBudgetList), not its first date.
const BILL_SORTS = {
  name_asc: compareByField((b) => b.name, 1),
  amount_desc: compareByField((b) => b.amount, -1, { text: false }),
  amount_asc: compareByField((b) => b.amount, 1, { text: false }),
};

// Fills the one-line summary: total unpaid as of today across all bills.
function renderBudgetStats(nonDeletedBills) {
  const el = document.getElementById('budget-stats');
  if (!el) return;
  const today = todayKey();
  const overallUnpaid = nonDeletedBills.reduce((sum, b) => sum + unpaidAmountThrough(b, today), 0);
  const count = nonDeletedBills.length;
  el.textContent = `$${overallUnpaid.toFixed(2)} unpaid across ${count} bill${count === 1 ? '' : 's'}.`;
}

// ---- Current Pay Period ----
// Storage key: budgetApp.paydaySettings.v1. Deliberately a flat, device-local settings object,
// NOT a synced collection: it is a display preference (which pay-cycle window to show), not
// transaction data. It is read and written with plain localStorage + JSON rather than
// loadCollection/saveCollection, which assume an array of sync-tracked records. If it ever needs
// to follow the user across devices it would have to become a real synced collection
// (id/updatedAt/deviceId/deleted/version, listed in SYNC_COLLECTIONS).

// localStorage key for the payday date and pay frequency.
const PAYDAY_SETTINGS_KEY = 'budgetApp.paydaySettings.v1';
// How often payday comes around, for the Current Pay Period panel.
const PAY_PERIOD_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

// Reads the saved payday date and frequency; falls back to "not set, biweekly".
function loadPaydaySettings() {
  try {
    const raw = localStorage.getItem(PAYDAY_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && typeof parsed.payDateKey === 'string') {
      return {
        payDateKey: parsed.payDateKey,
        frequency: PAY_PERIOD_FREQUENCIES.includes(parsed.frequency) ? parsed.frequency : 'biweekly',
      };
    }
  } catch {
    // fall through
  }
  return { payDateKey: null, frequency: 'biweekly' };
}

// Saves the payday date and frequency (device-local, never synced). Returns false (and shows the
// storage warning) if the browser refuses, instead of throwing out of the form's submit handler.
function savePaydaySettings(settings) {
  try {
    localStorage.setItem(PAYDAY_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    reportStorageProblem();
    return false;
  }
}

// The payday schedule to use: the one saved by hand, otherwise the biggest Recurring Income source that has
// started and repeats weekly, biweekly or monthly (usually the paycheck), so nothing has to be set up twice.
// derivedFrom names that source when the schedule was taken from it.
function effectivePaydaySettings() {
  const saved = loadPaydaySettings();
  if (saved.payDateKey) return saved;
  const todayK = todayKey();
  const paycheck = recurringIncome
    .filter((r) => !r.deleted && PAY_PERIOD_FREQUENCIES.includes(r.frequency) && r.dueDate <= todayK)
    .sort((a, b) => b.amount - a.amount)[0];
  return paycheck ? { payDateKey: paycheck.dueDate, frequency: paycheck.frequency, derivedFrom: paycheck.name } : saved;
}

// Finds the current pay period: { periodStart, periodEnd } where periodStart is the latest payday
// on or before today and periodEnd the next one. Returns null if there is no payday yet (the
// saved payday is still in the future).
// Bounded backward/forward scan (at most 31 days each way — long enough to
// cover every supported frequency) using the existing, already-verified
// occursOnDate() to find the current pay period's boundaries. This is safe
// as a bounded loop (unlike an unbounded day-by-day scan across arbitrary
// history, which this app avoids elsewhere) because the scan range here is
// small and constant, anchored at today.
function computeCurrentPayPeriod(payDateKey, frequency) {
  const todayK = todayKey();
  const payBill = { dueDate: payDateKey, frequency };
  let periodStart = null;
  for (let i = 0; i <= 31; i++) {
    const candidate = shiftDateKey(todayK, -i);
    if (candidate < payDateKey) break;
    if (occursOnDate(payBill, candidate)) { periodStart = candidate; break; }
  }
  if (!periodStart) return null;
  let periodEnd = null;
  for (let i = 1; i <= 31; i++) {
    const candidate = shiftDateKey(periodStart, i);
    if (occursOnDate(payBill, candidate)) { periodEnd = candidate; break; }
  }
  return { periodStart, periodEnd };
}

// "2026-09-05" becomes "September 5, 2026".
function formatDateKeyLong(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return `${MONTH_NAMES[m]} ${d}, ${y}`;
}

// Weekday names indexed like Date.getDay() (0 = Sunday).
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "2026-10-12" becomes "Mon, Oct 12" (the year is added only when it is not this year).
function formatDateKeyShort(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  const weekday = WEEKDAY_SHORT[new Date(y, m, d).getDay()];
  const year = y === new Date().getFullYear() ? '' : `, ${y}`;
  return `${weekday}, ${MONTH_NAMES[m].slice(0, 3)} ${d}${year}`;
}

// The date a bill needs paying next: its oldest unpaid date up to today (so a late bill shows how late),
// otherwise its next scheduled date within a year that is not already paid; null if there is none (a paid one-time bill).
function nextDueDateKey(bill, todayK) {
  if (unpaidAmountThrough(bill, todayK) > 0) {
    const unpaid = oldestUnpaidOccurrence(bill, todayK);
    if (unpaid) return unpaid;
  }
  for (let i = 1; i <= 366; i += 1) {
    const dateKey = shiftDateKey(todayK, i);
    if (occursOnDate(bill, dateKey) && !(bill.paidDates || []).includes(dateKey)) return dateKey;
  }
  return null;
}

// The line on a bill card, e.g. "Due Mon, Oct 12 · in 2 days" or "Overdue Mon, Oct 5 · 7 days ago".
function billDueText(bill, todayK) {
  const dateKey = nextDueDateKey(bill, todayK);
  if (!dateKey) {
    return bill.frequency === 'one_time' && (bill.paidDates || []).length ? 'Paid' : `Due ${formatDateKeyShort(bill.dueDate)}`;
  }
  const days = utcDayDiff(todayK, dateKey);
  const late = days < 0 && !bill.autopay; // a bill that pays itself is never called overdue
  return `${late ? 'Overdue' : 'Due'} ${formatDateKeyShort(dateKey)} \u00b7 ${whenLabel(days)}`;
}

// Draws the Current Pay Period panel: bills due before the next payday, plus income and net for that period.
// Reads the live, non-deleted bills array directly (same convention as
// renderBudgetStats/renderBillCategoryFilters) rather than taking it as a
// parameter, since it's called from renderBudget() alongside those.
function renderPayPeriod() {
  const summaryEl = document.getElementById('pay-period-summary');
  const listEl = document.getElementById('pay-period-bills-list');
  const emptyEl = document.getElementById('pay-period-empty-state');
  if (!summaryEl || !listEl || !emptyEl) return;

  listEl.innerHTML = '';

  const settings = effectivePaydaySettings();
  const sourceEl = document.getElementById('pay-period-source');
  if (sourceEl) {
    sourceEl.hidden = !settings.derivedFrom;
    if (settings.derivedFrom) sourceEl.textContent = `Using the schedule of your ${settings.derivedFrom} income. Save a payday below to use your own.`;
  }
  // No settings configured yet, or a (defensively handled, shouldn't happen
  // for weekly/biweekly/monthly within the 31-day scan bound) undetermined
  // period — treated identically: empty state, no summary, no crash.
  const period = settings.payDateKey ? computeCurrentPayPeriod(settings.payDateKey, settings.frequency) : null;
  const incomeEl = document.getElementById('pay-period-income-total');
  const netEl = document.getElementById('pay-period-net-total');
  if (!period) {
    summaryEl.textContent = '';
    if (incomeEl) incomeEl.textContent = '';
    if (netEl) netEl.textContent = '';
    emptyEl.textContent = settings.payDateKey
      ? 'That payday is in the future, so there is no current pay period yet.'
      : 'Set a recent payday above to see the current pay period.';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.textContent = 'No bills due in this pay period.';

  const { periodStart, periodEnd } = period;
  const nonDeletedBills = bills.filter((b) => !b.deleted);

  // Bounded loop — at most ~31 days (periodEnd is within 31 days of
  // periodStart, see computeCurrentPayPeriod) times every bill. A plain sum
  // of `amount` per matching occurrence, not cumulative unpaid-through-date
  // math like unpaidAmountThrough() — "what's due in this specific short
  // window" is a simpler question than "everything ever owed as of a date".
  const matches = [];
  nonDeletedBills.forEach((bill) => {
    const occurrenceDates = [];
    let total = 0;
    let dateKey = periodStart;
    while (dateKey < periodEnd) {
      if (occursOnDate(bill, dateKey)) {
        occurrenceDates.push(dateKey);
        total += occurrenceAmount(bill, dateKey);
      }
      dateKey = shiftDateKey(dateKey, 1);
    }
    if (occurrenceDates.length) matches.push({ bill, total, occurrenceDates });
  });

  matches.sort((a, b) => b.total - a.total);
  const grandTotal = matches.reduce((sum, m) => sum + m.total, 0);

  summaryEl.textContent =
    `Payday ${formatDateKeyLong(periodStart)} to ${formatDateKeyLong(periodEnd)}: ` +
    `$${grandTotal.toFixed(2)} due across ${matches.length} bill${matches.length === 1 ? '' : 's'}`;
  emptyEl.hidden = matches.length !== 0;

  // Income and net for exactly this pay period (payday up to, not including,
  // the next payday), so the period reads like the weekly and monthly totals.
  const periodIncome = totalIncomeInRange(
    periodStart,
    shiftDateKey(periodEnd, -1),
    uniqueIncomeByDate(income).filter((r) => !r.deleted),
    recurringIncome.filter((r) => !r.deleted)
  );
  const periodNet = periodIncome - grandTotal;
  if (incomeEl) {
    incomeEl.innerHTML = `Income this pay period: <strong>${formatSignedCurrency(periodIncome)}</strong>`;
  }
  if (netEl) {
    netEl.innerHTML = `Net this pay period: <strong class="${signedAmountClass(periodNet)}">${formatSignedCurrency(periodNet)}</strong>`;
    netEl.title = 'Income entered or expected in this pay period minus the bills due in it.';
  }

  matches.forEach(({ bill, total, occurrenceDates }) => {
    const li = document.createElement('li');
    li.className = 'bill-card';

    const info = document.createElement('div');
    info.className = 'bill-info';

    const name = document.createElement('strong');
    name.className = 'bill-name';
    name.textContent = bill.name;
    info.appendChild(name);

    const amount = document.createElement('span');
    amount.className = 'bill-amount';
    amount.textContent = occurrenceDates.length > 1
      ? `$${total.toFixed(2)} (${occurrenceDates.length} occurrences)`
      : `$${total.toFixed(2)}`;
    info.appendChild(amount);

    const due = document.createElement('span');
    due.className = 'bill-due';
    due.textContent = `Due: ${occurrenceDates.join(', ')}`;
    info.appendChild(due);

    if (bill.category) {
      const category = document.createElement('span');
      category.className = 'bill-category badge';
      category.textContent = bill.category;
      info.appendChild(category);
    }

    li.appendChild(info);
    listEl.appendChild(li);
  });
}

// The date key of the calendar day currently opened (expanded), or null when none is.
let openCalendarDayKey = null;

// True on narrow screens, where the calendar switches to its compact layout.
function isCompactCalendar() {
  return window.matchMedia('(max-width: 900px)').matches;
}

// In the compact calendar an opened day is a bottom sheet. For keyboard and screen-reader users it
// is exposed as a dialog: it has a name, focus moves into it, Tab stays inside, Escape closes it.
function setDayDialog(cell, open) {
  const body = cell.querySelector('.budget-day-body');
  if (!body) return;
  if (open) {
    body.setAttribute('role', 'dialog');
    body.setAttribute('aria-modal', 'true');
    body.setAttribute('aria-label', cell.dataset.fullLabel || 'Day');
  } else {
    body.removeAttribute('role');
    body.removeAttribute('aria-modal');
    body.removeAttribute('aria-label');
  }
}

// Closes the opened day sheet; with refocus, focus goes back to that day's button.
function closeCalendarDay({ refocus = false } = {}) {
  const key = openCalendarDayKey;
  openCalendarDayKey = null;
  document.querySelectorAll('.budget-day-cell.budget-day-open').forEach((el) => {
    el.classList.remove('budget-day-open');
    setDayDialog(el, false);
  });
  if (refocus && key) {
    // The Close button is about to be hidden, so hand focus back to the day that was opened.
    const opener = document.querySelector(`.budget-day-cell[data-date-key="${key}"] .budget-day-open-btn`);
    if (opener) opener.focus();
  }
}

// Starts a new bill on a given day: closes the day sheet, puts that date in the Add bill form and moves there.
function startBillOnDate(dateKey) {
  closeCalendarDay();
  document.getElementById('budget-duedate-input').value = dateKey;
  document.getElementById('budget-add-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('budget-name-input').focus({ preventScroll: true });
}

// While a day sheet is open: Escape closes it and Tab stays inside it.
document.addEventListener('keydown', (e) => {
  if (!openCalendarDayKey) return;
  const sheet = document.querySelector('.budget-day-cell.budget-day-open .budget-day-body');
  if (!sheet) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCalendarDay({ refocus: true });
    return;
  }
  if (e.key !== 'Tab') return;
  const stops = [...sheet.querySelectorAll('button, input')].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const here = document.activeElement;
  if (e.shiftKey && (here === first || here === sheet)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (here === last || !sheet.contains(here))) {
    e.preventDefault();
    first.focus();
  }
});

// Capture phase so a tap outside the open day sheet only closes it, rather
// than also opening whichever other day cell happened to be underneath.
document.addEventListener('click', (e) => {
  if (!openCalendarDayKey) return;
  const openCell = document.querySelector('.budget-day-cell.budget-day-open');
  if (openCell && !openCell.contains(e.target)) {
    // A tap outside the sheet only closes it; it must never also trigger
    // whatever is underneath (Delete, a tab, a chip, another day).
    closeCalendarDay();
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// Renders the 21-day rolling calendar into #budget-calendar (everything
// after the static .budget-weekday-row) and the month/year header. Always
// runs against the full live `bills` array, and unaffected by the Bills
// list's search filter below — but the category chip filter DOES apply here
// too (occurrence rendering only; every total stays unfiltered, see the
// matchesBillCategory comment inside the render loop below).
function renderBudgetCalendar(nonDeletedBills, nonDeletedIncome, nonDeletedRecurringIncome, focusedManualInput) {
  const today = new Date();
  const todayK = todayKey();
  const dueSoonEndK = shiftDateKey(todayK, REMINDER_BANNER_DAYS); // same window as the banner
  // Today only does something while the calendar is slid away from its usual place.
  const calendarTodayBtn = document.getElementById('calendar-today');
  if (calendarTodayBtn) calendarTodayBtn.disabled = calendarWeekOffset === 0;
  document.getElementById('budget-month-label').textContent =
    `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;

  // "This month" total: everything due this month, paid or not — deliberately unfiltered by
  // category, same carve-out as the weekly totals (see matchesBillCategory filter further down).
  const monthStartKey = dateKeyFromParts(today.getFullYear(), today.getMonth(), 1);
  const monthEndKey = dateKeyFromParts(
    today.getFullYear(), today.getMonth(), daysInMonth(today.getFullYear(), today.getMonth())
  );
  const monthDue = amountDueInRange(monthStartKey, monthEndKey, nonDeletedBills);
  const monthTotalEl = document.getElementById('budget-month-total');
  if (monthTotalEl) {
    monthTotalEl.innerHTML = `${MONTH_NAMES[today.getMonth()]} total: <strong>$${monthDue.toFixed(2)}</strong>`;
  }

  // Plain range-sum, deliberately not cumulative — see incomeSumInRange's
  // own comment. Uses totalIncomeInRange (manual `income` entries plus
  // recurring projections), not the bare incomeSumInRange, so this total
  // stays in sync with what the calendar shows.
  const monthIncome = totalIncomeInRange(monthStartKey, monthEndKey, nonDeletedIncome, nonDeletedRecurringIncome);
  const monthIncomeTotalEl = document.getElementById('budget-month-income-total');
  if (monthIncomeTotalEl) {
    monthIncomeTotalEl.innerHTML =
      `${MONTH_NAMES[today.getMonth()]} income: <strong>${formatSignedCurrency(monthIncome)}</strong>`;
  }

  // Income minus everything due this month, so ticking a bill paid does not move it.
  const monthNet = monthIncome - monthDue;
  const monthNetTotalEl = document.getElementById('budget-month-net-total');
  if (monthNetTotalEl) {
    monthNetTotalEl.innerHTML =
      `${MONTH_NAMES[today.getMonth()]} net: <strong class="${signedAmountClass(monthNet)}">${formatSignedCurrency(monthNet)}</strong>`;
    monthNetTotalEl.title =
      'Income entered or expected this month minus every bill due this month (paid or not)';
  }

  // Rebuild the three weeks from scratch: each week gets seven day cells plus its totals.
  const windowDays = getCalendarWindowDays(today);
  const calendarEl = document.getElementById('budget-calendar');
  calendarEl.querySelectorAll('.budget-week').forEach((el) => el.remove());

  for (let weekIndex = 0; weekIndex < 3; weekIndex++) {
    const weekDays = windowDays.slice(weekIndex * 7, weekIndex * 7 + 7);
    const weekEndKey = weekDays[6];

    const weekEl = document.createElement('div');
    weekEl.className = 'budget-week';
    weekEl.dataset.weekIndex = String(weekIndex);
    weekEl.classList.toggle('budget-week-current', weekDays.includes(todayK));

    const cellsEl = document.createElement('div');
    cellsEl.className = 'budget-week-cells';

    weekDays.forEach((dateKey) => {
      const { m, d } = parseDateKey(dateKey);

      const cellEl = document.createElement('div');
      cellEl.className = 'budget-day-cell';
      cellEl.dataset.dateKey = dateKey;
      cellEl.dataset.fullLabel = `${MONTH_NAMES[m]} ${d}`;
      cellEl.classList.toggle('budget-day-today', dateKey === todayK);
      const startsOpen = isCompactCalendar() && dateKey === openCalendarDayKey;
      cellEl.classList.toggle('budget-day-open', startsOpen);

      // Compact calendar only (hidden by CSS on wide screens): a real button laid over the cell, so
      // the day can be reached with Tab and opened with Enter/Space. Its name is filled in below.
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'budget-day-open-btn';
      openBtn.setAttribute('aria-haspopup', 'dialog');
      cellEl.appendChild(openBtn);

      cellEl.addEventListener('click', (e) => {
        if (!isCompactCalendar() || openCalendarDayKey === dateKey) return;
        // The dots are <label>s around hidden checkboxes: stop the tap that
        // opens the sheet from also toggling that bill's paid state.
        e.preventDefault();
        closeCalendarDay();
        openCalendarDayKey = dateKey;
        cellEl.classList.add('budget-day-open');
        setDayDialog(cellEl, true);
        // The button that was just activated is now hidden; move focus into the sheet itself
        // (not an input, so a phone keyboard doesn't pop up). Tab then reaches its controls.
        if (e.target === openBtn) cellEl.querySelector('.budget-day-body').focus({ preventScroll: true });
      });

      // All cell content lives in one wrapper so the compact calendar can lift
      // just the wrapper into a bottom sheet while the (now empty) cell keeps
      // its slot in the week grid. display: contents on desktop = no change.
      const bodyEl = document.createElement('div');
      bodyEl.className = 'budget-day-body';
      bodyEl.tabIndex = -1; // focusable by script only, so the opened sheet can receive focus
      cellEl.appendChild(bodyEl);
      if (startsOpen) setDayDialog(cellEl, true);

      const daySummary = []; // what this day holds, for the open button's accessible name
      const peekNames = []; // the bills due this day, for the short name shown in the compact cell

      // Day header: the date number, plus the Close button used by the compact layout.
      const headerEl = document.createElement('div');
      headerEl.className = 'budget-day-header';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'budget-day-date';
      dateSpan.textContent = String(d);
      dateSpan.dataset.full = `${MONTH_NAMES[m]} ${d}`;
      headerEl.appendChild(dateSpan);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'budget-day-close';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeCalendarDay({ refocus: true }); });
      headerEl.appendChild(closeBtn);
      bodyEl.appendChild(headerEl);

      const occurrencesEl = document.createElement('ul');
      occurrencesEl.className = 'budget-day-occurrences';

      // Recurring income occurrences render first, in the SAME list bills
      // use (not a separate section), unconditionally (never filtered by
      // selectedBillCategory), with no checkbox (nothing to toggle), a literal
      // "+ " name prefix, a fixed --accent dot (never hashed), and never the
      // .overdue/.due-soon classes (those semantics don't exist for income).
      nonDeletedRecurringIncome
        .filter((source) => occursOnDate(source, dateKey))
        .forEach((source) => {
          const itemEl = document.createElement('li');
          itemEl.className = 'budget-occurrence income-occurrence';

          const dotSpan = document.createElement('span');
          dotSpan.className = 'budget-occurrence-dot';
          dotSpan.style.backgroundColor = 'var(--accent)';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'budget-occurrence-name';
          nameSpan.textContent = `+ ${source.name}`;

          itemEl.title = `${source.name} — $${source.amount.toFixed(2)}`;
          daySummary.push(`income ${source.name}`);
          itemEl.appendChild(dotSpan);
          itemEl.appendChild(nameSpan);
          occurrencesEl.appendChild(itemEl);
        });

      // Then the bills due on this day, each with a paid checkbox and a category dot.
      nonDeletedBills
        .filter((bill) => occursOnDate(bill, dateKey))
        // Calendar-only category filter — the same chip selection filters the
        // Bills list below. Deliberately does NOT touch the week and month totals
        // above or renderBudgetStats(), which always sum the full
        // nonDeletedBills array regardless of the selected chip (totals must
        // never look smaller than the true unpaid amount just because a
        // category filter is active).
        .filter((bill) => matchesBillCategory(bill, selectedBillCategory))
        .forEach((bill) => {
          const itemEl = document.createElement('li');
          itemEl.className = 'budget-occurrence';
          const paid = (bill.paidDates || []).includes(dateKey);
          // A bill that pays itself is never flagged, matching the banner (see computeBillReminders).
          const needsPayment = !paid && !bill.autopay;
          const overdue = needsPayment && dateKey < todayK;
          // Mutually exclusive by construction: overdue is strictly before
          // today, due-soon is today-or-later, so a single dateKey can never
          // satisfy both.
          const dueSoon = needsPayment && dateKey >= todayK && dateKey <= dueSoonEndK;
          itemEl.classList.toggle('overdue', overdue);
          itemEl.classList.toggle('due-soon', dueSoon);

          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'budget-occurrence-checkbox';
          checkbox.dataset.billId = bill.id;
          checkbox.dataset.dateKey = dateKey;
          checkbox.checked = paid;
          checkbox.addEventListener('change', (e) => toggleBillPaid(bill.id, dateKey, e.target.checked));

          const categoryColor = billCategoryColor(bill.category);
          let dotSpan = null;
          if (categoryColor) {
            dotSpan = document.createElement('span');
            dotSpan.className = 'budget-occurrence-dot';
            dotSpan.style.backgroundColor = categoryColor;
          }

          const nameSpan = document.createElement('span');
          nameSpan.className = 'budget-occurrence-name';
          nameSpan.textContent = bill.name;

          const amountText = `$${(paid ? paidAmountFor(bill, dateKey) : bill.amount).toFixed(2)}`;
          label.title = bill.category ? `${bill.name} — ${amountText} (${bill.category})` : `${bill.name} — ${amountText}`;

          daySummary.push(`${bill.name}${paid ? ' (paid)' : overdue ? ' (overdue)' : ''}`);
          peekNames.push(bill.name);
          label.appendChild(checkbox);
          if (dotSpan) label.appendChild(dotSpan);
          label.appendChild(nameSpan);
          itemEl.appendChild(label);
          occurrencesEl.appendChild(itemEl);
        });
      bodyEl.appendChild(occurrencesEl);

      // Compact calendar only (CSS): the first bill's name, cut short to fit, and how many more there are,
      // so a day says what is due without opening it.
      if (peekNames.length) {
        const peekEl = document.createElement('div');
        peekEl.className = 'budget-day-peek';
        peekEl.setAttribute('aria-hidden', 'true'); // the open button already names everything
        const peekName = document.createElement('span');
        peekName.className = 'budget-day-peek-name';
        peekName.textContent = peekNames[0];
        peekEl.appendChild(peekName);
        if (peekNames.length > 1) {
          const peekMore = document.createElement('span');
          peekMore.className = 'budget-day-peek-more';
          peekMore.textContent = `+${peekNames.length - 1}`;
          peekEl.appendChild(peekMore);
        }
        bodyEl.insertBefore(peekEl, occurrencesEl);
      }

      // Day footer: the box for typing a manual income amount for this day.
      const footerEl = document.createElement('div');
      footerEl.className = 'budget-day-footer';
      const manualInput = document.createElement('input');
      manualInput.type = 'number';
      manualInput.step = 'any';
      manualInput.className = 'budget-day-manual-input';
      manualInput.dataset.dateKey = dateKey;
      manualInput.setAttribute('aria-label', `Income for ${MONTH_NAMES[m]} ${d}`);
      const incomeRecord = nonDeletedIncome.find((r) => r.dateKey === dateKey);
      manualInput.value = incomeRecord ? String(incomeRecord.amount) : '';
      manualInput.addEventListener('change', (e) => {
        // A half-typed number ("1e", "-") reads as empty: put the saved amount back rather than clearing the day.
        if (e.target.value === '' && e.target.validity && e.target.validity.badInput) { setTimeout(renderBudget, 0); return; }
        setIncomeForDate(dateKey, e.target.value);
      });
      // Sign-aware, not flat "always green" — a negative manually-entered
      // income amount (income's amount is unconstrained) must not be shown
      // with a color that implies "good news." Never
      // --accent-2, reserved for error/overdue/destructive semantics. This
      // reflects only the manual `income` entry's sign — it is NOT a summary
      // of the day's combined manual + recurring total.
      if (incomeRecord) {
        const dotSpan = document.createElement('span');
        dotSpan.className = `budget-income-dot ${signedAmountClass(incomeRecord.amount)}`;
        footerEl.appendChild(dotSpan);
      }
      footerEl.appendChild(manualInput);
      bodyEl.appendChild(footerEl);

      // In the day sheet: start a bill on this day (the Add bill form gets the date).
      const addOnDayBtn = document.createElement('button');
      addOnDayBtn.type = 'button';
      addOnDayBtn.className = 'budget-day-add-bill';
      addOnDayBtn.textContent = 'Add a bill on this day';
      addOnDayBtn.addEventListener('click', (e) => { e.stopPropagation(); startBillOnDate(dateKey); });
      bodyEl.appendChild(addOnDayBtn);

      if (incomeRecord) daySummary.push(`income entered $${Number(incomeRecord.amount).toFixed(2)}`);
      openBtn.setAttribute('aria-label',
        `${MONTH_NAMES[m]} ${d}${dateKey === todayK ? ', today' : ''}: ` +
        `${daySummary.length ? daySummary.join(', ') : 'nothing scheduled'}. Open day.`);

      cellsEl.appendChild(cellEl);
    });

    weekEl.appendChild(cellsEl);

    // Under each week: everything due, the income, the net (income minus everything due, so it moves
    // only when income does), and Due (what is still left to pay this week).
    const totalEl = document.createElement('p');
    totalEl.className = 'budget-week-total';
    const weekTotalDue = amountDueInRange(weekDays[0], weekEndKey, nonDeletedBills);
    totalEl.innerHTML = `${calendarWeekLabel(weekIndex - 1 + calendarWeekOffset, weekDays[0])}: <strong>$${weekTotalDue.toFixed(2)}</strong>`;
    weekEl.appendChild(totalEl);

    // totalIncomeInRange (manual `income` entries plus recurring
    // projections), not the bare incomeSumInRange, so this total stays in
    // sync with what the calendar visibly shows.
    const weekIncome = totalIncomeInRange(weekDays[0], weekDays[6], nonDeletedIncome, nonDeletedRecurringIncome);
    const incomeTotalEl = document.createElement('p');
    incomeTotalEl.className = 'budget-week-income-total';
    incomeTotalEl.innerHTML = `Income: <strong>${formatSignedCurrency(weekIncome)}</strong>`;
    weekEl.appendChild(incomeTotalEl);

    const weekNet = weekIncome - weekTotalDue;
    const netTotalEl = document.createElement('p');
    netTotalEl.className = 'budget-week-net-total';
    netTotalEl.innerHTML = `Net: <strong class="${signedAmountClass(weekNet)}">${formatSignedCurrency(weekNet)}</strong>`;
    netTotalEl.title =
      'Income entered or expected this week minus every bill due this week (paid or not)';
    weekEl.appendChild(netTotalEl);

    // What is left to pay this week: bills due in it that are not ticked paid yet.
    const weekLeft = amountDueInRange(weekDays[0], weekEndKey, nonDeletedBills, true);
    const leftEl = document.createElement('p');
    leftEl.className = 'budget-week-due-total';
    leftEl.innerHTML = `Due: <strong>$${weekLeft.toFixed(2)}</strong>`;
    weekEl.appendChild(leftEl);

    calendarEl.appendChild(weekEl);
  }

  // If an income box was being typed in when the redraw started, put its text and focus back.
  if (focusedManualInput) {
    const restored = calendarEl.querySelector(
      `.budget-day-manual-input[data-date-key="${focusedManualInput.dateKey}"]`
    );
    if (restored) {
      restored.value = focusedManualInput.value;
      restored.focus();
    }
  }
}

// Draws the Bills list (cards with edit form, delete and "mark oldest unpaid as paid");
// openEdit re-opens an edit form that was open before the redraw.
function renderBudgetList(nonDeletedBills, openEdit) {
  // Apply the search box, category chip and sort choice.
  const searchTerm = document.getElementById('budget-search-input').value;
  const todayK = todayKey();
  let visible = nonDeletedBills
    .filter((b) => matchesBillSearch(b, searchTerm))
    .filter((b) => matchesBillCategory(b, selectedBillCategory));

  // The next date each bill needs paying (late ones first); a bill with none left sorts last.
  const nextDue = new Map(visible.map((b) => [b.id, nextDueDateKey(b, todayK) || '9999-12-31']));
  if (onlyDueSoon) {
    const lastKey = shiftDateKey(todayK, DUE_SOON_LIST_DAYS);
    visible = visible.filter((b) => nextDue.get(b.id) <= lastKey);
  }
  let comparator = BILL_SORTS[selectedBillsSort];
  if (!comparator) {
    const dir = selectedBillsSort === 'due_date_desc' ? -1 : 1;
    comparator = (a, b) => {
      const x = nextDue.get(a.id);
      const y = nextDue.get(b.id);
      return (x < y ? -dir : x > y ? dir : 0) || BILL_SORTS.name_asc(a, b);
    };
  }
  visible.sort(comparator);

  const list = document.getElementById('budget-list');
  const template = document.getElementById('budget-card-template');

  list.innerHTML = '';

  // One card per bill: fill in the details first, then wire up the buttons.
  visible.forEach((bill) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.bill-card');
    card.dataset.billId = bill.id;
    const viewSection = node.querySelector('.bill-view');
    const editForm = node.querySelector('.bill-edit-form');

    node.querySelector('.bill-name').textContent = bill.name;
    node.querySelector('.bill-amount').textContent = `$${bill.amount.toFixed(2)}`;
    const dueEl = node.querySelector('.bill-due');
    dueEl.textContent = billDueText(bill, todayK);
    dueEl.classList.toggle('bill-due-late', dueEl.textContent.startsWith('Overdue'));
    node.querySelector('.bill-frequency').textContent = BILL_FREQUENCY_LABELS[bill.frequency] || bill.frequency;

    const categoryEl = node.querySelector('.bill-category');
    if (bill.category) {
      categoryEl.textContent = bill.category;
      categoryEl.hidden = false;
    }
    node.querySelector('.bill-autopay').hidden = !bill.autopay;

    // Only offered while something is still owed as of today.
    const markOldestBtn = node.querySelector('.mark-oldest-paid-btn');
    const hasUnpaid = unpaidAmountThrough(bill, todayK) > 0;
    markOldestBtn.disabled = !hasUnpaid;
    markOldestBtn.addEventListener('click', () => {
      const target = oldestUnpaidOccurrence(bill, todayKey());
      if (target) toggleBillPaid(bill.id, target, true);
    });

    const editNameInput = node.querySelector('.bill-edit-name');
    const editAmountInput = node.querySelector('.bill-edit-amount');
    const editDueDateInput = node.querySelector('.bill-edit-duedate');
    const editFrequencyInput = node.querySelector('.bill-edit-frequency');
    const editCategoryInput = node.querySelector('.bill-edit-category');
    const editAutopayInput = node.querySelector('.bill-edit-autopay');
    const editError = node.querySelector('.bill-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      // Only one bill can be in edit mode at a time: close any other open edit form first.
      const otherOpenForm = list.querySelector('.bill-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.bill-card').querySelector('.bill-view').hidden = false;
      }
      editNameInput.value = bill.name;
      editAmountInput.value = String(bill.amount);
      editDueDateInput.value = bill.dueDate;
      editFrequencyInput.value = bill.frequency;
      editCategoryInput.value = bill.category || '';
      editAutopayInput.checked = !!bill.autopay;
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Close the form BEFORE saving: a successful save redraws the list, and the redraw
      // reopens whichever edit form is still open. A failed save redraws nothing, so
      // these same nodes are still attached and simply get re-shown below.
      editForm.hidden = true;
      viewSection.hidden = false;
      const result = updateBill(bill.id, {
        name: editNameInput.value,
        amount: editAmountInput.value,
        dueDate: editDueDateInput.value,
        frequency: editFrequencyInput.value,
        category: editCategoryInput.value,
        autopay: editAutopayInput.checked,
      });
      if (!result.ok) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteBill(bill.id));

    // Re-open the form that was open before this redraw, with whatever had been typed in it.
    if (openEdit && openEdit.id === bill.id) {
      editNameInput.value = openEdit.name;
      editAmountInput.value = openEdit.amount;
      editDueDateInput.value = openEdit.dueDate;
      editFrequencyInput.value = openEdit.frequency;
      editCategoryInput.value = openEdit.category;
      editAutopayInput.checked = openEdit.autopay;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('budget-empty-state').hidden = nonDeletedBills.length !== 0;
  document.getElementById('budget-filter-empty').hidden = !(onlyDueSoon && nonDeletedBills.length !== 0 && visible.length === 0);
}

// Draws the Recurring Income list. Same shape as renderBudgetList, minus "mark oldest unpaid"
// (income has no paid concept) and the search/sort/category filters (only a handful of sources).
function renderRecurringIncomeList(nonDeletedRecurringIncome, openEdit) {
  const list = document.getElementById('recurring-income-list');
  const template = document.getElementById('recurring-income-card-template');

  list.innerHTML = '';

  nonDeletedRecurringIncome.forEach((source) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.recurring-income-card');
    card.dataset.recurringIncomeId = source.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');

    node.querySelector('.recurring-income-name').textContent = source.name;
    node.querySelector('.recurring-income-amount').textContent = `$${source.amount.toFixed(2)}`;
    node.querySelector('.recurring-income-start').textContent = `Starts: ${source.dueDate}`;
    node.querySelector('.recurring-income-frequency').textContent =
      RECURRING_INCOME_FREQUENCY_LABELS[source.frequency] || source.frequency;

    const categoryEl = node.querySelector('.recurring-income-category');
    if (source.category) {
      categoryEl.textContent = source.category;
      categoryEl.hidden = false;
    }

    const editNameInput = node.querySelector('.recurring-income-edit-name');
    const editAmountInput = node.querySelector('.recurring-income-edit-amount');
    const editStartDateInput = node.querySelector('.recurring-income-edit-startdate');
    const editFrequencyInput = node.querySelector('.recurring-income-edit-frequency');
    const editCategoryInput = node.querySelector('.recurring-income-edit-category');
    const editError = node.querySelector('.recurring-income-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      // Only one source is in edit mode at a time (independent of the Bills list's open form).
      const otherOpenForm = list.querySelector('.recurring-income-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.recurring-income-card').querySelector('.recurring-income-view').hidden = false;
      }
      editNameInput.value = source.name;
      editAmountInput.value = String(source.amount);
      editStartDateInput.value = source.dueDate;
      editFrequencyInput.value = source.frequency;
      editCategoryInput.value = source.category || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Close the form before saving; see the Bills edit handler for why.
      editForm.hidden = true;
      viewSection.hidden = false;
      const result = updateRecurringIncome(source.id, {
        name: editNameInput.value,
        amount: editAmountInput.value,
        dueDate: editStartDateInput.value,
        frequency: editFrequencyInput.value,
        category: editCategoryInput.value,
      });
      if (!result.ok) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteRecurringIncome(source.id));

    if (openEdit && openEdit.id === source.id) {
      editNameInput.value = openEdit.name;
      editAmountInput.value = openEdit.amount;
      editStartDateInput.value = openEdit.dueDate;
      editFrequencyInput.value = openEdit.frequency;
      editCategoryInput.value = openEdit.category;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('recurring-income-empty-state').hidden = nonDeletedRecurringIncome.length !== 0;
}

// Redraws the whole screen from the live lists. A redraw wipes the DOM, so it first captures the
// in-progress input it must put back: the open Bill edit form, the open Recurring Income edit form
// (one of each can be open at once) and a focused day income box (any paid tick redraws all 21 days).
function renderBudget() {
  const nonDeleted = bills.filter((b) => !b.deleted);
  // One record per date first (the newest wins, even if it is a cleared one), then drop cleared ones.
  const nonDeletedIncome = uniqueIncomeByDate(income).filter((r) => !r.deleted);
  const nonDeletedRecurringIncome = recurringIncome.filter((r) => !r.deleted);

  const activeEl = document.activeElement;
  const focusedManualInput = (activeEl && activeEl.classList && activeEl.classList.contains('budget-day-manual-input'))
    ? { dateKey: activeEl.dataset.dateKey, value: activeEl.value }
    : null;

  const list = document.getElementById('budget-list');
  const openForm = list.querySelector('.bill-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.bill-card').dataset.billId,
        name: openForm.querySelector('.bill-edit-name').value,
        amount: openForm.querySelector('.bill-edit-amount').value,
        dueDate: openForm.querySelector('.bill-edit-duedate').value,
        frequency: openForm.querySelector('.bill-edit-frequency').value,
        category: openForm.querySelector('.bill-edit-category').value,
        autopay: openForm.querySelector('.bill-edit-autopay').checked,
      }
    : null;

  const recurringIncomeList = document.getElementById('recurring-income-list');
  const openRecurringIncomeForm = recurringIncomeList.querySelector('.recurring-income-edit-form:not([hidden])');
  const openRecurringIncomeEdit = openRecurringIncomeForm
    ? {
        id: openRecurringIncomeForm.closest('.recurring-income-card').dataset.recurringIncomeId,
        name: openRecurringIncomeForm.querySelector('.recurring-income-edit-name').value,
        amount: openRecurringIncomeForm.querySelector('.recurring-income-edit-amount').value,
        dueDate: openRecurringIncomeForm.querySelector('.recurring-income-edit-startdate').value,
        frequency: openRecurringIncomeForm.querySelector('.recurring-income-edit-frequency').value,
        category: openRecurringIncomeForm.querySelector('.recurring-income-edit-category').value,
      }
    : null;

  renderBudgetStats(nonDeleted);
  renderBillCategoryFilters(nonDeleted);
  renderBudgetCalendar(nonDeleted, nonDeletedIncome, nonDeletedRecurringIncome, focusedManualInput);
  renderPayPeriod();
  renderPaidHistory();
  renderBudgetList(nonDeleted, openEdit);
  renderRecurringIncomeList(nonDeletedRecurringIncome, openRecurringIncomeEdit);

  renderBackupNotes();
  renderBillReminders(); // the due/overdue bills banner at the top
}

// ---- Form wiring ----

// Fills the payday settings form once at startup and saves it on submit. It is never refilled
// by renderBudget(), which would overwrite what the user is typing; renderPayPeriod() only
// touches the summary and list, never these inputs.
(function initPaydaySettingsForm() {
  const form = document.getElementById('payday-settings-form');
  if (!form) return;
  const dateInput = document.getElementById('payday-date-input');
  const frequencyInput = document.getElementById('payday-frequency-input');
  const settings = loadPaydaySettings();
  if (settings.payDateKey) dateInput.value = settings.payDateKey;
  frequencyInput.value = settings.frequency;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (dateInput.value && !isReasonableDateKey(dateInput.value)) return; // a mistyped year like 0026
    savePaydaySettings({
      payDateKey: dateInput.value || null,
      frequency: PAY_PERIOD_FREQUENCIES.includes(frequencyInput.value) ? frequencyInput.value : 'biweekly',
    });
    renderPayPeriod();
  });
})();

// Add-bill form: validate, add the bill, and clear the form when it worked.
document.getElementById('budget-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('budget-name-input');
  const amountInput = document.getElementById('budget-amount-input');
  const dueDateInput = document.getElementById('budget-duedate-input');
  const frequencyInput = document.getElementById('budget-frequency-input');
  const categoryInput = document.getElementById('budget-category-input');
  const errorEl = document.getElementById('budget-form-error');

  const result = addBill({
    name: nameInput.value,
    amount: amountInput.value,
    dueDate: dueDateInput.value,
    frequency: frequencyInput.value,
    category: categoryInput.value,
    autopay: document.getElementById('budget-autopay-input').checked,
  });

  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  document.getElementById('budget-autopay-input').checked = false;
  nameInput.value = '';
  amountInput.value = '';
  dueDateInput.value = todayKey();
  frequencyInput.value = 'monthly';
  categoryInput.value = '';
  showNewBillCard(result.id);
});

// The due date starts on today (a day's "Add a bill on this day" button changes it).
document.getElementById('budget-duedate-input').value = todayKey();

// Scrolls to a just-added bill's card and flashes it, so it is clear where it landed in the sorted list.
function showNewBillCard(billId) {
  const card = document.querySelector(`#budget-list [data-bill-id="${billId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('bill-card-new');
  setTimeout(() => card.classList.remove('bill-card-new'), 1800);
}

// Typing in the search box redraws the Bills list.
document.getElementById('budget-search-input').addEventListener('input', renderBudget);

// Choosing a sort order redraws the Bills list.
document.getElementById('budget-sort-input').addEventListener('change', (e) => {
  selectedBillsSort = e.target.value;
  renderBudget();
});

// The "Due in the next 2 weeks" chip turns that filter on and off.
document.getElementById('budget-soon-filter').addEventListener('click', (e) => {
  onlyDueSoon = !onlyDueSoon;
  e.currentTarget.classList.toggle('chip-active', onlyDueSoon);
  e.currentTarget.setAttribute('aria-pressed', String(onlyDueSoon));
  renderBudget();
});

// Add-recurring-income form: validate, add the source, and clear the form when it worked.
document.getElementById('recurring-income-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('recurring-income-name-input');
  const amountInput = document.getElementById('recurring-income-amount-input');
  const startDateInput = document.getElementById('recurring-income-startdate-input');
  const frequencyInput = document.getElementById('recurring-income-frequency-input');
  const categoryInput = document.getElementById('recurring-income-category-input');
  const errorEl = document.getElementById('recurring-income-form-error');

  const result = addRecurringIncome({
    name: nameInput.value,
    amount: amountInput.value,
    dueDate: startDateInput.value,
    frequency: frequencyInput.value,
    category: categoryInput.value,
  });

  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  nameInput.value = '';
  amountInput.value = '';
  startDateInput.value = '';
  frequencyInput.value = 'biweekly';
  categoryInput.value = '';
  nameInput.focus();
});

// ---- Backup reminders ----
// The server keeps daily restore points of everything that syncs. The one thing only this
// device holds is a full download. Browsers can't write files in the background, so the app
// tracks the last download and nags when it is overdue.

// Where the time of the last full export is remembered, and how many days before a reminder.
const EXPORT_AT_KEY = 'budgetApp.exportAt.v1';
// Days after the last full export before the app reminds you to download another.
const EXPORT_DUE_DAYS = 30;

// Remembers that a backup file was just downloaded.
function recordBackupTime(key) {
  try { localStorage.setItem(key, new Date().toISOString()); } catch { /* storage full: nothing to remember it in */ }
}

// Whole days since the last backup, or null if there has never been one.
function daysSinceBackup(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const ms = Date.now() - new Date(value).getTime();
    return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
  } catch {
    return null;
  }
}

// Set when the user dismisses the backup reminders; they stay hidden until the page is reloaded.
let backupNotesDismissed = false;

// Shows reminders above the calendar when the full export is overdue for a backup, or sync is stale.
function renderBackupNotes() {
  const box = document.getElementById('backup-notes');
  if (!box) return;
  box.innerHTML = '';
  const reminders = [];
  const hasAnyData = SYNC_COLLECTIONS.some((c) => c.get().some((r) => !r.deleted));
  const exportDays = daysSinceBackup(EXPORT_AT_KEY);
  // Never exported: only nag a device that does not sync (synced devices already hold copies of each other's data).
  if (hasAnyData && (exportDays === null ? !loadSyncConfig() : exportDays >= EXPORT_DUE_DAYS)) {
    reminders.push({
      text: `You haven't downloaded a full backup of your budget ${exportDays === null ? 'yet' : `in ${exportDays} days`}. It keeps your bills safe if this device is lost.`,
      label: 'Download full backup',
      action: exportData,
    });
  }
  // Syncing is manual, so nudge when it has been a while (only on devices where sync is set up).
  if (loadSyncConfig()) {
    const syncDays = daysSinceBackup(LAST_SYNC_AT_KEY);
    if (syncDays === null) {
      recordBackupTime(LAST_SYNC_AT_KEY); // start the clock the first time we notice sync is on
    } else if (syncDays >= SYNC_STALE_DAYS) {
      reminders.push({
        text: `You haven't synced in ${syncDays} days. Changes on this device are not on your other devices yet.`,
        label: 'Sync now',
        action: runSync,
      });
    }
  }
  box.hidden = backupNotesDismissed || reminders.length === 0;
  reminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'reminder-banner';
    const text = document.createElement('span');
    text.className = 'reminder-banner-text';
    text.textContent = reminder.text;
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'reminder-banner-btn';
    act.textContent = reminder.label;
    act.addEventListener('click', reminder.action);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'reminder-banner-btn';
    dismiss.setAttribute('aria-label', 'Dismiss backup reminders');
    dismiss.textContent = '\u00d7';
    dismiss.addEventListener('click', () => { backupNotesDismissed = true; box.hidden = true; });
    row.append(text, act, dismiss);
    box.appendChild(row);
  });
}

// ---- Bills banner ----
// Computed from the live bills array, with no storage key of its own. Redrawn at the end of
// renderBudget(), so every add/edit/delete/undo/redo/sync keeps it current.

// How soon a bill must be due to appear in the banner at the top of the screen.
const REMINDER_BANNER_DAYS = 2;

// Splits bills into overdue (unpaid balance before today) and due soon (unpaid, within
// REMINDER_BANNER_DAYS). Bills that pay themselves (autopay) are left out of both.
function computeBillReminders(nonDeletedBills) {
  const todayK = todayKey();
  const yesterdayK = shiftDateKey(todayK, -1);

  // Overdue: real unpaid balance strictly before today. Uses the closed-form unpaidAmountThrough,
  // not oldestUnpaidOccurrence (a day-by-day walk), because this runs on every redraw.
  const overdue = nonDeletedBills
    .filter((bill) => !bill.autopay) // a bill that pays itself is not "overdue" just because it was not ticked off
    .map((bill) => ({ bill, amount: unpaidAmountThrough(bill, yesterdayK) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Due soon: unpaid occurrences on any of the next REMINDER_BANNER_DAYS days (today included).
  const dueSoon = [];
  nonDeletedBills.filter((bill) => !bill.autopay).forEach((bill) => {
    for (let i = 0; i <= REMINDER_BANNER_DAYS; i++) {
      const dateKey = shiftDateKey(todayK, i);
      if (occursOnDate(bill, dateKey) && !(bill.paidDates || []).includes(dateKey)) {
        dueSoon.push({ bill, dateKey });
      }
    }
  });
  dueSoon.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  return { overdue, dueSoon };
}

// Plain-English timing for the banner, e.g. "today", "tomorrow", "in 4 days", "2 days ago".
function whenLabel(days) {
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// Whole days from today to a YYYY-MM-DD date (negative if it's in the past).
function daysUntilDateKey(dateKey) {
  return utcDayDiff(todayKey(), dateKey);
}

// Set when the bills banner is dismissed; it comes back on a new day.
let reminderBannerDismissed = false;

// Shows or hides the bills banner (bills due within a few days, plus a count of overdue ones).
function renderReminderBanner(overdueBills, soon) {
  const banner = document.getElementById('reminder-banner');
  if (reminderBannerDismissed || (soon.length === 0 && overdueBills.length === 0)) {
    banner.hidden = true;
    return;
  }
  const parts = soon.map(({ bill, dateKey }) =>
    `${bill.name} $${bill.amount.toFixed(2)} ${whenLabel(daysUntilDateKey(dateKey))}`);
  if (overdueBills.length > 0) {
    const total = overdueBills.reduce((sum, x) => sum + x.amount, 0);
    parts.push(`${overdueBills.length} overdue ($${total.toFixed(2)})`);
  }
  document.getElementById('reminder-banner-text').textContent = `Bills: ${parts.join(' · ')}`;
  renderBannerPayButtons(overdueBills, soon);
  banner.hidden = false;
}

// How many bills get a Mark paid button in the banner.
const BANNER_PAY_BUTTONS = 4;

// One Mark paid button per bill listed in the banner (the first few: due soon first, then overdue),
// so a bill can be ticked off right there instead of finding it in the list below.
function renderBannerPayButtons(overdueBills, soon) {
  const box = document.getElementById('reminder-banner-actions');
  if (!box) return;
  box.innerHTML = '';
  const targets = soon.slice(0, BANNER_PAY_BUTTONS).map(({ bill, dateKey }) => ({ bill, dateKey }));
  const yesterdayK = shiftDateKey(todayKey(), -1);
  for (const { bill } of overdueBills) {
    if (targets.length >= BANNER_PAY_BUTTONS) break;
    const dateKey = oldestUnpaidOccurrence(bill, yesterdayK);
    if (dateKey) targets.push({ bill, dateKey });
  }
  targets.forEach(({ bill, dateKey }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reminder-banner-btn';
    btn.textContent = `Mark ${bill.name} paid`;
    btn.setAttribute('aria-label', `Mark ${bill.name} paid for ${formatDateKeyShort(dateKey)}`);
    btn.addEventListener('click', () => toggleBillPaid(bill.id, dateKey, true));
    box.appendChild(btn);
  });
}

// Recomputes what is due or overdue and updates the banner.
function renderBillReminders() {
  const { overdue, dueSoon } = computeBillReminders(bills.filter((b) => !b.deleted));
  renderReminderBanner(overdue, dueSoon);
}

// The cross on the bills banner.
document.getElementById('reminder-banner-dismiss').addEventListener('click', () => {
  reminderBannerDismissed = true;
  document.getElementById('reminder-banner').hidden = true;
  // The button that had focus just disappeared; move focus to the screen heading.
  const heading = document.querySelector('#budget-collection h2');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
});

// ---- Device Sync ----
// Optional: the app works fully offline with no sync configured. Sync only happens when the
// user presses "Sync now" and is never required for any other action.

// The only address the app ever talks to, and only when the user presses "Sync now".
// It is this app's own sync server (server/sync_server.py, deployed with render.yaml).
const SYNC_SERVER_URL = 'https://budget-sync.onrender.com';

// localStorage key for the saved sync passphrase.
const SYNC_CONFIG_KEY = 'budgetApp.syncConfig.v1';

// Reads the saved sync settings ({ token }); null if none or damaged.
function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.token === 'string' && parsed.token) return parsed;
  } catch {
    // fall through
  }
  return null;
}

// Saves the sync settings on this device only.
function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

// The three synced lists: the name the server expects, the localStorage key, a display label, and
// how to read, replace, redraw, delete and restore each. Sync, undo and import all loop over this.
const SYNC_COLLECTIONS = [
  { name: 'bills', label: 'Bills', key: BILLS_KEY, get: () => bills, set: (v) => { bills = v; }, render: renderBudget, delete: deleteBill, restore: restoreBill },
  { name: 'income', label: 'Income', key: INCOME_KEY, get: () => income, set: (v) => { income = v; }, render: renderBudget, delete: deleteIncome, restore: restoreIncome },
  { name: 'recurringIncome', label: 'Recurring Income', key: RECURRING_INCOME_KEY, get: () => recurringIncome, set: (v) => { recurringIncome = v; }, render: renderBudget, delete: deleteRecurringIncome, restore: restoreRecurringIncome },
];

// ---- Undo/redo application mechanics ----
// Applies one side (`before` on undo, `after` on redo) of a recorded entry back onto the live
// collection, using the get/set/render/delete/restore lookup above.

// Replays one recorded change onto the live record. which is 'before' (undo) or 'after' (redo).
// Adds and deletes go through the collection's own delete/restore; edits copy back only the fields that changed.
function applyEntrySnapshot(entry, which) {
  // Find the collection and the live record this entry is about.
  const target = entry[which]; // 'before' on undo, 'after' on redo
  const cfg = SYNC_COLLECTIONS.find((c) => c.name === entry.collection);
  if (!cfg) return;
  const items = cfg.get();
  const record = items.find((r) => r.id === entry.id);

  // Case 1: the target state is "didn't exist" (undoing an add), so tombstone the record
  // with the collection's own delete, never a splice.
  if (target === null) {
    if (record && !record.deleted) cfg.delete(entry.id);
    return;
  }

  if (!record) return; // defensive: id no longer exists at all

  // Case 2: the target state is deleted. Case 3: it is live but the record is deleted, so restore it first.
  if (target.deleted && !record.deleted) {
    cfg.delete(entry.id);
    return;
  }
  if (!target.deleted && record.deleted) {
    cfg.restore(entry.id); // un-tombstone via restoreX first
  }

  // Clone the target so the live record never shares nested arrays (e.g. paidDates) with the
  // entry still sitting in the other stack.
  const snapshot = structuredClone(target);
  const other = entry[which === 'before' ? 'after' : 'before'];
  const BOOKKEEPING = ['id', 'dateAdded', 'version', 'updatedAt', 'deviceId', 'deleted'];
  // Only fields this entry actually changed are applied, so undo never reverts fields changed
  // elsewhere since (e.g. paid dates that arrived from another device). A field the snapshot
  // lacks is removed again. Bookkeeping is never replayed: version is server-assigned,
  // updatedAt/deviceId are freshly stamped below (this undo is a new local change), and
  // `deleted` is handled above. Then save and redraw this one collection.
  new Set([...Object.keys(snapshot), ...Object.keys(other || {})]).forEach((key) => {
    if (BOOKKEEPING.includes(key)) return;
    if (other && JSON.stringify(snapshot[key]) === JSON.stringify(other[key])) return;
    if (key in snapshot) record[key] = snapshot[key];
    else delete record[key];
  });
  stampSync(record);
  saveCollection(cfg.key, items);
  cfg.render(); // only this one collection re-renders — never the whole app
}

// Steps back the most recent change and moves it onto the redo list.
function undo() {
  if (undoStack.length === 0) return;
  const entry = undoStack.pop();
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'before');
  } finally {
    isApplyingHistory = false;
  }
  redoStack.push(entry);
  if (redoStack.length > MAX_UNDO_DEPTH) redoStack.shift();
  updateUndoRedoButtons();
  hideUndoToast();
}

// Re-applies the most recently undone change.
function redo() {
  if (redoStack.length === 0) return;
  const entry = redoStack.pop();
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'after');
  } finally {
    isApplyingHistory = false;
  }
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  updateUndoRedoButtons();
  hideUndoToast();
}

// Which field names a record in each collection, for the Undo/Redo tooltips.
const RECORD_LABEL_FIELD = {
  bills: 'name', income: 'dateKey', recurringIncome: 'name',
};

// Plain-English summary of an undo entry, e.g. "deleted 'Rent'", for the button tooltips.
function describeEntry(entry) {
  const labelField = RECORD_LABEL_FIELD[entry.collection];
  const source = entry.after || entry.before;
  const identifier = source && labelField ? source[labelField] : null;
  let action;
  if (entry.before === null) action = 'added';
  else if (entry.after.deleted && !entry.before.deleted) action = 'deleted';
  else if (!entry.after.deleted && entry.before.deleted) action = 'restored';
  else action = 'edited';
  return identifier ? `${action} '${identifier}'` : `${action} an item`;
}

// Enables or disables Undo / Redo and updates their tooltips to name the change they'd apply.
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const topUndo = undoStack[undoStack.length - 1];
  const topRedo = redoStack[redoStack.length - 1];
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  undoBtn.title = topUndo ? `Undo: ${describeEntry(topUndo)}` : 'Undo';
  redoBtn.title = topRedo ? `Redo: ${describeEntry(topRedo)}` : 'Redo';
}

// The Undo and Redo buttons in the Menu.
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

// ---- Undo toast ----
// A short bar at the bottom of the screen after a delete or a Mark paid, with an Undo button, so a
// mis-tap can be fixed without opening the Menu. Edits and typing a day's income get no toast.

// How long the toast stays before it hides itself.
const UNDO_TOAST_MS = 6000;
var undoToastTimer = null; // var, not let: recordUndo can run before this line during startup

// What the toast should say about a change, or null when the change does not get one.
function undoToastMessage(collectionName, before, after) {
  if (!after) return null;
  const name = after.name || 'item';
  if (!before) return collectionName === 'income' ? null : `Added ${name}`;
  if (collectionName !== 'income' && after.deleted && !before.deleted) return `Deleted ${name}`;
  if (collectionName === 'bills') {
    const paidBefore = (before.paidDates || []).length;
    const paidNow = (after.paidDates || []).length;
    if (paidNow > paidBefore) return `Marked ${name} paid`;
    if (paidNow < paidBefore) return `Marked ${name} unpaid`;
  }
  return null;
}

// Hides the toast (and its timer).
function hideUndoToast() {
  clearTimeout(undoToastTimer);
  const toast = document.getElementById('undo-toast');
  if (toast) toast.hidden = true;
}

// Shows the toast with a message, for UNDO_TOAST_MS.
function showUndoToast(message) {
  const toast = document.getElementById('undo-toast');
  if (!toast) return;
  document.getElementById('undo-toast-text').textContent = message;
  toast.hidden = false;
  clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(hideUndoToast, UNDO_TOAST_MS);
}

// The toast's Undo button undoes the latest change (undo() also hides the toast).
document.getElementById('undo-toast-btn').addEventListener('click', undo);

// Sync progress state: a sync is running, when the last one finished, and whether its message was ok/failed.
let syncInFlight = false;
let lastSyncedAt = null; // when the last sync finished (drives the "Synced Xm ago" label)
// The last successful sync is also saved, so the backup notes can warn when it has been too long.
const LAST_SYNC_AT_KEY = 'budgetApp.lastSyncAt.v1';
const SYNC_STALE_DAYS = 7; // days without a sync before the reminder shows
let lastSyncTone = null; // 'ok', 'failed' or null: the tone of the last status message

// Shows a sync message in the sidebar; tone is 'ok', 'failed' or null (neutral).
function setSyncStatus(text, tone) {
  lastSyncTone = tone;
  updateQuickSync();
  const el = document.getElementById('sync-status-text');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

// Mirrors the sync state into the top bar's Sync button and note (phones only, where the Menu is collapsed;
// the Menu keeps the full controls). Hidden until sync is set up on this device.
function updateQuickSync() {
  const btn = document.getElementById('quick-sync-btn');
  const note = document.getElementById('quick-sync-note');
  if (!btn || !note) return;
  const on = !!loadSyncConfig();
  btn.hidden = !on;
  note.hidden = !on;
  if (!on) return;
  const unsynced = countUnsyncedChanges();
  const needsSync = unsynced !== null && unsynced > 0;
  const failed = lastSyncTone === 'failed' && !syncInFlight;
  btn.disabled = syncInFlight;
  btn.classList.toggle('sync-needed', needsSync);
  let text = 'Not synced yet';
  if (syncInFlight) {
    text = 'Syncing…';
  } else if (failed) {
    text = 'Needs attention — see Menu';
  } else if (needsSync) {
    text = `${unsynced} change${unsynced === 1 ? '' : 's'} not synced`;
  } else if (lastSyncedAt) {
    const minutes = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000);
    text = minutes <= 0 ? 'Synced just now' : `Synced ${minutes}m ago`;
  }
  note.textContent = text;
  note.classList.toggle('sync-failed', failed);
}

// ---- Unsynced-changes indicator ----
// Sync is manual, so the sidebar says how many records differ from what the
// server last confirmed (the same comparison runSync uses to decide what to
// send) and the Sync now button highlights itself while there is work to send.

// How many records differ from what the server last confirmed; null if this device has never synced.
function countUnsyncedChanges() {
  const snapshot = loadSyncSnapshot();
  if (!snapshot) return null; // never synced on this device: the status line already says so
  let count = 0;
  SYNC_COLLECTIONS.forEach((c) => {
    const known = snapshot[c.name] || {};
    c.get().forEach((item) => { if (known[item.id] !== JSON.stringify(item)) count += 1; });
  });
  return count;
}

// Shows "N changes not synced" and highlights Sync now when there is something to send.
function updateSyncPending() {
  const el = document.getElementById('sync-pending');
  const btn = document.getElementById('sync-now-btn');
  if (!el || !btn) return;
  const count = loadSyncConfig() ? countUnsyncedChanges() : null;
  const show = count !== null && count > 0;
  el.hidden = !show;
  if (show) el.textContent = `${count} change${count === 1 ? '' : 's'} not synced. Tap Sync now.`;
  btn.classList.toggle('sync-needed', show);
  updateQuickSync();
}

var syncPendingTimer = null; // var, not let: saveCollection runs before this line during startup
// Refreshes the unsynced-changes indicator shortly after a save (a burst of saves refreshes it once).
function scheduleSyncPending() {
  clearTimeout(syncPendingTimer);
  syncPendingTimer = setTimeout(() => safeRender(updateSyncPending), 250);
}

// Per-device record of what the server last told us, so each sync can send
// only records this device actually changed. Re-sending every record on every
// tick let a stale device overwrite or "fork" other devices' newer edits and
// deletes into duplicates. Never synced; purely local bookkeeping.
const SYNC_SNAPSHOT_KEY = 'budgetApp.syncSnapshot.v1';

// Reads the record of what the server last confirmed ({ collection: { id: json } }); null if none.
function loadSyncSnapshot() {
  try {
    const raw = localStorage.getItem(SYNC_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Saves that record; if storage is full it is dropped so the next sync starts fresh instead of trusting stale data.
function saveSyncSnapshot(snapshot) {
  try {
    localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full: drop the stale snapshot so the next sync re-bootstraps
    // safely instead of trusting out-of-date bookkeeping.
    try { localStorage.removeItem(SYNC_SNAPSHOT_KEY); } catch { /* nothing more to do */ }
  }
}

// Maps each record's id to its JSON text, for comparing records before and after a sync.
function snapshotOfItems(items) {
  const map = Object.create(null); // no prototype, so an id such as "__proto__" is just a key
  items.forEach((item) => { map[item.id] = JSON.stringify(item); });
  return map;
}

// HTTP header values can only carry plain ASCII; anything else is sent
// percent-encoded behind a "u:" marker, which the server understands.
function syncTokenHeader(token) {
  return /^[\x20-\x7e]*$/.test(token) ? token : 'u:' + encodeURIComponent(token);
}

// After this long with no answer, the status line explains the wait (a free-tier server can be asleep).
// `let` so a test can shorten it.
let SYNC_WAKE_NOTICE_MS = 5000;
// After this long the request is abandoned and the sync reports a timeout, so a stalled
// connection cannot leave "Sync now" disabled until the browser gives up.
const SYNC_TIMEOUT_MS = 90000; // generous: a sleeping free-tier server can take a minute or more to wake

// How long to wait before the one automatic retry. `let` so a test can shorten it.
let SYNC_RETRY_DELAY_MS = 1500;

// Sends the changed records to the server and returns { kind: 'ok', data } or a failure kind:
// 'unauthorized' (wrong passphrase), 'outdated' (this copy of the app is too old) or 'error'.
// Gives up after SYNC_TIMEOUT_MS; network errors and timeouts are thrown to the caller.
async function postSync(config, collections) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${SYNC_SERVER_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': syncTokenHeader(config.token) },
      body: JSON.stringify({ deviceId: getDeviceId(), clientVersion: 2, collections }),
      signal: controller.signal,
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 426) return { kind: 'outdated' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

// postSync, plus one automatic retry when the server did not answer properly (a sleeping free server often
// fails the first request while it wakes up). A wrong passphrase or an out-of-date copy is never retried.
// A second failure is thrown (or returned as 'error') for runSync to report.
async function postSyncWithRetry(config, collections) {
  let first;
  try {
    first = await postSync(config, collections);
  } catch {
    first = { kind: 'error' };
  }
  if (first.kind !== 'error') return first;
  setSyncStatus('The server did not answer yet. Trying once more…', null);
  await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_DELAY_MS));
  return postSync(config, collections);
}

// First sync on a device with no snapshot: pull the server's state, then
// reconcile record by record WITHOUT sending anything. A local record is only
// kept as "changed here" if the server has never seen it or this device's
// copy was edited more recently than the server's; otherwise the server's
// copy wins, so a long-stale device can't resurrect or overwrite anything. A record the
// server has deleted stays deleted, even if this device edited it later.
function bootstrapSyncSnapshot(serverData) {
  const snapshot = {};
  SYNC_COLLECTIONS.forEach((c) => {
    const serverItems = serverData.collections && Array.isArray(serverData.collections[c.name])
      ? serverData.collections[c.name]
      : [];
    const serverById = new Map(serverItems.map((item) => [item.id, item]));
    const merged = [];
    const known = Object.create(null);
    const seen = new Set();

    c.get().forEach((local) => {
      seen.add(local.id);
      const server = serverById.get(local.id);
      if (!server) {
        merged.push(local);
        return;
      }
      const sameContent = contentMatchesIgnoringVersion(local, server, c.name);
      const wouldResurrect = server.deleted && !local.deleted;
      if (!sameContent && !wouldResurrect && (local.updatedAt || '') > (server.updatedAt || '')) {
        merged.push(local);
        return;
      }
      merged.push(server);
      known[server.id] = JSON.stringify(server);
    });
    serverItems.forEach((server) => {
      if (seen.has(server.id)) return;
      merged.push(server);
      known[server.id] = JSON.stringify(server);
    });

    c.set(merged);
    saveCollection(c.key, merged);
    c.render();
    snapshot[c.name] = known;
  });
  saveSyncSnapshot(snapshot);
  return snapshot;
}

// Applies the server's reply to one collection WITHOUT ever dropping or
// clobbering local work. Returns { result, known }: the new local array and
// the snapshot map of records now confirmed identical to the server's.
//  - unchanged since the request was sent: adopt the server's copy;
//  - edited/deleted/undeleted while the request was in flight: keep the local
//    version, and if the server holds exactly what we sent, adopt its version
//    number so the follow-up send is a clean update instead of a fork;
//  - missing from the reply (created in flight, or the server lost it): keep it
//    and leave it out of the snapshot so it is sent again;
//  - the server's copy has a LOWER version than ours (server rolled back):
//    keep ours and re-send it.
function reconcileServerReply(c, incoming, preFlightMap) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const result = [];
  const known = Object.create(null);
  const seen = new Set();

  c.get().forEach((local) => {
    seen.add(local.id);
    const server = incomingById.get(local.id);
    if (!server) {
      result.push(local);
      return;
    }
    if ((server.version || 0) < (local.version || 0)) {
      // The server's number is lower than ours. After a server restore or wipe it starts every
      // re-sent record again at version 1: if the content is the same, just take the server's copy
      // (otherwise it would never count as confirmed). Different content means the server really is
      // behind, so keep ours and send it again.
      if (contentMatchesIgnoringVersion(local, server, c.name) && JSON.stringify(local) === preFlightMap[local.id]) {
        result.push(server);
        known[server.id] = JSON.stringify(server);
        return;
      }
      result.push(local);
      return;
    }
    if (JSON.stringify(local) === preFlightMap[local.id]) {
      result.push(server);
      known[server.id] = JSON.stringify(server);
      return;
    }
    const sent = preFlightMap[local.id] ? JSON.parse(preFlightMap[local.id]) : null;
    if (sent && contentMatchesIgnoringVersion(sent, server, c.name)) {
      local.version = server.version;
    }
    result.push(local);
  });

  incoming.forEach((server) => {
    if (seen.has(server.id)) return;
    result.push(server);
    known[server.id] = JSON.stringify(server);
  });

  return { result, known };
}

// Runs one manual sync: send only what changed on this device, merge the server's reply
// into the local lists without losing local work, then report the outcome in the sidebar.
async function runSync() {
  // Step 1: do nothing if sync isn't set up or one is already running; lock the button and show progress.
  const config = loadSyncConfig();
  if (!config || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus('Syncing…', null);
  // After a few seconds the status explains the wait and counts the seconds, so it never looks stuck.
  const startedAt = Date.now();
  let wakeTicker = null;
  const wakeTimer = setTimeout(() => {
    const say = () => {
      if (!syncInFlight) return;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      setSyncStatus(`Still syncing. The server may be waking up, which can take a minute or more. (${seconds}s)`, null);
    };
    say();
    wakeTicker = setInterval(say, 5000);
  }, SYNC_WAKE_NOTICE_MS);
  const syncNowBtn = document.getElementById('sync-now-btn');
  if (syncNowBtn) syncNowBtn.disabled = true;
  let resyncSoon = false;
  let incompleteReply = false;

  try {
    // Step 2: first sync on this device (no snapshot yet): pull the server's data and reconcile without sending.
    let snapshot = loadSyncSnapshot();
    if (!snapshot) {
      const boot = await postSyncWithRetry(config, {});
      if (boot.kind === 'unauthorized') {
        setSyncStatus('Sync failed — check passphrase', 'failed');
        return;
      }
      if (boot.kind === 'outdated') {
        setSyncStatus('This copy is out of date — close and reopen the app, then tap Sync now', 'failed');
        return;
      }
      if (boot.kind !== 'ok') {
        setSyncStatus('Sync failed — tap Sync now to try again', 'failed');
        return;
      }
      snapshot = bootstrapSyncSnapshot(boot.data);
    }

    // Steps 3 to 5 normally run once. If the server turns out to have lost its data (free hosting
    // clears it whenever the service sleeps or redeploys), they run a second time straight away so
    // that one tap on Sync now sends everything back.
    let serverWasReset = false;
    const collectedConflicts = [];
    for (let pass = 0; pass < 2; pass += 1) {
      // Step 3: work out what changed here since the server last confirmed, and remember how every record looked when sent.
      const outgoing = {};
      const preFlight = {};
      SYNC_COLLECTIONS.forEach((c) => {
        const items = c.get();
        const known = snapshot[c.name] || {};
        outgoing[c.name] = items.filter((item) => known[item.id] !== JSON.stringify(item));
        preFlight[c.name] = snapshotOfItems(items);
      });

      // Step 4: send the changes and stop with a message if the server refuses.
      const result = await postSyncWithRetry(config, outgoing);
      if (result.kind === 'unauthorized') {
        setSyncStatus('Sync failed — check passphrase', 'failed');
        return;
      }
      if (result.kind === 'outdated') {
        setSyncStatus('This copy is out of date — close and reopen the app, then tap Sync now', 'failed');
        return;
      }
      if (result.kind !== 'ok') {
        setSyncStatus('Sync failed — tap Sync now to try again', 'failed');
        return;
      }
      const data = result.data;
      if (Array.isArray(data.conflicts)) collectedConflicts.push(...data.conflicts);

      // Step 5: merge the server's reply into each list, redrawing only lists that changed.
      resyncSoon = false;
      incompleteReply = false;
      let serverLostRecords = false;
      const nextSnapshot = { ...snapshot };
      SYNC_COLLECTIONS.forEach((c) => {
        const incoming = data.collections && Array.isArray(data.collections[c.name]) ? data.collections[c.name] : null;
        if (!incoming) {
          incompleteReply = true;
          return;
        }
        // The server never removes a record (deletes are kept as tombstones), so a record this device
        // had confirmed that is now missing from the reply means the server lost its data.
        const serverIds = new Set(incoming.map((item) => item.id));
        if (Object.keys(snapshot[c.name] || {}).some((id) => !serverIds.has(id))) serverLostRecords = true;
        const before = JSON.stringify(c.get());
        const { result, known } = reconcileServerReply(c, incoming, preFlight[c.name]);
        nextSnapshot[c.name] = known;
        if (JSON.stringify(result) !== before) {
          c.set(result);
          saveCollection(c.key, result);
          safeRender(() => c.render());
        }
        // Anything still different from what the server confirmed (an in-flight
        // change, or a record the server was missing) goes out on a quick retry.
        if (result.some((item) => known[item.id] !== JSON.stringify(item))) resyncSoon = true;
      });
      saveSyncSnapshot(nextSnapshot);

      if (!serverLostRecords || pass === 1) break;
      serverWasReset = true;
      snapshot = nextSnapshot; // the records the server lost are no longer marked confirmed, so pass 2 sends them
      setSyncStatus('The server had lost its data. Sending everything to it again…', null);
    }

    // Step 6: report the outcome (conflicts, an incomplete reply, edits made mid-sync, or success).
    lastSyncedAt = new Date();
    recordBackupTime(LAST_SYNC_AT_KEY); // the server was reached and answered, whatever the details below
    const conflicts = collectedConflicts;
    if (conflicts.length > 0) {
      const collectionNames = [...new Set(conflicts.map((c) => c.collection))]
        .map((name) => SYNC_COLLECTIONS.find((c) => c.name === name)?.label || name);
      const noun = conflicts.length === 1 ? 'conflict' : 'conflicts';
      setSyncStatus(
        `Synced — ${conflicts.length} ${noun} merged as duplicates in ${collectionNames.join(', ')}. Review and remove any you don't need.`,
        'failed'
      );
    } else if (incompleteReply) {
      setSyncStatus('Synced, but the server reply was incomplete. Tap Sync now again.', 'failed');
    } else if (resyncSoon) {
      setSyncStatus('Synced — you changed something during the sync. Tap Sync now again to send it.', 'failed');
    } else if (serverWasReset) {
      setSyncStatus('Synced — the server had been reset, so everything was sent to it again', 'ok');
    } else {
      setSyncStatus('Synced just now', 'ok');
    }
  // Network failures and timeouts end up here; always unlock the button afterwards.
  } catch (err) {
    setSyncStatus(
      err && err.name === 'AbortError'
        ? 'Sync timed out. The server did not answer — tap Sync now to try again'
        : 'Sync failed — tap Sync now to try again',
      'failed'
    );
  } finally {
    clearTimeout(wakeTimer);
    clearInterval(wakeTicker);
    syncInFlight = false;
    if (syncNowBtn) syncNowBtn.disabled = false;
    updateSyncPending();
  }
}

// Ticks the visible "Synced Xm ago" label between actual sync attempts,
// without ever overwriting a currently-shown error/in-progress state.
setInterval(() => {
  if (lastSyncTone !== 'ok' || syncInFlight || !lastSyncedAt) return;
  const minutes = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000);
  setSyncStatus(minutes <= 0 ? 'Synced just now' : `Synced ${minutes}m ago`, 'ok');
}, 30000);

// Wires up the sidebar sync controls: the passphrase form, "change passphrase" and "Sync now".
function initSyncUI() {
  const setupSection = document.getElementById('sync-setup');
  const statusSection = document.getElementById('sync-status');
  const form = document.getElementById('sync-setup-form');
  const changeBtn = document.getElementById('sync-change-btn');
  const config = loadSyncConfig();

  setupSection.hidden = !!config;
  statusSection.hidden = !config;
  if (!config) setSyncStatus('Sync not set up', null);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const tokenInput = document.getElementById('sync-token-input');
    const token = tokenInput.value.trim();
    if (!token) return;
    const previousConfig = loadSyncConfig();
    try {
      saveSyncConfig({ token });
    } catch {
      // The setup form is showing (the sync status line is hidden), so use the Menu's message line.
      setDataIoStatus('Could not save the sync passphrase on this device (storage is full).', 'failed');
      return; // the form stays open; nothing was changed
    }
    // A different passphrase means a different server copy: forget what the old one confirmed.
    if (!previousConfig || previousConfig.token !== token) {
      try { localStorage.removeItem(SYNC_SNAPSHOT_KEY); } catch { /* nothing to remove it from */ }
    }
    tokenInput.value = '';
    setupSection.hidden = true;
    statusSection.hidden = false;
    runSync();
  });

  changeBtn.addEventListener('click', () => {
    document.getElementById('sync-token-input').value = '';
    setupSection.hidden = false;
    statusSection.hidden = true;
  });

  // Sync is manual only: nothing runs in the background, on a timer, on
  // opening the app, or when the connection returns. Press Sync now.
  document.getElementById('sync-now-btn').addEventListener('click', runSync);
  document.getElementById('quick-sync-btn').addEventListener('click', runSync);
  if (config) setSyncStatus('Not synced yet — tap Sync now', null);
  updateSyncPending();
}

// ---- Data export / import ----
// Import's merge mirrors the sync server's merge_collection()/_content_matches() (as Second
// Memory does), so a restore behaves like a sync conflict: a replay of the same data is a no-op,
// a deleted record stays deleted, and a genuine conflict keeps both sides.
// It also accepts a Second Memory export (a one-time way to bring old data over): only bills,
// income and recurringIncome are read.

// The full backup: the three lists that sync, plus the pay-period settings, which only live on
// this device and are kept under `local` so they stay out of syncing.
function buildExportPayload() {
  const collections = {};
  SYNC_COLLECTIONS.forEach((c) => { collections[c.name] = c.get(); });
  const local = {};
  const payday = loadPaydaySettings();
  if (payday.payDateKey) local.paydaySettings = payday;
  return { collections, local };
}

// Downloads the full backup (the three lists plus the payday settings) as one JSON file.
function exportData() {
  recordBackupTime(EXPORT_AT_KEY);
  const json = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budget-export-${todayKey()}.json`; // the local date, not the UTC one
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000); // revoking at once can cancel the download on iOS/Safari
  setDataIoStatus('Backup downloaded. Keep the file somewhere private.', 'ok');
  renderBackupNotes();
}

// Finds the lists in a parsed file: `{ collections: {...} }` (what buildExportPayload makes) or a
// bare collections object. Returns null for anything else so the caller can refuse it.
function extractImportCollections(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.collections && typeof parsed.collections === 'object' && !Array.isArray(parsed.collections)) return parsed.collections;
  const looksLikeCollections = SYNC_COLLECTIONS.some((c) => Array.isArray(parsed[c.name]));
  return looksLikeCollections ? parsed : null;
}

// Structural equality for records (arrays and nested objects compared by content; null equals missing).
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true; // null and a missing value are the same (as in the server's dict.get())
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Fields that say who/when touched a record rather than what it holds (mirrors the server's
// _BOOKKEEPING_FIELDS). Comparing them would make identical records look different.
// `dateAdded` and `deleted` are deliberately NOT here: they are real data.
const BOOKKEEPING_FIELDS = new Set(['version', 'updatedAt', 'deviceId']);

// Extra bookkeeping per list. Income uses id = dateKey so two devices entering the same date
// converge on one record; their dateAdded values then differ normally and must not count.
const EXTRA_BOOKKEEPING_FIELDS_BY_COLLECTION = { income: new Set(['dateAdded']) };

// Port of the server's _content_matches(): true if two records hold the same real data, i.e.
// the incoming one is a re-import or resend, not a genuine conflicting edit.
function contentMatchesIgnoringVersion(a, b, collectionName) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  BOOKKEEPING_FIELDS.forEach((k) => keys.delete(k));
  const extra = EXTRA_BOOKKEEPING_FIELDS_BY_COLLECTION[collectionName];
  if (extra) extra.forEach((k) => keys.delete(k));
  return [...keys].every((k) => deepEqual(a[k], b[k]));
}

// Port of the server's merge_collection(), merging an imported file's records into the local
// list. Per record: (a) new id -> added; (b) same content -> no-op; (c) a deleted record is
// never brought back; (d) the incoming copy is newer (by version, then edit time) -> replaces
// the local one; (e) the incoming copy is older -> ignored if the local one was edited later,
// otherwise kept as a copy under a new id (income instead replaces, as it is one entry per
// date). Mutates `localItems` in place and returns counts for the summary message.
function mergeCollectionFromImport(localItems, importedItems, collectionName) {
  const byId = new Map(localItems.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let duplicated = 0;
  let unchanged = 0;

  importedItems.forEach((incoming) => {
    if (!incoming || typeof incoming !== 'object' || !incoming.id) return;
    const existing = byId.get(incoming.id);

    if (!existing) {
      const record = { ...incoming };
      localItems.push(record);
      byId.set(record.id, record);
      added += 1;
      return;
    }

    const incomingVersion = incoming.version || 0;
    const existingVersion = existing.version || 0;

    if (incomingVersion >= existingVersion) {
      // Same content is a true no-op: leave the local record (and its updatedAt/deviceId) alone.
      if (contentMatchesIgnoringVersion(existing, incoming, collectionName)) {
        unchanged += 1;
        return;
      }
      if (existing.deleted && !incoming.deleted) {
        unchanged += 1; // a deleted record is never brought back by a backup
        return;
      }
      // The version number only moves on a server round trip, so a record
      // changed or deleted here since the backup was taken has the SAME
      // version as the backup copy. Compare edit times instead of letting the
      // older backup overwrite (or resurrect) newer local work.
      if ((existing.updatedAt || '') > (incoming.updatedAt || '')) {
        unchanged += 1;
        return;
      }
      const record = { ...incoming };
      const index = localItems.findIndex((item) => item.id === incoming.id);
      localItems[index] = record;
      byId.set(record.id, record);
      updated += 1;
      return;
    }

    if (contentMatchesIgnoringVersion(existing, incoming, collectionName)) {
      unchanged += 1;
      return;
    }

    // Same rule as the sync server: a deleted record stays deleted rather than
    // being brought back as a duplicate by an older backup file.
    if (existing.deleted && !incoming.deleted) {
      unchanged += 1;
      return;
    }

    // A backup copy that is not newer than what is here is simply old news (the record was edited
    // and synced since the backup was made). It must not be added again as a duplicate, however many
    // times the same file is imported.
    if ((existing.updatedAt || '') >= (incoming.updatedAt || '')) {
      unchanged += 1;
      return;
    }

    // Income is one entry per date (the id is the date): the newer entry (known to be this one,
    // from the check above) replaces the local one instead of creating a second entry, which
    // would count the money twice.
    if (collectionName === 'income') {
      const index = localItems.findIndex((item) => item.id === incoming.id);
      const record = { ...incoming, version: existing.version };
      localItems[index] = record;
      byId.set(record.id, record);
      updated += 1;
      return;
    }

    const record = { ...incoming, id: makeId() };
    localItems.push(record);
    byId.set(record.id, record);
    duplicated += 1;
  });

  return { added, updated, duplicated, unchanged };
}

// Shows a message under the Export / Import buttons; tone is 'ok' or 'failed'.
function setDataIoStatus(text, tone) {
  const el = document.getElementById('data-io-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

// Rejects records whose types would crash rendering later (e.g. a bill whose amount is the
// string "1200" throws in toFixed on every page load).
function isValidImportRecord(collectionName, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return false;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // Bills and recurring income need what their forms need (a cent up to MAX_MONEY); a day's
  // income may be negative but is held to the same size limit.
  const isPositiveMoney = (v) => isNum(v) && v >= 0.01 && v <= MAX_MONEY;
  const isDate = (v) => isRealDateKey(v);
  const isText = (v) => typeof v === 'string';
  const textOrMissing = (v) => v === undefined || v === null || typeof v === 'string';
  const listOrMissing = (v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  // Sync bookkeeping, when present, must have the right types: a text "deleted" would count as
  // true, and a non-number version or non-text updatedAt would break the merge comparisons.
  if (rec.version !== undefined && !isNum(rec.version)) return false;
  if (rec.deleted !== undefined && typeof rec.deleted !== 'boolean') return false;
  if (!['updatedAt', 'deviceId', 'dateAdded'].every((k) => rec[k] == null || isText(rec[k]))) return false;
  if (collectionName === 'bills') return isText(rec.name) && textOrMissing(rec.category) && listOrMissing(rec.paidDates) && isPositiveMoney(rec.amount) && isDate(rec.dueDate) && BILL_FREQUENCIES.includes(rec.frequency) && (rec.autopay === undefined || typeof rec.autopay === 'boolean');
  if (collectionName === 'recurringIncome') return isText(rec.name) && textOrMissing(rec.category) && isPositiveMoney(rec.amount) && isDate(rec.dueDate) && RECURRING_INCOME_FREQUENCIES.includes(rec.frequency);
  if (collectionName === 'income') return isNum(rec.amount) && Math.abs(rec.amount) <= MAX_MONEY && isDate(rec.dateKey);
  return false; // only this app's three lists are ever checked
}

// Merges a parsed backup file into the app without ever discarding local data, then reports
// what happened (new, updated, merged-as-duplicates, skipped) under the Import button.
function importData(parsed) {
  // Step 1: make sure the file looks like an export.
  const importedCollections = extractImportCollections(parsed);
  if (!importedCollections) {
    setDataIoStatus("Import failed — that file doesn't look like a Budget or Second Memory export.", 'failed');
    return;
  }

  const summaries = [];
  let anyChanged = false;
  let skippedInvalid = 0;

  // Step 2: merge each list (any other list in the file is ignored), skipping records that would break rendering.
  SYNC_COLLECTIONS.forEach((c) => {
    const rawIncoming = importedCollections[c.name];
    if (!Array.isArray(rawIncoming) || rawIncoming.length === 0) return;
    const incoming = rawIncoming.filter((rec) => isValidImportRecord(c.name, rec));
    skippedInvalid += rawIncoming.length - incoming.length;
    if (incoming.length === 0) return;
    const localItems = c.get();
    const result = mergeCollectionFromImport(localItems, incoming, c.name);
    if (!result.added && !result.updated && !result.duplicated) return;

    anyChanged = true;
    saveCollection(c.key, localItems);
    safeRender(() => c.render());
    const parts = [];
    if (result.added) parts.push(`${result.added} new`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.duplicated) parts.push(`${result.duplicated} merged as duplicates`);
    summaries.push(`${parts.join(', ')} in ${c.label}`);
  });

  // Step 3: the pay-period settings (only present in a full backup).
  const localPart = parsed && typeof parsed === 'object' && parsed.local && typeof parsed.local === 'object' ? parsed.local : null;
  if (localPart) {
    const saved = localPart.paydaySettings;
    if (saved && isRealDateKey(saved.payDateKey) && PAY_PERIOD_FREQUENCIES.includes(saved.frequency) && !loadPaydaySettings().payDateKey) {
      // Only fills in settings this device doesn't have yet; it never overwrites your current ones.
      savePaydaySettings({ payDateKey: saved.payDateKey, frequency: saved.frequency });
      const dateInput = document.getElementById('payday-date-input');
      const frequencyInput = document.getElementById('payday-frequency-input');
      if (dateInput) dateInput.value = saved.payDateKey;
      if (frequencyInput) frequencyInput.value = saved.frequency;
      safeRender(renderBudget);
      anyChanged = true;
      summaries.push('pay-period settings');
    }
  }

  // Step 4: summarise the result.
  const skippedNote = skippedInvalid ? ` ${skippedInvalid} unreadable record${skippedInvalid === 1 ? ' was' : 's were'} skipped.` : '';
  if (!anyChanged) {
    setDataIoStatus(`Import complete — nothing new to merge.${skippedNote}`, 'ok');
    return;
  }

  setDataIoStatus(`Import complete — ${summaries.join('; ')}.${skippedNote}`, 'ok');
}

// Menu buttons: Export downloads a backup; Import opens the file picker.
document.getElementById('export-data-btn').addEventListener('click', exportData);

document.getElementById('import-data-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

// Reads the chosen backup file as JSON and hands it to importData.
document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      setDataIoStatus('Import failed — that file is not valid JSON.', 'failed');
      return;
    }
    importData(parsed);
  };
  reader.onerror = () => {
    setDataIoStatus('Import failed — could not read that file.', 'failed');
  };
  reader.readAsText(file);
});

// ---- Day rollover ----
// "Today" drives overdue/due-soon/calendar highlighting. If the app is left open across
// midnight (or comes back to the foreground on a new day), redraw the date-dependent
// screen. Local redraw only; nothing is synced.

// The calendar day the screen was last drawn for.
let lastRenderedDayKey = todayKey();

// Redraws the Budget when the calendar day has changed since the last check.
function refreshForNewDay() {
  const now = todayKey();
  if (now === lastRenderedDayKey) return;
  lastRenderedDayKey = now;
  reminderBannerDismissed = false; // a new day can bring new due/overdue bills
  safeRender(renderBudget);
}

setInterval(refreshForNewDay, 60000);
// Redraw when the app comes back to the foreground on a new day.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshForNewDay();
});

// ---- Theme and version ----

// The build number shown in the Menu. Keep it equal to the number in CACHE_NAME in sw.js
// (a test checks this), so "which version am I on?" has a one-glance answer.
const APP_VERSION = 11;
// localStorage key for the chosen theme.
const THEME_KEY = 'budgetApp.theme.v1';
// The theme choices, in the order the Theme button cycles through them.
const THEMES = ['auto', 'light', 'dark'];

// Reads the saved theme choice; anything unexpected means "auto" (follow the device).
function loadTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

// Applies and saves a theme: Light or Dark set <html data-theme>, Auto removes it.
function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage unavailable: the choice lasts until the page closes */ }
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = `Theme: ${theme.charAt(0).toUpperCase()}${theme.slice(1)}`;
}

// The Theme button cycles Auto -> Light -> Dark.
document.getElementById('theme-btn').addEventListener('click', () => {
  applyTheme(THEMES[(THEMES.indexOf(loadTheme()) + 1) % THEMES.length]);
});
applyTheme(loadTheme());
// Show the version number in the Menu.
document.getElementById('app-version').textContent = `Version ${APP_VERSION}`;

// ---- App lock ----
// A PIN that hides the app until it is typed. It keeps other people out of the screen; it does
// NOT encrypt the data stored on the device. The PIN is never stored: only a salted PBKDF2 hash.
// The lock starts shown (a script in index.html sets data-locked on <html> before the page paints),
// comes back after the app has been in the background a couple of minutes, and "Lock now" locks at once.

// localStorage key for the saved PIN lock (a salt and a hash, never the PIN itself).
const LOCK_KEY = 'budgetApp.lock.v1';
// How long the app can be out of sight before it locks again.
const LOCK_AFTER_MS = 2 * 60 * 1000;
// A valid PIN: 4 to 12 digits.
const LOCK_PIN_RE = /^\d{4,12}$/;
// Wrong PINs allowed before a pause.
const LOCK_MAX_TRIES = 5;
// Length of that pause.
const LOCK_COOLDOWN_MS = 30000;
// localStorage key for the wrong-try count and pause end, so reloading cannot skip the pause.
const LOCK_TRIES_KEY = 'budgetApp.lockTries.v1';
// Wrong PINs typed so far.
let lockFailures = 0;
// Time (in ms) until which PIN entry is paused.
let lockBlockedUntil = 0;
// When the app went out of sight, or null while it is visible.
let lockHiddenAt = null;
let lockChecking = false; // true while a PIN is being checked, so a double tap cannot run two checks

// Wrong-try count and pause end time live in storage too, so reloading the page cannot skip the pause.
function saveLockTries() {
  try { localStorage.setItem(LOCK_TRIES_KEY, JSON.stringify({ fails: lockFailures, until: lockBlockedUntil })); } catch { /* storage full: the in-memory count still applies */ }
}
try {
  const savedTries = JSON.parse(localStorage.getItem(LOCK_TRIES_KEY) || 'null');
  if (savedTries && Number.isFinite(savedTries.fails) && Number.isFinite(savedTries.until)) {
    lockFailures = Math.max(0, Math.min(LOCK_MAX_TRIES, savedTries.fails));
    lockBlockedUntil = savedTries.until;
  }
} catch { /* damaged: start from zero */ }

// The saved { salt, hash } (hex strings), or null when no lock is set or the saved value is damaged.
function loadLock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    if (parsed && /^[0-9a-f]{32}$/.test(parsed.salt) && /^[0-9a-f]{64}$/.test(parsed.hash)) return parsed;
  } catch { /* fall through */ }
  return null;
}

// Whether this browser can compute the PIN hash (it needs a secure page: https or localhost).
function lockSupported() {
  return !!(window.crypto && crypto.subtle && window.TextEncoder);
}

// Byte array <-> hex text, for storing the salt and hash.
const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16))); // hex text -> bytes

// Turns a PIN and a salt into the stored hash (PBKDF2, SHA-256, 150,000 rounds).
async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

// True when the PIN matches the saved lock.
async function checkPin(pin) {
  const lock = loadLock();
  return !!lock && (await hashPin(pin, lock.salt)) === lock.hash;
}

// Saves a new PIN (replacing any old one). Returns false if the PIN is not 4 to 12 digits or saving failed.
async function setAppLock(pin) {
  if (!LOCK_PIN_RE.test(pin) || !lockSupported()) return false;
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(pin, salt);
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash }));
  } catch {
    return false;
  }
  updateLockButtons();
  return true;
}

// Removes the lock and shows the app.
function clearAppLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* nothing to remove it from */ }
  document.documentElement.removeAttribute('data-locked');
  updateLockButtons();
}

// Shows the lock screen (if a lock is set) and puts the cursor in the PIN box.
function lockNow() {
  if (!loadLock()) return;
  // Close the lock settings dialog first if it is open.
  if (!document.getElementById('lock-setup').hidden) closeLockSetup();
  document.documentElement.setAttribute('data-locked', '1');
  const input = document.getElementById('lock-pin-input');
  input.value = '';
  document.getElementById('lock-error').hidden = true;
  input.focus();
}

// Keeps the Menu buttons in step with whether a lock is set.
function updateLockButtons() {
  const on = !!loadLock();
  document.getElementById('lock-btn').textContent = `App lock: ${on ? 'On' : 'Off'}`;
  document.getElementById('lock-now-btn').hidden = !on;
}

// Erases everything this app keeps on this device (all budgetApp.* entries, and nothing else). Used by "Forgot PIN".
function wipeDeviceData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('budgetApp.')) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
  return keys.length;
}

// Unlock screen: check the PIN, count wrong tries, and pause for 30 seconds after 5 in a row.
document.getElementById('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('lock-error');
  if (Date.now() < lockBlockedUntil) {
    errorEl.textContent = `Too many tries. Wait ${Math.ceil((lockBlockedUntil - Date.now()) / 1000)} seconds.`;
    errorEl.hidden = false;
    return;
  }
  if (lockChecking) return;
  lockChecking = true;
  const input = document.getElementById('lock-pin-input');
  try {
    if (await checkPin(input.value)) {
      lockFailures = 0;
      lockBlockedUntil = 0;
      saveLockTries();
      document.documentElement.removeAttribute('data-locked');
      input.value = '';
      errorEl.hidden = true;
      return;
    }
    lockFailures += 1;
    input.value = '';
    if (lockFailures >= LOCK_MAX_TRIES) {
      lockFailures = 0;
      lockBlockedUntil = Date.now() + LOCK_COOLDOWN_MS;
      errorEl.textContent = 'Too many tries. Wait 30 seconds.';
    } else {
      errorEl.textContent = 'That PIN is not right.';
    }
    saveLockTries();
    errorEl.hidden = false;
    input.focus();
  } finally {
    lockChecking = false;
  }
});

// "Forgot PIN": after a confirmation, erase this app's data on this device and reload.
document.getElementById('lock-forgot-btn').addEventListener('click', () => {
  const ok = window.confirm('Forgot your PIN?\n\nThe only way in is to erase everything stored on THIS device. Your synced lists come back when you sync again, but changes you have not synced yet and your sync passphrase exist only on this device and will be lost.\n\nErase this device and start over?');
  if (!ok) return;
  wipeDeviceData();
  window.location.reload();
});

// Which way the lock dialog is working: 'on' (choose a PIN) or 'off' (enter the PIN to remove it).
let lockSetupMode = 'on';

// Opens the turn-on / turn-off dialog for the given mode and focuses its first box.
function openLockSetup(mode) {
  lockSetupMode = mode;
  const turningOff = mode === 'off';
  document.getElementById('lock-setup-title').textContent = turningOff ? 'Turn off app lock' : 'Turn on app lock';
  document.getElementById('lock-setup-note').textContent = turningOff
    ? 'Enter your PIN to turn the lock off.'
    : 'Choose a PIN of 4 to 12 digits. It keeps other people out of the app on this device; it does not encrypt your data. If you forget it, the only way back in is to erase this device.';
  document.getElementById('lock-setup-current').hidden = !turningOff;
  document.getElementById('lock-setup-new').hidden = turningOff;
  document.getElementById('lock-setup-confirm').hidden = turningOff;
  ['lock-setup-current', 'lock-setup-new', 'lock-setup-confirm'].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('lock-setup-error').hidden = true;
  document.getElementById('lock-setup').hidden = false;
  document.getElementById(turningOff ? 'lock-setup-current' : 'lock-setup-new').focus();
}

// Closes the lock dialog and returns focus to the Menu's lock button.
function closeLockSetup() {
  document.getElementById('lock-setup').hidden = true;
  document.getElementById('lock-btn').focus();
}

// Menu lock button: opens the turn-on dialog, or the turn-off dialog when a lock is set.
document.getElementById('lock-btn').addEventListener('click', () => {
  if (!lockSupported()) {
    setDataIoStatus('App lock needs a secure page (https). It is not available here.', 'failed');
    return;
  }
  openLockSetup(loadLock() ? 'off' : 'on');
});
// Lock now, Cancel, and Escape in the lock dialog.
document.getElementById('lock-now-btn').addEventListener('click', lockNow);
document.getElementById('lock-setup-cancel').addEventListener('click', closeLockSetup);
document.getElementById('lock-setup').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLockSetup(); });

// Lock dialog submit: either verify the PIN to turn the lock off, or validate and save a new PIN.
document.getElementById('lock-setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('lock-setup-error');
  const fail = (text) => { errorEl.textContent = text; errorEl.hidden = false; };
  if (lockSetupMode === 'off') {
    if (!(await checkPin(document.getElementById('lock-setup-current').value))) { fail('That PIN is not right.'); return; }
    clearAppLock();
    closeLockSetup();
    return;
  }
  const pin = document.getElementById('lock-setup-new').value;
  if (!LOCK_PIN_RE.test(pin)) { fail('Use 4 to 12 digits, numbers only.'); return; }
  if (pin !== document.getElementById('lock-setup-confirm').value) { fail('The two PINs do not match.'); return; }
  if (!(await setAppLock(pin))) { fail('Could not save the PIN on this device.'); return; }
  closeLockSetup();
});

// Re-lock after the app has been out of sight for a couple of minutes.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lockHiddenAt = Date.now();
  } else if (lockHiddenAt !== null && Date.now() - lockHiddenAt >= LOCK_AFTER_MS) {
    lockNow();
  }
  if (document.visibilityState === 'visible') lockHiddenAt = null;
});

updateLockButtons();
// A damaged saved lock cannot be unlocked and would trap you on the lock screen: clear it.
if (document.documentElement.hasAttribute('data-locked') && !loadLock()) {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* nothing to remove it from */ }
  document.documentElement.removeAttribute('data-locked');
}
if (loadLock()) lockNow(); // a locked app opens locked (the lock screen is already showing)

// ---- Init ----

// Menu button (phones only; CSS hides it on wide screens): opens and closes the collapsed sidebar.
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    const isOpen = sidebar.classList.toggle('sidebar-open');
    sidebarToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

// The Earlier / Today / Later buttons slide the calendar's three weeks (Today puts them back).
function slideCalendar(weeks) {
  closeCalendarDay();
  calendarWeekOffset = weeks === 0 ? 0 : Math.max(-520, Math.min(520, calendarWeekOffset + weeks));
  renderBudget();
}
document.getElementById('calendar-prev').addEventListener('click', () => slideCalendar(-1));
document.getElementById('calendar-today').addEventListener('click', () => slideCalendar(0));
document.getElementById('calendar-next').addEventListener('click', () => slideCalendar(1));

// Collapsible parts of the page (Pay Period, Paid History, Recurring Income): each remembers on this device
// whether it was left open or folded up.
const FOLDS_KEY = 'budgetApp.folds.v1';

// Reads which folds were left closed ({ id: false }); empty if nothing was saved or it is damaged.
function loadFolds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDS_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
document.querySelectorAll('details.fold').forEach((fold) => {
  if (loadFolds()[fold.id] === false) fold.open = false;
  fold.addEventListener('toggle', () => {
    const folds = loadFolds();
    folds[fold.id] = fold.open;
    try { localStorage.setItem(FOLDS_KEY, JSON.stringify(folds)); } catch { /* not saved: it simply opens again next time */ }
  });
});

// The jump links scroll to a part of the page, opening it first if it is folded up.
document.querySelectorAll('[data-jump]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.jump);
    if (!target) return;
    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// The floating + button: scrolls down to the Add bill form (a long way down the page) and puts the
// cursor in its first box. It hides itself while that form is already on screen.
const addBillFab = document.getElementById('add-bill-fab');
const addBillForm = document.getElementById('budget-add-form');
if (addBillFab && addBillForm) {
  addBillFab.addEventListener('click', () => {
    addBillForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('budget-name-input').focus({ preventScroll: true });
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { addBillFab.hidden = entries[0].isIntersecting; }).observe(addBillForm);
  }
}

safeRender(renderBudget);
updateUndoRedoButtons();
initSyncUI();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      registration.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    }).catch(() => {
      // Offline install is optional (e.g. private browsing); the app still works without it.
    });
  });
}
