// Budget: bills, income and the pay period, as a small standalone app.
// All persistence is local (localStorage). No dependencies. The only network call is the
// optional manual "Sync now" to this app's own sync server (server/sync_server.py).
//
// This app began as the Budget tab of another app (Second Memory) and is now fully separate: its own
// repository, storage names and sync server.
//
// How this file is organised (top to bottom):
//   Shared helpers, filter/sort helpers, keyboard-focus keeping, device identity & sync
//   metadata, undo/redo, Budget (bills, income, projected income, recurring income, paid history,
//   pay period, calendar, the Add bill sheet), the Spending Plan, expected one-time costs, savings goals
//   and Expenses tabs (Quick Add, Spent vs Plan, charts, filters), backup and sync reminders, the due/overdue bills banner, Device Sync
//   (server address, sync client, undo/redo application, the undo bar), data export/import (and
//   the calendar reminders file), day rollover, theme, text size and version, App lock, and Init
//   (which wires the phone Menu button, the tabs, the calendar buttons, the folding parts and the
//   + button, and registers the service worker).
//
// Each list is an array of plain records kept in memory and saved whole to its own
// localStorage key. A record looks like:
//   { id, ...its own fields..., dateAdded, updatedAt, deviceId, deleted, version }
// - updatedAt / deviceId are stamped on every change (see stampSync).
// - Deleting never removes a record: it sets deleted:true (a "tombstone") so a later sync
//   can tell "deleted here" apart from "never existed here". Screens skip deleted records.
// - version is the server's counter for the record; 0 means the server hasn't confirmed it yet.
//
// There are three lists: bills, income (income received, which also holds projected income, Spending Plan
// categories, expenses, expected one-time costs and savings goals and deposits) and recurringIncome. Syncing is
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
// case-insensitively via localeCompare (for genuine text fields like a bill's
// name). Pass `{ text: false }` for ISO date/timestamp strings (and
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

// Each entry is { collection, id, before, after }; before is null for a brand-new record.
let undoStack = [];
// Undone changes that can be re-applied (any new change clears this list).
let redoStack = [];
// True while undo/redo replays a change, so the replay is not recorded as a new change.
let isApplyingHistory = false;
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
  });
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
  // The toast's Undo button undoes the latest change, so a change that gets no toast must hide an older one
  // (otherwise that Undo button would undo this newer change instead of the one the toast names).
  const toastMessage = undoToastMessage(collectionName, before, after);
  if (toastMessage) showUndoToast(toastMessage);
  else hideUndoToast();
}

// ---- Budget (Bills and the three-week calendar) ----
// Storage key: budgetApp.bills.v1.

// localStorage key for the bills list.
const BILLS_KEY = 'budgetApp.bills.v1';
// How often a bill repeats, and the label shown for each option.
const BILL_FREQUENCIES = ['one_time', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'];
// Display text for each bill repeat option.
const BILL_FREQUENCY_LABELS = {
  one_time: 'One-time', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom',
};
// A custom bill repeats every `every` weeks or months: a whole number from 1 up to this.
const MAX_REPEAT_EVERY = 99;

// How often a bill repeats, in words: "Monthly", or "Every 6 weeks" for a custom one.
function billFrequencyLabel(bill) {
  if (bill.frequency !== 'custom') return BILL_FREQUENCY_LABELS[bill.frequency] || bill.frequency;
  const unit = bill.unit === 'weeks' ? 'week' : 'month';
  return bill.every === 1 ? `Every ${unit}` : `Every ${bill.every} ${unit}s`;
}

// The repeat step of a schedule: { unit: 'days', step } or { unit: 'months', step }, or null for a one-time schedule
// or a custom one whose number or unit is unreadable (such a schedule never comes due).
function schedulePeriod(bill) {
  switch (bill.frequency) {
    case 'weekly': return { unit: 'days', step: 7 };
    case 'biweekly': return { unit: 'days', step: 14 };
    case 'monthly': return { unit: 'months', step: 1 };
    case 'yearly': return { unit: 'months', step: 12 };
    case 'custom':
      if (!Number.isInteger(bill.every) || bill.every < 1 || bill.every > MAX_REPEAT_EVERY) return null;
      if (bill.unit === 'weeks') return { unit: 'days', step: bill.every * 7 };
      if (bill.unit === 'months') return { unit: 'months', step: bill.every };
      return null;
    default: return null;
  }
}

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

  const period = schedulePeriod(bill);
  if (!period) return false;

  if (period.unit === 'days') {
    const dayDiff = utcDayDiff(bill.dueDate, dateKey);
    return dayDiff >= 0 && dayDiff % period.step === 0;
  }

  // Whole months from the first date; a day the month does not have (the 31st) falls on the month's last day.
  const anchor = parseDateKey(bill.dueDate);
  const candidate = parseDateKey(dateKey);
  const monthOffset = (candidate.y - anchor.y) * 12 + (candidate.m - anchor.m);
  if (monthOffset < 0 || monthOffset % period.step !== 0) return false;
  return candidate.d === Math.min(anchor.d, daysInMonth(candidate.y, candidate.m));
}

