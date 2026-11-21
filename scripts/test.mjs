// Self-check for the pure logic (no browser needed): node scripts/test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, daysBetween, isIsoDate, formatDay, formatShortDate, isoDate, parseLocalDate, resolveDayForDate } from "../js/schedule.js";
import { buildPrefilledSets, equivalentReps, findLastLoggedSet, nextSet, pctPerRep } from "../js/progression.js";
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
const { getExerciseHistory, getTodayContext, migrateLegacyPrefill, reconcileWorkoutWithTemplate } = await import("../js/workout.js");

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
const fine = [{ numWeeks: 6, startDate: "2026-9-1", days: [{ exercises: [{ targetSets: 3, repRangeMin: 8, repRangeMax: 12 }, { targetSets: 2, repRangeMin: 5, repRangeMax: 10, weightIncrementPct: 2.5 }] }] }];
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
// One already saved is repaired at startup (today); a merely unpadded one,
// which still works, is left alone.
localStorage.setItem("fah_mesocycles", JSON.stringify([
  { id: "a", name: "A", numWeeks: 4, startDate: "999999-01-01", active: true, days: [] },
  { id: "b", name: "B", numWeeks: 4, active: false, days: [] },
  { id: "c", name: "C", numWeeks: 4, startDate: "2026-9-1", active: false, days: [] },
]));
Store.normalize();
assert.deepStrictEqual(Store.getMesocycles().map((m) => m.startDate), [isoDate(new Date()), isoDate(new Date()), "2026-9-1"]);

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
