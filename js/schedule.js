// Weekday <-> day-template mapping.
// Weekday indices used throughout the app: 0=Mon, 1=Tue, ... 6=Sun.

function jsDateToWeekdayIndex(date) {
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7; // 0=Mon..6=Sun
}

function toDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isoDate(date) {
  const d = toDateOnly(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parses a "YYYY-MM-DD" string (e.g. from <input type=date>) as a local
// date. Not `new Date(str)`, which reads that format as UTC midnight and
// can land on the wrong calendar day depending on the viewer's timezone.
function parseLocalDate(isoDateStr) {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// A mesocycle's start weekday is always derived from its startDate — never
// stored separately, so it can never drift out of sync with the calendar.
function mesocycleStartWeekday(mesocycle) {
  return jsDateToWeekdayIndex(parseLocalDate(mesocycle.startDate));
}

// Resolve which day template (if any) trains on `date`, given a mesocycle's
// startDate (whose weekday anchors day[0]) and its ordered `days` array.
// Returns the day template object, or null if `date` is a rest day.
function resolveDayForDate(mesocycle, date) {
  if (!mesocycle || !mesocycle.days || mesocycle.days.length === 0) return null;
  const weekday = jsDateToWeekdayIndex(date);
  const offset = (weekday - mesocycleStartWeekday(mesocycle) + 7) % 7;
  if (offset >= mesocycle.days.length) return null;
  const sorted = [...mesocycle.days].sort((a, b) => a.order - b.order);
  return sorted[offset] || null;
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