// Closed-form occurrence count through a date, no day-by-day loop: "how many times has this bill (or
// income source) come due on or before this date", fast even when its first date is years in the past.
// unpaidAmountThrough and the recurring income totals are built on it.
function occurrenceCountThrough(bill, throughKey) {
  if (throughKey < bill.dueDate) return 0;
  if (bill.frequency === 'one_time') return 1;

  const period = schedulePeriod(bill);
  if (!period) return 0;

  if (period.unit === 'days') return Math.floor(utcDayDiff(bill.dueDate, throughKey) / period.step) + 1;

  // The last whole step that fits, counted only once its own date has arrived.
  const anchor = parseDateKey(bill.dueDate);
  const through = parseDateKey(throughKey);
  const monthOffset = (through.y - anchor.y) * 12 + (through.m - anchor.m);
  const lastIndex = Math.floor(monthOffset / period.step);
  return nthOccurrenceDate(bill, lastIndex) <= throughKey ? lastIndex + 1 : lastIndex;
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

// Walks forward from the bill's first due date to find the earliest date that really is a due date
// (per occursOnDate) and is not paid yet, up through and including throughKey; null if there is none.
// A plain day-by-day walk is the simplest correct way, so callers only use it for a bill that
// unpaidAmountThrough has already said has something unpaid (which keeps it off paid-up bills).
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

// ---- Income received (typed by hand, a synced collection) ----
// An income entry's `id` is built from its date (and source), not a fresh makeId() UUID like bills and recurring
// income use: two devices that each enter the same date and source then merge into one record across the normal
// sync paths (see newEntryId).
// The same list also holds projected income, Spending Plan categories, expenses, expected one-time costs and
// savings goals and deposits (each told apart by its own field, none with a `dateKey`), so they sync, undo and
// export with the server's three lists unchanged.

// localStorage key for the income list.
const INCOME_KEY = 'budgetApp.income.v1';
// Every record in the income list, loaded and upgraded at startup.
let income = migrateSyncFields(loadCollection(INCOME_KEY), INCOME_KEY, getDeviceId());

// The key that makes an entry unique: its day plus its source (case does not matter), so a day holds one income
// entry per source and a second source makes a second entry.
function entryKey(dateKey, source) {
  return `${dateKey}|${cleanSource(source).toLowerCase()}`;
}

// The day a real or projected income record belongs to.
function recordDay(record) {
  return record.dateKey || record.projectedFor;
}

// The id for a new income or projected entry: the date itself ("2026-10-15", "projected-2026-10-15") plus
// "#<source>" when it has a source, so two devices adding the same day and source meet in one record and different
// sources never share an id (which would drop one amount in a sync). A fresh unique id when that one is already
// taken, as when an entry's source was changed later.
function newEntryId(prefix, dateKey, source) {
  const name = cleanSource(source).toLowerCase();
  const base = `${prefix}${dateKey}${name ? `#${name}` : ''}`;
  return income.some((r) => r.id === base) ? `${prefix}${makeId()}` : base;
}

// Sets (or clears, when the value is '') the manual income number for one calendar day and source ('' or
// nothing = no source). The same day and source updates its entry; a different source makes another entry.
function setIncomeForDate(dateKey, rawValue, source) {
  const key = entryKey(dateKey, source);
  const matches = income.filter((r) => r.dateKey === dateKey && entryKey(r.dateKey, r.source) === key);

  if (rawValue === '') {
    // Clear every live entry for that day and source (a restore or conflict can leave a second copy with a
    // different id), otherwise the old value would come back.
    matches.filter((r) => !r.deleted).forEach((r) => deleteIncome(r.id));
    return; // already blank/absent: nothing to record
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_MONEY) {
    setTimeout(renderBudget, 0); // refused: put the saved value back in the box instead of leaving the rejected number showing
    return;
  }
  const amount = Math.round(parsed * 100) / 100; // whole cents, like bills

  // The newest copy for this day and source is the entry (a cleared one is brought back).
  const existing = matches.reduce((best, r) => (!best || (r.updatedAt || '') > (best.updatedAt || '') ? r : best), null);
  if (existing) {
    const before = structuredClone(existing);
    existing.amount = amount;
    existing.deleted = false; // re-entering a value on a previously-cleared entry un-tombstones
                               // the same record rather than creating a second one
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: newEntryId('', dateKey, source), dateKey, amount,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    if (cleanSource(source)) record.source = cleanSource(source);
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }

  // Deferred so the redraw runs after the current event has finished.
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

// Income is one entry per day and source. If two copies of the same day and source ever exist (from an old
// conflict or restore), only the most recently edited one is used, so nothing is counted twice.
function uniqueIncomeEntries(records) {
  const latest = new Map();
  records.forEach((r) => {
    if (!r.dateKey) return; // a projected-income record (see projectedByDate) is not money received
    const key = entryKey(r.dateKey, r.source);
    const current = latest.get(key);
    if (!current || (r.updatedAt || '') > (current.updatedAt || '')) latest.set(key, r);
  });
  return [...latest.values()];
}

// ---- Projected income (a per-day number typed by hand: what you expect to receive) ----
// Stored in the same `income` list, so it syncs, undoes and exports with no server change, but as a separate
// kind of record: { id: 'projected-<date>', projectedFor: '<date>', projected: amount, ...sync fields }.
// It has no `dateKey`, so every actual-income total ignores it, and an older copy of the app that has not
// updated yet ignores it too instead of counting it as money received.

// The live projected records for each date, as a Map of date key -> list of records (one per source, newest copy
// wins; cleared ones are left out), in a steady order: no source first, then by source name.
function projectedByDate(records) {
  const latest = new Map();
  records.forEach((r) => {
    if (!r.projectedFor) return;
    const key = entryKey(r.projectedFor, r.source);
    const current = latest.get(key);
    if (!current || (r.updatedAt || '') > (current.updatedAt || '')) latest.set(key, r);
  });
  const byDate = new Map();
  [...latest.values()].filter((r) => !r.deleted).forEach((r) => {
    if (!byDate.has(r.projectedFor)) byDate.set(r.projectedFor, []);
    byDate.get(r.projectedFor).push(r);
  });
  byDate.forEach((list) => list.sort((a, b) => (a.source || '').localeCompare(b.source || '')));
  return byDate;
}

// localStorage keys for the last expense category and the last income source typed, so the forms start on them next time.
const LAST_EXPENSE_CATEGORY_KEY = 'budgetApp.lastExpenseCategory.v1';
const LAST_INCOME_SOURCE_KEY = 'budgetApp.lastIncomeSource.v1';

// A remembered form choice ('' when none or storage is blocked).
function loadLastChoice(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

// Remembers a form choice for next time (an empty value forgets it).
function saveLastChoice(key, value) {
  try {
    if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
  } catch { /* not remembered: the form starts blank next time */ }
}

// ---- Income source (where a day's income, real or projected, comes from) ----
// An optional text on an income or projected record, chosen from the Recurring Income names and earlier
// sources or typed fresh. It only labels the entry and tells entries on one day apart: no total reads it.

// Longest source name kept.
const MAX_SOURCE_LENGTH = 60;

// A source as stored: trimmed and cut to MAX_SOURCE_LENGTH ('' means none).
function cleanSource(text) {
  return String(text || '').trim().slice(0, MAX_SOURCE_LENGTH);
}

// Every source name to suggest: the live Recurring Income names plus sources already used on income records.
function incomeSourceNames() {
  const names = new Map(); // lower-case -> first spelling seen, so "Pay" and "pay" are one choice
  const add = (text) => { const name = cleanSource(text); if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name); };
  recurringIncome.filter((r) => !r.deleted).forEach((r) => add(r.name));
  income.filter((r) => !r.deleted).forEach((r) => add(r.source));
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Fills the shared suggestion list that every Source box points at.
function renderIncomeSourceOptions() {
  const list = document.getElementById('income-source-options');
  list.innerHTML = '';
  incomeSourceNames().forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  });
}

// Changes the source on an existing income or projected record (empty text clears it). Refused, returning false,
// when the same day already has a live entry of the same kind from that source; true otherwise.
function setIncomeSource(id, text) {
  const record = income.find((r) => r.id === id);
  const source = cleanSource(text);
  if (!record || record.deleted) return true;
  if ((record.source || '') === source) return true;
  const key = entryKey(recordDay(record), source);
  const taken = income.some((r) => r !== record && !r.deleted && !r.projectedFor === !record.projectedFor
    && entryKey(recordDay(r), r.source) === key);
  if (taken) return false;
  const before = structuredClone(record);
  if (source) record.source = source; else delete record.source;
  stampSync(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', id, before, structuredClone(record));
  setTimeout(renderBudget, 0); // deferred like setIncomeForDate: this runs from a `change` event
  return true;
}

// Sets (or clears, when the value is '') the projected income number for one calendar day and source ('' or
// nothing = no source). The same day and source updates its entry; a different source makes another entry.
function setProjectedForDate(dateKey, rawValue, source) {
  const key = entryKey(dateKey, source);
  const matches = income.filter((r) => r.projectedFor === dateKey && entryKey(r.projectedFor, r.source) === key);
  if (rawValue === '') {
    matches.filter((r) => !r.deleted).forEach((r) => deleteIncome(r.id)); // keeps a tombstone, like clearing actual income
    return;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_MONEY) {
    setTimeout(renderBudget, 0); // refused: put the saved value back in the box
    return;
  }
  const amount = Math.round(parsed * 100) / 100; // whole cents, like bills
  const existing = matches.reduce((best, r) => (!best || (r.updatedAt || '') > (best.updatedAt || '') ? r : best), null);
  if (existing) {
    const before = structuredClone(existing);
    existing.projected = amount;
    existing.deleted = false;
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: newEntryId('projected-', dateKey, source),
      projectedFor: dateKey, projected: amount,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    if (cleanSource(source)) record.source = cleanSource(source);
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  // Deferred for the same reason as setIncomeForDate: this runs from a `change` event that a Tab key triggers.
  setTimeout(renderBudget, 0);
}

// allIncome must already be one entry per day and source (uniqueIncomeEntries, deleted ones dropped): duplicates
// would be summed twice.
// Deliberately NOT cumulative-through-date, unlike unpaidAmountThrough(). Each
// income record is summed into exactly the one week (or month) whose range its dateKey falls
// in — never carried into subsequent periods.
function incomeSumInRange(startKey, endKey, allIncome) {
  return allIncome
    .filter((r) => !r.deleted && r.dateKey >= startKey && r.dateKey <= endKey)
    .reduce((sum, r) => sum + r.amount, 0);
}

// A money amount as "$1,234.50": two decimals and a comma between thousands. Bill, plan and expense amounts are
// never negative, so this has no sign; amounts that can be negative use formatSignedCurrency.
function formatMoney(amount) {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Formats money with a sign ("-$5.00"). Bill figures are non-negative by construction
// (unpaidAmountThrough clamps at 0; a bill's amount is validated > 0), so they use the plain
// formatMoney. Income (a manual amount may be negative) and net totals (can go negative)
// must use this instead.
function formatSignedCurrency(amount) {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Check the sign of the *rounded* magnitude, not the raw value — a tiny
  // negative amount (a near-cancelling net total, a stray floating-point
  // epsilon) that rounds to 0.00 should never display as "-$0.00".
  return (amount < 0 && abs !== '0.00') ? `-$${abs}` : `$${abs}`;
}

// The CSS class for a net/income figure: red when negative, normal otherwise. Separate from
// formatSignedCurrency because only net totals are colored, not income totals.
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
  const every = frequency === 'custom' ? Number(fields.every) : undefined;
  const unit = frequency === 'custom' ? fields.unit : undefined;
  if (frequency === 'custom' && !schedulePeriod({ frequency, every, unit })) {
    return { ok: false, error: `Repeat every needs a whole number from 1 to ${MAX_REPEAT_EVERY}, in weeks or months.` };
  }
  return { ok: true, name: trimmedName, amount, dueDate, frequency, every, unit, category: canonicalCategory(fields.category.trim()), autopay: !!fields.autopay };
}

// A category typed in another case ("utilities") takes the spelling already in use ("Utilities"), so the
// filter chips and Paid History never split one category in two.
function canonicalCategory(raw) {
  const key = normalizeChipKey(raw);
  if (!key) return '';
  const existing = bills.find((b) => !b.deleted && b.category && normalizeChipKey(b.category) === key);
  return existing ? existing.category.trim() : raw;
}

// Fills the list of suggestions under the category boxes with the categories already used by bills.
function renderCategoryOptions(nonDeletedBills) {
  const list = document.getElementById('category-options');
  if (!list) return;
  list.innerHTML = '';
  deriveChipOptions(nonDeletedBills, (b) => b.category).forEach(({ label }) => {
    const option = document.createElement('option');
    option.value = label;
    list.appendChild(option);
  });
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
  if (result.frequency === 'custom') { bill.every = result.every; bill.unit = result.unit; }
  // "I'm caught up": every date up to paidThrough starts out paid (one undo still removes the whole bill).
  if (fields.paidThrough) {
    const dates = occurrenceDatesThrough(bill, fields.paidThrough);
    bill.paidDates = dates;
    bill.paidAmounts = Object.fromEntries(dates.map((dateKey) => [dateKey, bill.amount]));
  }
  bills.push(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', bill.id, null, structuredClone(bill));
  renderBudget();
  return { ok: true, id: bill.id };
}

// The date of a schedule's nth (0-based) occurrence, or null if it has none.
function nthOccurrenceDate(bill, n) {
  if (bill.frequency === 'one_time') return n === 0 ? bill.dueDate : null;
  const period = schedulePeriod(bill);
  if (!period) return null;
  if (period.unit === 'days') return shiftDateKey(bill.dueDate, n * period.step);
  const anchor = parseDateKey(bill.dueDate);
  const total = anchor.y * 12 + anchor.m + n * period.step;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return dateKeyFromParts(y, m, Math.min(anchor.d, daysInMonth(y, m)));
}

// Every date a bill is due on, from its first one up to and including throughKey (5000 at most, as a safety stop).
function occurrenceDatesThrough(bill, throughKey) {
  const dates = [];
  for (let n = 0; n < 5000; n += 1) {
    const dateKey = nthOccurrenceDate(bill, n);
    if (!dateKey || dateKey > throughKey) break;
    dates.push(dateKey);
  }
  return dates;
}

// Marks every unpaid date of a bill up to throughKey as paid in one change, so one Undo undoes them all.
function catchUpBill(billId, throughKey) {
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return;
  const before = structuredClone(bill);
  const paidSet = new Set(bill.paidDates || []);
  const amounts = { ...(bill.paidAmounts || {}) };
  occurrenceDatesThrough(bill, throughKey).forEach((dateKey) => {
    paidSet.add(dateKey);
    if (!Object.prototype.hasOwnProperty.call(amounts, dateKey)) amounts[dateKey] = bill.amount;
  });
  bill.paidDates = [...paidSet];
  bill.paidAmounts = amounts;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', billId, before, structuredClone(bill));
  renderBudget();
}

// Saves edits to a bill. Never marks anything paid or unpaid: it only carries existing payments over to a
// new schedule. Payments are marked by toggleBillPaid, catchUpBill and addBill's "caught up" option.
function updateBill(id, fields) {
  const bill = bills.find((b) => b.id === id);
  if (!bill) return { ok: false, error: 'Bill not found.' };
  const result = validateBillFields(fields);
  if (!result.ok) return result;
  const before = structuredClone(bill);
  const oldSchedule = { dueDate: bill.dueDate, frequency: bill.frequency, every: bill.every, unit: bill.unit };
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
  if (result.frequency === 'custom') { bill.every = result.every; bill.unit = result.unit; } else { delete bill.every; delete bill.unit; }
  bill.category = result.category;
  bill.autopay = result.autopay;
  // Changing when a bill is due must not orphan the payments already marked
  // paid: each paid occurrence moves to the same-numbered occurrence of the
  // new schedule (the 3rd payment stays the 3rd payment), so totals don't jump.
  if (oldSchedule.dueDate !== bill.dueDate || oldSchedule.frequency !== bill.frequency
    || oldSchedule.every !== bill.every || oldSchedule.unit !== bill.unit) {
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

// Marks one occurrence of a bill paid or unpaid. paidAmount (optional) is what was actually paid, and 0 means the
// date was skipped; unmarking removes the recorded amount, so paidAmounts only keeps entries for dates still in
// paidDates. paidDates is otherwise only moved by updateBill when the schedule changes.
function toggleBillPaid(billId, dateKey, paid, paidAmount) {
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return;
  const before = structuredClone(bill);
  const paidSet = new Set(bill.paidDates || []);
  const amounts = { ...(bill.paidAmounts || {}) };
  if (paid) {
    paidSet.add(dateKey);
    // Remember what this payment was worth: the amount given (0 means the date was skipped), otherwise the
    // bill's amount (keeping one already recorded for this date).
    if (typeof paidAmount === 'number') amounts[dateKey] = paidAmount;
    else if (!Object.prototype.hasOwnProperty.call(amounts, dateKey)) amounts[dateKey] = bill.amount;
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

// What one recurring income source adds up to between two dates (inclusive): the number of times it
// comes due in that range, times its amount. Uses occurrenceCountThrough, so there is no day-by-day loop.
function recurringIncomeSumInRange(startKey, endKey, source) {
  if (endKey < startKey) return 0;
  const throughEnd = occurrenceCountThrough(source, endKey);
  const throughBeforeStart = occurrenceCountThrough(source, shiftDateKey(startKey, -1));
  return Math.max(0, throughEnd - throughBeforeStart) * source.amount;
}

// The one place that answers "how much income does the calendar show for this period": manual `income`
// entries plus the recurring projections. Every income total (week, month and pay period) must use this, not
// the bare incomeSumInRange, or it would leave out recurring income the calendar visibly displays.
function totalIncomeInRange(startKey, endKey, nonDeletedIncome, nonDeletedRecurringIncome) {
  const manual = incomeSumInRange(startKey, endKey, nonDeletedIncome);
  const recurring = nonDeletedRecurringIncome.reduce(
    (sum, src) => sum + recurringIncomeSumInRange(startKey, endKey, src), 0
  );
  return manual + recurring;
}

// ---- Paid history ----
// Per-category totals of bill occurrences marked paid in one calendar month.
// Reads ALL bills including deleted ones (deleting a bill doesn't un-spend money already paid). It counts every
// recorded payment in the month, even one that no longer matches the bill's schedule.

// The month the Paid history panel is showing (m is 0-based); starts on the current month.
let paidHistoryMonth = (() => { const { y, m } = parseDateKey(todayKey()); return { y, m }; })();

// Totals what was paid in one month per bill category, biggest first.
function computePaidByCategory(allBills, y, m) {
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const byKey = new Map();
  const counted = new Set(); // same payment recorded on duplicate bills counts once (see paymentIdentity)
  // The first copy of a duplicated payment claims it, so live bills go first and labelled ones before
  // unlabelled ones: a payment is credited to the copy you kept and labelled, never to a deleted or
  // unlabelled copy (which is how labelled bills used to end up under Uncategorized).
  const hasLabel = (b) => normalizeChipKey(b.category) !== '';
  const ordered = [...allBills].sort((a, b) => (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0) || (hasLabel(b) ? 1 : 0) - (hasLabel(a) ? 1 : 0));
  ordered.forEach((bill) => {
    // Every recorded payment counts, even one that no longer lines up with the bill's schedule
    // (for example after the schedule was edited): money that was paid should not vanish from history.
    const dates = (bill.paidDates || []).filter((d) => {
      if (typeof d !== 'string' || !d.startsWith(prefix)) return false;
      if (paidAmountFor(bill, d) === 0) return false; // a skipped date is not money paid
      const paymentKey = paymentIdentity(bill, d);
      if (counted.has(paymentKey)) return false;
      counted.add(paymentKey);
      return true;
    });
    if (dates.length === 0) return;
    const raw = (bill.category || '').trim();
    const key = normalizeChipKey(raw);
    const entry = byKey.get(key) || { label: raw || 'Uncategorized', total: 0, billNames: new Set() };
    entry.total += dates.reduce((sum, d) => sum + paidAmountFor(bill, d), 0);
    entry.billNames.add(bill.name);
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

  // One row: the label and the amount, with an optional muted line underneath (which bills are in it).
  const addRow = (label, total, extraClass, detail) => {
    const li = document.createElement('li');
    li.className = `paid-history-row${extraClass ? ` ${extraClass}` : ''}`;
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('span');
    amount.textContent = formatMoney(total);
    li.append(name, amount);
    if (detail) {
      const note = document.createElement('span');
      note.className = 'paid-history-detail';
      note.textContent = detail;
      li.appendChild(note);
    }
    list.appendChild(li);
  };
  // The Uncategorized row says which bills are in it, so a bill that should have a label is easy to spot.
  rows.forEach((r) => addRow(r.label, r.total, '', r.label === 'Uncategorized' ? [...r.billNames].join(', ') : ''));
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

// The Bills sort choice; 'due_date_asc' is the default, matching the sort menu's first option.
let selectedBillsSort = 'due_date_asc';

// When on, the Bills list shows only bills that are overdue or due within DUE_SOON_LIST_DAYS days.
let onlyDueSoon = false;
// How many days ahead counts as "due soon" for that filter.
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
  el.textContent = `${formatMoney(overallUnpaid)} unpaid across ${count} bill${count === 1 ? '' : 's'}.`;
}

// ---- Current Pay Period ----
// Storage key: budgetApp.paydaySettings.v1. A flat, device-local settings object, NOT a synced collection (it is
// not in SYNC_COLLECTIONS): read and written with plain localStorage + JSON.

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
// Scans at most 31 days back and forward (longer than any supported pay frequency) with occursOnDate().
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
// otherwise its next scheduled date after today that is not already paid, however far away (a yearly bill, or one
// every 24 months); null if there is none (a paid one-time bill or an unreadable schedule).
function nextDueDateKey(bill, todayK) {
  if (unpaidAmountThrough(bill, todayK) > 0) {
    const unpaid = oldestUnpaidOccurrence(bill, todayK);
    if (unpaid) return unpaid;
  }
  const paid = bill.paidDates || [];
  // Occurrences are numbered from 0; the first one after today has the index that counts those up to today.
  const first = occurrenceCountThrough(bill, todayK);
  for (let n = first; n < first + 400; n += 1) { // 400 steps is a safety stop: advance payments are a handful
    const dateKey = nthOccurrenceDate(bill, n);
    if (!dateKey) return null;
    if (dateKey > todayK && !paid.includes(dateKey)) return dateKey;
  }
  return null;
}

// What a bill card says about when it needs paying: { text, late }, for example
// { text: 'Due Mon, Oct 12 · in 2 days', late: false } or { text: 'Overdue Mon, Oct 5 · 7 days ago', late: true }.
function billDueInfo(bill, todayK) {
  const dateKey = nextDueDateKey(bill, todayK);
  if (!dateKey) {
    // No date left to pay: a paid one-time bill, or a schedule that cannot be read (shown as its first date).
    const paidOff = bill.frequency === 'one_time' && (bill.paidDates || []).length;
    return { text: paidOff ? 'Paid' : `Due ${formatDateKeyShort(bill.dueDate)}`, late: false };
  }
  const days = utcDayDiff(todayK, dateKey);
  const late = days < 0 && !bill.autopay; // a bill that pays itself is never called overdue
  return { text: `${late ? 'Overdue' : 'Due'} ${formatDateKeyShort(dateKey)} \u00b7 ${whenLabel(days)}`, late };
}

// Draws the Current Pay Period panel: bills due before the next payday, plus income and net for that period.
// Reads the live bills array itself (not a parameter), skipping deleted ones.
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
    document.getElementById('pay-period-next').textContent = '';
    document.getElementById('pay-period-left').textContent = '';
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
    `${formatMoney(grandTotal)} due across ${matches.length} bill${matches.length === 1 ? '' : 's'}`;
  emptyEl.hidden = matches.length !== 0;

  // Income and net for exactly this pay period (payday up to, not including,
  // the next payday), so the period reads like the weekly and monthly totals.
  const periodIncome = totalIncomeInRange(
    periodStart,
    shiftDateKey(periodEnd, -1),
    uniqueIncomeEntries(income).filter((r) => !r.deleted),
    recurringIncome.filter((r) => !r.deleted)
  );
  const periodNet = periodIncome - grandTotal;
  // The next payday, and what is left once the bills in this period that are still unpaid are covered.
  const periodUnpaid = matches.reduce((sum, m) => sum + m.occurrenceDates
    .filter((dateKey) => !(m.bill.paidDates || []).includes(dateKey))
    .reduce((s, dateKey) => s + occurrenceAmount(m.bill, dateKey), 0), 0);
  const periodLeft = periodIncome - periodUnpaid;
  document.getElementById('pay-period-next').textContent = periodEnd
    ? `Next payday: ${formatDateKeyShort(periodEnd)} · ${whenLabel(daysUntilDateKey(periodEnd))}`
    : '';
  document.getElementById('pay-period-left').innerHTML =
    `Left after unpaid bills: <strong class="${signedAmountClass(periodLeft)}">${formatSignedCurrency(periodLeft)}</strong>`;
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
      ? `${formatMoney(total)} (${occurrenceDates.length} occurrences)`
      : formatMoney(total);
    info.appendChild(amount);

    const due = document.createElement('span');
    due.className = 'bill-due';
    due.textContent = `Due: ${occurrenceDates.map((dateKey) => formatDateKeyShort(dateKey)).join(', ')}`;
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
  showTab('bills');
  document.getElementById('budget-duedate-input').value = dateKey;
  updateCaughtUpOption();
  if (isPhoneLayout()) {
    openAddBillSheet();
    return;
  }
  document.getElementById('budget-add-form').scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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

// The hover text for a rolled-forward net: what the net is made of, and how much came from earlier weeks.
function carryTitle(base, carried) {
  return Math.abs(carried) < 0.005 ? base : `${base}. Includes ${formatSignedCurrency(carried)} from earlier weeks.`;
}

// ---- Carry-forward adjustments (correcting the rolled-forward number) ----
// The Net rolled into a week is worked out from bills and income, so it drifts when real spending differs. An
// adjustment is a record in the `income` list, { id: 'adjust-<id>', adjustWeek: <Monday of the week>, amount (signed),
// notes, ...sync fields }, added to what is carried into that week and so into every week after it. There is one
// per week (the newest live one counts), with no `dateKey`, so income totals ignore it, and its id is not a date id,
// so the sync server needs no change. Month totals do not roll forward and are not affected.

// The live adjustments by week: the Monday key to the newest record for that week.
function weekAdjustments() {
  const byWeek = new Map();
  income.forEach((r) => {
    if (!r.adjustWeek || r.deleted) return;
    const current = byWeek.get(r.adjustWeek);
    if (!current || (r.updatedAt || '') > (current.updatedAt || '')) byWeek.set(r.adjustWeek, r);
  });
  return byWeek;
}

// Sets what is carried into a week to the amount you actually have. calculatedCarry is what the app works out
// without any adjustment for that week; the adjustment saved is the difference. Entering the calculated amount
// removes the adjustment. Returns the problem as a sentence, or '' when it was saved.
function setWeekCarry(weekKey, calculatedCarry, actualRaw, rawNote) {
  const actual = Number(actualRaw);
  if (actualRaw === '' || !Number.isFinite(actual) || Math.abs(actual) > MAX_MONEY) return 'Enter an amount up to $1,000,000,000 (it can be negative).';
  const difference = Math.round((actual - calculatedCarry) * 100) / 100;
  const existing = weekAdjustments().get(weekKey);
  if (difference === 0) {
    if (existing) deleteIncome(existing.id);
    else renderBudget();
    return '';
  }
  const notes = rawNote.trim().slice(0, 200);
  if (existing) {
    const before = structuredClone(existing);
    existing.amount = difference;
    existing.notes = notes;
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `adjust-${makeId()}`, adjustWeek: weekKey, amount: difference, notes,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// The line under a week's Net: what it carried in was adjusted (if so, by how much and why), and an Adjust button
// that opens a small form to type what you actually have carried in. shownCarry is the carried-in figure on screen,
// calculatedCarry the same without this week's adjustment.
function buildWeekAdjust(weekKey, calculatedCarry, shownCarry, adjustment) {
  const wrap = document.createElement('div');
  wrap.className = 'budget-week-adjust';
  const summary = document.createElement('span');
  summary.className = 'budget-week-adjusted';
  if (adjustment) summary.textContent = `Carried in adjusted by ${formatSignedCurrency(adjustment.amount)}${adjustment.notes ? ` (${adjustment.notes})` : ''}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'small-btn';
  button.textContent = adjustment ? 'Change' : 'Adjust carried in';
  button.setAttribute('aria-label', `Adjust the amount carried into the week of ${formatDateKeyShort(weekKey)}`);

  const form = document.createElement('form');
  form.className = 'week-adjust-form';
  form.hidden = true;
  const amountBox = document.createElement('input');
  amountBox.type = 'number';
  amountBox.step = '0.01';
  amountBox.inputMode = 'decimal';
  amountBox.required = true;
  amountBox.setAttribute('aria-label', 'What you actually have carried into this week');
  const noteBox = document.createElement('input');
  noteBox.type = 'text';
  noteBox.maxLength = 200;
  noteBox.placeholder = 'Why (optional, e.g. extra gas)';
  noteBox.setAttribute('aria-label', 'Why the carried-in amount changed');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'small-btn';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'small-btn';
  cancel.textContent = 'Cancel';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'small-btn';
  reset.textContent = 'Reset';
  reset.hidden = !adjustment;
  const error = document.createElement('span');
  error.className = 'form-error';
  error.hidden = true;
  form.append(amountBox, noteBox, save, reset, cancel, error);

  button.addEventListener('click', () => {
    amountBox.value = String(Math.round(shownCarry * 100) / 100);
    noteBox.value = adjustment ? adjustment.notes || '' : '';
    error.hidden = true;
    form.hidden = false;
    amountBox.focus();
  });
  cancel.addEventListener('click', () => { form.hidden = true; });
  reset.addEventListener('click', () => { if (adjustment) deleteIncome(adjustment.id); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const problem = setWeekCarry(weekKey, calculatedCarry, amountBox.value, noteBox.value);
    if (problem) { error.textContent = problem; error.hidden = false; }
  });
  wrap.append(summary, button, form);
  return wrap;
}

// How many weeks back the running net is added up (older weeks are left out, so a very old income entry cannot
// make every redraw slow).
const MAX_ROLLOVER_WEEKS = 104;

// The Net and Projected net carried into the week that starts on thisWeekKey: every earlier week's income minus
// its bills, added up from the Monday of the earliest income there is (a typed entry or a recurring source) so
// money left over, or a shortfall, rolls forward. Projected net also counts the projected income of earlier days
// that have no real income. Each earlier week's carry-forward adjustment (see weekAdjustments) is added at the start
// of that week. Both are 0 when there is no earlier income to start from.
function netCarriedInto(thisWeekKey, allBills, nonDeletedIncome, nonDeletedRecurringIncome, projectedMap, incomeDates, adjustments = new Map()) {
  const firstDates = [
    ...nonDeletedIncome.map((r) => r.dateKey),
    ...nonDeletedRecurringIncome.map((r) => r.dueDate),
    ...adjustments.keys(), // an adjusted week counts even when nothing earlier than it was ever entered
  ].filter(Boolean).sort();
  if (!firstDates.length) return { net: 0, projectedNet: 0 };
  const earliestStart = shiftDateKey(weekStartKey(todayKey()), -7 * MAX_ROLLOVER_WEEKS); // fixed to today, so sliding the calendar never changes a week's figure
  let start = weekStartKey(firstDates[0]);
  if (start < earliestStart) start = earliestStart;

  let net = 0;
  let projectedNet = 0;
  for (let ws = start; ws < thisWeekKey; ws = shiftDateKey(ws, 7)) {
    const we = shiftDateKey(ws, 6);
    const weekIncome = totalIncomeInRange(ws, we, nonDeletedIncome, nonDeletedRecurringIncome);
    const due = amountDueInRange(ws, we, allBills);
    let projected = 0;
    for (let dateKey = ws; dateKey <= we; dateKey = shiftDateKey(dateKey, 1)) {
      if (projectedMap.has(dateKey) && !incomeDates.has(dateKey)) {
        projected += projectedMap.get(dateKey).reduce((sum, r) => sum + r.projected, 0);
      }
    }
    const adjustment = adjustments.has(ws) ? adjustments.get(ws).amount : 0;
    net += adjustment + weekIncome - due;
    projectedNet += adjustment + weekIncome + projected - due;
  }
  return { net, projectedNet };
}

// Renders the 21-day rolling calendar into #budget-calendar (everything
// after the static .budget-weekday-row), the month/year header, and this month's total, income, net and
// left-after-plan lines. The Bills search box does not affect it. The category chip filter only chooses which
// bills show in the day cells; every total uses all bills, so a filter never makes a total look smaller than what
// is really owed (see the matchesBillCategory comment inside the render loop below).
function renderBudgetCalendar(nonDeletedBills, nonDeletedIncome, nonDeletedRecurringIncome, projectedMap) {
  const today = new Date();
  const todayK = todayKey();
  const dueSoonEndK = shiftDateKey(todayK, REMINDER_BANNER_DAYS); // same window as the banner
  const incomeDates = new Set(nonDeletedIncome.map((r) => r.dateKey)); // days that already have income entered
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
    monthTotalEl.innerHTML = `${MONTH_NAMES[today.getMonth()]} total: <strong>${formatMoney(monthDue)}</strong>`;
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

  // What is left once the Spending Plan and this month's expected one-time costs are also set aside: the month's net
  // minus the planned spending for a month minus the guesses entered for this month.
  const monthLeftEl = document.getElementById('budget-month-left-total');
  if (monthLeftEl) {
    const plans = planCategories();
    const expectedMonth = guessTotalForMonth(todayKey().slice(0, 7));
    monthLeftEl.hidden = plans.length === 0 && expectedMonth === 0;
    if (!monthLeftEl.hidden) {
      const plannedMonth = plans.reduce((sum, r) => sum + planMonthly(planAmount(r), r.frequency), 0);
      const monthLeft = monthNet - plannedMonth - expectedMonth;
      monthLeftEl.innerHTML =
        `${MONTH_NAMES[today.getMonth()]} left after plan: <strong class="${signedAmountClass(monthLeft)}">${formatSignedCurrency(monthLeft)}</strong>`;
      monthLeftEl.title = `The month's net minus the ${formatMoney(plannedMonth)} a month your Spending Plan sets aside` +
        (expectedMonth ? ` and the ${formatMoney(expectedMonth)} of expected one-time costs this month` : '');
    }
  }

  // Rebuild the three weeks from scratch: each week gets seven day cells plus its totals.
  const windowDays = getCalendarWindowDays(today);
  const calendarEl = document.getElementById('budget-calendar');
  calendarEl.querySelectorAll('.budget-week').forEach((el) => el.remove());

  // The Net and Projected net roll forward: each week starts from what the weeks before it left over.
  const adjustments = weekAdjustments();
  const carry = netCarriedInto(windowDays[0], nonDeletedBills, nonDeletedIncome, nonDeletedRecurringIncome, projectedMap, incomeDates, adjustments);
  let rolledNet = carry.net;
  let rolledProjectedNet = carry.projectedNet;
  for (let weekIndex = 0; weekIndex < 3; weekIndex++) {
    const weekDays = windowDays.slice(weekIndex * 7, weekIndex * 7 + 7);
    const weekEndKey = weekDays[6];

    const weekEl = document.createElement('div');
    weekEl.className = 'budget-week';
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

          itemEl.title = `${source.name} — ${formatMoney(source.amount)}`;
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
          const skipped = paid && paidAmountFor(bill, dateKey) === 0; // skipped: counted as paid, with nothing paid
          // A bill that pays itself is never flagged, matching the banner (see computeBillReminders).
          const needsPayment = !paid && !bill.autopay;
          const overdue = needsPayment && dateKey < todayK;
          // Mutually exclusive by construction: overdue is strictly before
          // today, due-soon is today-or-later, so a single dateKey can never
          // satisfy both.
          const dueSoon = needsPayment && dateKey >= todayK && dateKey <= dueSoonEndK;
          itemEl.classList.toggle('overdue', overdue);
          itemEl.classList.toggle('due-soon', dueSoon);
          itemEl.classList.toggle('skipped', skipped);

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

          const amountText = skipped ? 'skipped' : formatMoney(paid ? paidAmountFor(bill, dateKey) : bill.amount);
          label.title = bill.category ? `${bill.name} — ${amountText} (${bill.category})` : `${bill.name} — ${amountText}`;

          daySummary.push(`${bill.name}${skipped ? ' (skipped)' : paid ? ' (paid)' : overdue ? ' (overdue)' : ''}`);
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

      // In the day sheet: start a bill on this day (the Add bill form gets the date).
      const addOnDayBtn = document.createElement('button');
      addOnDayBtn.type = 'button';
      addOnDayBtn.className = 'budget-day-add-bill';
      addOnDayBtn.textContent = 'Add a bill on this day';
      addOnDayBtn.addEventListener('click', (e) => { e.stopPropagation(); startBillOnDate(dateKey); });
      bodyEl.appendChild(addOnDayBtn);

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
    totalEl.innerHTML = `${calendarWeekLabel(weekIndex - 1 + calendarWeekOffset, weekDays[0])}: <strong>${formatMoney(weekTotalDue)}</strong>`;
    weekEl.appendChild(totalEl);

    // totalIncomeInRange (manual `income` entries plus recurring
    // projections), not the bare incomeSumInRange, so this total stays in
    // sync with what the calendar visibly shows.
    const weekIncome = totalIncomeInRange(weekDays[0], weekDays[6], nonDeletedIncome, nonDeletedRecurringIncome);
    const incomeTotalEl = document.createElement('p');
    incomeTotalEl.className = 'budget-week-income-total';
    incomeTotalEl.innerHTML = `Income: <strong>${formatSignedCurrency(weekIncome)}</strong>`;
    weekEl.appendChild(incomeTotalEl);

    // This week's adjustment (if any) changes what is carried in, for the Net and the Projected net alike.
    const calculatedCarry = rolledNet;
    const adjustment = adjustments.get(weekDays[0]);
    if (adjustment) { rolledNet += adjustment.amount; rolledProjectedNet += adjustment.amount; }
    const carriedNet = rolledNet;
    const weekNet = carriedNet + weekIncome - weekTotalDue;
    rolledNet = weekNet;
    const netTotalEl = document.createElement('p');
    netTotalEl.className = 'budget-week-net-total';
    netTotalEl.innerHTML = `Net: <strong class="${signedAmountClass(weekNet)}">${formatSignedCurrency(weekNet)}</strong>`;
    netTotalEl.title = carryTitle(
      'Income entered or expected this week minus every bill due this week (paid or not), plus what the weeks before it left over', carriedNet);
    weekEl.appendChild(netTotalEl);
    weekEl.appendChild(buildWeekAdjust(weekDays[0], calculatedCarry, carriedNet, adjustment));

    // What is left to pay this week: bills due in it that are not ticked paid yet.
    const weekLeft = amountDueInRange(weekDays[0], weekEndKey, nonDeletedBills, true);
    const leftEl = document.createElement('p');
    leftEl.className = 'budget-week-due-total';
    leftEl.innerHTML = `Due: <strong>${formatMoney(weekLeft)}</strong>`;
    weekEl.appendChild(leftEl);

    // Projected income, shown once any day of the week has one. A day's projection stops counting as soon as
    // real income is entered for that day, so typing the real figure replaces the guess instead of adding to it.
    const weekProjected = weekDays.reduce((sum, dateKey) => (
      projectedMap.has(dateKey) && !incomeDates.has(dateKey)
        ? sum + projectedMap.get(dateKey).reduce((daySum, r) => daySum + r.projected, 0) : sum
    ), 0);
    const carriedProjectedNet = rolledProjectedNet;
    const weekProjectedNet = carriedProjectedNet + weekIncome + weekProjected - weekTotalDue;
    rolledProjectedNet = weekProjectedNet;
    if (weekDays.some((dateKey) => projectedMap.has(dateKey))) {
      const projectedEl = document.createElement('p');
      projectedEl.className = 'budget-week-projected-total';
      projectedEl.innerHTML = `Projected: <strong>${formatSignedCurrency(weekProjected)}</strong>`;
      projectedEl.title = 'Income you expect this week and have not entered yet';
      weekEl.appendChild(projectedEl);

      const projectedNetEl = document.createElement('p');
      projectedNetEl.className = 'budget-week-projected-net-total';
      projectedNetEl.innerHTML = `Projected net: <strong class="${signedAmountClass(weekProjectedNet)}">${formatSignedCurrency(weekProjectedNet)}</strong>`;
      projectedNetEl.title = carryTitle('Net, plus the projected income above, plus what the weeks before it left over', carriedProjectedNet);
      weekEl.appendChild(projectedNetEl);
    }

    calendarEl.appendChild(weekEl);
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
    // Every button names its bill so a screen reader can tell the cards apart; each name still contains the
    // button's visible words.
    node.querySelector('.mark-oldest-paid-btn').setAttribute('aria-label', `Mark paid: ${bill.name}`);
    node.querySelector('.pay-other-btn').setAttribute('aria-label', `Other options: ${bill.name}`);
    node.querySelector('.catch-up-btn').setAttribute('aria-label', `Mark earlier dates paid: ${bill.name}`);
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit ${bill.name}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete ${bill.name}`);
    node.querySelector('.bill-amount').textContent = formatMoney(bill.amount);
    const due = billDueInfo(bill, todayK);
    const dueEl = node.querySelector('.bill-due');
    dueEl.textContent = due.text;
    dueEl.classList.toggle('bill-due-late', due.late);
    node.querySelector('.bill-frequency').textContent = billFrequencyLabel(bill);

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

    // Offered when two or more earlier dates are unpaid (a bill added with an old date, say): one tap catches up.
    const catchUpBtn = node.querySelector('.catch-up-btn');
    const yesterdayK = shiftDateKey(todayK, -1);
    catchUpBtn.hidden = Math.round(unpaidAmountThrough(bill, yesterdayK) / bill.amount) < 2;
    catchUpBtn.addEventListener('click', () => catchUpBill(bill.id, yesterdayK));

    // "Other...": pay the oldest unpaid date with a different amount, or skip that date (recorded as a payment of 0).
    const otherBtn = node.querySelector('.pay-other-btn');
    const otherForm = node.querySelector('.pay-other-form');
    const otherAmount = node.querySelector('.pay-other-amount');
    const otherError = node.querySelector('.pay-other-error');
    const otherNote = node.querySelector('.pay-other-note');
    otherBtn.disabled = !hasUnpaid;
    otherBtn.addEventListener('click', () => {
      const target = oldestUnpaidOccurrence(bill, todayKey());
      if (!target) return;
      otherForm.dataset.dateKey = target;
      otherNote.textContent = `For ${formatDateKeyShort(target)}: enter what you actually paid, or skip this date.`;
      otherAmount.value = String(bill.amount);
      otherError.hidden = true;
      otherForm.hidden = false;
      otherAmount.focus();
    });
    otherForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Math.round(Number(otherAmount.value) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) {
        otherError.textContent = 'Amount must be between $0.01 and $1,000,000,000.';
        otherError.hidden = false;
        return;
      }
      toggleBillPaid(bill.id, otherForm.dataset.dateKey, true, amount);
    });
    node.querySelector('.pay-skip-btn').addEventListener('click', () => toggleBillPaid(bill.id, otherForm.dataset.dateKey, true, 0));
    node.querySelector('.pay-other-cancel').addEventListener('click', () => { otherForm.hidden = true; });
    // (everything above is looked up now: by the time a button is pressed, this fragment has moved into the page)

    const editNameInput = node.querySelector('.bill-edit-name');
    const editAmountInput = node.querySelector('.bill-edit-amount');
    const editDueDateInput = node.querySelector('.bill-edit-duedate');
    const editFrequencyInput = node.querySelector('.bill-edit-frequency');
    const editEveryInput = node.querySelector('.bill-edit-every');
    const editUnitInput = node.querySelector('.bill-edit-unit');
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
      editEveryInput.value = String(bill.every || 6);
      editUnitInput.value = bill.unit || 'weeks';
      syncCustomRepeat(editFrequencyInput);
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
        every: editEveryInput.value,
        unit: editUnitInput.value,
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
      editEveryInput.value = openEdit.every;
      editUnitInput.value = openEdit.unit;
      syncCustomRepeat(editFrequencyInput);
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
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit ${source.name}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete ${source.name}`);
    node.querySelector('.recurring-income-amount').textContent = formatMoney(source.amount);
    node.querySelector('.recurring-income-start').textContent = `Starts: ${formatDateKeyShort(source.dueDate)}`;
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

// Draws the Projected Income list on the Income tab: the projected days from today on, soonest first, each
// with Edit (the amount) and Delete, plus a line with the total still expected. A day that already has real
// income entered says so, because its projection no longer counts.
function renderProjectedIncomeList() {
  const list = document.getElementById('projected-income-list');
  const template = document.getElementById('projected-income-card-template');
  list.innerHTML = '';

  const todayK = todayKey();
  const upcoming = [...projectedByDate(income).values()].flat()
    .filter((record) => record.projectedFor >= todayK)
    .sort((a, b) => (a.projectedFor < b.projectedFor ? -1 : a.projectedFor > b.projectedFor ? 1 : 0)
      || (a.source || '').localeCompare(b.source || ''));
  const receivedDates = new Set(uniqueIncomeEntries(income).filter((r) => !r.deleted).map((r) => r.dateKey));
  let stillExpected = 0;

  upcoming.forEach((record) => {
    const dateKey = record.projectedFor;
    const received = receivedDates.has(dateKey);
    if (!received) stillExpected += record.projected;

    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editAmount = node.querySelector('.projected-income-edit-amount');
    const editError = node.querySelector('.projected-income-edit-error');

    node.querySelector('.recurring-income-name').textContent =
      `${formatDateKeyShort(dateKey)} \u00b7 ${whenLabel(daysUntilDateKey(dateKey))}`;
    node.querySelector('.recurring-income-amount').textContent = formatSignedCurrency(record.projected);
    node.querySelector('.recurring-income-start').textContent =
      [record.source, received ? 'Real income entered: this no longer counts' : ''].filter(Boolean).join(' · ');
    const editSource = node.querySelector('.projected-income-edit-source');
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete projected income for ${formatDateKeyShort(dateKey)}`);
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit projected income for ${formatDateKeyShort(dateKey)}`);

    node.querySelector('.edit-btn').addEventListener('click', () => {
      editAmount.value = String(record.projected);
      editSource.value = record.source || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      editAmount.focus();
    });
    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Closed before saving, so the redraw after a save does not reopen it; shown again with the problem on a failure.
      editForm.hidden = true;
      viewSection.hidden = false;
      const fail = (message) => {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = message;
        editError.hidden = false;
      };
      const value = Number(editAmount.value);
      if (editAmount.value === '' || !Number.isFinite(value) || Math.abs(value) > MAX_MONEY) {
        fail('Enter an amount up to $1,000,000,000.');
        return;
      }
      // A new source on the entry first (refused if that day already has one from it), then the amount.
      if (!setIncomeSource(record.id, editSource.value)) {
        fail('That day already has a projected entry from that source.');
        return;
      }
      if (Math.round(value * 100) / 100 !== record.projected) setProjectedForDate(dateKey, editAmount.value, editSource.value);
      renderBudget();
    });
    node.querySelector('.delete-btn').addEventListener('click', () => setProjectedForDate(dateKey, '', record.source));

    list.appendChild(node);
  });

  const upcomingDays = new Set(upcoming.map((record) => record.projectedFor)).size;
  document.getElementById('projected-income-summary').textContent = upcoming.length
    ? `${formatSignedCurrency(stillExpected)} still expected across ${upcomingDays} day${upcomingDays === 1 ? '' : 's'}.`
    : '';
  document.getElementById('projected-income-empty-state').hidden = upcoming.length !== 0;
}

// ---- Spending Plan (estimated spending per category) ----
// Each category is a record in the same `income` list as projected income, { id: 'plan-<id>', planName, amount,
// frequency, business, notes, altAmount, ...sync fields }, so it syncs, undoes and exports with no change to the
// sync server (which only knows the three lists). Like a projected record it has no `dateKey`, so every actual-income
// total ignores it. The amount is stored in the frequency it was entered in; the other view is always worked out.

// The periods a category can be entered in.
const PLAN_FREQUENCIES = ['weekly', 'monthly'];
// localStorage key for the What-if switch (kept per device, not synced).
const PLAN_SCENARIO_KEY = 'budgetApp.planScenario.v1';
// Whether the What-if amounts are being used in the totals.
let planScenarioOn = loadPlanScenario();

// Reads the saved What-if switch (off when nothing is saved or storage is blocked).
function loadPlanScenario() {
  try { return localStorage.getItem(PLAN_SCENARIO_KEY) === '1'; } catch { return false; }
}

// A plan amount as a monthly figure: weekly amounts are multiplied by 52 weeks and divided by 12 months (not by 4).
function planMonthly(amount, frequency) {
  return frequency === 'weekly' ? (amount * 52) / 12 : amount;
}

// A plan amount as a weekly figure: monthly amounts are multiplied by 12 months and divided by 52 weeks.
function planWeekly(amount, frequency) {
  return frequency === 'monthly' ? (amount * 12) / 52 : amount;
}

// The live Spending Plan categories, by name.
function planCategories() {
  return income.filter((r) => r.planName && !r.deleted)
    .sort((a, b) => a.planName.localeCompare(b.planName));
}

// The amount a category counts for right now: its What-if amount while the switch is on and it has one,
// otherwise its normal amount (both are in the category's own frequency).
function planAmount(record) {
  return planScenarioOn && typeof record.altAmount === 'number' ? record.altAmount : record.amount;
}

// Checks the Add / Edit category fields and returns the first problem as a sentence ('' when they are fine).
function planFieldsError(fields) {
  if (!fields.name.trim()) return 'Enter a category name.';
  const amount = Number(fields.amountRaw);
  if (fields.amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  if (!PLAN_FREQUENCIES.includes(fields.frequency)) return 'Choose weekly or monthly.';
  const alt = Number(fields.altRaw);
  if (fields.altRaw !== '' && (!Number.isFinite(alt) || alt < 0 || alt > MAX_MONEY)) return 'The what-if amount must be $0 or more, up to $1,000,000,000.';
  return '';
}

// Adds a category, or changes the one with `id`. Returns the problem as a sentence, or '' when it was saved.
function savePlanCategory(fields, id) {
  const error = planFieldsError(fields);
  if (error) return error;
  const values = {
    planName: fields.name.trim().slice(0, 60),
    amount: Math.round(Number(fields.amountRaw) * 100) / 100, // whole cents, like bills
    frequency: fields.frequency,
    business: fields.type === 'business',
    notes: fields.notes.trim().slice(0, 500),
  };
  const alt = fields.altRaw === '' ? undefined : Math.round(Number(fields.altRaw) * 100) / 100;
  const existing = id ? income.find((r) => r.id === id) : null;
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, values);
    if (alt === undefined) delete existing.altAmount; else existing.altAmount = alt;
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `plan-${makeId()}`, ...values,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    if (alt !== undefined) record.altAmount = alt;
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// Sets a plan category's amount (in the frequency it was entered in) and records one Undo step. Used by the
// Expenses tab's "use this average" button.
function setPlanAmount(id, amount) {
  const record = income.find((r) => r.id === id && r.planName);
  if (!record || record.deleted || !(amount >= 0.01) || amount > MAX_MONEY) return;
  const before = structuredClone(record);
  record.amount = Math.round(amount * 100) / 100;
  stampSync(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', record.id, before, structuredClone(record));
  renderBudget();
}

// Draws the Spending Plan tab: each category with its weekly and monthly figures (the one it was entered in is
// marked), the totals for everything and for business and personal, and the What-if comparison.
function renderPlan() {
  const list = document.getElementById('plan-list');
  const template = document.getElementById('plan-card-template');
  list.innerHTML = '';
  document.getElementById('plan-scenario-input').checked = planScenarioOn;

  const records = planCategories();
  const money = formatMoney;
  const totals = { weekly: 0, monthly: 0, businessWeekly: 0, businessMonthly: 0, planMonthly: 0 };
  let anyWhatIf = false;

  records.forEach((record) => {
    const amount = planAmount(record);
    const weekly = planWeekly(amount, record.frequency);
    const monthly = planMonthly(amount, record.frequency);
    totals.weekly += weekly;
    totals.monthly += monthly;
    totals.planMonthly += planMonthly(record.amount, record.frequency);
    if (record.business) { totals.businessWeekly += weekly; totals.businessMonthly += monthly; }
    const usingWhatIf = planScenarioOn && typeof record.altAmount === 'number';
    if (typeof record.altAmount === 'number') anyWhatIf = true;

    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editError = node.querySelector('.plan-edit-error');
    node.querySelector('.recurring-income-name').textContent = record.planName;
    node.querySelector('.plan-type').textContent = record.business ? 'Business' : 'Personal';
    node.querySelector('.plan-amounts').textContent = `${money(weekly)} per week · ${money(monthly)} per month`;
    node.querySelector('.plan-entered').textContent = usingWhatIf
      ? `What-if amount in use (the plan says ${money(record.amount)} ${record.frequency})`
      : `Entered ${record.frequency}: ${money(record.amount)}`;
    const whatIfEl = node.querySelector('.plan-whatif');
    if (typeof record.altAmount === 'number' && !usingWhatIf) {
      whatIfEl.textContent = `What-if: ${money(record.altAmount)} ${record.frequency}`;
      whatIfEl.hidden = false;
    }
    const notesEl = node.querySelector('.plan-notes');
    if (record.notes) { notesEl.textContent = record.notes; notesEl.hidden = false; }
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit ${record.planName}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete ${record.planName}`);

    // Elements are captured now: once the fragment is appended it is empty, so node.querySelector would find nothing.
    const nameBox = node.querySelector('.plan-edit-name');
    const amountBox = node.querySelector('.plan-edit-amount');
    const frequencyBox = node.querySelector('.plan-edit-frequency');
    const typeBox = node.querySelector('.plan-edit-type');
    const altBox = node.querySelector('.plan-edit-alt');
    const notesBox = node.querySelector('.plan-edit-notes');
    node.querySelector('.edit-btn').addEventListener('click', () => {
      nameBox.value = record.planName;
      amountBox.value = String(record.amount);
      frequencyBox.value = record.frequency;
      typeBox.value = record.business ? 'business' : 'personal';
      altBox.value = typeof record.altAmount === 'number' ? String(record.altAmount) : '';
      notesBox.value = record.notes || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      nameBox.focus();
    });
    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Closed before saving: a successful save redraws, and the redraw would reopen a form that is still showing.
      editForm.hidden = true;
      viewSection.hidden = false;
      const problem = savePlanCategory({
        name: nameBox.value, amountRaw: amountBox.value, frequency: frequencyBox.value,
        type: typeBox.value, altRaw: altBox.value, notes: notesBox.value,
      }, record.id);
      if (problem) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = problem;
        editError.hidden = false;
      }
    });
    node.querySelector('.delete-btn').addEventListener('click', () => deleteIncome(record.id));

    list.appendChild(node);
  });

  document.getElementById('plan-empty-state').hidden = records.length !== 0;
  document.getElementById('plan-total-line').textContent = records.length
    ? `Total: ${money(totals.weekly)} per week · ${money(totals.monthly)} per month.` : '';
  document.getElementById('plan-split-line').textContent = records.length
    ? `Business: ${money(totals.businessWeekly)} per week · ${money(totals.businessMonthly)} per month. ` +
      `Personal: ${money(totals.weekly - totals.businessWeekly)} per week · ${money(totals.monthly - totals.businessMonthly)} per month.` : '';
  const scenarioLine = document.getElementById('plan-scenario-line');
  if (planScenarioOn && anyWhatIf) {
    const saved = totals.planMonthly - totals.monthly;
    scenarioLine.textContent = saved >= 0
      ? `What-if: ${money(saved)} per month less than the plan (${money(totals.planMonthly)} per month).`
      : `What-if: ${money(-saved)} per month more than the plan (${money(totals.planMonthly)} per month).`;
  } else {
    scenarioLine.textContent = '';
  }
}

// The What-if switch: remember it on this device and redraw the totals.
document.getElementById('plan-scenario-input').addEventListener('change', (e) => {
  planScenarioOn = e.target.checked;
  try { localStorage.setItem(PLAN_SCENARIO_KEY, planScenarioOn ? '1' : '0'); } catch { /* not saved: it starts off next time */ }
  renderPlan();
});

// Add category form: validate, save, and clear the boxes when it worked.
document.getElementById('plan-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('plan-form-error');
  const problem = savePlanCategory({
    name: document.getElementById('plan-name-input').value,
    amountRaw: document.getElementById('plan-amount-input').value,
    frequency: document.getElementById('plan-frequency-input').value,
    type: document.getElementById('plan-type-input').value,
    altRaw: document.getElementById('plan-alt-input').value,
    notes: document.getElementById('plan-notes-input').value,
  });
  if (problem) { errorEl.textContent = problem; errorEl.hidden = false; return; }
  errorEl.hidden = true;
  e.target.reset();
  document.getElementById('plan-name-input').focus();
});

// ---- Expected one-time costs (guesses) ----
// A guess is a one-off cost you expect in a certain month, e.g. car maintenance. It is a record in the `income` list,
// { id: 'guess-<id>', guessName, amount, guessMonth: 'YYYY-MM', notes, ...sync fields }, so it syncs and undoes like a
// plan category with no change to the sync server. It has no `dateKey`, so income totals ignore it. Only the current
// month's guesses are subtracted in "left after plan"; guesses for other months wait on the Plan tab.

// Whether `value` is a month key like '2026-10' within the forms' year range.
function isGuessMonth(value) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof value === 'string' ? value : '');
  return !!match && Number(match[1]) >= DATE_YEAR_MIN && Number(match[1]) <= DATE_YEAR_MAX;
}

// The live guesses, soonest month first and then by name.
function guessRecords() {
  return income.filter((r) => r.guessName && !r.deleted)
    .sort((a, b) => a.guessMonth.localeCompare(b.guessMonth) || a.guessName.localeCompare(b.guessName));
}

// What the guesses for one month ('YYYY-MM') add up to.
function guessTotalForMonth(monthKey) {
  return guessRecords().filter((r) => r.guessMonth === monthKey).reduce((sum, r) => sum + r.amount, 0);
}

// 'October 2026' for a month key.
function guessMonthLabel(monthKey) {
  return `${MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

// Checks the Add / Edit expected-cost fields and returns the first problem as a sentence ('' when they are fine).
function guessFieldsError(fields) {
  if (!fields.name.trim()) return 'Enter what the cost is for.';
  const amount = Number(fields.amountRaw);
  if (fields.amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  if (!isGuessMonth(fields.month)) return 'Choose the month you expect it.';
  return '';
}

// Adds an expected cost, or changes the one with `id`. Returns the problem as a sentence, or '' when it was saved.
function saveGuess(fields, id) {
  const error = guessFieldsError(fields);
  if (error) return error;
  const values = {
    guessName: fields.name.trim().slice(0, 60),
    amount: Math.round(Number(fields.amountRaw) * 100) / 100, // whole cents, like bills
    guessMonth: fields.month,
    notes: fields.notes.trim().slice(0, 500),
  };
  const existing = id ? income.find((r) => r.id === id && r.guessName) : null;
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, values);
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `guess-${makeId()}`, ...values,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// Turns an expected cost into a real expense dated today, for what it really cost and in the chosen Spending Plan
// category, with the guess's name as the note, and removes the guess so it is not counted twice. Returns the problem
// as a sentence, or '' when it worked. Nothing is changed when the expense would be refused.
function markGuessSpent(guessId, amountRaw, planId) {
  const guess = income.find((r) => r.id === guessId && r.guessName && !r.deleted);
  if (!guess) return 'That expected cost is gone.';
  const problem = expenseFieldsError({ dateKey: todayKey(), amountRaw, planId, notes: guess.guessName });
  if (problem) return problem;
  deleteIncome(guess.id);
  return saveExpense({ dateKey: todayKey(), amountRaw, planId, notes: guess.guessName });
}

// Draws the expected one-time costs on the Plan tab, with what this month's come to.
function renderGuesses() {
  const list = document.getElementById('guess-list');
  const template = document.getElementById('guess-card-template');
  list.innerHTML = '';
  const records = guessRecords();
  const thisMonth = todayKey().slice(0, 7);

  records.forEach((record) => {
    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editError = node.querySelector('.guess-edit-error');
    node.querySelector('.recurring-income-name').textContent = record.guessName;
    node.querySelector('.guess-amount').textContent = formatMoney(record.amount);
    node.querySelector('.guess-month').textContent = record.guessMonth < thisMonth
      ? `${guessMonthLabel(record.guessMonth)} (past)` : guessMonthLabel(record.guessMonth);
    const notesEl = node.querySelector('.guess-notes');
    if (record.notes) { notesEl.textContent = record.notes; notesEl.hidden = false; }
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit ${record.guessName}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete ${record.guessName}`);

    // Elements are captured now: once the fragment is appended it is empty, so node.querySelector would find nothing.
    const nameBox = node.querySelector('.guess-edit-name');
    const amountBox = node.querySelector('.guess-edit-amount');
    const monthBox = node.querySelector('.guess-edit-month');
    const notesBox = node.querySelector('.guess-edit-notes');
    node.querySelector('.edit-btn').addEventListener('click', () => {
      nameBox.value = record.guessName;
      amountBox.value = String(record.amount);
      monthBox.value = record.guessMonth;
      notesBox.value = record.notes || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      nameBox.focus();
    });
    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      editForm.hidden = true; // closed before saving, so the redraw after a save does not reopen it
      viewSection.hidden = false;
      const problem = saveGuess({ name: nameBox.value, amountRaw: amountBox.value, month: monthBox.value, notes: notesBox.value }, record.id);
      if (problem) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = problem;
        editError.hidden = false;
      }
    });
    node.querySelector('.delete-btn').addEventListener('click', () => deleteIncome(record.id));

    // Mark as spent: the real amount (starting from the guess) and a Spending Plan category, then it becomes an expense.
    const spentForm = node.querySelector('.guess-spent-form');
    const spentAmount = node.querySelector('.guess-spent-amount');
    const spentCategory = node.querySelector('.guess-spent-category');
    const spentError = node.querySelector('.guess-spent-error');
    node.querySelector('.guess-spent-btn').addEventListener('click', () => {
      // The category whose name matches the guess is chosen to start with; otherwise the first one.
      const match = planCategories().find((plan) => plan.planName.toLowerCase() === record.guessName.toLowerCase());
      fillExpenseCategorySelect(spentCategory, match ? match.id : '', '');
      spentAmount.value = String(record.amount);
      spentError.hidden = true;
      viewSection.hidden = true;
      spentForm.hidden = false;
      spentAmount.focus();
    });
    node.querySelector('.guess-spent-cancel').addEventListener('click', () => {
      spentForm.hidden = true;
      viewSection.hidden = false;
    });
    spentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const problem = markGuessSpent(record.id, spentAmount.value, spentCategory.value);
      if (problem) { spentError.textContent = problem; spentError.hidden = false; }
    });

    list.appendChild(node);
  });

  document.getElementById('guess-empty-state').hidden = records.length !== 0;
  const monthTotal = guessTotalForMonth(thisMonth);
  document.getElementById('guess-total-line').textContent = monthTotal
    ? `${guessMonthLabel(thisMonth)}: ${formatMoney(monthTotal)} expected, taken off "left after plan" on Home.` : '';
}

// Add expected cost form: validate, save, and clear the boxes (keeping the month) when it worked.
document.getElementById('guess-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('guess-form-error');
  const monthInput = document.getElementById('guess-month-input');
  const problem = saveGuess({
    name: document.getElementById('guess-name-input').value,
    amountRaw: document.getElementById('guess-amount-input').value,
    month: monthInput.value,
    notes: document.getElementById('guess-notes-input').value,
  });
  if (problem) { errorEl.textContent = problem; errorEl.hidden = false; return; }
  errorEl.hidden = true;
  const keepMonth = monthInput.value;
  e.target.reset();
  monthInput.value = keepMonth;
  document.getElementById('guess-name-input').focus();
});
document.getElementById('guess-month-input').value = todayKey().slice(0, 7);

// ---- Savings goals (saving up for a large purchase) ----
// A goal is a record in the `income` list, { id: 'goal-<id>', goalName, target, goalDate (optional), notes, ...sync
// fields }. It can be split into cost parts, one record each (see goalCosts); with parts, the target is their total. What has been put aside is a separate record per deposit, { id: 'save-<id>', savedFor: <goal id>, savedOn,
// amount }, with a negative amount for money taken back out. Separate records mean two devices adding savings at the
// same time both count, instead of one overwriting the other's total. Neither kind has a `dateKey`, so income totals
// ignore them, and the sync server needs no change (their ids are not date ids, so they merge like bills).

// The live goals, by name.
function goalRecords() {
  return income.filter((r) => r.goalName && !r.deleted).sort((a, b) => a.goalName.localeCompare(b.goalName));
}

// How much has been put aside for a goal: its deposits minus its withdrawals.
function goalSaved(goalId) {
  const total = income.filter((r) => r.savedFor === goalId && !r.deleted).reduce((sum, r) => sum + r.amount, 0);
  return Math.round(total * 100) / 100;
}

// The cost parts listed under a goal ({ id: 'item-<id>', goalItemFor: <goal id>, itemName, amount }), oldest first.
// They are records in the income list like the goal itself, so they sync and undo the same way.
function goalCosts(goalId) {
  return income.filter((r) => r.goalItemFor === goalId && !r.deleted)
    .sort((a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || ''));
}

// What a goal is saving toward: the total of its cost parts when it has any, otherwise its own target.
function goalTarget(goal) {
  const costs = goalCosts(goal.id);
  return costs.length ? Math.round(costs.reduce((sum, r) => sum + r.amount, 0) * 100) / 100 : goal.target;
}

// Adds a cost part to a goal. Returns the problem as a sentence, or '' when it was saved.
function addGoalCost(goalId, rawName, amountRaw) {
  const goal = income.find((r) => r.id === goalId && r.goalName && !r.deleted);
  if (!goal) return 'That goal is gone.';
  const name = rawName.trim().slice(0, 60);
  if (!name) return 'Enter what the cost is for.';
  const amount = Number(amountRaw);
  if (amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  const now = new Date().toISOString();
  const record = {
    id: `item-${makeId()}`, goalItemFor: goalId, itemName: name, amount: Math.round(amount * 100) / 100,
    dateAdded: now, updatedAt: now,
    deviceId: getDeviceId(), deleted: false, version: 0,
  };
  income.push(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', record.id, null, structuredClone(record));
  renderBudget();
  return '';
}

// Changes the name and amount of a goal's cost part. Returns the problem as a sentence, or '' when it was saved
// (nothing is recorded, and no Undo step added, when neither changed).
function saveGoalCost(id, rawName, amountRaw) {
  const cost = income.find((r) => r.id === id && r.goalItemFor && !r.deleted);
  if (!cost) return 'That cost is gone.';
  const name = rawName.trim().slice(0, 60);
  if (!name) return 'Enter what the cost is for.';
  const amount = Number(amountRaw);
  if (amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  const cents = Math.round(amount * 100) / 100;
  if (name !== cost.itemName || cents !== cost.amount) {
    const before = structuredClone(cost);
    cost.itemName = name;
    cost.amount = cents;
    stampSync(cost);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', cost.id, before, structuredClone(cost));
  }
  renderBudget();
  return '';
}

// Checks the Add / Edit goal fields and returns the first problem as a sentence ('' when they are fine).
function goalFieldsError(fields) {
  if (!fields.name.trim()) return 'Enter what you are saving for.';
  const target = Number(fields.targetRaw);
  if (fields.targetRaw === '' || !Number.isFinite(target) || target < 0.01 || target > MAX_MONEY) return 'Enter a target of at least $0.01 and up to $1,000,000,000.';
  if (fields.date && !(isRealDateKey(fields.date) && isReasonableDateKey(fields.date))) return 'Choose a real target date, or leave it empty.';
  return '';
}

// Adds a goal, or changes the one with `id`. Returns the problem as a sentence, or '' when it was saved.
function saveGoal(fields, id) {
  const error = goalFieldsError(fields);
  if (error) return error;
  const values = {
    goalName: fields.name.trim().slice(0, 60),
    target: Math.round(Number(fields.targetRaw) * 100) / 100, // whole cents, like bills
    notes: fields.notes.trim().slice(0, 500),
  };
  const existing = id ? income.find((r) => r.id === id && r.goalName) : null;
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, values);
    if (fields.date) existing.goalDate = fields.date; else delete existing.goalDate;
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `goal-${makeId()}`, ...values,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    if (fields.date) record.goalDate = fields.date;
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// Puts money toward a goal (sign +1) or takes it back out (sign -1), dated today. Returns the problem as a
// sentence, or '' when it was saved. You cannot take out more than is saved.
function addSavings(goalId, amountRaw, sign) {
  const goal = income.find((r) => r.id === goalId && r.goalName && !r.deleted);
  if (!goal) return 'That goal is gone.';
  const amount = Number(amountRaw);
  if (amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  const cents = Math.round(amount * 100) / 100;
  if (sign < 0 && cents > goalSaved(goalId)) return `Only ${formatMoney(goalSaved(goalId))} is saved for this goal.`;
  const now = new Date().toISOString();
  const record = {
    id: `save-${makeId()}`, savedFor: goalId, savedOn: todayKey(), amount: sign < 0 ? -cents : cents,
    dateAdded: now, updatedAt: now,
    deviceId: getDeviceId(), deleted: false, version: 0,
  };
  income.push(record);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', record.id, null, structuredClone(record));
  renderBudget();
  return '';
}

// Draws the Savings Goals on the Plan tab: each goal with a progress bar, what is left, and (when it has a target
// date) what to put aside each month to get there.
function renderGoals() {
  const list = document.getElementById('goal-list');
  const template = document.getElementById('goal-card-template');
  list.innerHTML = '';
  const records = goalRecords();

  records.forEach((record) => {
    const saved = goalSaved(record.id);
    const costs = goalCosts(record.id);
    const target = goalTarget(record);
    const left = Math.round((target - saved) * 100) / 100;
    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editError = node.querySelector('.goal-edit-error');
    node.querySelector('.recurring-income-name').textContent = record.goalName;
    node.querySelector('.goal-amounts').textContent = `${formatMoney(saved)} of ${formatMoney(target)}`;
    node.querySelector('.goal-fill').style.width = `${Math.max(0, Math.min(100, Math.round((saved / target) * 100)))}%`;

    // The cost parts under the goal: each with a Remove button, then the boxes to add another.
    const costList = node.querySelector('.goal-costs');
    costs.forEach((cost) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${cost.itemName}: ${formatMoney(cost.amount)}`;
      const actions = document.createElement('span');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'small-btn';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${cost.itemName} in ${record.goalName}`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-btn';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${cost.itemName} from ${record.goalName}`);
      remove.addEventListener('click', () => deleteIncome(cost.id));
      actions.append(edit, remove);

      // The form that replaces the row's text while the cost is being edited.
      const form = document.createElement('form');
      form.className = 'goal-cost-form';
      form.hidden = true;
      const nameBox = document.createElement('input');
      nameBox.type = 'text';
      nameBox.maxLength = 60;
      nameBox.required = true;
      nameBox.setAttribute('aria-label', `Edit the name of ${cost.itemName}`);
      const amountBox = document.createElement('input');
      amountBox.type = 'number';
      amountBox.inputMode = 'decimal';
      amountBox.min = '0.01';
      amountBox.step = '0.01';
      amountBox.required = true;
      amountBox.setAttribute('aria-label', `Edit the amount of ${cost.itemName}`);
      const save = document.createElement('button');
      save.type = 'submit';
      save.className = 'small-btn';
      save.textContent = 'Save';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'small-btn';
      cancel.textContent = 'Cancel';
      const error = document.createElement('span');
      error.className = 'form-error';
      error.hidden = true;
      form.append(nameBox, amountBox, save, cancel, error);
      edit.addEventListener('click', () => {
        nameBox.value = cost.itemName;
        amountBox.value = String(cost.amount);
        error.hidden = true;
        label.hidden = true;
        actions.hidden = true;
        form.hidden = false;
        nameBox.focus();
      });
      cancel.addEventListener('click', () => {
        form.hidden = true;
        label.hidden = false;
        actions.hidden = false;
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const problem = saveGoalCost(cost.id, nameBox.value, amountBox.value);
        if (problem) { error.textContent = problem; error.hidden = false; }
      });
      row.append(label, actions, form);
      costList.appendChild(row);
    });
    // The savings history: every deposit (+) and withdrawal (-), newest first, each removable (Undo brings it back).
    const deposits = income.filter((r) => r.savedFor === record.id && !r.deleted)
      .sort((a, b) => b.savedOn.localeCompare(a.savedOn) || (b.dateAdded || '').localeCompare(a.dateAdded || ''));
    node.querySelector('.goal-history-summary').textContent = `Savings history (${deposits.length})`;
    node.querySelector('.goal-history').hidden = deposits.length === 0;
    const historyList = node.querySelector('.goal-history-list');
    deposits.forEach((deposit) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      const signed = `${deposit.amount < 0 ? '-' : '+'}${formatMoney(Math.abs(deposit.amount))}`; // always shows its sign
      label.textContent = `${formatDateKeyShort(deposit.savedOn)}: ${signed}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-btn';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete the ${signed} entry from ${formatDateKeyShort(deposit.savedOn)}`);
      remove.addEventListener('click', () => deleteIncome(deposit.id));
      row.append(label, remove);
      historyList.appendChild(row);
    });
    const costNote = node.querySelector('.goal-costs-note');
    costNote.textContent = costs.length
      ? `The target is the total of ${costs.length} cost${costs.length === 1 ? '' : 's'}.`
      : 'Split the target into costs (for example flights and hotel) and it becomes their total.';
    const costNameBox = node.querySelector('.goal-cost-name-input');
    const costAmountBox = node.querySelector('.goal-cost-amount-input');
    const costError = node.querySelector('.goal-cost-error');
    node.querySelector('.goal-cost-add-btn').addEventListener('click', () => {
      const problem = addGoalCost(record.id, costNameBox.value, costAmountBox.value);
      if (problem) { costError.textContent = problem; costError.hidden = false; }
    });
    let status;
    if (left <= 0) status = 'Goal reached!';
    else {
      status = `${formatMoney(left)} to go`;
      if (record.goalDate) {
        const days = daysUntilDateKey(record.goalDate);
        if (days < 0) status += ` · target date ${formatDateKeyLong(record.goalDate)} has passed`;
        else status += ` · ${formatMoney(left / Math.max(1, days / (365 / 12)))} per month to reach it by ${formatDateKeyLong(record.goalDate)}`;
      }
    }
    node.querySelector('.goal-status').textContent = status;
    const notesEl = node.querySelector('.goal-notes');
    if (record.notes) { notesEl.textContent = record.notes; notesEl.hidden = false; }
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit ${record.goalName}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete ${record.goalName}`);

    // Elements are captured now: once the fragment is appended it is empty, so node.querySelector would find nothing.
    const amountBox = node.querySelector('.goal-amount-input');
    const saveError = node.querySelector('.goal-save-error');
    const deposit = (sign) => {
      const problem = addSavings(record.id, amountBox.value, sign);
      if (problem) { saveError.textContent = problem; saveError.hidden = false; }
    };
    node.querySelector('.goal-add-btn').addEventListener('click', () => deposit(1));
    node.querySelector('.goal-take-btn').addEventListener('click', () => deposit(-1));
    const nameBox = node.querySelector('.goal-edit-name');
    const targetBox = node.querySelector('.goal-edit-target');
    const dateBox = node.querySelector('.goal-edit-date');
    const notesBox = node.querySelector('.goal-edit-notes');
    node.querySelector('.edit-btn').addEventListener('click', () => {
      nameBox.value = record.goalName;
      targetBox.value = String(record.target);
      dateBox.value = record.goalDate || '';
      notesBox.value = record.notes || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      nameBox.focus();
    });
    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      editForm.hidden = true; // closed before saving, so the redraw after a save does not reopen it
      viewSection.hidden = false;
      const problem = saveGoal({ name: nameBox.value, targetRaw: targetBox.value, date: dateBox.value, notes: notesBox.value }, record.id);
      if (problem) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = problem;
        editError.hidden = false;
      }
    });
    node.querySelector('.delete-btn').addEventListener('click', () => deleteIncome(record.id));

    list.appendChild(node);
  });

  document.getElementById('goal-empty-state').hidden = records.length !== 0;
}

// Add goal form: validate, save, and clear the boxes when it worked.
document.getElementById('goal-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('goal-form-error');
  const problem = saveGoal({
    name: document.getElementById('goal-name-input').value,
    targetRaw: document.getElementById('goal-target-input').value,
    date: document.getElementById('goal-date-input').value,
    notes: document.getElementById('goal-notes-input').value,
  });
  if (problem) { errorEl.textContent = problem; errorEl.hidden = false; return; }
  errorEl.hidden = true;
  e.target.reset();
  document.getElementById('goal-name-input').focus();
});

// The lists whose cards each have an Edit form (and a data-record-id): they are rebuilt on every redraw, so an
// open form has to be captured first and put back after.
const EDIT_CARD_LIST_IDS = ['plan-list', 'guess-list', 'goal-list', 'repeat-list', 'expense-list', 'received-income-list', 'projected-income-list'];

// Notes every open card edit form (in the given lists, by default all of them): which record, what is typed in
// each box, and which box had focus. The Bills and Recurring Income lists are not here: renderBudget captures
// their forms itself.
function captureOpenCardForms(listIds = EDIT_CARD_LIST_IDS) {
  const open = [];
  listIds.forEach((listId) => {
    document.querySelectorAll(`#${listId} li[data-record-id]`).forEach((card) => {
      const form = card.querySelector('.recurring-income-edit-form');
      if (!form || form.hidden) return;
      const fields = [...form.querySelectorAll('input, select')];
      open.push({ listId, recordId: card.dataset.recordId, values: fields.map((f) => f.value), focused: fields.indexOf(document.activeElement) });
    });
  });
  return open;
}

// Reopens the forms captured by captureOpenCardForms on the freshly drawn cards, with what was typed. A record
// that is gone (deleted or synced away) just stays closed.
function restoreOpenCardForms(open) {
  open.forEach(({ listId, recordId, values, focused }) => {
    const card = [...document.querySelectorAll(`#${listId} li[data-record-id]`)].find((c) => c.dataset.recordId === recordId);
    const editBtn = card && card.querySelector('.edit-btn');
    if (!editBtn) return;
    const typingElsewhere = document.activeElement;
    editBtn.click(); // opens the form and fills the choices a box needs, from the saved record
    const fields = [...card.querySelectorAll('.recurring-income-edit-form input, .recurring-income-edit-form select')];
    fields.forEach((field, i) => { if (values[i] !== undefined) field.value = values[i]; });
    if (focused >= 0 && fields[focused]) fields[focused].focus();
    // The Edit button moves focus into the form; when the user was typing somewhere else, give focus back there.
    else if (focused < 0 && typingElsewhere && typingElsewhere !== document.body && typingElsewhere.isConnected) typingElsewhere.focus({ preventScroll: true });
  });
}

// Redraws the whole screen from the live lists. A redraw wipes the DOM, so it first captures the
// in-progress input it must put back: the open Bill edit form, the open Recurring Income edit form
// (one of each can be open at once) and the open edit forms of the Plan, Expected costs, Savings goals, Expenses
// and Income cards.
function renderBudget() {
  const openCardForms = captureOpenCardForms();
  const nonDeleted = bills.filter((b) => !b.deleted);
  // One record per date first (the newest wins, even if it is a cleared one), then drop cleared ones.
  const nonDeletedIncome = uniqueIncomeEntries(income).filter((r) => !r.deleted);
  const nonDeletedRecurringIncome = recurringIncome.filter((r) => !r.deleted);

  const list = document.getElementById('budget-list');
  const openForm = list.querySelector('.bill-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.bill-card').dataset.billId,
        name: openForm.querySelector('.bill-edit-name').value,
        amount: openForm.querySelector('.bill-edit-amount').value,
        dueDate: openForm.querySelector('.bill-edit-duedate').value,
        frequency: openForm.querySelector('.bill-edit-frequency').value,
        every: openForm.querySelector('.bill-edit-every').value,
        unit: openForm.querySelector('.bill-edit-unit').value,
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
  renderCategoryOptions(nonDeleted);
  renderBudgetCalendar(nonDeleted, nonDeletedIncome, nonDeletedRecurringIncome, projectedByDate(income));
  renderPayPeriod();
  renderPaidHistory();
  renderBudgetList(nonDeleted, openEdit);
  renderRecurringIncomeList(nonDeletedRecurringIncome, openRecurringIncomeEdit);
  renderIncomeSourceOptions();
  renderReceivedIncomeList();
  renderProjectedIncomeList();
  renderPlan();
  renderGuesses();
  renderGoals();
  renderExpenses();
  restoreOpenCardForms(openCardForms);

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

// Shows the "repeat every X weeks or months" row under a bill's frequency box only while Custom is chosen.
function syncCustomRepeat(select) {
  const row = select.nextElementSibling;
  if (row && row.classList.contains('custom-repeat')) row.hidden = select.value !== 'custom';
}

// Any bill frequency box (the Add form's or a card's Edit form) shows or hides its custom row when changed.
document.addEventListener('change', (e) => {
  if (e.target.matches('#budget-frequency-input, .bill-edit-frequency')) syncCustomRepeat(e.target);
});

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
    every: document.getElementById('budget-every-input').value,
    unit: document.getElementById('budget-unit-input').value,
    category: categoryInput.value,
    autopay: document.getElementById('budget-autopay-input').checked,
    // When the "I'm caught up" box is showing and ticked, every date before today starts out paid.
    paidThrough: !document.getElementById('budget-caughtup-field').hidden && document.getElementById('budget-caughtup-input').checked
      ? shiftDateKey(todayKey(), -1)
      : null,
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
  document.getElementById('budget-every-input').value = '6';
  document.getElementById('budget-unit-input').value = 'weeks';
  syncCustomRepeat(frequencyInput);
  categoryInput.value = '';
  updateCaughtUpOption();
  closeAddBillSheet();
  showNewBillCard(result.id);
});

// ---- The Add bill form as a bottom sheet (phones) ----
// On a phone the form is hidden until the + button (or a day's "Add a bill on this day") opens it as a sheet over
// the page, so the Bills list sits right under its filters. On wider screens it stays in the page.

// True on the narrow layout (the same width the phone styles use).
function isPhoneLayout() {
  return window.matchMedia('(max-width: 700px)').matches;
}

// Smooth scrolling, unless the device is set to reduce motion.
function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

// Opens the form as a sheet (CSS only turns that into a sheet on the phone layout) and moves into its first box.
function openAddBillSheet() {
  const form = document.getElementById('budget-add-form');
  form.classList.add('add-form-open');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');
  form.setAttribute('aria-label', 'Add a bill');
  document.getElementById('add-sheet-backdrop').hidden = false;
  document.getElementById('budget-name-input').focus();
}

// Closes the sheet (a no-op when it is not open).
function closeAddBillSheet() {
  const form = document.getElementById('budget-add-form');
  form.classList.remove('add-form-open');
  form.removeAttribute('role');
  form.removeAttribute('aria-modal');
  form.removeAttribute('aria-label');
  document.getElementById('add-sheet-backdrop').hidden = true;
}

// Cancel, a tap on the dimmed page, Escape, or the screen turning wide all close it.
document.querySelector('#budget-add-form .add-form-cancel').addEventListener('click', closeAddBillSheet);
document.getElementById('add-sheet-backdrop').addEventListener('click', closeAddBillSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('budget-add-form').classList.contains('add-form-open')) closeAddBillSheet();
});
window.matchMedia('(max-width: 700px)').addEventListener('change', closeAddBillSheet);

// The due date starts on today (a day's "Add a bill on this day" button changes it).
document.getElementById('budget-duedate-input').value = todayKey();

// Shows the "I'm caught up" tick box only for a repeating bill whose due date is in the past (a one-time
// bill that old really is overdue); it starts ticked each time it appears, so the usual answer is one tap fewer.
function updateCaughtUpOption() {
  const field = document.getElementById('budget-caughtup-field');
  const dueDate = document.getElementById('budget-duedate-input').value;
  const show = !!dueDate && dueDate < todayKey() && document.getElementById('budget-frequency-input').value !== 'one_time';
  if (show && field.hidden) document.getElementById('budget-caughtup-input').checked = true;
  field.hidden = !show;
}
// Re-check whenever the due date or the repeat setting changes.
['budget-duedate-input', 'budget-frequency-input'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateCaughtUpOption);
  document.getElementById(id).addEventListener('change', updateCaughtUpOption);
});

// Scrolls to a just-added bill's card and flashes it, so it is clear where it landed in the sorted list.
function showNewBillCard(billId) {
  const card = document.querySelector(`#budget-list [data-bill-id="${billId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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

// Add-projected-income form: validate, save the projection for that date (replacing one already there), and
// clear the amount when it worked.
document.getElementById('projected-income-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const dateInput = document.getElementById('projected-income-date-input');
  const amountInput = document.getElementById('projected-income-amount-input');
  const errorEl = document.getElementById('projected-income-form-error');
  const amount = Number(amountInput.value);

  let error = '';
  if (!dateInput.value) error = 'Pick a date.';
  else if (!isReasonableDateKey(dateInput.value)) error = DATE_RANGE_MESSAGE;
  else if (dateInput.value < todayKey()) error = 'Projected income is for today or a later day.';
  else if (amountInput.value === '' || !Number.isFinite(amount) || Math.abs(amount) > MAX_MONEY) error = 'Enter an amount up to $1,000,000,000.';
  if (error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  saveLastChoice(LAST_INCOME_SOURCE_KEY, cleanSource(document.getElementById('projected-income-source-input').value));
  setProjectedForDate(dateInput.value, amountInput.value, document.getElementById('projected-income-source-input').value);
  amountInput.value = '';
  amountInput.focus();
});

// The projected-income date starts on today, and the source on the one used last.
document.getElementById('projected-income-date-input').value = todayKey();
document.getElementById('projected-income-source-input').value = loadLastChoice(LAST_INCOME_SOURCE_KEY);

// Draws the Income Received list on the Income tab: every income entry typed by hand, newest day first, each with
// Edit (amount and source) and Delete. Recurring income is not listed here: it has its own section.
function renderReceivedIncomeList() {
  const list = document.getElementById('received-income-list');
  const template = document.getElementById('received-income-card-template');
  list.innerHTML = '';

  const entries = uniqueIncomeEntries(income).filter((r) => !r.deleted)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : (a.source || '').localeCompare(b.source || '')));

  entries.forEach((record) => {
    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editAmount = node.querySelector('.received-income-edit-amount');
    const editSource = node.querySelector('.received-income-edit-source');
    const editError = node.querySelector('.received-income-edit-error');
    const editBtn = node.querySelector('.edit-btn');
    const deleteBtn = node.querySelector('.delete-btn');
    const cancelBtn = node.querySelector('.cancel-btn');

    node.querySelector('.recurring-income-name').textContent = formatDateKeyShort(record.dateKey);
    node.querySelector('.recurring-income-amount').textContent = formatSignedCurrency(record.amount);
    node.querySelector('.recurring-income-start').textContent = record.source || '';
    editBtn.setAttribute('aria-label', `Edit income for ${formatDateKeyShort(record.dateKey)}${record.source ? ` from ${record.source}` : ''}`);
    deleteBtn.setAttribute('aria-label', `Delete income for ${formatDateKeyShort(record.dateKey)}${record.source ? ` from ${record.source}` : ''}`);

    editBtn.addEventListener('click', () => {
      editAmount.value = String(record.amount);
      editSource.value = record.source || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      editAmount.focus();
    });
    cancelBtn.addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Closed before saving, so the redraw after a save does not reopen it; shown again with the problem on a failure.
      editForm.hidden = true;
      viewSection.hidden = false;
      const fail = (message) => {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = message;
        editError.hidden = false;
      };
      const value = Number(editAmount.value);
      if (editAmount.value === '' || !Number.isFinite(value) || Math.abs(value) > MAX_MONEY) {
        fail('Enter an amount up to $1,000,000,000.');
        return;
      }
      // A new source on the entry first (refused if that day already has one from it), then the amount.
      if (!setIncomeSource(record.id, editSource.value)) {
        fail('That day already has an entry from that source.');
        return;
      }
      // Only a changed amount is a second change; an unchanged one would add an empty Undo step.
      if (Math.round(value * 100) / 100 !== record.amount) setIncomeForDate(record.dateKey, editAmount.value, editSource.value);
      renderBudget();
    });
    deleteBtn.addEventListener('click', () => setIncomeForDate(record.dateKey, '', record.source));

    list.appendChild(node);
  });

  document.getElementById('received-income-empty-state').hidden = entries.length !== 0;
}

// Add-income form: validate, save the entry for that date and source (the same day and source is updated), and
// clear the amount when it worked.
document.getElementById('received-income-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const dateInput = document.getElementById('received-income-date-input');
  const amountInput = document.getElementById('received-income-amount-input');
  const errorEl = document.getElementById('received-income-form-error');
  const amount = Number(amountInput.value);

  let error = '';
  if (!dateInput.value) error = 'Pick a date.';
  else if (!isReasonableDateKey(dateInput.value)) error = DATE_RANGE_MESSAGE;
  else if (amountInput.value === '' || !Number.isFinite(amount) || Math.abs(amount) > MAX_MONEY) error = 'Enter an amount up to $1,000,000,000.';
  if (error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  saveLastChoice(LAST_INCOME_SOURCE_KEY, cleanSource(document.getElementById('received-income-source-input').value));
  setIncomeForDate(dateInput.value, amountInput.value, document.getElementById('received-income-source-input').value);
  amountInput.value = '';
  amountInput.focus();
});

// The income date starts on today, and the source on the one used last.
document.getElementById('received-income-date-input').value = todayKey();
document.getElementById('received-income-source-input').value = loadLastChoice(LAST_INCOME_SOURCE_KEY);

// ---- Expenses (what you actually spent, logged by hand) ----
// Each expense is a record in the same `income` list as projected income and plan categories, { id: 'expense-<id>',
// spentOn, amount, planId, categoryName, notes, ...sync fields }, so it syncs, undoes and exports with no change to the
// sync server. It has no `dateKey`, so no income total sees it. `planId` points at a Spending Plan category;
// `categoryName` is that category's name when it was logged, shown if the category is later deleted.

// How many of the newest expenses the list shows.
const MAX_EXPENSES_SHOWN = 50;
// How many different recent amounts a category's Quick Add row offers.
const MAX_QUICK_AMOUNTS = 3;
// Days of entries a category needs before its average per week is worked out (less is too noisy to trust).
const MIN_AVERAGE_DAYS = 14;

// The live expenses, newest day first.
function expenseRecords() {
  return income.filter((r) => r.spentOn && !r.deleted)
    .sort((a, b) => (a.spentOn < b.spentOn ? 1 : a.spentOn > b.spentOn ? -1 : (b.dateAdded || '').localeCompare(a.dateAdded || '')));
}

// The Monday on or before a date key (the calendar's weeks start on Monday).
function weekStartKey(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return shiftDateKey(dateKey, -((new Date(y, m, d).getDay() + 6) % 7));
}

// The name to show for an expense's category: the plan category's current name, or the name saved with the
// expense when that category has since been deleted.
function expenseCategoryName(record) {
  const plan = income.find((r) => r.id === record.planId && r.planName && !r.deleted);
  return plan ? plan.planName : (record.categoryName || 'Other');
}

// Fills a category dropdown with the Spending Plan categories, keeping the chosen one (and, for an expense whose
// category was deleted, offering its saved name so editing does not silently change it).
function fillExpenseCategorySelect(select, selectedId, savedName) {
  const keep = selectedId;
  select.innerHTML = '';
  const categories = planCategories();
  categories.forEach((plan) => {
    const option = document.createElement('option');
    option.value = plan.id;
    option.textContent = plan.planName;
    select.appendChild(option);
  });
  if (keep && !categories.some((plan) => plan.id === keep) && savedName) {
    const option = document.createElement('option');
    option.value = keep;
    option.textContent = `${savedName} (deleted category)`;
    select.appendChild(option);
  }
  if (!select.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Add a category on the Plan tab first';
    select.appendChild(option);
  }
  if (keep && [...select.options].some((o) => o.value === keep)) select.value = keep;
}

// Checks the Add / Edit expense fields and returns the first problem as a sentence ('' when they are fine).
function expenseFieldsError(fields) {
  if (!fields.dateKey) return 'Pick a date.';
  if (!isReasonableDateKey(fields.dateKey)) return DATE_RANGE_MESSAGE;
  const amount = Number(fields.amountRaw);
  if (fields.amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  if (!fields.planId) return 'Choose a category (add one on the Plan tab first).';
  return '';
}

// Adds an expense, or changes the one with `id`. Returns the problem as a sentence, or '' when it was saved.
function saveExpense(fields, id) {
  const error = expenseFieldsError(fields);
  if (error) return error;
  const plan = income.find((r) => r.id === fields.planId && r.planName);
  const existing = id ? income.find((r) => r.id === id) : null;
  const values = {
    spentOn: fields.dateKey,
    amount: Math.round(Number(fields.amountRaw) * 100) / 100, // whole cents, like bills
    planId: fields.planId,
    categoryName: plan ? plan.planName : (existing ? existing.categoryName : '') || '',
    notes: fields.notes.trim().slice(0, 200),
  };
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, values);
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `expense-${makeId()}`, ...values,
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    if (fields.recurId) { record.recurId = fields.recurId; record.recurDate = fields.recurDate; } // which repeating expense and date it logs
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// The first and last day keys of the month a date key is in (date keys sort as text, so day 31 covers every month).
function monthBounds(dateKey) {
  return [`${dateKey.slice(0, 8)}01`, `${dateKey.slice(0, 8)}31`];
}

// The total of the expenses dated from start to end (inclusive).
function sumExpensesIn(records, start, end) {
  return records.filter((r) => r.spentOn >= start && r.spentOn <= end).reduce((sum, r) => sum + r.amount, 0);
}

// How spending reads against its plan: from 80% of the plan (exactly 100% included) a note says how much is used,
// once more than the plan is spent the note says by how much; the class colours the line. Nothing when there is no
// plan or plenty is left. Compared in whole cents, because a weekly figure worked out from a monthly plan is not.
function spendStatus(spent, planned) {
  if (!(planned > 0)) return { note: '', cls: '' };
  const spentCents = Math.round(spent * 100);
  const plannedCents = Math.round(planned * 100);
  if (spentCents > plannedCents) return { note: ` · ${formatMoney((spentCents - plannedCents) / 100)} over`, cls: 'spend-over' };
  if (spentCents >= plannedCents * 0.8) return { note: ` · ${Math.round((spentCents / plannedCents) * 100)}% used`, cls: 'spend-near' };
  return { note: '', cls: '' };
}

// localStorage key for the Quick Add amounts hidden on this device, as { planId: [amounts] }.
const QUICK_HIDDEN_KEY = 'budgetApp.quickHidden.v1';
// Whether the Quick Add buttons are in "remove an amount" mode.
let quickEditMode = false;

// The hidden Quick Add amounts ({} when none or storage is blocked).
function loadQuickHidden() {
  try {
    const value = JSON.parse(localStorage.getItem(QUICK_HIDDEN_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Saves the hidden Quick Add amounts.
function saveQuickHidden(hidden) {
  try { localStorage.setItem(QUICK_HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* not saved: the amounts show again next time */ }
}

// Draws Quick Add: for each plan category, its last few different amounts as one-tap buttons (or, in edit mode, buttons
// that remove an amount). Amounts removed here are only hidden on this device; Show hidden amounts brings them back.
function renderQuickAdd(expenses) {
  const quickList = document.getElementById('expense-quick-list');
  quickList.innerHTML = '';
  const hidden = loadQuickHidden();
  planCategories().forEach((plan) => {
    const hiddenHere = Array.isArray(hidden[plan.id]) ? hidden[plan.id] : [];
    const recent = [];
    expenses.filter((r) => r.planId === plan.id).forEach((r) => {
      if (recent.length < MAX_QUICK_AMOUNTS && !recent.includes(r.amount) && !hiddenHere.includes(r.amount)) recent.push(r.amount);
    });
    if (!recent.length) return;
    const row = document.createElement('div');
    row.className = 'expense-quick-row';
    const label = document.createElement('strong');
    label.textContent = plan.planName;
    row.appendChild(label);
    recent.forEach((amount) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'expense-quick-btn';
      button.id = `quick-add-${plan.id}-${String(amount).replace('.', '_')}`; // a stable handle for each amount's button
      if (quickEditMode) {
        button.textContent = `✕ ${formatMoney(amount)}`;
        button.setAttribute('aria-label', `Remove ${formatMoney(amount)} from ${plan.planName} quick amounts`);
        button.addEventListener('click', () => {
          const next = loadQuickHidden();
          next[plan.id] = [...(Array.isArray(next[plan.id]) ? next[plan.id] : []), amount];
          saveQuickHidden(next);
          renderExpenses();
        });
      } else {
        button.textContent = formatMoney(amount);
        button.setAttribute('aria-label', `Log ${formatMoney(amount)} for ${plan.planName} today`);
        button.addEventListener('click', () => saveExpense({ dateKey: todayKey(), amountRaw: String(amount), planId: plan.id, notes: '' }));
      }
      row.appendChild(button);
    });
    quickList.appendChild(row);
  });
  document.getElementById('expense-quick-empty').hidden = quickList.children.length !== 0;
  document.getElementById('expense-quick-edit-btn').textContent = quickEditMode ? 'Done' : 'Edit amounts';
  document.getElementById('expense-quick-reset-btn').hidden = !Object.values(hidden).some((list) => Array.isArray(list) && list.length);
}

// Draws Spent vs Plan: each category's spending this week and this month against its plan (amber from 80%, red when
// over), its average per week once it has two weeks of entries (with a button to make that the plan), and the totals.
// Returns the rows so the charts can reuse the month's spending.
function renderSpentVsPlan(expenses) {
  const todayK = todayKey();
  const weekStart = weekStartKey(todayK);
  const weekEnd = shiftDateKey(weekStart, 6);
  const [monthStart, monthEnd] = monthBounds(todayK);
  const summaryList = document.getElementById('expense-summary-list');
  summaryList.innerHTML = '';
  const categories = planCategories();
  const rows = categories.map((plan) => ({
    plan, name: plan.planName, records: expenses.filter((r) => r.planId === plan.id),
    plannedWeek: planWeekly(plan.amount, plan.frequency), plannedMonth: planMonthly(plan.amount, plan.frequency),
  }));
  const knownIds = new Set(categories.map((plan) => plan.id));
  const orphans = expenses.filter((r) => !knownIds.has(r.planId));
  if (orphans.length) rows.push({ plan: null, name: 'Other (no plan category)', records: orphans, plannedWeek: null, plannedMonth: null });

  let totalWeek = 0; let totalMonth = 0; let plannedWeekAll = 0; let plannedMonthAll = 0;
  rows.forEach((row) => {
    const spentWeek = sumExpensesIn(row.records, weekStart, weekEnd);
    const spentMonth = sumExpensesIn(row.records, monthStart, monthEnd);
    row.spentMonth = spentMonth;
    totalWeek += spentWeek; totalMonth += spentMonth;
    if (row.plannedWeek !== null) { plannedWeekAll += row.plannedWeek; plannedMonthAll += row.plannedMonth; }

    const weekStatus = spendStatus(spentWeek, row.plannedWeek);
    const monthStatus = spendStatus(spentMonth, row.plannedMonth);
    const lines = [
      {
        text: (row.plannedWeek === null ? `This week: ${formatMoney(spentWeek)}` : `This week: ${formatMoney(spentWeek)} of ${formatMoney(row.plannedWeek)} planned`) + weekStatus.note,
        cls: weekStatus.cls,
      },
      {
        text: (row.plannedMonth === null ? `This month: ${formatMoney(spentMonth)}` : `This month: ${formatMoney(spentMonth)} of ${formatMoney(row.plannedMonth)} planned`) + monthStatus.note,
        cls: monthStatus.cls,
      },
    ];
    let useAverage = null;
    if (row.records.length) {
      // Only expenses up to today count: a future-dated one has not happened yet and would inflate the average.
      const sofar = row.records.filter((r) => r.spentOn <= todayK);
      const first = sofar.reduce((min, r) => (r.spentOn < min ? r.spentOn : min), todayK);
      const days = utcDayDiff(first, todayK) + 1;
      const total = sofar.reduce((sum, r) => sum + r.amount, 0);
      if (sofar.length && days >= MIN_AVERAGE_DAYS) {
        lines.push({ text: `Average so far: ${formatMoney((total / days) * 7)} per week (${formatMoney((total / days) * 52 / 12 * 7)} per month)`, cls: '' });
        if (row.plan) {
          const value = Math.round((row.plan.frequency === 'weekly' ? (total / days) * 7 : (total / days) * 52 / 12 * 7) * 100) / 100;
          if (value >= 0.01 && value !== row.plan.amount) useAverage = value;
        }
      } else {
        lines.push({ text: 'Average per week: needs two weeks of entries', cls: '' });
      }
    }

    const item = document.createElement('li');
    item.className = 'recurring-income-card';
    const info = document.createElement('div');
    info.className = 'recurring-income-info';
    const title = document.createElement('strong');
    title.className = 'recurring-income-name';
    title.textContent = row.name;
    info.appendChild(title);
    lines.forEach((line) => {
      const span = document.createElement('span');
      span.className = `recurring-income-start ${line.cls}`.trim();
      span.textContent = line.text;
      info.appendChild(span);
    });
    item.appendChild(info);
    if (useAverage !== null) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small-btn';
      button.textContent = `Use ${formatMoney(useAverage)} per ${row.plan.frequency === 'weekly' ? 'week' : 'month'} as my plan`;
      button.setAttribute('aria-label', `Set the ${row.name} plan to ${formatMoney(useAverage)} per ${row.plan.frequency === 'weekly' ? 'week' : 'month'}`);
      button.addEventListener('click', () => setPlanAmount(row.plan.id, useAverage));
      item.appendChild(button);
    }
    summaryList.appendChild(item);
  });
  document.getElementById('expense-summary-empty').hidden = rows.length !== 0;
  document.getElementById('expense-total-line').textContent = rows.length
    ? `Spent this week: ${formatMoney(totalWeek)} of ${formatMoney(plannedWeekAll)} planned. This month: ${formatMoney(totalMonth)} of ${formatMoney(plannedMonthAll)} planned.` : '';
  return rows;
}

// Draws the two charts: a bar per category for this month, and a column per week for the last 8 weeks. The bars are
// decoration (hidden from screen readers); the figures beside them say the same thing in text.
function renderExpenseCharts(expenses, rows) {
  const monthChart = document.getElementById('expense-month-chart');
  monthChart.innerHTML = '';
  const entries = rows.filter((row) => row.spentMonth > 0).sort((a, b) => b.spentMonth - a.spentMonth);
  const largest = entries.length ? entries[0].spentMonth : 0;
  entries.forEach((row) => {
    const item = document.createElement('li');
    item.className = 'chart-row';
    const name = document.createElement('span');
    name.className = 'chart-label';
    name.textContent = row.name;
    const track = document.createElement('span');
    track.className = 'chart-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'chart-fill';
    fill.style.width = `${Math.max(2, Math.round((row.spentMonth / largest) * 100))}%`;
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = formatMoney(row.spentMonth);
    item.append(name, track, value);
    monthChart.appendChild(item);
  });
  document.getElementById('expense-month-chart-empty').hidden = entries.length !== 0;

  const weekChart = document.getElementById('expense-week-chart');
  weekChart.innerHTML = '';
  const thisWeek = weekStartKey(todayKey());
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = shiftDateKey(thisWeek, -7 * i);
    weeks.push({ start, total: sumExpensesIn(expenses, start, shiftDateKey(start, 6)) });
  }
  const tallest = Math.max(...weeks.map((w) => w.total));
  weeks.forEach((week) => {
    const item = document.createElement('li');
    item.className = 'chart-col';
    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = formatMoney(week.total);
    const track = document.createElement('span');
    track.className = 'chart-vtrack';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'chart-vfill';
    fill.style.height = `${week.total > 0 ? Math.max(3, Math.round((week.total / tallest) * 100)) : 0}%`;
    track.appendChild(fill);
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = formatDateKeyShort(week.start);
    item.append(value, track, label);
    weekChart.appendChild(item);
  });
}

// Fills the "show category" filter with All plus the plan categories, keeping the choice.
function fillExpenseFilterSelect() {
  const select = document.getElementById('expense-filter-category');
  const keep = select.value;
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All categories';
  select.appendChild(all);
  planCategories().forEach((plan) => {
    const option = document.createElement('option');
    option.value = plan.id;
    option.textContent = plan.planName;
    select.appendChild(option);
  });
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}

// Draws Recent Expenses: the expenses that pass the filters (category, dates, note search), newest first, each with
// Edit and Delete, and a line saying how many are shown and what they add up to.
function renderExpenseList(expenses) {
  fillExpenseFilterSelect();
  const category = document.getElementById('expense-filter-category').value;
  const from = document.getElementById('expense-filter-from').value;
  const to = document.getElementById('expense-filter-to').value;
  const search = document.getElementById('expense-filter-search').value.trim().toLowerCase();
  const filtering = !!(category || from || to || search);
  const shown = expenses.filter((r) => (!category || r.planId === category)
    && (!from || r.spentOn >= from) && (!to || r.spentOn <= to)
    && (!search || (r.notes || '').toLowerCase().includes(search) || expenseCategoryName(r).toLowerCase().includes(search)));

  const list = document.getElementById('expense-list');
  const template = document.getElementById('expense-card-template');
  list.innerHTML = '';
  shown.slice(0, MAX_EXPENSES_SHOWN).forEach((record) => {
    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = record.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const dateBox = node.querySelector('.expense-edit-date');
    const amountBox = node.querySelector('.expense-edit-amount');
    const categoryBox = node.querySelector('.expense-edit-category');
    const notesBox = node.querySelector('.expense-edit-notes');
    const errorEl = node.querySelector('.expense-edit-error');
    const editBtn = node.querySelector('.edit-btn');
    const deleteBtn = node.querySelector('.delete-btn');
    const cancelBtn = node.querySelector('.cancel-btn');
    const categoryName = expenseCategoryName(record);

    node.querySelector('.recurring-income-name').textContent = `${formatDateKeyShort(record.spentOn)} · ${categoryName}`;
    node.querySelector('.recurring-income-amount').textContent = formatMoney(record.amount);
    const noteEl = node.querySelector('.expense-note');
    if (record.notes) { noteEl.textContent = record.notes; noteEl.hidden = false; }
    editBtn.setAttribute('aria-label', `Edit ${categoryName} expense on ${formatDateKeyShort(record.spentOn)}`);
    deleteBtn.setAttribute('aria-label', `Delete ${categoryName} expense on ${formatDateKeyShort(record.spentOn)}`);

    editBtn.addEventListener('click', () => {
      dateBox.value = record.spentOn;
      amountBox.value = String(record.amount);
      fillExpenseCategorySelect(categoryBox, record.planId, record.categoryName);
      notesBox.value = record.notes || '';
      errorEl.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      amountBox.focus();
    });
    cancelBtn.addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      editForm.hidden = true; // closed before saving, so the redraw after a save does not reopen it
      viewSection.hidden = false;
      const problem = saveExpense({
        dateKey: dateBox.value, amountRaw: amountBox.value, planId: categoryBox.value, notes: notesBox.value,
      }, record.id);
      if (problem) {
        viewSection.hidden = true;
        editForm.hidden = false;
        errorEl.textContent = problem;
        errorEl.hidden = false;
      }
    });
    deleteBtn.addEventListener('click', () => deleteIncome(record.id));
    list.appendChild(node);
  });

  document.getElementById('expense-empty-state').hidden = expenses.length !== 0;
  const total = shown.reduce((sum, r) => sum + r.amount, 0);
  document.getElementById('expense-filter-total').textContent = !expenses.length ? ''
    : filtering ? `Showing ${shown.length} of ${expenses.length} expense${expenses.length === 1 ? '' : 's'}, ${formatMoney(total)} in total.`
      : `${expenses.length} expense${expenses.length === 1 ? '' : 's'}, ${formatMoney(total)} in total.`;
  const noteLine = document.getElementById('expense-list-note');
  noteLine.hidden = shown.length <= MAX_EXPENSES_SHOWN;
  noteLine.textContent = `Showing the newest ${MAX_EXPENSES_SHOWN} of ${shown.length} expenses.`;
}

// Draws the whole Expenses tab: Quick Add, the log form's category list, Spent vs Plan, the charts and the recent list.
function renderExpenses() {
  const openForms = captureOpenCardForms(['expense-list', 'repeat-list']); // the list is rebuilt, so an open Edit form is kept
  const sel = document.getElementById('expense-category-input');
  fillExpenseCategorySelect(sel, sel.value || loadLastChoice(LAST_EXPENSE_CATEGORY_KEY));
  const expenses = expenseRecords();
  renderQuickAdd(expenses);
  const rows = renderSpentVsPlan(expenses);
  renderExpenseCharts(expenses, rows);
  renderExpenseList(expenses);
  renderRepeats();
  renderBusinessSummary();
  restoreOpenCardForms(openForms);
}

// The Quick Add edit and reset buttons, and the filter boxes (they redraw only the Expenses tab, so typing in the
// search box never loses focus).
document.getElementById('expense-quick-edit-btn').addEventListener('click', () => { quickEditMode = !quickEditMode; renderExpenses(); });
document.getElementById('expense-quick-reset-btn').addEventListener('click', () => { saveQuickHidden({}); renderExpenses(); });
['expense-filter-category', 'expense-filter-from', 'expense-filter-to', 'expense-filter-search'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderExpenses);
});
document.getElementById('expense-filter-clear').addEventListener('click', () => {
  ['expense-filter-category', 'expense-filter-from', 'expense-filter-to', 'expense-filter-search'].forEach((id) => { document.getElementById(id).value = ''; });
  renderExpenses();
});

// Log-an-expense form: validate, save, and clear the amount and note when it worked (the date and category stay,
// since several purchases in a row are usually the same day or kind).
document.getElementById('expense-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('expense-form-error');
  const problem = saveExpense({
    dateKey: document.getElementById('expense-date-input').value,
    amountRaw: document.getElementById('expense-amount-input').value,
    planId: document.getElementById('expense-category-input').value,
    notes: document.getElementById('expense-notes-input').value,
  });
  if (problem) { errorEl.textContent = problem; errorEl.hidden = false; return; }
  errorEl.hidden = true;
  saveLastChoice(LAST_EXPENSE_CATEGORY_KEY, document.getElementById('expense-category-input').value);
  document.getElementById('expense-amount-input').value = '';
  document.getElementById('expense-notes-input').value = '';
  document.getElementById('expense-amount-input').focus();
});

// ---- Repeating expenses (costs that come around again; logged with one tap when due) ----
// A repeating expense is a record in the `income` list, { id: 'rexp-<id>', recurPlanId (a Spending Plan category),
// amount, frequency, recurStart (the first date), notes, skippedDates, ...sync fields }, so it syncs and undoes like
// the other kinds with no change to the sync server. Nothing logs itself: each due date is offered on the Expenses
// tab, and Log it records an ordinary expense carrying { recurId, recurDate } so that date is not offered again;
// Skip remembers the date in skippedDates. Only the last REPEAT_LOOKBACK_DAYS days are offered, so a repeat left
// alone for months does not bury you in old dates. Two devices that both log the same date before syncing make two
// expenses, which the Recent Expenses list lets you delete.

// The ways a repeating expense can come around.
const REPEAT_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
// How far back an unlogged date is still offered.
const REPEAT_LOOKBACK_DAYS = 45;

// The live repeating expenses, by category name.
function repeatRecords() {
  return income.filter((r) => r.recurPlanId && !r.deleted)
    .sort((a, b) => expenseCategoryName({ planId: a.recurPlanId, categoryName: '' }).localeCompare(expenseCategoryName({ planId: b.recurPlanId, categoryName: '' })));
}

// Checks the Add / Edit repeating expense fields and returns the first problem as a sentence ('' when they are fine).
function repeatFieldsError(fields) {
  if (!fields.planId || !income.some((r) => r.id === fields.planId && r.planName && !r.deleted)) return 'Choose a category (add one on the Plan tab first).';
  const amount = Number(fields.amountRaw);
  if (fields.amountRaw === '' || !Number.isFinite(amount) || amount < 0.01 || amount > MAX_MONEY) return 'Enter an amount of at least $0.01 and up to $1,000,000,000.';
  if (!REPEAT_FREQUENCIES.includes(fields.frequency)) return 'Choose how often it repeats.';
  if (!fields.start) return 'Pick the first date.';
  if (!isRealDateKey(fields.start) || !isReasonableDateKey(fields.start)) return DATE_RANGE_MESSAGE;
  return '';
}

// Adds a repeating expense, or changes the one with `id`. Returns the problem as a sentence, or '' when it was saved.
function saveRepeat(fields, id) {
  const error = repeatFieldsError(fields);
  if (error) return error;
  const values = {
    recurPlanId: fields.planId,
    amount: Math.round(Number(fields.amountRaw) * 100) / 100, // whole cents, like bills
    frequency: fields.frequency,
    recurStart: fields.start,
    notes: fields.notes.trim().slice(0, 200),
  };
  const existing = id ? income.find((r) => r.id === id && r.recurPlanId) : null;
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, values);
    stampSync(existing);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', existing.id, before, structuredClone(existing));
  } else {
    const now = new Date().toISOString();
    const record = {
      id: `rexp-${makeId()}`, ...values, skippedDates: [],
      dateAdded: now, updatedAt: now,
      deviceId: getDeviceId(), deleted: false, version: 0,
    };
    income.push(record);
    saveCollection(INCOME_KEY, income);
    recordUndo('income', record.id, null, structuredClone(record));
  }
  renderBudget();
  return '';
}

// The dates a repeating expense has come due in the last REPEAT_LOOKBACK_DAYS days (today included) that have not
// been logged or skipped, oldest first, as { repeat, dateKey }.
function dueRepeats() {
  const todayK = todayKey();
  const due = [];
  repeatRecords().forEach((repeat) => {
    // Only a live plan category can be logged against: a repeat whose category was deleted waits (and can be edited).
    if (!income.some((r) => r.id === repeat.recurPlanId && r.planName && !r.deleted)) return;
    const schedule = { dueDate: repeat.recurStart, frequency: repeat.frequency };
    const logged = new Set(income.filter((r) => r.recurId === repeat.id && !r.deleted).map((r) => r.recurDate));
    for (let back = REPEAT_LOOKBACK_DAYS; back >= 0; back -= 1) {
      const dateKey = shiftDateKey(todayK, -back);
      if (occursOnDate(schedule, dateKey) && !logged.has(dateKey) && !(repeat.skippedDates || []).includes(dateKey)) due.push({ repeat, dateKey });
    }
  });
  return due.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// Logs one due date of a repeating expense as an expense dated that day. Returns the problem as a sentence, or ''.
function logRepeat(repeatId, dateKey) {
  const repeat = income.find((r) => r.id === repeatId && r.recurPlanId && !r.deleted);
  if (!repeat) return 'That repeating expense is gone.';
  return saveExpense({ dateKey, amountRaw: String(repeat.amount), planId: repeat.recurPlanId, notes: repeat.notes, recurId: repeat.id, recurDate: dateKey });
}

// Skips one due date of a repeating expense (it is not offered again), as one Undo step.
function skipRepeat(repeatId, dateKey) {
  const repeat = income.find((r) => r.id === repeatId && r.recurPlanId && !r.deleted);
  if (!repeat) return;
  const before = structuredClone(repeat);
  repeat.skippedDates = [...new Set([...(repeat.skippedDates || []), dateKey])].sort();
  stampSync(repeat);
  saveCollection(INCOME_KEY, income);
  recordUndo('income', repeat.id, before, structuredClone(repeat));
  renderBudget();
}

// How often a repeating expense comes around, in words.
function repeatWhen(repeat) {
  const label = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' }[repeat.frequency];
  return `${label}, from ${formatDateKeyShort(repeat.recurStart)}`;
}

// Draws the Repeating Expenses fold: the dates due now (Log it / Skip) and the repeating expenses themselves.
function renderRepeats() {
  const dueList = document.getElementById('repeat-due-list');
  dueList.innerHTML = '';
  dueRepeats().forEach(({ repeat, dateKey }) => {
    const name = expenseCategoryName({ planId: repeat.recurPlanId, categoryName: '' });
    const row = document.createElement('li');
    row.className = 'repeat-due';
    const label = document.createElement('span');
    label.textContent = `${name} · ${formatDateKeyShort(dateKey)} · ${formatMoney(repeat.amount)} due`;
    const logBtn = document.createElement('button');
    logBtn.type = 'button';
    logBtn.className = 'small-btn';
    logBtn.textContent = 'Log it';
    logBtn.setAttribute('aria-label', `Log ${formatMoney(repeat.amount)} for ${name} on ${formatDateKeyShort(dateKey)}`);
    logBtn.addEventListener('click', () => logRepeat(repeat.id, dateKey));
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'small-btn';
    skipBtn.textContent = 'Skip';
    skipBtn.setAttribute('aria-label', `Skip ${name} on ${formatDateKeyShort(dateKey)}`);
    skipBtn.addEventListener('click', () => skipRepeat(repeat.id, dateKey));
    row.append(label, logBtn, skipBtn);
    dueList.appendChild(row);
  });

  const list = document.getElementById('repeat-list');
  const template = document.getElementById('repeat-card-template');
  list.innerHTML = '';
  const records = repeatRecords();
  records.forEach((repeat) => {
    const node = template.content.cloneNode(true);
    node.firstElementChild.dataset.recordId = repeat.id;
    const viewSection = node.querySelector('.recurring-income-view');
    const editForm = node.querySelector('.recurring-income-edit-form');
    const editError = node.querySelector('.repeat-edit-error');
    const name = expenseCategoryName({ planId: repeat.recurPlanId, categoryName: '' });
    node.querySelector('.recurring-income-name').textContent = name;
    node.querySelector('.repeat-amount').textContent = formatMoney(repeat.amount);
    node.querySelector('.repeat-when').textContent = repeatWhen(repeat);
    const notesEl = node.querySelector('.repeat-notes');
    if (repeat.notes) { notesEl.textContent = repeat.notes; notesEl.hidden = false; }
    node.querySelector('.edit-btn').setAttribute('aria-label', `Edit repeating ${name}`);
    node.querySelector('.delete-btn').setAttribute('aria-label', `Delete repeating ${name}`);

    // Elements are captured now: once the fragment is appended it is empty, so node.querySelector would find nothing.
    const categoryBox = node.querySelector('.repeat-edit-category');
    const amountBox = node.querySelector('.repeat-edit-amount');
    const frequencyBox = node.querySelector('.repeat-edit-frequency');
    const startBox = node.querySelector('.repeat-edit-start');
    const notesBox = node.querySelector('.repeat-edit-notes');
    node.querySelector('.edit-btn').addEventListener('click', () => {
      fillExpenseCategorySelect(categoryBox, repeat.recurPlanId, '');
      amountBox.value = String(repeat.amount);
      frequencyBox.value = repeat.frequency;
      startBox.value = repeat.recurStart;
      notesBox.value = repeat.notes || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
      amountBox.focus();
    });
    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      editForm.hidden = true; // closed before saving, so the redraw after a save does not reopen it
      viewSection.hidden = false;
      const problem = saveRepeat({ planId: categoryBox.value, amountRaw: amountBox.value, frequency: frequencyBox.value, start: startBox.value, notes: notesBox.value }, repeat.id);
      if (problem) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = problem;
        editError.hidden = false;
      }
    });
    node.querySelector('.delete-btn').addEventListener('click', () => deleteIncome(repeat.id));
    list.appendChild(node);
  });
  document.getElementById('repeat-empty-state').hidden = records.length !== 0;
  const addCategory = document.getElementById('repeat-category-input');
  fillExpenseCategorySelect(addCategory, addCategory.value, '');
}

// Add repeating expense form: validate, save, and clear the amount and note when it worked.
document.getElementById('repeat-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('repeat-form-error');
  const problem = saveRepeat({
    planId: document.getElementById('repeat-category-input').value,
    amountRaw: document.getElementById('repeat-amount-input').value,
    frequency: document.getElementById('repeat-frequency-input').value,
    start: document.getElementById('repeat-start-input').value,
    notes: document.getElementById('repeat-notes-input').value,
  });
  if (problem) { errorEl.textContent = problem; errorEl.hidden = false; return; }
  errorEl.hidden = true;
  document.getElementById('repeat-amount-input').value = '';
  document.getElementById('repeat-notes-input').value = '';
});

// The first date of a new repeating expense starts on today.
document.getElementById('repeat-start-input').value = todayKey();

// ---- Business summary and the expenses spreadsheet (CSV) ----
// A Spending Plan category is marked Business or Personal on the Plan tab, and each expense belongs to a category, so
// an expense is Business or Personal by its category (an expense whose category was deleted counts as Personal when
// the category cannot be found at all). The summary adds them up for a period, and the CSV lists every expense in it
// for a spreadsheet or a tax preparer. Nothing is stored: it is worked out from the expenses each time.

// The periods the summary can show, as { value, label }.
const SUMMARY_PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'lastYear', label: 'Last year' },
];

// The first and last day keys of a summary period (see SUMMARY_PERIODS), counted from today.
function summaryPeriodBounds(kind) {
  const today = parseDateKey(todayKey());
  if (kind === 'year') return [`${today.y}-01-01`, `${today.y}-12-31`];
  if (kind === 'lastYear') return [`${today.y - 1}-01-01`, `${today.y - 1}-12-31`];
  if (kind === 'lastMonth') {
    // A Date rolls January back into December of the year before; a hand-built key would say month 0.
    return monthBounds(dateKeyFromLocalDate(new Date(today.y, today.m - 1, 1)));
  }
  return monthBounds(todayKey());
}

// Whether an expense is a Business one, by its Spending Plan category.
function isBusinessExpense(expense) {
  const plan = income.find((r) => r.id === expense.planId && r.planName);
  return !!(plan && plan.business);
}

// The live expenses dated within a summary period, oldest first.
function expensesInSummaryPeriod(kind) {
  const [start, end] = summaryPeriodBounds(kind);
  return expenseRecords().filter((r) => r.spentOn >= start && r.spentOn <= end).sort((a, b) => a.spentOn.localeCompare(b.spentOn));
}

// One cell of a CSV line: wrapped in quotes with inner quotes doubled, and a text that starts with =, +, - or @ gets a
// leading apostrophe so a spreadsheet shows it as text instead of running it as a formula.
function csvCell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// The spreadsheet text for a list of expenses: a header line, then date, category, Business or Personal, amount, note.
function buildExpenseCsv(expenses) {
  const lines = [['Date', 'Category', 'Type', 'Amount', 'Note'].map(csvCell).join(',')];
  expenses.forEach((r) => {
    lines.push([r.spentOn, expenseCategoryName(r), isBusinessExpense(r) ? 'Business' : 'Personal', r.amount.toFixed(2), r.notes || ''].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

// Draws the Business Summary fold for the chosen period: the totals, the Business categories, and the CSV button.
function renderBusinessSummary() {
  const kind = document.getElementById('business-period-input').value || 'month';
  const expenses = expensesInSummaryPeriod(kind);
  const business = expenses.filter(isBusinessExpense);
  const businessTotal = business.reduce((sum, r) => sum + r.amount, 0);
  const total = expenses.reduce((sum, r) => sum + r.amount, 0);
  document.getElementById('business-total-line').textContent = expenses.length
    ? `Business: ${formatMoney(businessTotal)} · Personal: ${formatMoney(total - businessTotal)} · Total: ${formatMoney(total)} (${expenses.length} expense${expenses.length === 1 ? '' : 's'}).`
    : '';
  const byCategory = new Map();
  business.forEach((r) => byCategory.set(expenseCategoryName(r), (byCategory.get(expenseCategoryName(r)) || 0) + r.amount));
  const list = document.getElementById('business-category-list');
  list.innerHTML = '';
  [...byCategory.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, amount]) => {
    const row = document.createElement('li');
    row.textContent = `${name}: ${formatMoney(amount)}`;
    list.appendChild(row);
  });
  document.getElementById('business-empty').hidden = expenses.length !== 0;
  document.getElementById('business-csv-btn').disabled = expenses.length === 0;
}

// Downloads the expenses of the chosen period as a CSV file.
function downloadExpenseCsv() {
  const select = document.getElementById('business-period-input');
  const expenses = expensesInSummaryPeriod(select.value || 'month');
  if (!expenses.length) return;
  const label = SUMMARY_PERIODS.find((p) => p.value === select.value);
  downloadBlob(new Blob([buildExpenseCsv(expenses)], { type: 'text/csv' }), `budget-expenses-${(label ? label.label : 'this month').toLowerCase().replace(/\s+/g, '-')}-${todayKey()}.csv`);
}

// The period choices, filled once, and the summary redrawing when the choice changes or the button is pressed.
(function initBusinessSummary() {
  const select = document.getElementById('business-period-input');
  SUMMARY_PERIODS.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.value;
    option.textContent = p.label;
    select.appendChild(option);
  });
  select.addEventListener('change', renderBusinessSummary);
  document.getElementById('business-csv-btn').addEventListener('click', downloadExpenseCsv);
})();

// The expense date starts on today.
document.getElementById('expense-date-input').value = todayKey();

// The Today buttons next to the date boxes put today's date back in the box they name.
document.querySelectorAll('.today-btn').forEach((button) => {
  button.addEventListener('click', () => { document.getElementById(button.dataset.dateInput).value = todayKey(); });
});

// ---- Backup reminders ----
// The sync server's copy is temporary (the free plan forgets it whenever the server sleeps or redeploys), so
// the real copy of your data is on your devices, and a downloaded backup file is the safety net if all of
// them are lost. Browsers can't write files in the background, so the app remembers when the last backup
// was made and reminds you when it is overdue.

// Where the time of the last full export is remembered, and how many days before a reminder.
const EXPORT_AT_KEY = 'budgetApp.exportAt.v1';
// Days after the last full export before the app reminds you to download another.
const EXPORT_DUE_DAYS = 7;

// Remembers, under the given key, the moment a backup was made or a sync finished.
function recordBackupTime(key) {
  try { localStorage.setItem(key, new Date().toISOString()); } catch { /* storage full: nothing to remember it in */ }
}

// Whole days since the time stored under this key (a backup or a sync), or null if none is stored.
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
  // Never exported, or not for a week: the sync server forgets its data, so a backup file is the only safe copy.
  // Where the phone can share a file, the button shares it in one tap; otherwise it downloads it.
  if (hasAnyData && (exportDays === null || exportDays >= EXPORT_DUE_DAYS)) {
    reminders.push({
      text: `You haven't saved a full backup of your budget ${exportDays === null ? 'yet' : `in ${exportDays} days`}. It keeps your data safe if this device is lost.`,
      label: CAN_SHARE_FILES ? 'Share backup' : 'Download full backup',
      action: CAN_SHARE_FILES ? shareBackup : exportData,
    });
  }
  // Syncing is manual, so nudge when it has been a while (only on devices where sync is set up). Before the first
  // sync the clock starts when sync was first noticed, kept under its own key: LAST_SYNC_AT_KEY must stay empty
  // until a sync really happens, because the top bar reads it as "Synced ... ago".
  if (loadSyncConfig()) {
    const lastSyncDays = daysSinceBackup(LAST_SYNC_AT_KEY);
    if (lastSyncDays === null && daysSinceBackup(SYNC_NOTICED_AT_KEY) === null) recordBackupTime(SYNC_NOTICED_AT_KEY);
    const syncDays = lastSyncDays === null ? daysSinceBackup(SYNC_NOTICED_AT_KEY) : lastSyncDays;
    if (syncDays !== null && syncDays >= SYNC_STALE_DAYS) {
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

  // Due soon: unpaid occurrences today and on each of the next REMINDER_BANNER_DAYS days.
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
    `${bill.name} ${formatMoney(bill.amount)} ${whenLabel(daysUntilDateKey(dateKey))}`);
  if (overdueBills.length > 0) {
    const total = overdueBills.reduce((sum, x) => sum + x.amount, 0);
    parts.push(`${overdueBills.length} overdue (${formatMoney(total)})`);
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
  const targets = soon.slice(0, BANNER_PAY_BUTTONS);
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
  if (undoStack.length === 0) { hideUndoToast(); return; }
  const entry = undoStack[undoStack.length - 1]; // only taken off the list once it has been applied
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'before');
  } finally {
    isApplyingHistory = false;
  }
  undoStack.pop();
  redoStack.push(entry);
  if (redoStack.length > MAX_UNDO_DEPTH) redoStack.shift();
  updateUndoRedoButtons();
  hideUndoToast();
}

// Re-applies the most recently undone change.
function redo() {
  if (redoStack.length === 0) return;
  const entry = redoStack[redoStack.length - 1]; // only taken off the list once it has been applied
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'after');
  } finally {
    isApplyingHistory = false;
  }
  redoStack.pop();
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  updateUndoRedoButtons();
  hideUndoToast();
}

