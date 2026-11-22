// Self-check for the pure logic (no browser needed): node scripts/test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, daysBetween, isIsoDate, offsetWeekday, plannedEndIso, totalShiftDays, weekNumber, formatDay, formatShortDate, isoDate, parseLocalDate, resolveDayForDate } from "../js/schedule.js";
import { buildPrefilledSets, equivalentReps, exercisePR, findLastLoggedSet, nextSet, pctPerRep } from "../js/progression.js";
import { APP_VERSION } from "../js/version.js";

// store.js only touches localStorage inside functions, so a Map stands in.
const memory = new Map();
let fullKey = null; // a write to this key fails, as when storage is full
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { if (k === fullKey) throw new Error("QuotaExceededError"); memory.set(k, String(v)); },
  removeItem: (k) => memory.delete(k),
};
const { Store, cleanSetValue, normalizeMesocycles, validateBackup } = await import("../js/store.js");
const { buildEntrySets, doMissedDay, findMissedDay, generateWorkout, getExerciseHistory, getTodayContext, migrateLegacyPrefill, reconcileWorkoutWithTemplate, refreshPredictions, undoMissedDay } = await import("../js/workout.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const set = (weight, reps) => ({ weight, reps });
const workout = (date, dayId, exercises) => ({ finished: true, date, dayId, exercises });
const ex = (slotId, exerciseId, exerciseName, ...sets) => ({ slotId, exerciseId, exerciseName, sets });

// A swapped-in exercise never inherits the slot's previous exercise.
const log = [
  workout("2026-01-01", "push", [ex("s1", "bench", "Bench", set(200, 8))]),
  workout("2026-01-02", "pull", [ex("s9", "fly", "Fly", set(30, 12))]),
];
assert.strictEqual(findLastLoggedSet(log, "push", "s1", "new", 0, "2026-02-01", "New"), null);
// ...it gets its own history, from another day if this day has none.
assert.strictEqual(findLastLoggedSet(log, "push", "s1", "fly", 0, "2026-02-01", "Fly").weight, 30);
assert.strictEqual(findLastLoggedSet(log, "push", "s1", "bench", 0, "2026-02-01", "Bench").weight, 200);
// Same day beats a more recent other day.
log.push(workout("2026-01-05", "legs", [ex("s5", "bench", "Bench", set(100, 8))]));
assert.strictEqual(findLastLoggedSet(log, "push", "s1", "bench", 0, "2026-02-01", "Bench").weight, 200);
// Same exercise in two slots of one day: each slot keeps its own numbers.
const twice = [workout("2026-01-01", "d", [ex("a", "curl", "Curl", set(40, 8)), ex("b", "curl", "Curl", set(25, 15))])];
assert.strictEqual(findLastLoggedSet(twice, "d", "b", "curl", 0, "2026-02-01", "Curl").weight, 25);
// Missing/stale exerciseId falls back to the name; not at or after the date.
const legacy = [workout("2026-01-01", "d", [ex("a", undefined, "Row", set(90, 10))])];
assert.strictEqual(findLastLoggedSet(legacy, "d", "zz", "row-new-id", 0, "2026-02-01", "Row").weight, 90);
assert.strictEqual(findLastLoggedSet(legacy, "d", "zz", "row-new-id", 0, "2026-01-01", "Row"), null);

// Double progression.
assert.deepStrictEqual({ ...nextSet(set(100, 8), 8, 12, 2.5) }, { weight: 100, reps: 9 });
assert.deepStrictEqual({ ...nextSet(set(20, 12), 8, 12, 2.5) }, { weight: 22.5, reps: 11 });
assert.deepStrictEqual({ ...nextSet(set(0, 12), 8, 12, 2.5) }, { weight: 0, reps: 12 });

// Schedule: local dates, gaps are rest days.
assert.strictEqual(isoDate(parseLocalDate("2026-03-01")), "2026-03-01");
const meso = { startDate: "2026-11-02", days: [{ id: "a", weekdayOffset: 0 }, { id: "b", weekdayOffset: 2 }] };
assert.strictEqual(resolveDayForDate(meso, parseLocalDate("2026-11-11")).id, "b");
assert.strictEqual(resolveDayForDate(meso, parseLocalDate("2026-11-10")), null);
// Whole days, also across a daylight-saving change (a 23 or 25 hour day).
assert.strictEqual(daysBetween(parseLocalDate("2026-03-02"), parseLocalDate("2026-03-30")), 28);
assert.strictEqual(daysBetween(parseLocalDate("2026-10-19"), parseLocalDate("2026-11-16")), 28);
assert.strictEqual(daysBetween(parseLocalDate("2026-11-21"), parseLocalDate("2026-11-20")), -1);
// One date format: the year only outside the current one.
const now = parseLocalDate("2026-11-21");
assert.strictEqual(formatShortDate("2026-11-06", now), "Nov 6");
assert.strictEqual(formatShortDate("2025-12-31", now), "Dec 31, 2025");
assert.strictEqual(formatDay("2026-11-21", now), "Sat, Nov 21");

// Copying a mesocycle: new ids throughout, inactive, same weekday, no overlap.
localStorage.setItem("fah_mesocycles", JSON.stringify([{
  id: "m1", name: "Block", numWeeks: 4, startDate: "2026-10-05", active: true,
  days: [{ id: "d1", name: "Push", weekdayOffset: 0, exercises: [{ id: "s1", exerciseId: "bench", order: 0, targetSets: 2, repRangeMin: 8, repRangeMax: 12 }] }],
}]));
const copy = Store.cloneMesocycle("m1", "2026-11-21");
assert.strictEqual(copy.active, false);
assert.strictEqual(copy.startDate, "2026-11-23"); // first Monday on or after today
assert.notStrictEqual(copy.days[0].id, "d1");
assert.notStrictEqual(copy.days[0].exercises[0].id, "s1");
assert.strictEqual(copy.days[0].exercises[0].exerciseId, "bench");
assert.strictEqual(Store.cloneMesocycle("m1", "2026-10-10").startDate, "2026-11-02"); // right after the planned end
assert.strictEqual(Store.getMesocycles()[0].days[0].id, "d1"); // source untouched

// Backup: what the app exports must import; anything that could carry markup
// into an unescaped spot must not.
localStorage.setItem("fah_workouts", JSON.stringify([{
  id: "w1", mesocycleId: "m1", dayId: "d1", date: "2026-10-05", dayName: "Push", finished: true, finishedAt: "x",
  exercises: [{ slotId: "s1", exerciseId: "bench", exerciseName: "Bench", order: 0, repRangeMin: 8, repRangeMax: 12, sets: [{ weight: 100, reps: 8 }] }],
}]));
const backup = Store.exportBackup();
assert.strictEqual(validateBackup(JSON.parse(JSON.stringify(backup))), null);
const tampered = (edit) => { const b = JSON.parse(JSON.stringify(backup)); edit(b); return validateBackup(b); };
assert.ok(tampered((b) => { b.workouts[0].exercises[0].slotId = '"><img src=x onerror=alert(1)>'; }));
assert.ok(tampered((b) => { b.workouts[0].date = "2026-02-31"; }));
assert.ok(tampered((b) => { b.workouts[0].exercises[0].sets[0].weight = "<b>"; }));
assert.ok(tampered((b) => { b.mesocycles[0].days = "x"; }));
assert.ok(tampered((b) => { b.app = "other"; }));
assert.ok(validateBackup(null));
assert.ok(validateBackup([]));
assert.ok(tampered((b) => { b.mesocycles[0].days[0].weekdayOffset = 2.5; }));
assert.ok(tampered((b) => { b.mesocycles[0].days[0].weekdayOffset = 7; }));
// Names of any length the forms accepted must restore.
assert.strictEqual(tampered((b) => { b.mesocycles[0].name = "x".repeat(300); b.mesocycles[0].days[0].name = "y".repeat(250); b.workouts[0].exercises[0].exerciseName = "z".repeat(201); }), null);
assert.ok(tampered((b) => { b.mesocycles[0].name = 5; }));
assert.strictEqual(Store.importBackup(backup), true);
assert.strictEqual(Store.getWorkouts().length, 1);
assert.ok(localStorage.getItem("fah_before_import"));

// Numbers out of range are not a reason to refuse a backup (older versions
// did not clamp, and that data must still restore): they are clamped on
// import, and once at startup for what is already stored.
const wild = JSON.parse(JSON.stringify(backup));
wild.mesocycles[0].numWeeks = 1e9;
Object.assign(wild.mesocycles[0].days[0].exercises[0], { targetSets: 1e9, repRangeMin: 0, repRangeMax: -3, weightIncrementPct: 900 });
assert.strictEqual(validateBackup(wild), null);
assert.strictEqual(Store.importBackup(wild), true);
const clamped = Store.getMesocycles()[0];
assert.strictEqual(clamped.numWeeks, 99);
assert.deepStrictEqual(
  (({ targetSets, repRangeMin, repRangeMax, weightIncrementPct }) => ({ targetSets, repRangeMin, repRangeMax, weightIncrementPct }))(clamped.days[0].exercises[0]),
  { targetSets: 99, repRangeMin: 1, repRangeMax: 1, weightIncrementPct: 50 });
const fine = [{ numWeeks: 6, startDate: "2026-09-01", days: [{ exercises: [{ targetSets: 3, repRangeMin: 8, repRangeMax: 12 }, { targetSets: 2, repRangeMin: 5, repRangeMax: 10, weightIncrementPct: 2.5 }] }] }];
const fineBefore = JSON.stringify(fine);
assert.strictEqual(normalizeMesocycles(fine), false); // valid data is left exactly as it is
assert.strictEqual(JSON.stringify(fine), fineBefore);
localStorage.setItem("fah_mesocycles", JSON.stringify([{ id: "m9", name: "Old", numWeeks: 0, startDate: "2026-10-05", active: true, days: [] }]));
Store.normalize();
assert.strictEqual(Store.getMesocycles()[0].numWeeks, 1);

// Set values typed on Today: out of range is refused as blank, 0 lb is a
// bodyweight set.
assert.deepStrictEqual(["0", "22.5", "2000", "-50", "2000.5", "99999999999999999999", "abc", "", " "].map((v) => cleanSetValue("weight", v)),
  [0, 22.5, 2000, null, null, null, null, null, null]);
assert.deepStrictEqual(["0", "8", "999", "-5", "7.5", "1000", "1e3", ""].map((v) => cleanSetValue("reps", v)),
  [0, 8, 999, null, null, null, null, null]);

const todayStr = isoDate(new Date());
// Start dates: only a real "YYYY-MM-DD" with a four-digit year is saved. A
// date input takes years up to 275760, which Date cannot hold, and that
// blanked Settings and Program with no way to change it back.
assert.strictEqual(isIsoDate("2026-11-21"), true);
for (const bad of ["275760-09-13", "2026-02-31", "0050-01-01", "2026-9-1", "", undefined]) assert.strictEqual(isIsoDate(bad), false, bad);
Store.updateMesocycle("m9", { name: "Renamed", startDate: "275760-09-13" });
assert.deepStrictEqual([Store.getMesocycles()[0].name, Store.getMesocycles()[0].startDate], ["Renamed", "2026-10-05"]);
Store.updateMesocycle("m9", { startDate: "2026-10-12" });
assert.strictEqual(Store.getMesocycles()[0].startDate, "2026-10-12");
assert.strictEqual(Store.createMesocycle({ name: "N", numWeeks: 4, startDate: "275760-09-13" }).startDate, isoDate(new Date()));
// One already saved is repaired at startup (today); a merely unpadded one is
// the same day written padded. A year below 1000 or above 9999 is not padding.
localStorage.setItem("fah_mesocycles", JSON.stringify([
  { id: "a", name: "A", numWeeks: 4, startDate: "999999-01-01", active: true, days: [] },
  { id: "b", name: "B", numWeeks: 4, active: false, days: [] },
  { id: "c", name: "C", numWeeks: 4, startDate: "2026-9-1", active: false, days: [] },
  { id: "d", name: "D", numWeeks: 4, startDate: "0026-11-21", active: false, days: [] },
  { id: "e", name: "E", numWeeks: 4, startDate: "20266-11-21", active: false, days: [] },
  { id: "f", name: "F", numWeeks: 4, startDate: "2026-2-30", active: false, days: [] },
  // Repaired to today: shifts dated before it go, the key too when none is left.
  { id: "g", name: "G", numWeeks: 4, startDate: "999999-01-01", active: false, days: [], shifts: [{ date: "2020-01-06", days: 1 }, { date: "2999-01-06", days: 2 }] },
  { id: "h", name: "H", numWeeks: 4, startDate: "999999-01-01", active: false, days: [], shifts: [{ date: "2020-01-06", days: 1 }] },
]));
Store.normalize();
assert.deepStrictEqual(Store.getMesocycles().map((m) => m.startDate), [todayStr, todayStr, "2026-09-01", todayStr, todayStr, todayStr, todayStr, todayStr]);
assert.deepStrictEqual(Store.getMesocycles().slice(6).map((m) => m.shifts), [[{ date: "2999-01-06", days: 2 }], undefined]);
assert.strictEqual("shifts" in Store.getMesocycles()[7], false);
assert.ok(Store.getMesocycles().every((m) => validateBackup({ app: "fa-hypertrophy", version: 1, exercises: [], workouts: [], mesocycles: [m] }) === null));

// An import that runs out of space part-way puts back what was there.
const realError = console.error;
console.error = () => {}; // the failures below are logged on purpose
Store.importBackup(backup);
const before = ["fah_exercises", "fah_mesocycles", "fah_workouts"].map((k) => localStorage.getItem(k));
const other = JSON.parse(JSON.stringify(backup));
other.mesocycles[0].name = "Other";
other.workouts = [];
fullKey = "fah_workouts";
assert.strictEqual(Store.importBackup(other), false);
fullKey = null;
assert.deepStrictEqual(["fah_exercises", "fah_mesocycles", "fah_workouts"].map((k) => localStorage.getItem(k)), before);

// A failed write is reported, not thrown and not silent.
let reported = 0;
Store.onWriteError = () => { reported++; };
fullKey = "fah_exercises";
Store.addExercise("Does not fit", "Other");
fullKey = null;
assert.strictEqual(reported, 1);
assert.strictEqual(Store.writeFailed, true);
console.error = realError;
Store.onWriteError = null;
Store.writeFailed = false;

// Rep estimate after a weight change: 1 rep per 15% light, per 2.5% heavy,
// interpolated by weight in between.
assert.strictEqual(pctPerRep(20), 15);
assert.strictEqual(pctPerRep(45), 15);
assert.strictEqual(pctPerRep(90), 8.75);
assert.strictEqual(pctPerRep(135), 2.5);
assert.strictEqual(pctPerRep(300), 2.5);
assert.strictEqual(equivalentReps(17.5, 9, 20), 8); // the real progressions the light rate is fitted to
assert.strictEqual(equivalentReps(15, 8, 20), 6);
assert.strictEqual(equivalentReps(90, 10, 100), 9);
assert.strictEqual(equivalentReps(200, 8, 210), 6);
assert.strictEqual(equivalentReps(200, 8, 190), 10); // lighter: more reps
assert.strictEqual(equivalentReps(200, 2, 300), 1); // never below 1
assert.strictEqual(equivalentReps(null, 8, 100), null);
assert.strictEqual(equivalentReps(100, 8, 0), null);

// Predictions per set index: a set left blank last time falls back to the
// newest workout where that set was logged; never written into weight/reps.
const history = [
  workout("2026-01-08", "A", [ex("s1", "bench", "Bench", set(100, 8), set(null, null))]),
  workout("2026-01-01", "A", [ex("s1", "bench", "Bench", set(95, 8), set(90, 10))]),
];
const built = buildPrefilledSets({ id: "s1", exerciseId: "bench", targetSets: 3, repRangeMin: 8, repRangeMax: 12 }, history, "A", "2026-01-15", "Bench");
assert.deepStrictEqual(built.map((s) => [s.baseWeight, s.baseReps, s.weight, s.reps]), [[100, 9, null, null], [90, 11, null, null], [null, null, null, null]]);

// History follows the exercise. An entry with no exerciseId (older data) is
// matched by name, never by another entry that also lacks an id.
const noIds = [
  workout("2026-01-01", "d", [ex("a", undefined, "Row", set(90, 10))]),
  workout("2026-01-02", "d", [ex("b", undefined, "Curl", set(30, 12))]),
];
localStorage.setItem("fah_workouts", JSON.stringify(noIds));
assert.deepStrictEqual(getExerciseHistory("a", undefined, "Row").map((r) => r.date), ["2026-01-01"]);
assert.deepStrictEqual(getExerciseHistory("b", undefined, "Curl").map((r) => r.date), ["2026-01-02"]);

// --- Today: which workout a date gets (getTodayContext) ---
// Dates are relative to the real today. The mesocycle started two weeks ago,
// so offset 0 is today's weekday: -1 is offset 6, -2 is a rest day, +1 is
// offset 1, -15 is before the start.
const dayIso = (n) => isoDate(addDays(new Date(), n));
const todayIso = dayIso(0);
const slot = (id, exerciseId, order, targetSets = 2) => ({ id, exerciseId, order, targetSets, repRangeMin: 8, repRangeMax: 12, weightIncrementPct: 2.5 });
const program = () => [
  { id: "A", name: "Push", weekdayOffset: 0, exercises: [slot("s1", "bench", 0), slot("s2", "row", 1)] },
  { id: "T", name: "Pull", weekdayOffset: 1, exercises: [slot("s3", "row", 0)] },
  { id: "Y", name: "Legs", weekdayOffset: 6, exercises: [slot("s4", "curl", 0)] },
];
const seed = (days, workouts = []) => {
  memory.clear();
  localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }, { id: "row", name: "Row" }, { id: "curl", name: "Curl" }]));
  localStorage.setItem("fah_mesocycles", JSON.stringify([{ id: "m", name: "M", numWeeks: 4, startDate: dayIso(-14), active: true, days }]));
  localStorage.setItem("fah_workouts", JSON.stringify(workouts));
};
const at = (iso) => {
  globalThis.location = { hash: iso ? `#/today?date=${iso}` : "#/today" };
  return getTodayContext();
};
const stored = () => Store.getWorkouts();
const blank = (i) => ({ setIndex: i, weight: null, reps: null, baseWeight: null, baseReps: null, isLogged: false, done: false });
const logged = (i, weight, reps) => ({ ...blank(i), weight, reps, isLogged: true });
const wex = (slotId, exerciseId, exerciseName, order, sets, extra = {}) => ({ slotId, exerciseId, exerciseName, order, repRangeMin: 8, repRangeMax: 12, weightIncrementPct: 2.5, sets, ...extra });
const unfinished = (id, date, dayId, exercises, extra = {}) => ({ id, mesocycleId: "m", date, dayId, dayName: "x", finished: false, finishedAt: null, exercises, ...extra });

