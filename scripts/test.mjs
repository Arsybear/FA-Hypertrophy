// Self-check for the pure logic (no browser needed): node scripts/test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, daysBetween, isIsoDate, offsetWeekday, plannedEndIso, totalShiftDays, weekNumber, formatDay, formatShortDate, isoDate, parseLocalDate, resolveDayForDate } from "../js/schedule.js";
import { PRESETS, PROGRESSIONS, buildPrefilledSets, dueUnits, equivalentReps, exercisePR, findLastLoggedSet, hintReps, minIncrementFor, nextSet, nextSets, pctPerRep, phaseOf, presetFromPct, progressionOf, stepCost, triggerReps, weekOf, weightFirst } from "../js/progression.js";
import { APP_VERSION } from "../js/version.js";

// store.js only touches localStorage inside functions, so a Map stands in.
const memory = new Map();
let fullKey = null; // a write to this key fails, as when storage is full
let quota = Infinity; // characters of keys and values, as browsers count a replaced key by its change
const used = () => [...memory].reduce((n, [k, v]) => n + k.length + v.length, 0);
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => {
    const after = used() - (memory.has(k) ? k.length + memory.get(k).length : 0) + k.length + String(v).length;
    if (k === fullKey || after > quota) throw new Error("QuotaExceededError");
    memory.set(k, String(v));
  },
  removeItem: (k) => memory.delete(k),
};
const { Store, cleanMinIncrement, cleanSetValue, normalizeMesocycles, validateBackup } = await import("../js/store.js");
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

// The progression rule (coach's spec-lines.txt): the preset is a pace in
// rep-equivalents a week, due as whole units on calendar weeks per exercise.
const DATES = ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"];
const ns = (w, r, min, max, preset, inc, date, id = "bench") => { const n = nextSet(set(w, r), min, max, preset, inc, weekOf(date), phaseOf(id)); return `${n.weight}x${n.reps}`; };
const fmt = (sets) => sets.map((s) => s && `${s.weight}x${s.reps ?? "-"}`); // x-: a weight with no rep target
assert.deepStrictEqual(["1970-01-05", "1970-01-04", "2026-11-23", "2026-11-29", "2026-11-30", "2026-03-29"].map(weekOf), [0, -1, 2968, 2968, 2969, 2933]);
assert.deepStrictEqual(["bench", "row", "Lift 1", "Lift 2", ""].map(phaseOf), [0.364328624214977, 0.6921157399192452, 0.4017844588961452, 0.5268021458759904, 0.6689221884589642]);
assert.deepStrictEqual([[8, 12], [5, 8], [6, 10], [10, 15], [3, 6], [8, 9], [8, 8]].map(([min, max]) => PROGRESSIONS.map((p) => triggerReps(p, min, max)).join("|")),
  ["12|11|10", "8|7|6", "10|9|8", "15|14|12", "6|5|4", "9|9|8", "8|8|8"]);
assert.deepStrictEqual([0.2, 0.4, 0.8, 1.6].map((r) => dueUnits(r, weekOf("2026-11-23"), phaseOf("bench"))), [0, 1, 1, 2]);
assert.strictEqual(dueUnits(0.2, weekOf("1969-12-29"), phaseOf("bench")), 0);
assert.deepStrictEqual([[100, 2.5], [100, 1.25], [17.5, 2.5], [15, 1.25], [230, 10], [315, 5]].map(([w, i]) => `${Math.round(stepCost(w, i) * 1e4) / 1e4}/${weightFirst(w, i)}`),
  ["1/false", "0.5/true", "1/false", "0.5556/true", "1.7391/false", "0.6349/true"]);
