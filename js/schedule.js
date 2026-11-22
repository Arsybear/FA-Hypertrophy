// Weekday <-> day-template mapping.
// Weekday indices used throughout the app: 0=Mon, 1=Tue, ... 6=Sun.

export function jsDateToWeekdayIndex(date) {
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7; // 0=Mon..6=Sun
}

export function toDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isoDate(date) {
  const d = toDateOnly(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parses a "YYYY-MM-DD" string (e.g. from <input type=date>) as a local
// date. Not `new Date(str)`, which reads that format as UTC midnight and
// can land on the wrong calendar day depending on the viewer's timezone.
export function parseLocalDate(isoDateStr) {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// A real calendar date written the way the app writes one: zero-padded
// "YYYY-MM-DD" with a four-digit year. A date input accepts years up to
// 275760, which Date cannot hold as a local date (Invalid Date breaks every
// screen that shows it), and years below 100, which Date reads as 19xx.
export function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseLocalDate(s)) === s;
}

export function addDays(date, n) {
  const d = toDateOnly(date);
  d.setDate(d.getDate() + n);
  return d;
}

// A mesocycle's start weekday is always derived from its startDate — never
// stored separately, so it can never drift out of sync with the calendar.
export function mesocycleStartWeekday(mesocycle) {
  return jsDateToWeekdayIndex(parseLocalDate(mesocycle.startDate));
}

// A day template's weekday offset (0 = the mesocycle's start weekday, 1 =
// the next day, ... wrapping at 7) is what pins it to a specific weekday,
// allowing gaps (rest days) between training days. Mesocycles created
// before this field existed only ever had days packed consecutively from
// offset 0 in `order`, so `order` is exactly the right fallback — no data
// migration needed.
export function getDayWeekdayOffset(day) {
  return day.weekdayOffset ?? day.order ?? 0;
}

// Shifts ("shift mesocycle to fit" after a missed day): each
// { date, days } inserts `days` rest days starting at `date`, and every later
// real date maps back by those days. Sorted by date, never overlapping. A
// mesocycle without `shifts` has none.
export function totalShiftDays(meso, uptoIso = null) {
  return (meso.shifts || [])
    .filter((s) => uptoIso == null || s.date <= uptoIso)
    .reduce((sum, s) => sum + s.days, 0);
}

// The date on the unshifted template calendar that a real date stands for.
// A gap day is paused at its shift's own date.
export function schedulePosition(meso, date) {
  const iso = isoDate(date);
  let back = 0;
  for (const s of meso.shifts || []) {
    if (iso < s.date) break;
    if (iso < isoDate(addDays(parseLocalDate(s.date), s.days))) {
      return { date: addDays(parseLocalDate(s.date), -back), gap: true };
    }
    back += s.days;
  }
  return { date: addDays(date, -back), gap: false };
}

// Resolve which day template (if any) trains on `date`, given a mesocycle's
// startDate (whose weekday anchors offset 0), its shifts, and each day's own
// weekdayOffset. Returns the day template object, or null if `date` is a
// rest day (no day template claims that offset, or a shift's gap day).
export function resolveDayForDate(mesocycle, date) {
  if (!mesocycle || !mesocycle.days || mesocycle.days.length === 0) return null;
  const position = schedulePosition(mesocycle, date);
  if (position.gap) return null;
  const weekday = jsDateToWeekdayIndex(position.date);
  const offset = (weekday - mesocycleStartWeekday(mesocycle) + 7) % 7;
  return mesocycle.days.find((d) => getDayWeekdayOffset(d) === offset) || null;
}

export function weekNumber(meso, date) {
  return Math.floor(daysBetween(parseLocalDate(meso.startDate), schedulePosition(meso, date).date) / 7) + 1;
}

// Last day of the planned weeks, moved out by the shifts.
export function plannedEndIso(meso) {
  let end = addDays(parseLocalDate(meso.startDate), meso.numWeeks * 7 - 1);
  // Only a shift dated on or before the running end moves it (shifts are
  // sorted); one after the planned end changes nothing in the plan.
  for (const s of meso.shifts || []) if (s.date <= isoDate(end)) end = addDays(end, s.days);
  return isoDate(end);
}

// The weekday (0 = Monday) a day template with this offset trains on now.
export function offsetWeekday(meso, offset) {
  return (mesocycleStartWeekday(meso) + offset + totalShiftDays(meso)) % 7;
}

export const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Whole calendar days from a to b. Rounded, because a day that holds a
// daylight-saving change is 23 or 25 hours long.
export function daysBetween(a, b) {
  return Math.round((toDateOnly(b) - toDateOnly(a)) / 86400000);
}

// How a stored "YYYY-MM-DD" is shown everywhere: "Nov 21", with the year
// only when it is not the current one.
export function formatShortDate(isoDateStr, now = new Date()) {
  const date = parseLocalDate(isoDateStr);
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}${year}`;
}

// The same with the weekday in front: "Sat, Nov 21".
export function formatDay(isoDateStr, now = new Date()) {
  const date = parseLocalDate(isoDateStr);
  return `${WEEKDAY_LABELS[jsDateToWeekdayIndex(date)].slice(0, 3)}, ${formatShortDate(isoDateStr, now)}`;
}