// Rest day, before the start, future: nothing generated.
seed(program());
let ctx = at(dayIso(-2));
assert.strictEqual(ctx.dayTemplate, null);
assert.strictEqual(ctx.workout, null);
ctx = at(dayIso(-15));
assert.strictEqual(ctx.dayTemplate, null);
assert.strictEqual(ctx.workout, null);
ctx = at(dayIso(1));
assert.strictEqual(ctx.dayTemplate.id, "T");
assert.strictEqual(ctx.workout, null);
assert.strictEqual(stored().length, 0);
// An invalid ?date= falls back to today.
ctx = at("2026-02-31");
assert.strictEqual(ctx.dateIso, todayIso);
assert.strictEqual(ctx.isToday, true);

// First visit generates once, from the template; a second read writes nothing.
seed(program(), [{ ...unfinished("old", dayIso(-7), "A", [wex("s1", "bench", "Bench", 0, [logged(0, 100, 8), logged(1, 100, 7)])]), finished: true }]);
ctx = at();
assert.strictEqual(ctx.workout.dayId, "A");
assert.deepStrictEqual(ctx.workout.exercises.map((e) => [e.slotId, e.exerciseName, e.sets.length]), [["s1", "Bench", 2], ["s2", "Row", 2]]);
assert.deepStrictEqual(ctx.workout.exercises[0].sets.map((s) => [s.baseWeight, s.baseReps, s.weight]), [[100, 9, null], [100, 8, null]]);
assert.strictEqual(stored().length, 2);
const afterFirst = localStorage.getItem("fah_workouts");
assert.strictEqual(at().workout.id, ctx.workout.id);
assert.strictEqual(localStorage.getItem("fah_workouts"), afterFirst);