// Key lines (exercise "bench").
assert.strictEqual(ns(17.5, 9, 6, 9, "moderate", 2.5, "2026-11-30"), "20x8"); // the user's points
assert.strictEqual(ns(15, 8, 5, 8, "moderate", 5, "2026-11-30"), "20x6");
assert.strictEqual(ns(100, 7, 8, 12, "light", 2.5, "2026-11-23"), "100x8"); // under the range: +1 every session
assert.deepStrictEqual(["2026-11-23", "2026-12-07"].map((d) => ns(0, 12, 8, 12, "light", 2.5, d)), ["0x12", "0x13"]); // bodyweight
assert.strictEqual(ns(235, 4, 5, 8, "aggressive", 5, "2026-11-23"), "235x5"); // a miss
assert.strictEqual(ns(100, 12, 8, 12, "light", 2.5, "2026-11-23"), "102.5x11"); // at the top: jump in any week
assert.deepStrictEqual(["aggressive", "moderate"].map((p) => ns(95, 10, 8, 12, p, 2.5, "2026-11-23")), ["97.5x10", "95x11"]); // early jump
assert.strictEqual(ns(20, 10, 8, 12, "aggressive", 10, "2026-11-23"), "20x11"); // early jump would land under the range
assert.strictEqual(ns(225, 8, 8, 9, "aggressive", 5, "2026-11-23"), "225x9"); // weight-first at the bottom
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => ns(20, 20, 8, 12, "moderate", 2.5, d)), ["22.5x12", "22.5x12"]); // overshoot: one step
assert.strictEqual(ns(100, 15, 8, 12, "moderate", 2.5, "2026-11-30"), "102.5x12");
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => ns(225, 12, 5, 8, "moderate", 5, d)), ["230x8", "230x8"]); // max(due, 1), not due + 1
assert.strictEqual(ns(225, 12, 5, 8, "aggressive", 1.25, "2026-11-23"), "230x8");
assert.strictEqual(ns(20, 13, 8, 12, "moderate", 10, "2026-11-23"), "30x10");
assert.strictEqual(ns(10, 16, 10, 15, "moderate", 10, "2026-11-30"), "10x16"); // a step would land under the range
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => ns(10, 17, 10, 15, "moderate", 10, d)), ["20x10", "20x11"]);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5), TypeError);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5, weekOf("2026-11-23")), TypeError);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5, undefined, 0.5), TypeError); // a phase but no week
assert.strictEqual(ns(10.2, 12, 8, 12, "moderate", 1.1, "2026-11-23"), "11.3x12"); // rounded to 0.001 (10.2 + 1.1 is 11.299999999999999)
assert.strictEqual(ns(10, 5, 1, 5, "moderate", 10, "2026-11-30"), "20x1"); // reps never under 1
// F3: a log from the target's own calendar week has no units due.
assert.strictEqual(nextSet(set(100, 10), 8, 12, "moderate", 2.5, 2968, phaseOf("bench"), 2968).reps, 10);
assert.strictEqual(nextSet(set(100, 10), 8, 12, "moderate", 2.5, 2968, phaseOf("bench"), 2967).reps, 11);
// The version 34 lines on each of the five dates.
for (const [args, want] of [
  [[100, 8, 8, 12, "moderate", 2.5], "100x9 100x8 100x9 100x8 100x8"],
  [[95, 12, 8, 12, "moderate", 2.5], "97.5x12 97.5x11 97.5x12 97.5x11 97.5x11"],
  [[95, 12, 8, 12, "light", 2.5], "97.5x11 97.5x11 97.5x12 97.5x11 97.5x11"],
  [[95, 10, 8, 12, "aggressive", 2.5], "97.5x10 97.5x10 97.5x10 97.5x10 97.5x9"],
  [[95, 10, 8, 12, "moderate", 2.5], "95x11 95x10 95x11 95x10 95x10"],
  [[225, 8, 5, 8, "moderate", 5], "230x8 225x8 230x8 225x8 225x8"],
  [[225, 8, 5, 8, "moderate", 2.5], "227.5x8 227.5x8 227.5x8 227.5x8 227.5x8"],
  [[225, 8, 5, 8, "light", 2.5], "227.5x8 225x8 227.5x8 225x8 225x8"],
  [[225, 7, 5, 8, "aggressive", 5], "230x7 230x7 230x7 230x7 230x7"],
  [[20, 12, 8, 12, "light", 5], "25x10 25x10 25x11 25x10 25x10"],
  [[20, 12, 8, 12, "moderate", 5], "25x11 25x10 25x11 25x10 25x10"],
  [[20, 12, 8, 12, "aggressive", 5], "25x11 25x11 25x11 25x11 25x10"],
  [[20, 12, 8, 12, "moderate", 10], "30x9 30x8 30x9 30x8 30x8"],
  [[20, 10, 8, 12, "moderate", 10], "20x11 20x10 20x11 20x10 20x10"],
  [[10, 15, 10, 15, "moderate", 10], "10x16 10x15 10x16 10x15 10x15"],
  [[10, 16, 10, 15, "moderate", 10], "20x10 10x16 20x10 10x16 10x16"],
  [[10, 17, 10, 15, "moderate", 10], "20x11 20x10 20x11 20x10 20x10"],
  [[60, 12, 8, 12, "moderate", 5], "65x11 65x10 65x11 65x10 65x10"],
  [[235, 4, 5, 8, "moderate", 5], "235x5 235x5 235x5 235x5 235x5"],
  [[100, 15, 8, 12, "moderate", 2.5], "102.5x12 102.5x12 102.5x12 102.5x12 102.5x12"],
  [[17.5, 9, 6, 9, "moderate", 2.5], "20x9 20x8 20x9 20x8 20x8"],
  [[15, 8, 5, 8, "moderate", 5], "20x7 20x6 20x7 20x6 20x6"],
  [[0, 12, 8, 12, "moderate", 2.5], "0x13 0x12 0x13 0x12 0x12"],
]) assert.strictEqual(DATES.map((d) => ns(...args, d)).join(" "), want, args.join());
// The dated tables: light | moderate | aggressive, each on the five dates.
const TABLE = `20x10 8-12 /2.5 | 20x10 20x10 20x11 20x10 20x10 | 20x11 20x10 20x11 20x10 20x10 | 22.5x10 22.5x10 22.5x10 22.5x10 22.5x9
20x10 8-12 /5 | 20x10 20x10 20x11 20x10 20x10 | 20x11 20x10 20x11 20x10 20x10 | 25x9 25x9 25x9 25x9 25x8
20x12 8-12 /2.5 | 22.5x11 22.5x11 22.5x12 22.5x11 22.5x11 | 22.5x12 22.5x11 22.5x12 22.5x11 22.5x11 | 22.5x12 22.5x12 22.5x12 22.5x12 22.5x11
20x12 8-12 /5 | 25x10 25x10 25x11 25x10 25x10 | 25x11 25x10 25x11 25x10 25x10 | 25x11 25x11 25x11 25x11 25x10
60x10 8-12 /2.5 | 60x10 60x10 60x11 60x10 60x10 | 60x11 60x10 60x11 60x10 60x10 | 62.5x10 62.5x10 62.5x10 62.5x10 62.5x9
60x10 8-12 /5 | 60x10 60x10 60x11 60x10 60x10 | 60x11 60x10 60x11 60x10 60x10 | 65x9 65x9 65x9 65x9 65x8
60x12 8-12 /2.5 | 62.5x11 62.5x11 62.5x12 62.5x11 62.5x11 | 62.5x12 62.5x11 62.5x12 62.5x11 62.5x11 | 62.5x12 62.5x12 62.5x12 62.5x12 62.5x11
60x12 8-12 /5 | 65x10 65x10 65x11 65x10 65x10 | 65x11 65x10 65x11 65x10 65x10 | 65x11 65x11 65x11 65x11 65x10
95x8 6-10 /2.5 | 95x8 95x8 95x9 95x8 95x8 | 95x9 95x8 95x9 95x8 95x8 | 97.5x8 97.5x8 97.5x8 97.5x8 97.5x7
95x8 6-10 /5 | 95x8 95x8 95x9 95x8 95x8 | 95x9 95x8 95x9 95x8 95x8 | 100x7 100x7 100x7 100x7 100x6
95x10 6-10 /2.5 | 97.5x9 97.5x9 97.5x10 97.5x9 97.5x9 | 97.5x10 97.5x9 97.5x10 97.5x9 97.5x9 | 97.5x10 97.5x10 97.5x10 97.5x10 97.5x9
95x10 6-10 /5 | 100x8 100x8 100x9 100x8 100x8 | 100x9 100x8 100x9 100x8 100x8 | 100x9 100x9 100x9 100x9 100x8
135x10 8-12 /2.5 | 135x10 135x10 137.5x10 135x10 135x10 | 137.5x10 135x10 137.5x10 137.5x10 135x10 | 137.5x10 137.5x10 140x10 137.5x10 137.5x10
135x10 8-12 /5 | 135x10 135x10 135x11 135x10 135x10 | 135x11 135x10 135x11 135x10 135x10 | 140x10 140x10 140x10 140x10 140x9
135x12 8-12 /2.5 | 135x12 135x12 137.5x12 135x12 135x12 | 137.5x12 135x12 137.5x12 137.5x12 135x12 | 137.5x12 137.5x12 140x12 137.5x12 137.5x12
135x12 8-12 /5 | 140x11 140x11 140x12 140x11 140x11 | 140x12 140x11 140x12 140x11 140x11 | 140x12 140x12 140x12 140x12 140x11
185x10 8-12 /2.5 | 187.5x10 185x10 187.5x10 185x10 185x10 | 187.5x10 187.5x10 187.5x10 187.5x10 185x10 | 190x10 187.5x10 190x10 190x10 187.5x10
185x10 8-12 /5 | 185x10 185x10 185x11 185x10 185x10 | 185x11 185x10 185x11 185x10 185x10 | 190x10 190x10 190x10 190x10 190x9
185x12 8-12 /2.5 | 187.5x12 185x12 187.5x12 185x12 185x12 | 187.5x12 187.5x12 187.5x12 187.5x12 185x12 | 190x12 187.5x12 190x12 190x12 187.5x12
185x12 8-12 /5 | 190x11 190x11 190x12 190x11 190x11 | 190x12 190x11 190x12 190x11 190x11 | 190x12 190x12 190x12 190x12 190x11
225x6 5-8 /2.5 | 227.5x6 225x6 227.5x6 225x6 225x6 | 227.5x6 227.5x6 227.5x6 227.5x6 227.5x6 | 230x6 230x6 230x6 230x6 227.5x6
225x6 5-8 /5 | 225x6 225x6 230x6 225x6 225x6 | 230x6 225x6 230x6 225x6 225x6 | 230x6 230x6 230x6 230x6 230x6
225x8 5-8 /2.5 | 227.5x8 225x8 227.5x8 225x8 225x8 | 227.5x8 227.5x8 227.5x8 227.5x8 227.5x8 | 230x8 230x8 230x8 230x8 227.5x8
225x8 5-8 /5 | 225x8 225x8 230x8 225x8 225x8 | 230x8 225x8 230x8 225x8 225x8 | 230x8 230x8 230x8 230x8 230x8
315x4 3-6 /2.5 | 317.5x4 315x4 317.5x4 317.5x4 315x4 | 317.5x4 317.5x4 320x4 317.5x4 317.5x4 | 322.5x4 320x4 322.5x4 322.5x4 320x4
315x4 3-6 /5 | 320x4 315x4 320x4 315x4 315x4 | 320x4 315x4 320x4 320x4 315x4 | 320x4 320x4 325x4 320x4 320x4
315x6 3-6 /2.5 | 317.5x6 315x6 317.5x6 317.5x6 315x6 | 317.5x6 317.5x6 320x6 317.5x6 317.5x6 | 322.5x6 320x6 322.5x6 322.5x6 320x6
315x6 3-6 /5 | 320x6 315x6 320x6 315x6 315x6 | 320x6 315x6 320x6 320x6 315x6 | 320x6 320x6 325x6 320x6 320x6`;
const ROW_TABLE = `60x10 8-12 /2.5 | 60x10 60x10 60x10 60x11 60x10 | 60x10 60x11 60x10 60x11 60x10 | 62.5x9 62.5x10 62.5x10 62.5x10 62.5x10
60x10 8-12 /5 | 60x10 60x10 60x10 60x11 60x10 | 60x10 60x11 60x10 60x11 60x10 | 65x8 65x9 65x9 65x9 65x9
135x10 8-12 /2.5 | 135x10 135x10 135x10 137.5x10 135x10 | 135x10 137.5x10 135x10 137.5x10 137.5x10 | 137.5x10 137.5x10 137.5x10 137.5x10 137.5x10
135x10 8-12 /5 | 135x10 135x10 135x10 135x11 135x10 | 135x10 135x11 135x10 135x11 135x10 | 140x9 140x10 140x10 140x10 140x10
225x6 5-8 /2.5 | 225x6 227.5x6 225x6 227.5x6 225x6 | 225x6 227.5x6 227.5x6 227.5x6 227.5x6 | 227.5x6 230x6 230x6 230x6 230x6
225x6 5-8 /5 | 225x6 225x6 225x6 230x6 225x6 | 225x6 230x6 225x6 230x6 225x6 | 225x6 230x6 230x6 230x6 230x6`;
for (const [id, table] of [["bench", TABLE], ["row", ROW_TABLE]]) {
  for (const line of table.split("\n")) {
    const [, w, r, min, max, inc, ...cols] = line.match(/^([\d.]+)x(\d+) (\d+)-(\d+) \/([\d.]+) \| (.*) \| (.*) \| (.*)$/);
    PROGRESSIONS.forEach((p, k) => assert.strictEqual(DATES.map((d) => ns(+w, +r, +min, +max, p, +inc, d, id)).join(" "), cols[k], `${id} ${line} ${p}`));
  }
}
// nextSets: the set-1 group.
const nss = (sets, min, max, inc, date, firstWeights = sets.map(() => sets[0][0])) =>
  fmt(nextSets(sets.map(([w, r]) => set(w, r)), firstWeights, min, max, "moderate", inc, weekOf(date), phaseOf("bench")));
