// Self-check for the pure logic (no browser needed): node scripts/test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoDate, parseLocalDate, resolveDayForDate } from "../js/schedule.js";
import { findLastLoggedSet, nextSet } from "../js/progression.js";

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