// A slot with no weightIncrementPct (older data) gets the 2.5% default.
const oldSlot = program();
delete oldSlot[0].exercises[0].weightIncrementPct;
seed(oldSlot);
assert.strictEqual(at().workout.exercises[0].weightIncrementPct, 2.5);

// The schedule moved under an untouched unfinished workout: dropped, and the
// date follows the new schedule.
seed(program(), [unfinished("stale", todayIso, "Y", [wex("s4", "curl", "Curl", 0, [blank(0)])])]);
ctx = at();
assert.strictEqual(ctx.workout.dayId, "A");
assert.notStrictEqual(ctx.workout.id, "stale");
assert.deepStrictEqual(stored().map((w) => w.dayId), ["A"]);
// ...one with a logged set is kept exactly as it is, not reconciled.
const keptWorkout = unfinished("kept", todayIso, "Y", [wex("s4", "curl", "Curl", 0, [logged(0, 30, 12), blank(1)])]);
seed(program(), [keptWorkout]);
ctx = at();
assert.strictEqual(ctx.workout.id, "kept");
assert.deepStrictEqual(stored(), [keptWorkout]);

// A past-dated unfinished workout is migrated but never reconciled: no
// exercise added since, none removed since.
const legacySet = { setIndex: 1, weight: 100, reps: 9, baseWeight: null, baseReps: null, isLogged: false, prefilled: true };
seed(program(), [unfinished("past", dayIso(-7), "A", [
  wex("s1", "bench", "Bench", 0, [logged(0, 100, 8), legacySet]),
  wex("gone", "curl", "Curl", 1, [logged(0, 30, 12)]),
])]);
ctx = at(dayIso(-7));
assert.strictEqual(ctx.isToday, false);
assert.deepStrictEqual(stored()[0].exercises.map((e) => e.slotId), ["s1", "gone"]);
assert.deepStrictEqual(stored()[0].exercises[0].sets[1], { setIndex: 1, weight: null, reps: null, baseWeight: 100, baseReps: 9, isLogged: false });
// Today's is reconciled: the program's new exercise shows up.
seed(program(), [unfinished("now", todayIso, "A", [wex("s1", "bench", "Bench", 0, [logged(0, 100, 8), blank(1)])])]);
assert.deepStrictEqual(at().workout.exercises.map((e) => e.slotId), ["s1", "s2"]);
assert.deepStrictEqual(stored()[0].exercises.map((e) => e.slotId), ["s1", "s2"]);

// Days from before weekdayOffset existed: `order` is the offset.
seed([
  { id: "L0", name: "Old 0", order: 0, exercises: [slot("s1", "bench", 0)] },
  { id: "L1", name: "Old 1", order: 1, exercises: [slot("s3", "row", 0)] },
]);
assert.strictEqual(at().dayTemplate.id, "L0");
assert.strictEqual(at(dayIso(-6)).dayTemplate.id, "L1");
assert.strictEqual(at(dayIso(-1)).dayTemplate, null);