assert.deepStrictEqual(nss([[185, 12], [185, 10], [185, 9]], 8, 12, 2.5, "2026-11-23"), ["187.5x12", "187.5x10", "187.5x9"]);
assert.deepStrictEqual(nss([[185, 11], [185, 9], [185, 8]], 8, 12, 2.5, "2026-11-23"), ["185x12", "185x10", "185x9"]);
assert.deepStrictEqual(nss([[60, 12], [60, 10], [60, 9]], 8, 12, 5, "2026-11-30"), ["65x10", "65x8", "65x7"]);
assert.deepStrictEqual(nss([[60, 12], [60, 10], [60, 9]], 8, 12, 5, "2026-11-23"), ["65x11", "65x9", "65x8"]);
assert.deepStrictEqual(nss([[100, 11], [100, 13], [100, 12]], 8, 12, 2.5, "2026-11-23"), ["102.5x11", "102.5x12", "102.5x12"]);
assert.deepStrictEqual(nss([[10, 15], [10, 13], [10, 12]], 10, 15, 10, "2026-11-23"), ["10x16", "10x14", "10x13"]);
assert.deepStrictEqual(nss([[185, 7], [185, 9], [185, 6]], 8, 12, 2.5, "2026-11-23"), ["185x8", "185x9", "185x7"]);
assert.deepStrictEqual(nss([[0, 12], [0, 10], [0, 7]], 8, 12, 2.5, "2026-11-23"), ["0x13", "0x11", "0x8"]);
assert.deepStrictEqual(nss([[185, 11], [185, 9], [135, 12]], 8, 12, 2.5, "2026-11-23"), ["187.5x11", "187.5x9", "137.5x12"]);
// A straight set from an older workout at another weight (firstWeights[2] = its own weight there).
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => nss([[250, 8], [250, 7], [245, 6]], 8, 12, 2.5, d, [250, 250, 245])), [["250x8", "250x8", "250x5"], ["250x9", "250x8", "250x6"]]);
assert.deepStrictEqual(nss([[35, 10], [35, 9], [20, 12]], 8, 12, 5, "2026-11-30", [35, 35, 20]), ["35x10", "35x9", "35x-"]); // costs 6 reps
assert.deepStrictEqual(nss([[30, 10], [30, 9], [20, 12]], 8, 12, 5, "2026-11-30", [30, 30, 20]), ["30x10", "30x9", "30x8"]); // exactly 4: a number
assert.deepStrictEqual(nss([[32.5, 10], [32.5, 9], [20, 12]], 8, 12, 2.5, "2026-11-30", [32.5, 32.5, 20]), ["32.5x10", "32.5x9", "32.5x-"]); // 5 reps: over the limit
assert.deepStrictEqual(nss([[10, 22], [10, 20], [10, 19]], 10, 15, 10, "2026-11-30"), ["20x15", "20x13", "20x12"]); // logged with set 1: always a number
assert.deepStrictEqual(nss([[185, 12], [185, 10], [150, 9]], 8, 12, 2.5, "2026-11-23", [185, 185, 150]), ["187.5x12", "187.5x10", "187.5x-"]);
// A drop set (alone) whose own log is from the target's week: no units due.
const dropWeek = (w3) => fmt(nextSets([set(185, 11), set(185, 9), set(135, 12)], [185, 185, 185], 8, 12, "moderate", 2.5, weekOf("2026-11-23"), phaseOf("bench"), [2967, 2967, w3]));
assert.deepStrictEqual([2968, 2967].map(dropWeek), [["187.5x11", "187.5x9", "135x12"], ["187.5x11", "187.5x9", "137.5x12"]]);
assert.deepStrictEqual(nss([[20, 12], [20, 1]], 8, 12, 5, "2026-11-23"), ["25x11", "25x1"]); // a follower's reps never under 1
assert.deepStrictEqual(nss([[10, 15], [10, 15]], 10, 15, 10, "2026-11-23"), ["10x16", "10x16"]); // capped at set 1's reps past the top
// The reps placeholder after a weight is typed: at the predicted weight it
// is the predicted reps, whatever the range.
assert.deepStrictEqual([[100, 6, 100, 8, 12], [100, 6, 100, 5, 5], [10, 13, 10, 10, 12], [60, 10, 70, 4, 12], [60, 10, 70, 8, 12]].map((a) => hintReps(...a)), [6, 6, 13, 6, 8]);
assert.strictEqual(hintReps(null, null, 100, 8, 12), null);
// Presets of slots and entries saved before presets (weightIncrementPct only).
assert.deepStrictEqual([undefined, 2.5, 0, 1, 1.25, 3.75, 4, 5].map(presetFromPct), ["moderate", "moderate", "light", "light", "moderate", "moderate", "aggressive", "aggressive"]);
assert.strictEqual(progressionOf({ progression: "constructor" }), "moderate");
assert.strictEqual(progressionOf({ progression: "light", weightIncrementPct: 5 }), "light");
// The minimum step comes from the library: by id, by name, else 2.5.
const incLib = [{ id: "db", name: "Curl", minIncrement: 5 }, { id: "zero", name: "Zero", minIncrement: 0 }, { id: "neg", name: "Neg", minIncrement: -5 }, { id: "none", name: "None" }];
assert.deepStrictEqual([minIncrementFor(incLib, "db", "x"), minIncrementFor(incLib, undefined, "Curl"), minIncrementFor(incLib, "gone", "(unknown exercise)"),
  minIncrementFor([...incLib, { id: "u", name: "(unknown exercise)", minIncrement: 10 }], "gone", "(unknown exercise)"),
  minIncrementFor(incLib, "none", "None"), minIncrementFor(incLib, "zero", "Zero"), minIncrementFor(incLib, "neg", "Neg")], [5, 5, 2.5, 2.5, 2.5, 2.5, 2.5]);

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
// Storage nearly full, no room for the copy: the old data has a big library,
// the file a small one, a program as much bigger as the library is smaller,
// and a log that does not fit. The old values all go back (they fit before).
const bigLibrary = JSON.parse(JSON.stringify(backup));
bigLibrary.exercises.push(...Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, name: `Filler ${i}`.padEnd(60, ".") })));
Store.importBackup(bigLibrary);
localStorage.removeItem("fah_before_import");
const liveKeys = ["fah_exercises", "fah_mesocycles", "fah_workouts"];
const before = liveKeys.map((k) => localStorage.getItem(k));
const other = JSON.parse(JSON.stringify(backup));
other.mesocycles[0].name += "o".repeat(JSON.stringify(bigLibrary.exercises).length - JSON.stringify(backup.exercises).length);
other.workouts[0].dayName += "w".repeat(5000);
quota = used() + 100;
assert.strictEqual(Store.importBackup(other), false);
quota = Infinity;
assert.deepStrictEqual(liveKeys.map((k) => localStorage.getItem(k)), before);
// An older import's copy never stays as the copy of a later one.
Store.importBackup(backup);
assert.ok(localStorage.getItem("fah_before_import"));
fullKey = "fah_before_import";
assert.strictEqual(Store.importBackup(backup), true);
fullKey = null;
assert.strictEqual(localStorage.getItem("fah_before_import"), null);

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