// The field that names a record in each list, for the Undo/Redo tooltips; describeEntry falls back to the
// kind-specific name fields of the other records in the income list (projected date, plan, expected cost, goal,
// savings, expense category or date).
const RECORD_LABEL_FIELD = {
  bills: 'name', income: 'dateKey', recurringIncome: 'name',
};

// Plain-English summary of an undo entry, e.g. "deleted 'Rent'", for the button tooltips.
function describeEntry(entry) {
  const labelField = RECORD_LABEL_FIELD[entry.collection];
  const source = entry.after || entry.before;
  const identifier = source && labelField ? (source[labelField] || source.projectedFor || source.planName || source.guessName || source.goalName || source.itemName || (source.adjustWeek ? 'carry-forward' : '') || (source.recurPlanId ? 'repeating expense' : '') || (source.savedFor ? 'savings' : '') || source.categoryName || source.spentOn) : null;
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
// A short bar at the bottom of the screen after a delete, a Mark paid or unpaid, a new bill, recurring income,
// expected cost, savings goal or savings entry, a logged expense, or a changed Spending Plan amount, with an Undo
// button, so a mis-tap (or a one-tap Quick Add) can be fixed without opening the Menu. Other edits get no toast.

// How long the toast stays before it hides itself.
const UNDO_TOAST_MS = 6000;
// var, not let: recordUndo (far above) can reach hideUndoToast before this line has run.
var undoToastTimer = null;

// What the toast should say about a change, or null when the change does not get one.
function undoToastMessage(collectionName, before, after) {
  if (!after) return null;
  const name = after.name || 'item';
  if (!before) {
    if (after.spentOn) return `Logged ${formatMoney(after.amount)} for ${after.categoryName || 'expense'}`;
    if (after.guessName) return `Added expected cost ${after.guessName}`;
    if (after.goalName) return `Added goal ${after.goalName}`;
    if (after.goalItemFor) return `Added cost ${after.itemName}`;
    if (after.adjustWeek) return 'Adjusted the amount carried forward';
    if (after.recurPlanId) return 'Added a repeating expense';
    if (after.savedFor) {
      const goal = income.find((r) => r.id === after.savedFor);
      return `${after.amount < 0 ? 'Took out' : 'Saved'} ${formatMoney(Math.abs(after.amount))}${goal ? ` ${after.amount < 0 ? 'from' : 'toward'} ${goal.goalName}` : ''}`;
    }
    return collectionName === 'income' ? null : `Added ${name}`;
  }
  if (after.projectedFor && after.deleted && !before.deleted) return 'Deleted projected income';
  if (after.dateKey && after.deleted && !before.deleted) return 'Deleted income';
  if (after.planName && after.deleted && !before.deleted) return `Deleted ${after.planName}`;
  if (after.spentOn && after.deleted && !before.deleted) return 'Deleted expense';
  if (after.guessName && after.deleted && !before.deleted) return `Deleted ${after.guessName}`;
  if (after.goalName && after.deleted && !before.deleted) return `Deleted goal ${after.goalName}`;
  if (after.goalItemFor && after.deleted && !before.deleted) return `Removed cost ${after.itemName}`;
  if (after.savedFor && after.deleted && !before.deleted) return 'Removed a savings entry';
  if (after.adjustWeek && after.deleted && !before.deleted) return 'Removed the carry-forward adjustment';
  if (after.recurPlanId && after.deleted && !before.deleted) return 'Deleted a repeating expense';
  if (after.recurPlanId && (after.skippedDates || []).length > (before.skippedDates || []).length) return 'Skipped a repeating expense';
  if (after.adjustWeek && !after.deleted && after.amount !== before.amount) return 'Changed the carry-forward adjustment';
  if (after.planName && !after.deleted && after.amount !== before.amount) {
    return `Changed ${after.planName} to ${formatMoney(after.amount)} per ${after.frequency === 'weekly' ? 'week' : 'month'}`;
  }
  if (collectionName !== 'income' && after.deleted && !before.deleted) return `Deleted ${name}`;
  if (collectionName === 'bills') {
    const paidBefore = (before.paidDates || []).length;
    const paidNow = (after.paidDates || []).length;
    if (paidNow > paidBefore) {
      const added = (after.paidDates || []).find((dateKey) => !(before.paidDates || []).includes(dateKey));
      return after.paidAmounts && after.paidAmounts[added] === 0 ? `Skipped ${name}` : `Marked ${name} paid`;
    }
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

// Sync progress state: whether a sync is running, when the last one finished, and whether its message was
// ok/failed.
let syncInFlight = false;
let lastSyncedAt = null; // when the last sync finished (drives the "Synced Xm ago" label)
// When the server last answered a sync, also saved so the backup notes can warn when it has been too long.
const LAST_SYNC_AT_KEY = 'budgetApp.lastSyncAt.v1';
// When this device first noticed sync was set up but never run, so the "you haven't synced" reminder can count days.
const SYNC_NOTICED_AT_KEY = 'budgetApp.syncNoticedAt.v1';
const SYNC_STALE_DAYS = 7; // days without a sync before the reminder shows
const SYNC_NUDGE_DAYS = 3; // days without a sync before the top-bar Sync button is highlighted
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

// When the last sync finished, read back from storage so it is still known after the page is reloaded (null if never).
function lastSyncTime() {
  try {
    const value = localStorage.getItem(LAST_SYNC_AT_KEY);
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

// How long ago a time was, in words: "just now", "5m ago", "3h ago", "2 days ago".
function formatAgo(date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} day${days === 1 ? '' : 's'} ago`;
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
  const last = lastSyncedAt || lastSyncTime();
  const stale = !!last && Date.now() - last.getTime() >= SYNC_NUDGE_DAYS * 86400000;
  btn.classList.toggle('sync-needed', needsSync || stale);
  let text = 'Not synced yet';
  if (syncInFlight) {
    text = 'Syncing…';
  } else if (failed) {
    text = 'Needs attention — see Menu';
  } else if (needsSync) {
    text = `${unsynced} change${unsynced === 1 ? '' : 's'} not synced`;
  } else if (last) {
    text = `Synced ${formatAgo(last)}`;
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
      // clientVersion is the sync protocol this app speaks; the server refuses clients older than it requires.
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
// fails the first request while it wakes up). A wrong passphrase, an out-of-date copy or a timeout is never
// retried (a timeout has already waited the full SYNC_TIMEOUT_MS). A second failure is thrown (or returned
// as 'error') for runSync to report.
async function postSyncWithRetry(config, collections) {
  let first;
  try {
    first = await postSync(config, collections);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
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
        // Kept as the newer edit, but built on the server's version: sent with an older one, the server would
        // take it for a conflicting edit and keep both copies.
        merged.push({ ...local, version: Math.max(local.version || 0, server.version || 0) });
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
    safeRender(c.render);
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
//    keep ours and re-send it, unless the server's copy is a newer delete (then take the delete).
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
      // The server holds a delete that is newer than this device's last edit of the record: take the delete, or
      // sending our live copy again would bring a deleted record back.
      if (server.deleted && !local.deleted && JSON.stringify(local) === preFlightMap[local.id]
          && (local.updatedAt || '') <= (server.updatedAt || '')) {
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
        setSyncStatus('This copy is out of date. Wait for the update bar at the top, tap Update now, then Sync again.', 'failed');
        checkForNewVersion();
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
        setSyncStatus('This copy is out of date. Wait for the update bar at the top, tap Update now, then Sync again.', 'failed');
        checkForNewVersion();
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
    if (collectedConflicts.length > 0) {
      const collectionNames = [...new Set(collectedConflicts.map((c) => c.collection))]
        .map((name) => SYNC_COLLECTIONS.find((c) => c.name === name)?.label || name);
      const noun = collectedConflicts.length === 1 ? 'conflict' : 'conflicts';
      setSyncStatus(
        `Synced — ${collectedConflicts.length} ${noun} merged as duplicates in ${collectionNames.join(', ')}. Review and remove any you don't need.`,
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
  setSyncStatus(`Synced ${formatAgo(lastSyncedAt)}`, 'ok');
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
  if (config) {
    const last = lastSyncTime();
    setSyncStatus(last ? `Last synced ${formatAgo(last)}. Tap Sync now to sync again.` : 'Not synced yet — tap Sync now', null);
  }
  updateSyncPending();
}

// ---- Data export / import ----
// Import's merge mirrors the sync server's merge_collection()/_content_matches(), so a restore behaves
// like a sync conflict: a replay of the same data is a no-op, a deleted record stays deleted, and a
// genuine conflict keeps both sides.
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

// Saves a file to the device by clicking a temporary link to it. The link is kept for a while: revoking it at once can
// cancel the download on iOS/Safari.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Downloads the full backup (the three lists plus the payday settings) as one JSON file.
function exportData() {
  recordBackupTime(EXPORT_AT_KEY);
  const json = JSON.stringify(buildExportPayload(), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), `budget-export-${todayKey()}.json`); // the local date, not the UTC one
  setDataIoStatus('Backup downloaded. Keep the file somewhere private.', 'ok');
  renderBackupNotes();
}

// True where the browser can hand a file to the phone's share sheet (Files, Drive, email, messages...).
const CAN_SHARE_FILES = (() => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'budget.json', { type: 'application/json' })] })); } catch { return false; }
})();