// --- Reconciling today's workout with an edited template ---
// Template: s3 new (first), s1 with fewer sets and a new rep range, s2
// skipped for this workout. Workout: a one-off first, s1, and a slot since
// removed from the program.
seed(program(), [unfinished("r", todayIso, "A", [
  wex("x", "curl", "Curl", 0, [blank(0)], { oneOff: true }),
  wex("s1", "bench", "Bench", 1, [logged(0, 100, 8), blank(1), blank(2)]),
  wex("old", "row", "Row", 2, [blank(0)]),
], { skippedSlotIds: ["s2"] })]);
const edited = { id: "A", exercises: [slot("s3", "curl", 0, 1), { ...slot("s1", "bench", 1, 1), repRangeMax: 10 }, slot("s2", "row", 2)] };
reconcileWorkoutWithTemplate(Store.getWorkout("r"), edited);
let r = Store.getWorkout("r");
const byOrder = () => [...r.exercises].sort((a, b) => a.order - b.order);
assert.deepStrictEqual(byOrder().map((e) => e.slotId), ["x", "s3", "s1"]); // one-off keeps its place
const s1 = r.exercises.find((e) => e.slotId === "s1");
assert.deepStrictEqual(s1.sets, [logged(0, 100, 8)]); // trailing untouched sets dropped
assert.strictEqual(s1.repRangeMax, 10);
assert.strictEqual(r.exercises.find((e) => e.slotId === "s3").sets.length, 1);
// Fewer sets never drops a set already typed into; more sets appends blanks.
seed(program(), [unfinished("r", todayIso, "A", [wex("s1", "bench", "Bench", 0, [blank(0), logged(1, 100, 8)])])]);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 0, 1)] });
r = Store.getWorkout("r");
assert.strictEqual(r.exercises[0].sets.length, 2);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 0, 4)] });
r = Store.getWorkout("r");
assert.deepStrictEqual(r.exercises[0].sets.slice(2), [blank(2), blank(3)]);
// Order follows the template (reordered in #/program).
seed(program(), [unfinished("r", todayIso, "A", [wex("s1", "bench", "Bench", 0, [blank(0)]), wex("s2", "row", "Row", 1, [blank(0)])])]);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 1, 1), slot("s2", "row", 0, 1)] });
r = Store.getWorkout("r");
assert.deepStrictEqual(byOrder().map((e) => e.slotId), ["s2", "s1"]);
// A workout exercise with no exerciseId (older data) is kept by its slot.
seed(program(), [unfinished("r", todayIso, "A", [wex("s1", undefined, "Bench", 0, [logged(0, 100, 8)])])]);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 0, 1)] });
r = Store.getWorkout("r");
assert.deepStrictEqual(r.exercises.map((e) => [e.slotId, e.sets.length]), [["s1", 1]]);

// --- Sets saved before predictions became placeholders ---
const legacyWorkout = unfinished("lg", todayIso, "A", [wex("s1", "bench", "Bench", 0, [
  { setIndex: 0, weight: 105, reps: 8, baseWeight: 100, baseReps: 9, isLogged: true, prefilled: false, repsManual: true }, // typed: kept
  { setIndex: 1, weight: 100, reps: 9, baseWeight: null, baseReps: null, isLogged: false, prefilled: true }, // prediction: back to a hint
  { setIndex: 2, weight: 100, reps: 9, baseWeight: 95, baseReps: 10, isLogged: false, prefilled: true }, // existing base kept
])]);
seed(program(), [legacyWorkout]);
migrateLegacyPrefill(Store.getWorkout("lg"));
assert.deepStrictEqual(Store.getWorkout("lg").exercises[0].sets, [
  { setIndex: 0, weight: 105, reps: 8, baseWeight: 100, baseReps: 9, isLogged: true },
  { setIndex: 1, weight: null, reps: null, baseWeight: 100, baseReps: 9, isLogged: false },
  { setIndex: 2, weight: null, reps: null, baseWeight: 95, baseReps: 10, isLogged: false },
]);
const migrated = localStorage.getItem("fah_workouts");
migrateLegacyPrefill(Store.getWorkout("lg")); // runs once: nothing left to change
assert.strictEqual(localStorage.getItem("fah_workouts"), migrated);

// --- Shift mesocycle to fit ---
// Monday/Wednesday/Friday from Monday 2026-11-02; Monday 11-09 missed and
// done Tuesday 11-10 with a shift: everything after moves one day.
const mwf = (extra = {}) => ({ id: "m", name: "M", numWeeks: 4, startDate: "2026-11-02", active: true,
  days: [{ id: "mon", name: "Mon", weekdayOffset: 0, exercises: [] }, { id: "wed", name: "Wed", weekdayOffset: 2, exercises: [] }, { id: "fri", name: "Fri", weekdayOffset: 4, exercises: [] }], ...extra });
const dayOn = (meso, iso) => { const d = resolveDayForDate(meso, parseLocalDate(iso)); return d && d.id; };
const daysOn = (meso, from, n) => Array.from({ length: n }, (_, i) => dayOn(meso, isoDate(addDays(parseLocalDate(from), i))));
let shifted = mwf({ shifts: [{ date: "2026-11-09", days: 1 }] });
assert.deepStrictEqual(daysOn(shifted, "2026-11-02", 14), [
  "mon", null, "wed", null, "fri", null, null, // week 1 unchanged
  null, "mon", null, "wed", null, "fri", null, // Mon is the gap; Tue/Thu/Sat
]);
// A Sunday day wraps to the next Monday.
shifted.days.push({ id: "sun", name: "Sun", weekdayOffset: 6, exercises: [] });
assert.strictEqual(dayOn(shifted, "2026-11-08"), "sun");
assert.strictEqual(dayOn(shifted, "2026-11-15"), null);
assert.strictEqual(dayOn(shifted, "2026-11-16"), "sun");
// Two shifts: Tuesday 11-17 (now Monday's day) missed again, done Thursday.
shifted = mwf({ shifts: [{ date: "2026-11-09", days: 1 }, { date: "2026-11-17", days: 2 }] });
assert.deepStrictEqual(daysOn(shifted, "2026-11-16", 9), [null, null, null, "mon", null, "wed", null, "fri", null]);
assert.strictEqual(totalShiftDays(shifted), 3);
assert.strictEqual(totalShiftDays(shifted, "2026-11-16"), 1);
// Across daylight-saving changes (2026-11-01 and 2026-03-08 in the US).
const dst = (start, shiftDate) => mwf({ startDate: start, shifts: [{ date: shiftDate, days: 3 }] });
assert.deepStrictEqual(daysOn(dst("2026-10-26", "2026-10-30"), "2026-10-30", 9), [null, null, null, "fri", null, null, "mon", null, "wed"]);
assert.deepStrictEqual(daysOn(dst("2026-03-02", "2026-03-06"), "2026-03-06", 9), [null, null, null, "fri", null, null, "mon", null, "wed"]);
// No `shifts` key (or an empty list) resolves exactly as the plain weekday rule.
const plain = mwf();
const byWeekday = (iso) => ({ 0: "mon", 2: "wed", 4: "fri" })[(parseLocalDate(iso).getDay() + 6) % 7] || null;
for (let i = 0; i < 60; i++) {
  const iso = isoDate(addDays(parseLocalDate("2026-11-02"), i));
  assert.strictEqual(dayOn(plain, iso), byWeekday(iso), iso);
  assert.strictEqual(dayOn(mwf({ shifts: [] }), iso), byWeekday(iso), iso);
}
// Week number follows the schedule; a gap day shows the paused week.
assert.deepStrictEqual(["2026-11-02", "2026-11-08", "2026-11-09"].map((d) => weekNumber(plain, parseLocalDate(d))), [1, 1, 2]);
const gapSunday = mwf({ shifts: [{ date: "2026-11-08", days: 2 }] });
assert.deepStrictEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-16"].map((d) => weekNumber(gapSunday, parseLocalDate(d))), [1, 1, 1, 2]);
assert.strictEqual(plannedEndIso(plain), "2026-11-29");
assert.strictEqual(plannedEndIso(gapSunday), "2026-12-01");
assert.strictEqual(offsetWeekday(plain, 2), 2);
assert.strictEqual(offsetWeekday(mwf({ shifts: [{ date: "2026-11-09", days: 1 }] }), 2), 3);
assert.strictEqual(offsetWeekday(mwf({ shifts: [{ date: "2026-11-09", days: 1 }] }), 6), 0);