// Rep estimate after a weight change: one rep per 2.5 lb, between 2.5 % and
// 15 % per rep.
const pct4 = (w) => Math.round(pctPerRep(w) * 10000) / 10000;
assert.deepStrictEqual([10, 20, 45, 90, 135, 300].map(pct4), [15, 12.5, 5.5556, 2.7778, 2.5, 2.5]);
assert.strictEqual(equivalentReps(17.5, 9, 20), 8); // the real progressions the light rate is fitted to
assert.strictEqual(equivalentReps(15, 8, 20), 6);
assert.strictEqual(equivalentReps(90, 10, 100), 6);
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
// Predictions depend on the workout's calendar week: units due for an
// exercise at moderate (0 or 1), and the first week from a date with that many.
const dueOn = (iso, id = "bench") => dueUnits(PRESETS.moderate.repsPerWeek, weekOf(iso), phaseOf(id));
const weekWith = (units, fromIso = todayIso, id = "bench") => {
  let d = parseLocalDate(fromIso);
  while (dueOn(isoDate(d), id) !== units) d = addDays(d, 7);
  return isoDate(d);
};
const basesOn = (w, iso, i = 0) => buildEntrySets({ ...w, date: iso }, { ...w.exercises[i], targetSets: w.exercises[i].sets.length }).map((s) => [s.baseWeight, s.baseReps]);
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
assert.deepStrictEqual(ctx.workout.exercises[0].sets.map((s) => [s.baseWeight, s.baseReps, s.weight]), [[100, 8 + dueOn(todayIso), null], [100, 8, null]]);
assert.deepStrictEqual([weekWith(1), weekWith(0)].map((d) => basesOn(ctx.workout, d)), [[[100, 9], [100, 8]], [[100, 8], [100, 8]]]); // set 2 under the range: +1 in any week
assert.strictEqual(stored().length, 2);
const afterFirst = localStorage.getItem("fah_workouts");
assert.strictEqual(at().workout.id, ctx.workout.id);
assert.strictEqual(localStorage.getItem("fah_workouts"), afterFirst);