// Shares the full backup through the share sheet instead of downloading it. Cancelling the sheet is not an error.
async function shareBackup() {
  const file = new File([JSON.stringify(buildExportPayload(), null, 2)], `budget-export-${todayKey()}.json`, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'Budget backup' });
    recordBackupTime(EXPORT_AT_KEY);
    setDataIoStatus('Backup shared. Keep the file somewhere private.', 'ok');
    renderBackupNotes();
  } catch (err) {
    if (!err || err.name !== 'AbortError') setDataIoStatus('Could not share the backup. Use Export data instead.', 'failed');
  }
}

// ---- Calendar reminders (.ics) ----
// A calendar file with each bill as a repeating all-day event (and, unless it pays itself, an alert at 9am the day
// before), so the phone's own calendar can remind you with no server. It cannot know what is paid, so each bill
// starts at its next unpaid date. Importing it again updates the same events in most calendar apps.

// Escapes text for an .ics field.
function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

// Folds a long line the way calendar files require: lines of at most 70 bytes of text (under the 75-byte limit), each continuation starting
// with a space. It counts bytes (not characters) and never splits one character, so names with accents or
// emoji survive.
function icsFold(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const character of line) { // iterates whole characters, not UTF-16 halves
    const size = encoder.encode(character).length;
    if (bytes + size > 70) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

// The repeat rule for a bill, or null for a one-time bill (or an unreadable custom one). A custom bill repeats every
// N weeks (FREQ=WEEKLY;INTERVAL=N) or N months (FREQ=MONTHLY;INTERVAL=N, with the same day-of-month rules as
// monthly). A bill due on the 31st repeats on each month's last day (like the calendar on screen); the 29th and
// 30th are skipped by calendars in months without them, and a yearly bill due on February 29 only repeats in
// leap years. The file only holds each bill's next unpaid date within a year: a one-time bill or a custom
// schedule further out than that is left out.
function icsRepeatRule(bill) {
  const day = parseDateKey(bill.dueDate).d;
  if (bill.frequency === 'weekly') return 'FREQ=WEEKLY';
  if (bill.frequency === 'biweekly') return 'FREQ=WEEKLY;INTERVAL=2';
  if (bill.frequency === 'custom') {
    if (!schedulePeriod(bill)) return null;
    if (bill.unit === 'weeks') return `FREQ=WEEKLY;INTERVAL=${bill.every}`;
    if (day <= 28) return `FREQ=MONTHLY;INTERVAL=${bill.every}`;
    return `FREQ=MONTHLY;INTERVAL=${bill.every};BYMONTHDAY=${day === 31 ? -1 : day}`;
  }
  if (bill.frequency === 'yearly') return 'FREQ=YEARLY';
  if (bill.frequency === 'monthly') {
    if (day <= 28) return 'FREQ=MONTHLY';
    return day === 31 ? 'FREQ=MONTHLY;BYMONTHDAY=-1' : `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  }
  return null;
}

// The text of the calendar file, or null when no bill has an upcoming date.
function buildCalendarFile() {
  const todayK = todayKey();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const events = [];
  bills.filter((b) => !b.deleted).forEach((bill) => {
    let start = null;
    for (let i = 0; i <= 366 && !start; i += 1) {
      const dateKey = shiftDateKey(todayK, i);
      if (occursOnDate(bill, dateKey) && !(bill.paidDates || []).includes(dateKey)) start = dateKey;
    }
    if (!start) return;
    const rule = icsRepeatRule(bill);
    const money = formatMoney(bill.amount);
    const lines = [
      'BEGIN:VEVENT',
      `UID:${icsEscape(bill.id)}@budget-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start.replace(/-/g, '')}`,
    ];
    if (rule) lines.push(`RRULE:${rule}`);
    lines.push(
      `SUMMARY:${icsEscape(bill.autopay ? `${bill.name} autopay (${money})` : `Pay ${bill.name} (${money})`)}`,
      'DESCRIPTION:From your Budget app. Tick it paid there.',
      'TRANSP:TRANSPARENT'
    );
    if (!bill.autopay) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${bill.name} is due tomorrow`)}`, 'TRIGGER:-PT15H', 'END:VALARM');
    }
    lines.push('END:VEVENT');
    events.push(...lines);
  });
  if (!events.length) return null;
  return [...['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Budget//Bills//EN', 'CALSCALE:GREGORIAN'], ...events, 'END:VCALENDAR']
    .map(icsFold).join('\r\n') + '\r\n';
}

// Downloads that calendar file.
function exportCalendar() {
  const text = buildCalendarFile();
  if (!text) {
    setDataIoStatus('No upcoming bills to add to a calendar.', 'failed');
    return;
  }
  downloadBlob(new Blob([text], { type: 'text/calendar' }), 'budget-reminders.ics');
  setDataIoStatus('Calendar file downloaded. Open it to add your bills to your calendar.', 'ok');
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

// Rejects records whose types would break rendering or totals later (e.g. a bill whose amount is the
// string "1200" instead of a number, or a date outside the forms' year range). Records in the income list come in
// kinds, told apart by which field is present and checked in this order: spentOn (expense), planName (plan
// category), recurPlanId (a repeating expense), adjustWeek (a carry-forward adjustment), goalName (savings goal), goalItemFor (a cost part of a goal), savedFor (savings deposit or withdrawal), guessName (expected cost),
// projectedFor (projected income), otherwise a plain income entry with a dateKey. A custom-repeat bill must
// also have a readable every/unit (schedulePeriod). A name must not be empty: the app treats an empty one as absent.
function isValidImportRecord(collectionName, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return false;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // Bills and recurring income need what their forms need (a cent up to MAX_MONEY); a day's
  // income may be negative but is held to the same size limit.
  const isPositiveMoney = (v) => isNum(v) && v >= 0.01 && v <= MAX_MONEY;
  const isDate = (v) => isRealDateKey(v) && isReasonableDateKey(v); // the forms' year range, so a hand-edited year 0500 cannot make every redraw crawl
  const isText = (v) => typeof v === 'string';
  const textOrMissing = (v) => v === undefined || v === null || typeof v === 'string';
  const nonEmptyText = (v) => typeof v === 'string' && v !== '';
  const dateListOrMissing = (v) => v === undefined || (Array.isArray(v) && v.every(isDate));
  // Sync bookkeeping, when present, must have the right types: a text "deleted" would count as
  // true, and a non-number version or non-text updatedAt would break the merge comparisons.
  if (rec.version !== undefined && !isNum(rec.version)) return false;
  if (rec.deleted !== undefined && typeof rec.deleted !== 'boolean') return false;
  if (!['updatedAt', 'deviceId', 'dateAdded'].every((k) => rec[k] == null || isText(rec[k]))) return false;
  if (collectionName === 'bills') return isText(rec.name) && textOrMissing(rec.category) && dateListOrMissing(rec.paidDates) && isPositiveMoney(rec.amount) && isDate(rec.dueDate) && BILL_FREQUENCIES.includes(rec.frequency) && (rec.frequency !== 'custom' || schedulePeriod(rec) !== null) && (rec.autopay === undefined || typeof rec.autopay === 'boolean');
  if (collectionName === 'recurringIncome') return isText(rec.name) && textOrMissing(rec.category) && isPositiveMoney(rec.amount) && isDate(rec.dueDate) && RECURRING_INCOME_FREQUENCIES.includes(rec.frequency);
  if (collectionName === 'income') {
    if (!textOrMissing(rec.source)) return false;
    if (rec.spentOn !== undefined) {
      return isDate(rec.spentOn) && isPositiveMoney(rec.amount) && textOrMissing(rec.planId) && textOrMissing(rec.categoryName) && textOrMissing(rec.notes);
    }
    if (rec.planName !== undefined) {
      return nonEmptyText(rec.planName) && isPositiveMoney(rec.amount) && PLAN_FREQUENCIES.includes(rec.frequency)
        && (rec.business === undefined || typeof rec.business === 'boolean') && textOrMissing(rec.notes)
        && (rec.altAmount === undefined || rec.altAmount === null || (isNum(rec.altAmount) && rec.altAmount >= 0 && rec.altAmount <= MAX_MONEY));
    }
    if (rec.goalName !== undefined) return nonEmptyText(rec.goalName) && isPositiveMoney(rec.target) && (rec.goalDate === undefined || isDate(rec.goalDate)) && textOrMissing(rec.notes);
    if (rec.recurPlanId !== undefined) return nonEmptyText(rec.recurPlanId) && isPositiveMoney(rec.amount) && REPEAT_FREQUENCIES.includes(rec.frequency) && isDate(rec.recurStart) && dateListOrMissing(rec.skippedDates) && textOrMissing(rec.notes);
    if (rec.adjustWeek !== undefined) return isDate(rec.adjustWeek) && isNum(rec.amount) && rec.amount !== 0 && Math.abs(rec.amount) <= MAX_MONEY && textOrMissing(rec.notes);
    if (rec.goalItemFor !== undefined) return nonEmptyText(rec.goalItemFor) && nonEmptyText(rec.itemName) && isPositiveMoney(rec.amount);
    if (rec.savedFor !== undefined) return nonEmptyText(rec.savedFor) && isDate(rec.savedOn) && isNum(rec.amount) && rec.amount !== 0 && Math.abs(rec.amount) <= MAX_MONEY;
    if (rec.guessName !== undefined) return nonEmptyText(rec.guessName) && isPositiveMoney(rec.amount) && isGuessMonth(rec.guessMonth) && textOrMissing(rec.notes);
    if (rec.projectedFor !== undefined) return isDate(rec.projectedFor) && isNum(rec.projected) && Math.abs(rec.projected) <= MAX_MONEY;
    return isNum(rec.amount) && Math.abs(rec.amount) <= MAX_MONEY && isDate(rec.dateKey);
  }
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
    if (saved && isRealDateKey(saved.payDateKey) && isReasonableDateKey(saved.payDateKey) && PAY_PERIOD_FREQUENCIES.includes(saved.frequency) && !loadPaydaySettings().payDateKey) {
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

  // Step 4: summarise the result, then say what the app holds now so a restore can be checked at a glance.
  const skippedNote = skippedInvalid ? ` ${skippedInvalid} unreadable record${skippedInvalid === 1 ? ' was' : 's were'} skipped.` : '';
  if (!anyChanged) {
    setDataIoStatus(`Import complete — nothing new to merge.${skippedNote} ${describeContents()}`, 'ok');
    return;
  }

  setDataIoStatus(`Import complete — ${summaries.join('; ')}.${skippedNote} ${describeContents()}`, 'ok');
}

// One sentence saying what the app holds right now (live records only), e.g. "You now have 12 bills and 5 plan categories."
function describeContents() {
  const live = (list) => list.filter((r) => !r.deleted);
  const counts = [
    [live(bills).length, 'bill', 'bills'],
    [live(recurringIncome).length, 'recurring income source', 'recurring income sources'],
    [income.filter((r) => r.dateKey && !r.deleted).length, 'income entry', 'income entries'],
    [income.filter((r) => r.projectedFor && !r.deleted).length, 'projected income entry', 'projected income entries'],
    [income.filter((r) => r.planName && !r.deleted).length, 'plan category', 'plan categories'],
    [income.filter((r) => r.guessName && !r.deleted).length, 'expected cost', 'expected costs'],
    [income.filter((r) => r.goalName && !r.deleted).length, 'savings goal', 'savings goals'],
    [income.filter((r) => r.goalItemFor && !r.deleted).length, 'goal cost', 'goal costs'],
    [income.filter((r) => r.recurPlanId && !r.deleted).length, 'repeating expense', 'repeating expenses'],
    [income.filter((r) => r.adjustWeek && !r.deleted).length, 'carry-forward adjustment', 'carry-forward adjustments'],
    [income.filter((r) => r.savedFor && !r.deleted).length, 'savings deposit or withdrawal', 'savings deposits and withdrawals'],
    [income.filter((r) => r.spentOn && !r.deleted).length, 'expense', 'expenses'],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (!counts.length) return 'The app is empty.';
  return `You now have ${counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}` : counts[0]}.`;
}