// A copy starts after the shifted end, without shifts; a new start date
// drops only the shifts dated before it, other edits keep them all.
memory.clear();
localStorage.setItem("fah_mesocycles", JSON.stringify([mwf({ startDate: "2026-10-05", shifts: [{ date: "2026-10-12", days: 1 }] })]));
const shiftedCopy = Store.cloneMesocycle("m", "2026-10-10");
assert.strictEqual(shiftedCopy.startDate, "2026-11-03");
assert.strictEqual("shifts" in shiftedCopy, false);
assert.strictEqual(Store.cloneMesocycle("m", "2026-11-21").startDate, "2026-11-24");
Store.updateMesocycle("m", { name: "Renamed", startDate: "2026-10-05" });
assert.deepStrictEqual(Store.getMesocycles()[0].shifts, [{ date: "2026-10-12", days: 1 }]);
Store.updateMesocycle("m", { startDate: "2026-10-06" });
assert.deepStrictEqual(Store.getMesocycles()[0].shifts, [{ date: "2026-10-12", days: 1 }]);
Store.updateMesocycle("m", { startDate: "2026-10-12" }); // on the shift's own date: kept
assert.deepStrictEqual(Store.getMesocycles()[0].shifts, [{ date: "2026-10-12", days: 1 }]);
Store.updateMesocycle("m", { startDate: "2026-10-13" });
assert.strictEqual("shifts" in Store.getMesocycles()[0], false);
// addShift keeps the list sorted; removing the last one removes the key.
Store.addShift("m", "2026-10-20", 2);
Store.addShift("m", "2026-10-13", 1);
assert.deepStrictEqual(Store.getMesocycles()[0].shifts, [{ date: "2026-10-13", days: 1 }, { date: "2026-10-20", days: 2 }]);
Store.removeShift("m", "2026-10-13");
Store.removeShift("m", "2026-10-20");
assert.strictEqual("shifts" in Store.getMesocycles()[0], false);

// Backups: valid shifts, makeup and notes import; anything else is refused.
const featureBackup = JSON.parse(JSON.stringify(backup));
featureBackup.mesocycles[0].shifts = [{ date: "2026-10-12", days: 1 }, { date: "2026-10-13", days: 366 }];
Object.assign(featureBackup.workouts[0], { makeup: true, makeupFor: "2026-10-04" });
featureBackup.exercises.push({ id: "n1", name: "Noted", note: "x".repeat(200) });
assert.strictEqual(validateBackup(featureBackup), null);
const badFeature = (edit) => { const b = JSON.parse(JSON.stringify(featureBackup)); edit(b); return validateBackup(b); };
assert.ok(badFeature((b) => { b.mesocycles[0].shifts.reverse(); }));
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[0].days = 2; })); // overlaps the next
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[0].days = 0; }));
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[0].days = 1.5; }));
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[1].days = 367; }));
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[0].date = "2026-02-30"; }));
assert.ok(badFeature((b) => { b.mesocycles[0].shifts = {}; }));
assert.ok(badFeature((b) => { b.workouts[0].makeup = "yes"; }));
assert.ok(badFeature((b) => { b.workouts[0].makeupFor = "<b>"; }));
assert.ok(badFeature((b) => { b.exercises.at(-1).note = "x".repeat(201); }));

// --- Missed days ---
const fixedWorkout = (date, dayId, { finished = false, touched = false, ...extra } = {}) => ({
  id: `w-${date}`, mesocycleId: "m", date, dayId, dayName: dayId, finished, finishedAt: null,
  exercises: [wex("s1", "bench", "Bench", 0, [touched ? logged(0, 100, 8) : blank(0)])], ...extra });
const missedOn = (meso, workouts, x, today = "2026-11-30") => { const m = findMissedDay(meso, workouts, x, today); return m && [m.dateIso, m.dayTemplate.id]; };
assert.strictEqual(missedOn(plain, [fixedWorkout("2026-11-02", "mon", { finished: true })], "2026-11-04"), null); // nothing missed
assert.deepStrictEqual(missedOn(plain, [], "2026-11-03"), ["2026-11-02", "mon"]); // one missed
assert.deepStrictEqual(missedOn(plain, [], "2026-11-05"), ["2026-11-02", "mon"]); // two in a row: the earliest
assert.deepStrictEqual(missedOn(plain, [fixedWorkout("2026-11-02", "mon", { finished: true })], "2026-11-05"), ["2026-11-04", "wed"]); // stops at a finished one
assert.deepStrictEqual(missedOn(plain, [fixedWorkout("2026-11-02", "mon", { touched: true })], "2026-11-05"), ["2026-11-04", "wed"]); // ...and a logged one
assert.deepStrictEqual(missedOn(plain, [fixedWorkout("2026-11-02", "mon")], "2026-11-05"), ["2026-11-02", "mon"]); // an untouched one is still missed
const gapWed = mwf({ shifts: [{ date: "2026-11-04", days: 1 }] }); // Wed 11-04 a gap, Wed's day on Thu
assert.deepStrictEqual(missedOn(gapWed, [], "2026-11-08"), ["2026-11-05", "wed"]); // stops at the gap day
assert.deepStrictEqual(missedOn(plain, [fixedWorkout("2026-11-03", "mon", { touched: true, makeup: true, makeupFor: "2026-11-02" })], "2026-11-05"), ["2026-11-04", "wed"]); // stops at a made-up day
assert.deepStrictEqual(missedOn(plain, [fixedWorkout("2026-11-03", "mon", { makeup: true, makeupFor: "2026-11-02" })], "2026-11-05"), ["2026-11-02", "mon"]); // ...only once the makeup is touched or finished
assert.strictEqual(missedOn(plain, [fixedWorkout("2026-11-03", "mon", { touched: true })], "2026-11-03"), null); // X logged
assert.strictEqual(missedOn(plain, [fixedWorkout("2026-11-04", "wed", { touched: true })], "2026-11-03"), null); // a later day logged
assert.strictEqual(missedOn(plain, [], "2026-11-05", "2026-11-04"), null); // X in the future
assert.strictEqual(missedOn(plain, [], "2026-11-01"), null); // X before the start
assert.strictEqual(missedOn(plain, [], "2026-11-02"), null); // nothing before the first day