// A slot from before presets gets its preset from weightIncrementPct (5 ->
// aggressive); one with neither field is moderate. Entries carry
// `progression`, never weightIncrementPct.
const oldSlot = program();
delete oldSlot[0].exercises[0].weightIncrementPct;
oldSlot[0].exercises[1].weightIncrementPct = 5;
seed(oldSlot);
assert.deepStrictEqual(at().workout.exercises.map((e) => [e.progression, "weightIncrementPct" in e]), [["moderate", false], ["aggressive", false]]);

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
// An untouched legacy workout reads as untouched everywhere: migrated before
// the stale-day check (dropped on its first view), and refreshPredictions
// (startup, import) migrates every unfinished one, so it no longer blocks
// the Missed card.
seed(program(), [unfinished("old", dayIso(-1), "A", [wex("s1", "bench", "Bench", 0, [{ ...legacySet, setIndex: 0 }])])]);
assert.strictEqual(at(dayIso(-1)).workout.dayId, "Y");
assert.deepStrictEqual(stored().map((w) => w.id).includes("old"), false);
seed(program(), [unfinished("leg", dayIso(-1), "Y", [wex("s4", "curl", "Curl", 0, [{ ...legacySet, setIndex: 0 }])])]);
refreshPredictions();
assert.deepStrictEqual(stored()[0].exercises[0].sets[0], { setIndex: 0, weight: null, reps: null, baseWeight: null, baseReps: null, isLogged: false }); // then predicted afresh (no history here)
assert.ok(findMissedDay(Store.getActiveMesocycle(), stored(), todayIso, todayIso));
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
assert.ok(badFeature((b) => { delete b.workouts[0].makeupFor; }));
// Ids are unique: exercises, mesocycles, workouts, and the days and the
// slots of one mesocycle. More than one active mesocycle still restores.
assert.ok(badFeature((b) => { b.workouts.push({ ...b.workouts[0], date: "2026-10-06" }); }));
assert.ok(badFeature((b) => { b.exercises.push({ ...b.exercises[0], name: "Other name" }); }));
assert.ok(badFeature((b) => { b.mesocycles[1].id = b.mesocycles[0].id; }));
assert.ok(badFeature((b) => { b.mesocycles[0].days.push({ ...b.mesocycles[0].days[0], exercises: [], weekdayOffset: 1 }); }));
assert.ok(badFeature((b) => { b.mesocycles[0].days.push({ id: "d2", name: "Pull", weekdayOffset: 1, exercises: [{ ...b.mesocycles[0].days[0].exercises[0] }] }); }));
assert.strictEqual(badFeature((b) => { b.mesocycles[1].days = JSON.parse(JSON.stringify(b.mesocycles[0].days)); }), null); // another mesocycle's ids may repeat
const twoActive = JSON.parse(JSON.stringify(featureBackup));
twoActive.mesocycles.forEach((m) => { m.active = true; });
assert.strictEqual(validateBackup(twoActive), null);
assert.strictEqual(Store.importBackup(twoActive), true);
assert.deepStrictEqual(Store.getMesocycles().map((m) => m.active), [true, false, false]);
const twoActiveStored = twoActive.mesocycles.map((m) => ({ ...m, active: true }));
assert.strictEqual(normalizeMesocycles(twoActiveStored), true); // the same at startup
assert.deepStrictEqual(twoActiveStored.map((m) => m.active), [true, false, false]); // a makeup names its missed day (Today formats it)
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
// On a gap day of a shift nothing is offered: a second shift from there
// would leave the day itself a rest day.
assert.strictEqual(missedOn(mwf({ shifts: [{ date: "2026-11-09", days: 2 }] }), [], "2026-11-09"), null);
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
assert.deepStrictEqual([today11.exercises[0].sets[0].baseWeight, today11.exercises[0].sets[0].baseReps], [105, 8]); // logged the same week: no unit due
assert.deepStrictEqual(basesOn(today11, "2026-11-23"), [[105, 9]]); // a due week later: the rise
assert.deepStrictEqual([today11.exercises[1].sets[1].baseWeight, today11.exercises[1].sets[1].baseReps], [1, 1]); // started: left alone
const refreshed = localStorage.getItem("fah_workouts");
refreshPredictions();
assert.strictEqual(localStorage.getItem("fah_workouts"), refreshed); // nothing changed, nothing written
// A finished workout's predictions are never redone (a skipped set keeps its old one).
memory.clear();
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...fixedWorkout("2026-11-04", "wed", { finished: true }), exercises: [wex("s1", "bench", "Bench", 0, [logged(0, 100, 12)])] },
  { ...fixedWorkout("2026-11-11", "wed", { finished: true }), exercises: [wex("s1", "bench", "Bench", 0, [{ ...blank(0), baseWeight: 1, baseReps: 1 }])] },
]));
refreshPredictions();
assert.deepStrictEqual([Store.getWorkout("w-2026-11-11").exercises[0].sets[0].baseWeight, Store.getWorkout("w-2026-11-11").exercises[0].sets[0].baseReps], [1, 1]);

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
// Only finished workouts strictly before count: not another mesocycle's on
// the same date, not an unfinished earlier one.
const benchAt = (date, s, extra = {}) => ({ ...workout(date, "d", [ex("s", "bench", "Bench", s)]), ...extra });
assert.strictEqual(exercisePR([benchAt("2026-01-01", set(90, 8)), benchAt("2026-02-01", set(200, 1), { mesocycleId: "other" })], { date: "2026-02-01" }, ex("s", "bench", "Bench", set(100, 8))), "weight");
assert.strictEqual(exercisePR([benchAt("2026-01-01", set(90, 8)), benchAt("2026-01-15", set(200, 1), { finished: false })], { date: "2026-02-01" }, ex("s", "bench", "Bench", set(100, 8))), "weight");
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
Store.addExercise("Curl", "Biceps"); // in the library, in no workout
assert.strictEqual(Store.updateExercise("row", { name: "curl" }), null);
// Storage full on the history write: the rename is undone, not half done.
console.error = () => {};
fullKey = "fah_workouts";
assert.strictEqual(Store.updateExercise("row", { name: "Seated Row" }), null);
fullKey = null;
console.error = realError;
Store.writeFailed = false;
assert.strictEqual(Store.getExercises().find((e) => e.id === "row").name, "Row");
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
const copyWeek = generateWorkout(copied, copied.days[0], dayIso(7));
const u7 = dueOn(dayIso(7), "curl");
assert.deepStrictEqual(copyWeek.exercises.map((e) => e.sets.map((s) => [s.baseWeight, s.baseReps])), [[[40, 8 + u7], [40, 8 + u7]], [[25, 10 + u7], [25, 10 + u7]]]);
assert.deepStrictEqual([1, 0].map((u) => [0, 1].map((i) => basesOn(copyWeek, weekWith(u, dayIso(7), "curl"), i))), [[[[40, 9], [40, 9]], [[25, 11], [25, 11]]], [[[40, 8], [40, 8]], [[25, 10], [25, 10]]]]);
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
  ["row", "Row", 0, [[80, 10 + dueOn(todayIso, "row"), null, null], [80, 10 + dueOn(todayIso, "row"), null, null]]]);
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u, todayIso, "row"))), [[[80, 11], [80, 11]], [[80, 10], [80, 10]]]);
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
  ["bench", [logged(0, 100, 9), { ...blank(1), baseWeight: 100, baseReps: 8 + dueOn(todayIso) }, { ...blank(2), baseWeight: 95, baseReps: 8 + dueOn(todayIso) }]],
  ["curl", [blank(0), { ...blank(1), baseWeight: 30, baseReps: 10 + dueOn(todayIso, "curl") }, { ...blank(2), baseWeight: 25, baseReps: 10 + dueOn(todayIso, "curl") }]],
]);
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u))), [[[100, 9], [100, 9], [95, 9]], [[100, 8], [100, 8], [95, 8]]]);
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u, todayIso, "curl"), 1)), [[[30, 11], [30, 11], [25, 11]], [[30, 10], [30, 10], [25, 10]]]);

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

// A shift after the planned end does not move the planned end.
assert.strictEqual(plannedEndIso({ startDate: "2026-11-02", numWeeks: 1, shifts: [{ date: "2026-11-16", days: 1 }] }), "2026-11-08");
assert.strictEqual(plannedEndIso({ startDate: "2026-11-02", numWeeks: 1, shifts: [{ date: "2026-11-04", days: 2 }, { date: "2026-11-11", days: 1 }] }), "2026-11-10");
assert.strictEqual(plannedEndIso({ startDate: "2026-11-02", numWeeks: 1, shifts: [{ date: "2026-11-04", days: 2 }, { date: "2026-11-10", days: 1 }] }), "2026-11-11");

// --- Presets and the minimum step: storage ---
assert.deepStrictEqual([undefined, null, "", "  ", "abc", Infinity, "5", 0, "0", -3, 0.1, 2.555, 250, 10].map(cleanMinIncrement),
  [null, null, null, null, null, null, 5, null, null, null, 0.25, 2.56, 100, 10]);
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }]));
assert.strictEqual(Store.updateExercise("bench", { minIncrement: "5" }).minIncrement, 5);
assert.strictEqual(Store.updateExercise("bench", { note: "x" }).minIncrement, 5); // undefined: left alone
assert.strictEqual("minIncrement" in Store.updateExercise("bench", { minIncrement: "" }), false);
Store.updateExercise("bench", { minIncrement: 5 });
assert.strictEqual("minIncrement" in Store.updateExercise("bench", { minIncrement: 0 }), false); // 0: the default
Store.updateExercise("bench", { minIncrement: 5 });
assert.strictEqual("minIncrement" in Store.updateExercise("bench", { minIncrement: -5 }), false);
localStorage.setItem("fah_mesocycles", JSON.stringify([{ id: "m", name: "M", numWeeks: 4, startDate: "2026-11-02", active: true,
  days: [{ id: "d", name: "D", weekdayOffset: 0, exercises: [] }] }]));