// Menu buttons: Export downloads a backup, Share backup shares it (where the phone can), Calendar reminders
// downloads the calendar file, and Import opens the file picker.
document.getElementById('export-data-btn').addEventListener('click', exportData);
document.getElementById('share-data-btn').hidden = !CAN_SHARE_FILES;
document.getElementById('share-data-btn').addEventListener('click', shareBackup);
document.getElementById('calendar-export-btn').addEventListener('click', exportCalendar);

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

// Check once a minute, since the app can stay open past midnight.
setInterval(refreshForNewDay, 60000);
// Redraw when the app comes back to the foreground on a new day.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshForNewDay();
});

// ---- Theme and version ----

// The build number shown in the Menu. Keep it equal to the number in CACHE_NAME in sw.js
// (a test checks this), so "which version am I on?" has a one-glance answer.
const APP_VERSION = 40;
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
  // The current theme is read from the page, not storage, so cycling works when storage is blocked.
  applyTheme(THEMES[(THEMES.indexOf(document.documentElement.getAttribute('data-theme') || 'auto') + 1) % THEMES.length]);
});
applyTheme(loadTheme());

// localStorage key for the chosen text size, and the choices in the order the Text size button cycles them.
const TEXT_SIZE_KEY = 'budgetApp.textSize.v1';
const TEXT_SIZES = ['normal', 'large', 'xlarge'];
const TEXT_SIZE_LABELS = { normal: 'Normal', large: 'Large', xlarge: 'Largest' };