// Doing it, and undoing it. Fri 11-06 finished, Mon 11-09 missed.
const mwfSlots = () => mwf({ days: [
  { id: "mon", name: "Mon", weekdayOffset: 0, exercises: [slot("s1", "bench", 0)] },
  { id: "wed", name: "Wed", weekdayOffset: 2, exercises: [slot("s2", "row", 0)] },
  { id: "fri", name: "Fri", weekdayOffset: 4, exercises: [slot("s3", "curl", 0)] },
] });
const seedMissed = () => {
  memory.clear();
  localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }, { id: "row", name: "Row" }, { id: "curl", name: "Curl" }]));
  localStorage.setItem("fah_mesocycles", JSON.stringify([mwfSlots()]));
  localStorage.setItem("fah_workouts", JSON.stringify([{ ...fixedWorkout("2026-11-02", "mon", { finished: true, touched: true }) }, { ...fixedWorkout("2026-11-06", "fri", { finished: true, touched: true }) }]));
};
const snapshot = () => ["fah_exercises", "fah_mesocycles", "fah_workouts"].map((k) => localStorage.getItem(k));
const activeMeso = () => Store.getActiveMesocycle();
// With a shift on rest day Tue 11-10: Tue does Monday's day, the rest moves.
seedMissed();
const beforeMissed = snapshot();
let made = doMissedDay(activeMeso(), "2026-11-10", "2026-11-10", true);
assert.deepStrictEqual([made.date, made.dayId, made.exercises[0].exerciseName], ["2026-11-10", "mon", "Bench"]);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-09", days: 1 }]);
assert.strictEqual(dayOn(activeMeso(), "2026-11-12"), "wed");
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-10"), true);
assert.deepStrictEqual(snapshot(), beforeMissed);
// Without a shift: only this workout moves.
made = doMissedDay(activeMeso(), "2026-11-10", "2026-11-10", false);
assert.deepStrictEqual([made.date, made.dayId, made.makeup, made.makeupFor], ["2026-11-10", "mon", true, "2026-11-09"]);
assert.strictEqual("shifts" in activeMeso(), false);
assert.strictEqual(dayOn(activeMeso(), "2026-11-11"), "wed");
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-10"), true);
assert.deepStrictEqual(snapshot(), beforeMissed);
// Unticked on a training day (Wed 11-11) is refused and changes nothing.
assert.strictEqual(doMissedDay(activeMeso(), "2026-11-11", "2026-11-11", false), null);
assert.deepStrictEqual(snapshot(), beforeMissed);
// Ticked on a training day: that day's untouched workout makes way, and
// after undo it comes back the same (a new id: it is generated again).
const wedWorkout = generateWorkout(activeMeso(), activeMeso().days[1], "2026-11-11");
made = doMissedDay(activeMeso(), "2026-11-11", "2026-11-11", true);
assert.deepStrictEqual([made.dayId, Store.getWorkouts().filter((w) => w.date === "2026-11-11").length], ["mon", 1]);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-09", days: 2 }]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-11"), true);
const regenerated = generateWorkout(activeMeso(), activeMeso().days[1], "2026-11-11");
assert.deepStrictEqual({ ...regenerated, id: wedWorkout.id }, wedWorkout);
// Nothing to undo once the workout has a logged set.
seedMissed();
made = doMissedDay(activeMeso(), "2026-11-10", "2026-11-10", false);
made.exercises[0].sets[0] = logged(0, 100, 8);
Store.updateWorkout(made.id, { exercises: made.exercises });
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-10"), false);
assert.strictEqual(Store.getWorkouts().length, 3);

// What Today shows: the missed day, then the move that can be undone. The
// program() mesocycle started two weeks ago on today's weekday, nothing logged.
seed(program());
ctx = at();
assert.deepStrictEqual([ctx.missed.dateIso, ctx.missed.dayTemplate.id, ctx.madeUp], [dayIso(-14), "A", null]);
doMissedDay(ctx.meso, todayIso, todayIso, true);
ctx = at();
assert.deepStrictEqual([ctx.workout.dayId, ctx.missed, ctx.madeUp], ["A", null, { dateIso: dayIso(-14), shifted: true }]);
undoMissedDay(ctx.meso, todayIso);
assert.deepStrictEqual(at().madeUp, null);
// A makeup on a rest day keeps its own day: never dropped as a mismatch.
seed(program());
made = doMissedDay(Store.getActiveMesocycle(), dayIso(-2), todayIso, false);
ctx = at(dayIso(-2));
assert.deepStrictEqual([ctx.workout.id, ctx.dayTemplate.id, ctx.madeUp, ctx.missed], [made.id, "A", { dateIso: dayIso(-14), shifted: false }, null]); // missed would be -14 again: never both
// ...even when its day is later removed from the program.
Store.removeDay("m", "A");
assert.strictEqual(at(dayIso(-2)).workout.id, made.id);

// --- Predictions follow history logged late ---
memory.clear();
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...fixedWorkout("2026-11-04", "wed", { finished: true }), exercises: [wex("s1", "bench", "Bench", 0, [logged(0, 100, 8)])] },
  { ...fixedWorkout("2026-11-10", "wed"), exercises: [wex("s1", "bench", "Bench", 0, [logged(0, 105, 8)])] },
  { ...fixedWorkout("2026-11-11", "wed"), exercises: [
    wex("s1", "bench", "Bench", 0, [{ ...blank(0), baseWeight: 100, baseReps: 9 }]),
    wex("s2", "row", "Row", 1, [logged(0, 50, 10), { ...blank(1), baseWeight: 1, baseReps: 1 }]),
  ] },
]));
Store.finishWorkout("w-2026-11-10"); // yesterday's, finished a day late
refreshPredictions();
const today11 = Store.getWorkout("w-2026-11-11");
assert.deepStrictEqual([today11.exercises[0].sets[0].baseWeight, today11.exercises[0].sets[0].baseReps], [105, 9]);
assert.deepStrictEqual([today11.exercises[1].sets[1].baseWeight, today11.exercises[1].sets[1].baseReps], [1, 1]); // started: left alone
const refreshed = localStorage.getItem("fah_workouts");
refreshPredictions();
assert.strictEqual(localStorage.getItem("fah_workouts"), refreshed); // nothing changed, nothing written

// --- Personal records ---
const prOf = (earlierSets, nowSets) => exercisePR(
  [workout("2026-01-01", "d", [ex("s", "bench", "Bench", ...earlierSets)])].filter(() => earlierSets.length),
  { date: "2026-02-01" }, ex("s", "bench", "Bench", ...nowSets));
assert.strictEqual(prOf([], [set(100, 8)]), null); // first time
assert.strictEqual(prOf([set(100, 8)], [set(105, 5)]), "weight");
assert.strictEqual(prOf([set(100, 8)], [set(100, 9)]), "reps");
assert.strictEqual(prOf([set(100, 8), set(90, 12)], [set(90, 10)]), null); // more than the heavier set, not more than ever at 90
assert.strictEqual(prOf([set(100, 8)], [set(100, 8)]), null); // tie
assert.strictEqual(prOf([set(100, 8)], [set(90, 10)]), null); // 90 never done before
assert.strictEqual(prOf([set(100, 8), set(90, 8)], [set(90, 10)]), "reps");
assert.strictEqual(exercisePR([{ ...workout("2026-03-01", "d", [ex("s", "bench", "Bench", set(200, 1))]) }], { date: "2026-02-01" }, ex("s", "bench", "Bench", set(100, 8))), null); // later ones do not count

// --- Editing the exercise library ---
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench", muscleGroup: "Chest" }, { id: "row", name: "Row", muscleGroup: "Back" }]));
localStorage.setItem("fah_workouts", JSON.stringify([
  workout("2026-01-01", "d", [ex("a", "bench", "Bench", set(100, 8)), ex("b", "row", "Row", set(80, 10))]),
  workout("2026-01-02", "d", [ex("a", undefined, "bench", set(100, 8))]),
]));
assert.strictEqual(Store.updateExercise("bench", { name: "  Bench Press " }).name, "Bench Press");
assert.deepStrictEqual(Store.getWorkouts().map((w) => w.exercises.map((e) => e.exerciseName)), [["Bench Press", "Row"], ["Bench Press"]]);
assert.strictEqual(Store.updateExercise("row", { name: "bench press" }), null);
assert.strictEqual(Store.updateExercise("row", { name: "   " }), null);
assert.strictEqual(Store.updateExercise("nope", { note: "x" }), null);
assert.strictEqual(Store.getExercises()[1].name, "Row");
assert.strictEqual(Store.updateExercise("row", { note: "  pause at the top " }).note, "pause at the top");
assert.strictEqual(Store.updateExercise("row", { muscleGroup: "Biceps" }).note, "pause at the top"); // other fields untouched
assert.strictEqual("note" in Store.updateExercise("row", { note: "" }), false);
assert.strictEqual(Store.updateExercise("row", { note: "y".repeat(250) }).note.length, 200);
assert.strictEqual(validateBackup({ ...Store.exportBackup(), workouts: [] }), null); // an edited library still exports
// A name a deleted exercise's entries carry is refused (its history would
// merge in by name); a case-only rename is not.
Store.saveWorkouts([...Store.getWorkouts(), workout("2026-01-03", "d", [ex("q", "deadrow", "Pendlay", set(135, 10))])]);
assert.strictEqual(Store.updateExercise("row", { name: "pendlay" }), null);
assert.strictEqual(Store.updateExercise("bench", { name: "BENCH PRESS" }).name, "BENCH PRESS");
assert.deepStrictEqual(Store.getWorkouts().map((w) => w.exercises.map((e) => e.exerciseName)), [["BENCH PRESS", "Row"], ["BENCH PRESS"], ["Pendlay"]]);