Store.addExerciseSlot("m", "d", { exerciseId: "bench", targetSets: 2, repRangeMin: 8, repRangeMax: 12, progression: "fast" });
Store.addExerciseSlot("m", "d", { exerciseId: "bench", targetSets: 2, repRangeMin: 8, repRangeMax: 12, progression: "aggressive" });
let presetSlots = Store.getMesocycles()[0].days[0].exercises;
assert.deepStrictEqual(presetSlots.map((s) => s.progression), [undefined, "aggressive"]);
Store.updateExerciseSlot("m", "d", presetSlots[1].id, { progression: "constructor" });
Store.updateExerciseSlot("m", "d", presetSlots[0].id, { progression: "light" });
assert.deepStrictEqual(Store.getMesocycles()[0].days[0].exercises.map((s) => s.progression), ["light", "aggressive"]);
assert.deepStrictEqual(Store.cloneMesocycle("m", "2026-12-01").days[0].exercises.map((s) => s.progression), ["light", "aggressive"]);
// Startup clean-up: a bad preset goes (slot and entry), a step is clamped or removed.
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "a", name: "A", minIncrement: 500 }, { id: "b", name: "B", minIncrement: "x" }, { id: "c", name: "C", minIncrement: 5 }, { id: "d", name: "D", minIncrement: 0 }, { id: "e", name: "E", minIncrement: -5 }]));
localStorage.setItem("fah_mesocycles", JSON.stringify([{ id: "m", name: "M", numWeeks: 4, startDate: "2026-11-02", active: true,
  days: [{ id: "d", name: "D", weekdayOffset: 0, exercises: [{ ...slot("s1", "a", 0), progression: "fast" }, { ...slot("s2", "c", 1), progression: "light" }] }] }]));
localStorage.setItem("fah_workouts", JSON.stringify([{ ...workout("2026-11-02", "d", [{ ...ex("s1", "a", "A", set(10, 10)), progression: "<b>" }, { ...ex("s2", "c", "C", set(10, 10)), progression: "light" }]), id: "w" }]));
Store.normalize();
assert.deepStrictEqual(Store.getExercises().map((e) => "minIncrement" in e ? e.minIncrement : "none"), [100, "none", 5, "none", "none"]);
assert.deepStrictEqual(Store.getMesocycles()[0].days[0].exercises.map((s) => s.progression), [undefined, "light"]);
assert.deepStrictEqual(Store.getWorkouts()[0].exercises.map((e) => e.progression), [undefined, "light"]);
// Backup: a preset is absent or one of the three; a step is a number.
assert.ok(badFeature((b) => { b.mesocycles[0].days[0].exercises[0].progression = "fast"; }));
assert.ok(badFeature((b) => { b.workouts[0].exercises[0].progression = "fast"; }));
assert.ok(badFeature((b) => { b.exercises[0].minIncrement = "5"; }));
for (const preset of ["light", "moderate", "aggressive"]) {
  assert.strictEqual(badFeature((b) => { b.mesocycles[0].days[0].exercises[0].progression = preset; b.workouts[0].exercises[0].progression = preset; }), null, preset);
}
assert.strictEqual(badFeature((b) => { b.exercises[0].minIncrement = 5; }), null);
// Import runs the same clean-up as startup: a step is clamped.
const stepBackup = JSON.parse(JSON.stringify(featureBackup));
stepBackup.exercises[0].minIncrement = 500;
assert.strictEqual(Store.importBackup(stepBackup), true);
assert.strictEqual(Store.getExercises()[0].minIncrement, 100);
for (const step of [0, -5]) { // 0 or less: no value (the 2.5 default)
  stepBackup.exercises[0].minIncrement = step;
  assert.strictEqual(Store.importBackup(JSON.parse(JSON.stringify(stepBackup))), true);
  assert.strictEqual("minIncrement" in Store.getExercises()[0], false, String(step));
}
assert.strictEqual(badFeature((b) => { for (const s of b.mesocycles[0].days[0].exercises) { delete s.progression; s.weightIncrementPct = 5; } }), null); // weightIncrementPct only
// A predicted weight with no rep target (a group set whose conversion costs
// too many reps) is valid and survives an import unchanged.
const weightOnly = JSON.parse(JSON.stringify(featureBackup));
const weightOnlySet = { setIndex: 0, weight: null, reps: null, baseWeight: 187.5, baseReps: null, isLogged: false, done: false };
weightOnly.workouts[0].exercises[0].sets[0] = weightOnlySet;
assert.strictEqual(validateBackup(weightOnly), null);
assert.strictEqual(Store.importBackup(JSON.parse(JSON.stringify(weightOnly))), true);
assert.deepStrictEqual(Store.getWorkout(weightOnly.workouts[0].id).exercises[0].sets[0], weightOnlySet);

// --- Presets and the minimum step: predictions ---
// A step change reaches an untouched prediction through refreshPredictions.
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }]));
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...fixedWorkout("2026-11-04", "wed", { finished: true }), exercises: [wex("s1", "bench", "Bench", 0, [logged(0, 100, 12)])] },
  fixedWorkout("2026-11-11", "wed"),
]));
const benchBase = () => { const s = Store.getWorkout("w-2026-11-11").exercises[0].sets[0]; return `${s.baseWeight}x${s.baseReps}`; };
refreshPredictions();
assert.strictEqual(benchBase(), "102.5x11");
Store.updateExercise("bench", { minIncrement: 10 });
refreshPredictions();
assert.strictEqual(benchBase(), "110x8");
// A preset changed on Program reaches today's entry: an untouched one is
// predicted again, a touched one keeps its sets.
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }, { id: "row", name: "Row" }]));
localStorage.setItem("fah_workouts", JSON.stringify([
  { ...workout("2026-11-04", "A", [ex("s1", "bench", "Bench", set(95, 10)), ex("s2", "row", "Row", set(80, 10))]), id: "h" },
  unfinished("r", "2026-11-11", "A", [
    wex("s1", "bench", "Bench", 0, [{ ...blank(0), baseWeight: 95, baseReps: 11 }]),
    wex("s2", "row", "Row", 1, [{ ...logged(0, 80, 11), baseWeight: 80, baseReps: 11 }]),
  ]),
]));
reconcileWorkoutWithTemplate(Store.getWorkout("r"), { id: "A", name: "x", exercises: [{ ...slot("s1", "bench", 0, 1), progression: "aggressive" }, { ...slot("s2", "row", 1, 1), progression: "aggressive" }] });
assert.deepStrictEqual(Store.getWorkout("r").exercises.map((e) => [e.progression, e.sets[0].baseWeight, e.sets[0].baseReps, e.sets[0].weight]),
  [["aggressive", 97.5, 10, null], ["aggressive", 80, 11, 80]]); // aggressive jumps from 10 of 8-12 (moderate: 95x10 or 95x11)

// --- The set-1 group and the calendar week, through buildPrefilledSets ---
// (coach's spec-lines.txt sections 2 and 4). Bench 8-12 moderate, step
// 2.5, day A, slot sA; a moderate unit is due for "bench" on 2026-11-23,
// none on 2026-11-30.
seed(program());
const benchSlot = (targetSets = 3) => ({ id: "sA", exerciseId: "bench", targetSets, repRangeMin: 8, repRangeMax: 12, progression: "moderate" });
const B = (...sets) => ex("sA", "bench", "Bench", ...sets.map((s) => (s ? set(...s) : set(null, null))));
const predict = (history, date = "2026-11-23", targetSets = 3, dayId = "A", dayName = null) =>
  buildPrefilledSets(benchSlot(targetSets), history, dayId, date, "Bench", dayName).map((s) => s.baseWeight == null ? null : `${s.baseWeight}x${s.baseReps ?? "-"}`);