// Reads the saved text size; anything unexpected means normal.
function loadTextSize() {
  try {
    const value = localStorage.getItem(TEXT_SIZE_KEY);
    return TEXT_SIZES.includes(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

// Applies and saves a text size: Large and Largest set <html data-text> (CSS scales everything from it), Normal removes it.
function applyTextSize(size) {
  if (size === 'normal') document.documentElement.removeAttribute('data-text');
  else document.documentElement.setAttribute('data-text', size);
  try {
    if (size === 'normal') localStorage.removeItem(TEXT_SIZE_KEY);
    else localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch { /* storage unavailable: the choice lasts until the page closes */ }
  const btn = document.getElementById('text-size-btn');
  if (btn) btn.textContent = `Text size: ${TEXT_SIZE_LABELS[size]}`;
}

// The Text size button cycles Normal -> Large -> Largest.
document.getElementById('text-size-btn').addEventListener('click', () => {
  applyTextSize(TEXT_SIZES[(TEXT_SIZES.indexOf(document.documentElement.getAttribute('data-text') || 'normal') + 1) % TEXT_SIZES.length]);
});
applyTextSize(loadTextSize());
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
      errorEl.textContent = `Too many tries. Wait ${LOCK_COOLDOWN_MS / 1000} seconds.`;
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

// The Earlier / Today / Later buttons slide the calendar's three weeks (Today puts them back), limited to 520 weeks
// (about 10 years) either way.
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

// ---- Tabs ----
// Home (the calendar), Income, Bills (the list, the Add bill form and Paid History), Plan and Expenses. Every part is always drawn; the tabs only show one at a time, and the last one used is
// remembered on this device.

// localStorage key for the last tab used, and the tabs in order.
const TAB_KEY = 'budgetApp.tab.v1';
const TABS = ['home', 'income', 'bills', 'plan', 'expenses'];
// The tab on screen.
let currentTab = 'home';

// Reads the remembered tab; anything unexpected means Home.
function loadTab() {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return TABS.includes(value) ? value : 'home';
  } catch {
    return 'home';
  }
}

// Shows one tab (and closes anything open on the one being left), highlights its button and remembers it.
function showTab(name) {
  const tab = TABS.includes(name) ? name : 'home';
  closeCalendarDay();
  closeAddBillSheet();
  currentTab = tab;
  TABS.forEach((id) => { document.getElementById(`tab-${id}`).hidden = id !== tab; });
  document.querySelectorAll('.tabbar-btn').forEach((button) => {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* not saved: it opens on Home next time */ }
  updateAddFab();
}

// The tab buttons switch tabs and start the new tab at its top.
document.querySelectorAll('.tabbar-btn').forEach((button) => {
  button.addEventListener('click', () => {
    showTab(button.dataset.tab);
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  });
});

// The floating + button opens the Add bill form (switching to the Bills tab first). It is hidden on the
// Income, Plan and Expenses tabs, and on the Bills tab while that form is already on screen.
const addBillFab = document.getElementById('add-bill-fab');
const addBillForm = document.getElementById('budget-add-form');
let addFormOnScreen = false;

// Shows or hides the + button for the current tab.
function updateAddFab() {
  addBillFab.hidden = currentTab === 'income' || currentTab === 'plan' || currentTab === 'expenses' || (currentTab === 'bills' && addFormOnScreen);
}

if (addBillFab && addBillForm) {
  addBillFab.addEventListener('click', () => {
    showTab('bills');
    if (isPhoneLayout()) {
      openAddBillSheet();
      return;
    }
    addBillForm.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    document.getElementById('budget-name-input').focus({ preventScroll: true });
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { addFormOnScreen = entries[0].isIntersecting; updateAddFab(); }).observe(addBillForm);
  }
}

safeRender(renderBudget);
updateUndoRedoButtons();
initSyncUI();
showTab(loadTab());

// Shows the "new version is ready" bar at the top of the page.
function showUpdateBanner() {
  document.getElementById('update-banner').hidden = false;
}

// Asks the browser to look for a newer copy of the app now; if there is one it installs in the background
// and the "new version is ready" bar appears.
function checkForNewVersion() {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((registration) => registration && registration.update()).catch(() => {});
  } catch {
    // Some pages cannot use a service worker (private windows, embedded frames): there is just nothing to check.
  }
}

// The bar's button reloads into the new copy.
document.getElementById('update-now-btn').addEventListener('click', () => location.reload());

if ('serviceWorker' in navigator) {
  // A new service worker taking over a page that already had one means a newer app is installed than the
  // one this page is running; offer the reload. (The very first install has no earlier worker: no bar.)
  const hadServiceWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadServiceWorker) showUpdateBanner(); });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    }).catch(() => {
      // Offline install is optional (e.g. private browsing); the app still works without it.
    });
  });
}