// --- Which logged entry a prediction, a PR or History follows ---
// "(unknown exercise)" (a slot whose exercise left the library) never
// matches another missing exercise by that name.
const unknownLog = [workout("2026-01-01", "d", [ex("s2", "gone2", "(unknown exercise)", set(90, 10))])];
assert.strictEqual(findLastLoggedSet(unknownLog, "d", "s1", "gone1", 0, "2026-02-01", "(unknown exercise)"), null);
assert.strictEqual(exercisePR(unknownLog, { date: "2026-02-01" }, ex("s1", "gone1", "(unknown exercise)", set(100, 10))), null);
memory.clear();
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...fixedWorkout("2026-01-01", "d", { finished: true }), exercises: [wex("s2", "gone2", "(unknown exercise)", 0, [logged(0, 90, 10)])] },
  { ...fixedWorkout("2026-01-08", "d"), exercises: [wex("s1", "gone1", "(unknown exercise)", 0, [blank(0)])] },
]));
refreshPredictions();
assert.strictEqual(Store.getWorkout("w-2026-01-08").exercises[0].sets[0].baseWeight, null);
assert.deepStrictEqual(getExerciseHistory("s1", "gone1", "(unknown exercise)"), []);
// One entry per workout: slot b's set left blank last week falls back to
// slot b two weeks ago, never to slot a's set in the same workout.
const twoSlots = [
  workout("2026-01-08", "d", [ex("a", "curl", "Curl", set(40, 9), set(40, 8)), ex("b", "curl", "Curl", set(25, 15), set(null, null))]),
  workout("2026-01-01", "d", [ex("a", "curl", "Curl", set(40, 8), set(40, 8)), ex("b", "curl", "Curl", set(25, 14), set(25, 13))]),
];
assert.strictEqual(findLastLoggedSet(twoSlots, "d", "b", "curl", 1, "2026-02-01", "Curl").weight, 25);
// A copied mesocycle has new day ids: a day of the same name comes before
// any day (Monday's heavy squat, not Thursday's newer light one).
const twoDays = [
  { ...workout("2026-01-05", "oldThu", [ex("q", "squat", "Squat", set(185, 10))]), dayName: "Thu" },
  { ...workout("2026-01-01", "oldMon", [ex("p", "squat", "Squat", set(225, 6))]), dayName: "Mon" },
];
assert.strictEqual(findLastLoggedSet(twoDays, "newMon", "n", "squat", 0, "2026-02-01", "Squat", "Mon").weight, 225);
assert.strictEqual(findLastLoggedSet(twoDays, "newMon", "n", "squat", 0, "2026-02-01", "Squat").weight, 185); // no day name given
assert.strictEqual(findLastLoggedSet(twoDays, "oldThu", "n", "squat", 0, "2026-02-01", "Squat", "Mon").weight, 185); // same day id first
// Two slots of one exercise and no slot match: the k-th slot takes the k-th
// entry by order, or the last one.
const ordered = [workout("2026-01-01", "d", [{ ...ex("b", "curl", "Curl", set(25, 15)), order: 1 }, { ...ex("a", "curl", "Curl", set(40, 8)), order: 0 }])];
assert.deepStrictEqual([0, 1, 2].map((k) => findLastLoggedSet(ordered, "d2", "new", "curl", 0, "2026-02-01", "Curl", null, k).weight), [40, 25, 25]);
// ...end to end: a copy's first week.
seed([{ id: "A", name: "Push", weekdayOffset: 0, exercises: [slot("c1", "curl", 0), slot("c2", "curl", 1)] }], [
  { ...unfinished("old", dayIso(-7), "A", [wex("c1", "curl", "Curl", 0, [logged(0, 40, 8), logged(1, 40, 8)]), wex("c2", "curl", "Curl", 1, [logged(0, 25, 10), logged(1, 25, 10)])]), dayName: "Push", finished: true },
]);
const copied = Store.cloneMesocycle("m", todayIso);
assert.deepStrictEqual(generateWorkout(copied, copied.days[0], dayIso(7)).exercises.map((e) => e.sets.map((s) => [s.baseWeight, s.baseReps])), [[[40, 9], [40, 9]], [[25, 11], [25, 11]]]);
// buildEntrySets (a swap or an added exercise on Today): the same pools and
// k-th rule. A Row swapped in after one Row in a copy's first Monday takes
// the old Monday's second Row; the first Row the first; with no day of that
// name, the newest of any day.
const rowHistory = [
  { ...workout("2026-01-05", "oldThu", [ex("t", "row", "Row", set(60, 10))]), dayName: "Thu" },
  { ...workout("2026-01-01", "oldMon", [{ ...ex("m1", "row", "Row", set(80, 10)), order: 0 }, { ...ex("m2", "row", "Row", set(70, 10)), order: 1 }]), dayName: "Mon" },
];
const copyMonday = { dayId: "newMon", dayName: "Mon", date: "2026-02-02", exercises: [wex("n1", "row", "Row", 0, []), wex("n2", "bench", "Bench", 1, [])] };
const rowEntry = { exerciseId: "row", exerciseName: "Row", targetSets: 1, repRangeMin: 8, repRangeMax: 12, weightIncrementPct: 2.5 };
assert.deepStrictEqual([buildEntrySets(copyMonday, { ...rowEntry, slotId: "n2", order: 1 }, rowHistory)[0].baseWeight,
  buildEntrySets(copyMonday, { ...rowEntry, slotId: "n1", order: 0 }, rowHistory)[0].baseWeight,
  buildEntrySets({ ...copyMonday, dayName: "Fri" }, { ...rowEntry, slotId: "n1", order: 0 }, rowHistory)[0].baseWeight], [70, 80, 60]);

// History lists every entry of the exercise, labelled by day and part.
memory.clear();
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...workout("2026-01-01", "mon", [{ ...ex("b", "curl", "Curl", set(25, 15)), order: 1 }, { ...ex("a", "curl", "Curl", set(40, 8)), order: 0 }]), dayName: "Mon" },
  { ...workout("2026-01-04", "thu", [ex("c", "curl", "Curl", set(30, 12))]), dayName: "Thu" },
  { ...workout("2025-12-01", "mon", [ex("a", undefined, "Curl", set(35, 8))]), dayName: "Mon" },
  { ...workout("2025-11-01", "mon", [ex("a", "gone", "(unknown exercise)", set(99, 9))]), dayName: "Mon" },
  { ...workout("2026-01-05", "thu", [ex("c", "curl", "Curl", set(31, 12))]), dayName: "Thu", finished: false },
]));
assert.deepStrictEqual(getExerciseHistory("a", "curl", "Curl").map((r) => [r.date, r.dayName, r.sets[0].weight, r.part, r.parts]), [
  ["2026-01-04", "Thu", 30, 1, 1], ["2026-01-01", "Mon", 40, 1, 2], ["2026-01-01", "Mon", 25, 2, 2], ["2025-12-01", "Mon", 35, 1, 1],
]);
assert.deepStrictEqual(getExerciseHistory("x", "gone2", "(unknown exercise)"), []);

// --- Reconcile: swaps, removed slots, added sets ---
// An untouched entry whose exercise differs from its slot's (swapped for all
// future on another date) follows the slot, with fresh predictions; one
// swapped for this workout only (`swapped`), or with a touched set, stays.
const swapCase = (entryExtra, sets) => {
  seed(program(), [
    { ...unfinished("h", dayIso(-7), "A", [wex("s1", "row", "Row", 0, [logged(0, 80, 10), logged(1, 80, 10)])]), finished: true },
    unfinished("r", todayIso, "A", [wex("s1", "bench", "Bench", 0, sets, entryExtra), wex("s2", "row", "Row", 1, [blank(0), blank(1)])]),
  ]);
  Store.updateExerciseSlot("m", "A", "s1", { exerciseId: "row" });
  return at().workout.exercises.find((e) => e.slotId === "s1");
};
const followed = swapCase({}, [blank(0), blank(1)]);
assert.deepStrictEqual([followed.exerciseId, followed.exerciseName, followed.order, followed.sets.map((s) => [s.baseWeight, s.baseReps, s.weight, s.reps])],
  ["row", "Row", 0, [[80, 11, null, null], [80, 11, null, null]]]);