const on16 = (...sets) => [workout("2026-11-16", "A", [B(...sets)])];
assert.deepStrictEqual(predict(on16([185, 12], [185, 10], [185, 9])), ["187.5x12", "187.5x10", "187.5x9"]); // 1: one step for the group
assert.deepStrictEqual(predict(on16([185, 11], [185, 9], [185, 8])), ["185x12", "185x10", "185x9"]); // 1b: set 3 at the bottom: reps
assert.deepStrictEqual(predict(on16([185, 11], [185, 9], [135, 12])), ["187.5x11", "187.5x9", "137.5x12"]); // 2: drop set alone
assert.deepStrictEqual(predict(on16([135, 12], [155, 10], [175, 8])), ["137.5x12", "157.5x10", "175x9"]); // 3: pyramid
assert.deepStrictEqual(predict(on16(null, [185, 10], [185, 9])), [null, "187.5x10", "187.5x9"]); // 4: no set 1
// Set 1 logged with no reps is no set 1 for the group: set 2 goes alone
// (in the group it would follow set 1's older 95x12 to 97.5x12).
assert.deepStrictEqual(predict([workout("2026-11-16", "A", [B([100, null], [100, 10])]), workout("2026-11-09", "A", [B([95, 12])])], "2026-11-23", 2), ["97.5x12", "100x11"]);
const fellBack = (third) => [workout("2026-11-16", "A", [B([185, 12], [185, 10], null)]), workout("2026-11-09", "A", [B([182.5, 12], [182.5, 10], third)])];
assert.deepStrictEqual(predict(fellBack([182.5, 9])), ["187.5x12", "187.5x10", "187.5x8"]); // 5: was straight there: joins
assert.deepStrictEqual(predict(fellBack([182.5, 8])), ["187.5x12", "187.5x10", "187.5x7"]); // 5c: joins, its honest reps under the range
assert.deepStrictEqual(predict(fellBack([135, 12])), ["187.5x12", "187.5x10", "137.5x12"]); // 5b: was a drop set there: alone
const straightAt = (x) => [workout("2026-11-16", "A", [B([185, 12], [185, 10], null)]), workout("2026-11-09", "A", [B([x, 12], [x, 10], [x, 9])])];
// A straight set always joins; converted more than MAX_CONVERT_REPS (4) reps
// from another weight than set 1's last, it gets the weight and no rep target.
assert.deepStrictEqual([180, 175, 150].map((x) => predict(straightAt(x))[2]), ["187.5x8", "187.5x7", "187.5x-"]); // 150: 5d
assert.deepStrictEqual(predict([workout("2026-11-16", "A", [B([185, 10], [185, 8], null)]), workout("2026-11-09", "A", [B([187.5, 7], [187.5, 6], [187.5, 5])])]), ["185x11", "185x9", "185x7"]); // a heavier fallback joins too
// The D1 trace: DB press, 5 lb step; set 3 skipped the session the group went
// 65 -> 70 falls back to 65x8 and joins at the group's weight.
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench", minIncrement: 5 }]));
const d1 = (s1, s2) => [workout("2026-11-16", "A", [B(s1, s2, null)]), workout("2026-11-09", "A", [B([65, 12], [65, 10], [65, 8])])];
assert.deepStrictEqual(predict(d1([70, 10], [70, 8])), ["70x11", "70x9", "70x7"]); // due week
assert.deepStrictEqual(predict(d1([70, 10], [70, 8]), "2026-11-30"), ["70x10", "70x8", "70x6"]); // no unit
assert.deepStrictEqual(predict(d1([70, 12], [70, 10])), ["75x11", "75x9", "75x5"]); // jump week
// A 10 lb gap from 17 to 100 lb costs exactly 4 reps, which float error puts
// just above 4 (60 -> 70, 45 -> 55): still a rep target (the 1e-9 guard).
const gap = (from, to) => [workout("2026-11-16", "A", [B([to, 10], [to, 8], null)]), workout("2026-11-09", "A", [B([from, 12], [from, 10], [from, 10])])];
assert.deepStrictEqual(["2026-11-23", "2026-11-30"].map((d) => predict(gap(60, 70), d)), [["70x11", "70x9", "70x7"], ["70x10", "70x8", "70x6"]]);
assert.deepStrictEqual(["2026-11-23", "2026-11-30"].map((d) => predict(gap(45, 55), d)), [["55x11", "55x9", "55x7"], ["55x10", "55x8", "55x6"]]);
seed(program());
// Set 1 is never asked below its last weight; set 2 follows it down.
assert.deepStrictEqual(predict([workout("2026-11-16", "A", [B([150, 10], null)]), workout("2026-11-09", "A", [B([200, 10], [200, 10])])], "2026-11-23", 2), ["152.5x10", "152.5x12"]);
// Calendar weeks: a week's unit counts once, skipped weeks are not caught up.
assert.deepStrictEqual(predict(on16([100, 9]), "2026-11-23", 1), ["100x10"]);
assert.deepStrictEqual(predict([workout("2026-11-23", "A", [B([100, 10])])], "2026-11-30", 1), ["100x10"]);
assert.deepStrictEqual(predict(on16([100, 10]), "2026-11-30", 1), ["100x10"]); // 2026-11-23 skipped
// A new Thursday day falling back to Monday's log of the same week matches
// it (at 11 the jump alone), instead of asking the week's unit again.
const monday = (...sets) => [{ ...workout("2026-11-23", "A", [B(...sets)]), dayName: "Mon" }];
assert.deepStrictEqual(["10", "11"].map((r) => predict(monday([100, +r]), "2026-11-26", 1, "T", "Thu")[0]), ["100x10", "102.5x10"]);
assert.deepStrictEqual(predict(monday([185, 11], [185, 9], [185, 8]), "2026-11-26", 3, "T", "Thu"), ["185x11", "185x9", "185x8"]);
assert.deepStrictEqual(predict(monday([185, 12], [185, 10], [185, 9]), "2026-11-26", 3, "T", "Thu"), ["185x12", "185x10", "185x9"]);
assert.deepStrictEqual(predict(monday([100, 15]), "2026-11-26", 1, "T", "Thu"), ["102.5x12"]); // the overshoot step still applies
// Per set: set 3 falls back to this week's Monday and matches it; sets 1-2
// (last Thursday) get the week's unit.
assert.deepStrictEqual(predict([workout("2026-11-19", "T", [B([100, 10], [100, 9])]), ...monday([100, 10], [100, 9], [100, 8])], "2026-11-26", 3, "T"), ["100x11", "100x10", "100x8"]);
// The phase key is the library exercise's id, also for an entry with no id
// ("Bench" as a key would give a unit on 2026-12-21, "bench" none).
assert.deepStrictEqual([{ exerciseId: "bench" }, { exerciseId: undefined }].map((s) => buildPrefilledSets({ ...benchSlot(1), ...s }, on16([100, 9]), "A", "2026-12-21", "Bench")[0].baseReps), [9, 9]);
// A makeup in the week of that day's next session: the unit counts once.
const thu12 = workout("2026-11-12", "T", [B([100, 10])]);
assert.deepStrictEqual(predict([thu12], "2026-11-24", 1, "T"), ["100x11"]); // the makeup (Tue) itself
assert.deepStrictEqual(predict([thu12, { ...workout("2026-11-24", "T", [B([100, 10])]), makeup: true, makeupFor: "2026-11-19" }], "2026-11-26", 1, "T"), ["100x10"]);

// Through generateWorkout: the weight with no rep target is stored as
// baseReps null, and refreshPredictions keeps it.
seed([{ id: "A", name: "Push", weekdayOffset: 0, exercises: [slot("s1", "bench", 0, 3)] }], [
  { ...workout("2026-11-16", "A", [ex("s1", "bench", "Bench", set(185, 12), set(185, 10), set(null, null))]), id: "h2" },
  { ...workout("2026-11-09", "A", [ex("s1", "bench", "Bench", set(150, 12), set(150, 10), set(150, 9))]), id: "h1" },
]);
const farSet = generateWorkout(Store.getActiveMesocycle(), Store.getActiveMesocycle().days[0], "2026-11-23");
const farBases = () => Store.getWorkout(farSet.id).exercises[0].sets.map((s) => [s.baseWeight, s.baseReps]);
assert.deepStrictEqual(farBases(), [[187.5, 12], [187.5, 10], [187.5, null]]);
refreshPredictions();
assert.deepStrictEqual(farBases(), [[187.5, 12], [187.5, 10], [187.5, null]]);

