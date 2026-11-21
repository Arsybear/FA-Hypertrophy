// Self-check for the pure logic (no browser needed): node scripts/test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoDate, parseLocalDate, resolveDayForDate } from "../js/schedule.js";
import { findLastLoggedSet, nextSet } from "../js/progression.js";
import { APP_VERSION } from "../js/version.js";

// store.js only touches localStorage inside functions, so a Map stands in.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
};
const { Store, validateBackup } = await import("../js/store.js");

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
Store.importBackup(backup);
assert.strictEqual(Store.getWorkouts().length, 1);
assert.ok(localStorage.getItem("fah_before_import"));

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