assert.strictEqual(swapCase({ swapped: true }, [blank(0), blank(1)]).exerciseId, "bench");
assert.strictEqual(swapCase({}, [logged(0, 100, 8), blank(1)]).exerciseId, "bench");
assert.strictEqual(tampered((b) => { b.workouts[0].exercises[0].swapped = true; }), null);
assert.ok(tampered((b) => { b.workouts[0].exercises[0].swapped = "yes"; }));
// A slot removed from the program: its exercise stays, as this workout's own
// (oneOff), when a set of it is touched; goes when none is.
seed(program(), [unfinished("r", todayIso, "A", [wex("s1", "bench", "Bench", 0, [blank(0)]), wex("gone", "curl", "Curl", 1, [logged(0, 30, 12)]), wex("gone2", "row", "Row", 2, [blank(0)])])]);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 0, 1)] });
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", exercises: [slot("s1", "bench", 0, 1)] });
assert.deepStrictEqual(Store.getWorkout("r").exercises.map((e) => [e.slotId, !!e.oneOff, e.sets.length]), [["s1", false, 1], ["gone", true, 1]]);
// Sets added because the program raised the set count get predictions, for
// the entry's own exercise (here a this-workout-only swap to Curl).
seed(program(), [
  { ...unfinished("h", dayIso(-7), "A", [wex("s1", "bench", "Bench", 0, [logged(0, 100, 8), logged(1, 100, 8), logged(2, 95, 8)]), wex("y", "curl", "Curl", 1, [logged(0, 30, 10), logged(1, 30, 10), logged(2, 25, 10)])]), finished: true },
  unfinished("r", todayIso, "A", [wex("s1", "bench", "Bench", 0, [logged(0, 100, 9)]), wex("s2", "curl", "Curl", 1, [blank(0)], { swapped: true })]),
]);
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", name: "Push", exercises: [slot("s1", "bench", 0, 3), slot("s2", "row", 1, 3)] });
assert.deepStrictEqual(Store.getWorkout("r").exercises.map((e) => [e.exerciseId, e.sets]), [
  ["bench", [logged(0, 100, 9), { ...blank(1), baseWeight: 100, baseReps: 9 }, { ...blank(2), baseWeight: 95, baseReps: 9 }]],
  ["curl", [blank(0), { ...blank(1), baseWeight: 30, baseReps: 11 }, { ...blank(2), baseWeight: 25, baseReps: 11 }]],
]);

// --- Legacy sets: a carried weight, and a reopened workout ---
seed(program(), [unfinished("cw", todayIso, "A", [wex("s1", "bench", "Bench", 0, [
  { setIndex: 0, weight: 100, reps: 9, baseWeight: 100, baseReps: 9, isLogged: false, prefilled: false }, // weight carried from set 1
  { setIndex: 1, weight: 100, reps: 9, baseWeight: null, baseReps: null, isLogged: false, done: true, prefilled: true, repsManual: false }, // ticked done
])])]);
migrateLegacyPrefill(Store.getWorkout("cw"));
assert.deepStrictEqual(Store.getWorkout("cw").exercises[0].sets, [
  { setIndex: 0, weight: 100, reps: null, baseWeight: 100, baseReps: 9, isLogged: false },
  { setIndex: 1, weight: 100, reps: 9, baseWeight: null, baseReps: null, isLogged: false, done: true },
]);
// A legacy workout finished as predicted, then reopened, keeps its sets.
seed(program(), [{ ...unfinished("ro", dayIso(-7), "A", [wex("s1", "bench", "Bench", 0, [
  { setIndex: 0, weight: 100, reps: 9, baseWeight: 100, baseReps: 9, isLogged: false, prefilled: true },
])]), finished: true, finishedAt: "x" }]);
const reopened = Store.getWorkout("ro");
reopened.exercises.forEach((e) => e.sets.forEach((s) => { if (s.weight != null && s.reps != null) s.done = true; })); // what reopen-workout does
Store.updateWorkout("ro", { finished: false, finishedAt: null, exercises: reopened.exercises });
at(dayIso(-7));
assert.deepStrictEqual(Store.getWorkout("ro").exercises[0].sets, [{ setIndex: 0, weight: 100, reps: 9, baseWeight: 100, baseReps: 9, isLogged: false, done: true }]);

// --- Missed days: limits ---
// The scan looks back at most 366 days.
assert.deepStrictEqual(missedOn(mwf({ startDate: "2024-01-01" }), [], "2026-11-04"), ["2025-11-03", "mon"]);
// A backup shift may not start before its mesocycle.
assert.ok(badFeature((b) => { b.mesocycles[0].shifts[0].date = "2026-10-01"; }));
assert.strictEqual(badFeature((b) => { b.mesocycles[0].shifts[0].date = "2026-10-05"; }), null);
// An untouched makeup for M does not hide M, and is replaced when M is done
// again (Tue makeup left untouched; Thu, a rest day, does Monday instead).
seedMissed();
doMissedDay(activeMeso(), "2026-11-10", "2026-11-10", false);
made = doMissedDay(activeMeso(), "2026-11-12", "2026-11-12", false);
assert.deepStrictEqual(Store.getWorkouts().filter((w) => w.makeup).map((w) => [w.date, w.makeupFor]), [["2026-11-12", "2026-11-09"]]);
// Undo needs nothing finished or touched on X or later...
seed(program());
doMissedDay(Store.getActiveMesocycle(), todayIso, todayIso, true);
assert.deepStrictEqual(at().madeUp, { dateIso: dayIso(-14), shifted: true });
Store.createWorkout(unfinished("later", dayIso(1), "T", [wex("s3", "row", "Row", 0, [logged(0, 80, 10)])]));
assert.strictEqual(at().madeUp, null);
assert.strictEqual(undoMissedDay(Store.getActiveMesocycle(), todayIso), false);
assert.strictEqual(Store.getActiveMesocycle().shifts.length, 1);
// ...and only the last shift can be undone.
seedMissed();
doMissedDay(activeMeso(), "2026-11-10", "2026-11-10", true); // Mon 11-09 done Tue
doMissedDay(activeMeso(), "2026-11-12", "2026-11-12", true); // Tue's (Monday's) missed too, done Thu
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-09", days: 1 }, { date: "2026-11-10", days: 2 }]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-10"), false);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-12"), true);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-09", days: 1 }]);

// removeExerciseSlot renumbers in the order shown, not the order added.
memory.clear();
localStorage.setItem("fah_mesocycles", JSON.stringify([{ id: "m", name: "M", numWeeks: 4, startDate: "2026-11-02", active: true,
  days: [{ id: "d", name: "D", weekdayOffset: 0, exercises: [slot("a", "bench", 2), slot("b", "row", 0), slot("c", "curl", 1), slot("e", "bench", 3)] }] }]));
Store.removeExerciseSlot("m", "d", "b");
assert.deepStrictEqual(Store.getMesocycles()[0].days[0].exercises.map((e) => [e.id, e.order]), [["a", 1], ["c", 0], ["e", 2]]);

// The version shown in Settings is the service worker cache version.
assert.ok(fs.readFileSync(path.join(root, "sw.js"), "utf8").includes(`"fa-hypertrophy-v${APP_VERSION}"`), "APP_VERSION and CACHE_NAME differ");

// Offline: every file the app loads must be in sw.js's ASSETS, or an
// installed copy breaks without a connection (and the pre-commit hook, which
// reads the same list, stops asking for a CACHE_NAME bump).
const assets = fs.readFileSync(path.join(root, "sw.js"), "utf8").match(/const ASSETS = \[([^\]]*)\]/)[1];
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
for (const file of ["index.html", "manifest.json", ...walk("js"), ...walk("css"), ...walk("icons")]) {
  assert.ok(assets.includes(`"${file}"`), `${file} is missing from ASSETS in sw.js`);
}

console.log("ok");