// A date that gives no week never throws (refreshPredictions runs at
// startup): blank sets, no prediction.
seed(program(), [
  { ...workout("2026-11-16", "A", [ex("s1", "bench", "Bench", set(100, 10))]), id: "h" },
  unfinished("bad", "2026-13-01", "A", [wex("s1", "bench", "Bench", 0, [{ ...blank(0), baseWeight: 1, baseReps: 1 }])]),
]);
refreshPredictions();
assert.deepStrictEqual(Store.getWorkout("bad").exercises[0].sets, [blank(0)]);
assert.deepStrictEqual(predict(on16([100, 10]), "2026-13-01", 1), [null]);
// The phase follows the library exercise: an entry with no exerciseId gets
// the same sets on every path, and a rename does not move it ("Bench" as a
// key has no unit due on 2026-11-23, "Press" has one on 2026-12-14).
const phaseHistory = [{ ...workout("2026-11-16", "A", [ex("s1", "bench", "Bench", set(100, 10), set(100, 10))]), id: "h", dayName: "Push" }];
const noId = (date, name = "Bench") => unfinished("u", date, "A", [wex("s1", undefined, name, 0, [{ ...blank(0), baseWeight: 1, baseReps: 1 }, blank(1)])], { dayName: "Push" });
const bases = (w) => w.exercises[0].sets.map((s) => [s.baseWeight, s.baseReps]);
seed(program(), phaseHistory);
assert.deepStrictEqual(bases(generateWorkout(Store.getActiveMesocycle(), program()[0], "2026-11-23")), [[100, 11], [100, 11]]);
seed(program(), [...phaseHistory, noId("2026-11-23")]);
assert.deepStrictEqual(basesOn(Store.getWorkout("u"), "2026-11-23"), [[100, 11], [100, 11]]);
refreshPredictions();
assert.deepStrictEqual(bases(Store.getWorkout("u")), [[100, 11], [100, 11]]);
// Reconcile: kept as the entry's own (swapped), so the set added by a raised
// set count is predicted from the entry itself.
seed(program(), [...phaseHistory, unfinished("u", "2026-11-23", "A", [wex("s1", undefined, "Bench", 0, [blank(0)], { swapped: true })], { dayName: "Push" })]);
reconcileWorkoutWithTemplate(Store.getWorkout("u"), { ...program()[0], exercises: [slot("s1", "bench", 0, 2)] });
assert.deepStrictEqual(Store.getWorkout("u").exercises[0].exerciseId, undefined);
assert.deepStrictEqual(bases(Store.getWorkout("u"))[1], [100, 11]);
seed(program(), [...phaseHistory, noId("2026-12-14")]);
Store.updateExercise("bench", { name: "Press" });
assert.deepStrictEqual(basesOn({ ...Store.getWorkout("u"), exercises: [{ ...Store.getWorkout("u").exercises[0], exerciseName: "Press" }] }, "2026-12-14"), [[100, 10], [100, 10]]);

// --- Missed day on consecutive training days (the user's case): train Mon
// to Fri, miss Monday, do it Tuesday and shift the rest of the week along ---
memory.clear();
const consecutive = () => {
  const bench = Store.addExercise("Bench", "Chest");
  const meso = Store.createMesocycle({ name: "M", numWeeks: 6, startDate: "2026-11-16" }); // a Monday
  Store.setActiveMesocycle(meso.id);
  ["Mon-A", "Tue-B", "Wed-C", "Thu-D", "Fri-E"].forEach((name, i) => {
    Store.addDay(meso.id, name, i);
    const day = activeMeso().days.find((d) => d.name === name);
    Store.addExerciseSlot(meso.id, day.id, { exerciseId: bench.id, targetSets: 2, repRangeMin: 8, repRangeMax: 12 });
  });
  return activeMeso();
};
const weekFrom = (from, n) => Array.from({ length: n }, (_, i) => {
  const t = resolveDayForDate(activeMeso(), addDays(parseLocalDate(from), i));
  return t ? t.name : "rest";
});
let cmeso = consecutive();
generateWorkout(cmeso, resolveDayForDate(cmeso, parseLocalDate("2026-11-16")), "2026-11-16"); // Monday's opened, untouched
generateWorkout(cmeso, resolveDayForDate(cmeso, parseLocalDate("2026-11-17")), "2026-11-17"); // Tuesday's own, untouched
assert.deepStrictEqual(missedOn(cmeso, Store.getWorkouts(), "2026-11-17", "2026-11-17"), ["2026-11-16", cmeso.days[0].id]);
assert.strictEqual(doMissedDay(cmeso, "2026-11-17", "2026-11-17", false), null); // no shift on a training day: refused
assert.strictEqual(activeMeso().shifts, undefined);
assert.strictEqual(doMissedDay(cmeso, "2026-11-17", "2026-11-17", true).dayName, "Mon-A");
const oneShift = ["rest", "Mon-A", "Tue-B", "Wed-C", "Thu-D", "Fri-E", "rest", "rest", "Mon-A", "Tue-B", "Wed-C", "Thu-D"];
assert.deepStrictEqual(weekFrom("2026-11-16", 12), oneShift);
assert.deepStrictEqual(Store.getWorkouts().filter((w) => w.date === "2026-11-17").map((w) => w.dayName), ["Mon-A"]);
assert.deepStrictEqual(Store.getWorkouts().filter((w) => w.date === "2026-11-16"), []); // Monday's untouched one went with the shift
// Then Tuesday logged and finished, Wednesday missed too, opened Thursday.
const tue = Store.findWorkoutByDate(activeMeso().id, "2026-11-17");
tue.exercises[0].sets[0] = { ...tue.exercises[0].sets[0], ...logged(0, 100, 10) };
Store.updateWorkout(tue.id, { exercises: tue.exercises });
Store.finishWorkout(tue.id);
cmeso = activeMeso();
generateWorkout(cmeso, resolveDayForDate(cmeso, parseLocalDate("2026-11-19")), "2026-11-19");
assert.deepStrictEqual(missedOn(cmeso, Store.getWorkouts(), "2026-11-19", "2026-11-19"), ["2026-11-18", cmeso.days[1].id]);
assert.strictEqual(doMissedDay(cmeso, "2026-11-19", "2026-11-19", true).dayName, "Tue-B");
assert.deepStrictEqual(weekFrom("2026-11-16", 12), ["rest", "Mon-A", "rest", "Tue-B", "Wed-C", "Thu-D", "Fri-E", "rest", "rest", "Mon-A", "Tue-B", "Wed-C"]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-19"), true);
assert.deepStrictEqual(weekFrom("2026-11-16", 12), oneShift);
// Monday and Tuesday both missed, opened Wednesday: resumes from Monday's.
memory.clear();
cmeso = consecutive();
assert.deepStrictEqual(missedOn(cmeso, [], "2026-11-18", "2026-11-18"), ["2026-11-16", cmeso.days[0].id]);
assert.strictEqual(doMissedDay(cmeso, "2026-11-18", "2026-11-18", true).dayName, "Mon-A");
assert.deepStrictEqual(weekFrom("2026-11-16", 10), ["rest", "rest", "Mon-A", "Tue-B", "Wed-C", "Thu-D", "Fri-E", "rest", "rest", "Mon-A"]);

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
