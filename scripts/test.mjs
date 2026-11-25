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
const { buildEntrySets, doMissedDay, findMissedDay, findMissedDays, generateWorkout, getExerciseHistory, getTodayContext, migrateLegacyPrefill, reconcileWorkoutWithTemplate, refreshPredictions, undoMissedDay } = await import("../js/workout.js");
const { swipeStep } = await import("../js/ui.js");

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
// rep-equivalents a week, due as whole units on calendar weeks per exercise;
// Moderate asks at least one unit every week, Aggressive one every week and a
// second in about half the weeks (version 36), so a week with no unit due is
// tested on Light or with a log from the target's own week.
const DATES = ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"];
const ns = (w, r, min, max, preset, inc, date, id = "bench") => { const n = nextSet(set(w, r), min, max, preset, inc, weekOf(date), phaseOf(id)); return `${n.weight}x${n.reps}`; };
// The same with a log from the target's own week (no units due, also on Moderate and Aggressive).
const nsOwn = (w, r, min, max, preset, inc, date, id = "bench") => { const n = nextSet(set(w, r), min, max, preset, inc, weekOf(date), phaseOf(id), weekOf(date)); return `${n.weight}x${n.reps}`; };
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
assert.strictEqual(ns(17.5, 9, 6, 9, "light", 2.5, "2026-11-30"), "20x8"); // the user's points (a week with no unit due)
assert.strictEqual(ns(15, 8, 5, 8, "light", 5, "2026-11-30"), "20x6");
assert.strictEqual(nsOwn(17.5, 9, 6, 9, "moderate", 2.5, "2026-11-30"), "20x8");
assert.strictEqual(ns(100, 7, 8, 12, "light", 2.5, "2026-11-23"), "100x8"); // under the range: +1 every session
assert.deepStrictEqual(["2026-11-23", "2026-12-07"].map((d) => ns(0, 12, 8, 12, "light", 2.5, d)), ["0x12", "0x13"]); // bodyweight
assert.strictEqual(ns(235, 4, 5, 8, "aggressive", 5, "2026-11-23"), "235x5"); // a miss
assert.strictEqual(ns(100, 12, 8, 12, "light", 2.5, "2026-11-23"), "102.5x11"); // at the top: jump in any week
assert.deepStrictEqual(["aggressive", "moderate"].map((p) => ns(95, 10, 8, 12, p, 2.5, "2026-11-23")), ["100x10", "95x11"]); // early jump (95x12 at 100 lb)
assert.strictEqual(nsOwn(95, 10, 8, 12, "aggressive", 2.5, "2026-11-23"), "97.5x9"); // the jump itself asks nothing more
assert.strictEqual(ns(20, 10, 9, 12, "aggressive", 10, "2026-11-23"), "20x12"); // early jump would land under the range (30x8)
// The logged 10 reps convert to 30x6, under the range: the week's 2 reps
// (bench: a two-unit week) would make it land at 30x8, but no early jump.
assert.deepStrictEqual([ns(20, 10, 8, 12, "aggressive", 10, "2026-11-23"), nsOwn(20, 10, 8, 12, "aggressive", 10, "2026-11-23")], ["20x12", "20x10"]);
assert.deepStrictEqual(["aggressive", "moderate"].map((p) => ns(225, 8, 8, 12, p, 5, "2026-11-23")), ["225x9", "225x9"]); // weight-first at the bottom: one rep at most, also in Aggressive's two-unit week
assert.strictEqual(ns(225, 8, 8, 9, "aggressive", 5, "2026-11-23"), "225x9"); // below the top the reps never pass it
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => ns(20, 20, 8, 12, "moderate", 2.5, d)), ["22.5x12", "22.5x12"]); // overshoot: one step
assert.strictEqual(ns(100, 15, 8, 12, "moderate", 2.5, "2026-11-30"), "102.5x12");
assert.deepStrictEqual(["2026-11-30", "2026-11-23"].map((d) => ns(225, 12, 5, 8, "moderate", 5, d)), ["230x8", "230x8"]); // max(due, 1), not due + 1
assert.deepStrictEqual([ns(225, 12, 5, 8, "light", 5, "2026-11-30"), nsOwn(225, 12, 5, 8, "moderate", 5, "2026-11-30")], ["230x8", "230x8"]); // no step due: still one
assert.strictEqual(ns(225, 12, 5, 8, "aggressive", 1.25, "2026-11-23"), "230x8");
assert.strictEqual(ns(20, 13, 8, 12, "moderate", 10, "2026-11-23"), "30x10");
assert.strictEqual(ns(10, 16, 10, 15, "light", 10, "2026-11-30"), "10x16"); // a step would land under the range
assert.deepStrictEqual([ns(10, 17, 10, 15, "light", 10, "2026-11-30"), ns(10, 17, 10, 15, "moderate", 10, "2026-11-23")], ["20x10", "20x11"]);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5), TypeError);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5, weekOf("2026-11-23")), TypeError);
assert.throws(() => nextSet(set(100, 10), 8, 12, "moderate", 2.5, undefined, 0.5), TypeError); // a phase but no week
assert.strictEqual(ns(10.2, 12, 8, 12, "moderate", 1.1, "2026-11-23"), "11.3x12"); // rounded to 0.001 (10.2 + 1.1 is 11.299999999999999)
assert.strictEqual(ns(10, 5, 1, 5, "moderate", 10, "2026-11-30"), "20x1"); // reps never under 1
// F3: a log from the target's own calendar week has no units due.
assert.strictEqual(nextSet(set(100, 10), 8, 12, "moderate", 2.5, 2968, phaseOf("bench"), 2968).reps, 10);
assert.strictEqual(nextSet(set(100, 10), 8, 12, "moderate", 2.5, 2968, phaseOf("bench"), 2967).reps, 11);
// The version 34 lines on each of the five dates, and each Moderate or
// Aggressive line on Light, where a week can have no unit due.
for (const [args, want] of [
  [[100, 8, 8, 12, "moderate", 2.5], "100x9 100x9 100x9 100x9 100x9"],
  [[95, 12, 8, 12, "moderate", 2.5], "97.5x12 97.5x12 97.5x12 97.5x12 97.5x12"],
  [[95, 12, 8, 12, "light", 2.5], "97.5x11 97.5x11 97.5x12 97.5x11 97.5x11"],
  [[95, 10, 8, 12, "aggressive", 2.5], "100x10 97.5x10 100x10 100x10 97.5x10"],
  [[95, 10, 8, 12, "moderate", 2.5], "95x11 95x11 95x11 95x11 95x11"],
  [[225, 8, 5, 8, "moderate", 5], "230x8 230x8 230x8 230x8 230x8"],
  [[225, 8, 5, 8, "moderate", 2.5], "227.5x8 227.5x8 227.5x8 227.5x8 227.5x8"],
  [[225, 8, 5, 8, "light", 2.5], "227.5x8 225x8 227.5x8 225x8 225x8"],
  [[225, 7, 5, 8, "aggressive", 5], "235x7 230x7 235x7 235x7 230x7"],
  [[20, 12, 8, 12, "light", 5], "25x10 25x10 25x11 25x10 25x10"],
  [[20, 12, 8, 12, "moderate", 5], "25x11 25x11 25x11 25x11 25x11"],
  [[20, 12, 8, 12, "aggressive", 5], "25x12 25x11 25x12 25x12 25x11"],
  [[20, 12, 8, 12, "moderate", 10], "30x9 30x9 30x9 30x9 30x9"],
  [[20, 10, 8, 12, "moderate", 10], "20x11 20x11 20x11 20x11 20x11"],
  [[10, 15, 10, 15, "moderate", 10], "10x16 10x16 10x16 10x16 10x16"],
  [[10, 16, 10, 15, "moderate", 10], "20x10 20x10 20x10 20x10 20x10"],
  [[10, 17, 10, 15, "moderate", 10], "20x11 20x11 20x11 20x11 20x11"],
  [[60, 12, 8, 12, "moderate", 5], "65x11 65x11 65x11 65x11 65x11"],
  [[235, 4, 5, 8, "moderate", 5], "235x5 235x5 235x5 235x5 235x5"],
  [[100, 15, 8, 12, "moderate", 2.5], "102.5x12 102.5x12 102.5x12 102.5x12 102.5x12"],
  [[17.5, 9, 6, 9, "moderate", 2.5], "20x9 20x9 20x9 20x9 20x9"],
  [[15, 8, 5, 8, "moderate", 5], "20x7 20x7 20x7 20x7 20x7"],
  [[0, 12, 8, 12, "moderate", 2.5], "0x13 0x13 0x13 0x13 0x13"],
  [[100, 8, 8, 12, "light", 2.5], "100x8 100x8 100x9 100x8 100x8"],
  [[95, 10, 8, 12, "light", 2.5], "95x10 95x10 95x11 95x10 95x10"],
  [[225, 8, 5, 8, "light", 5], "225x8 225x8 230x8 225x8 225x8"],
  [[225, 7, 5, 8, "light", 5], "225x7 225x7 230x7 225x7 225x7"],
  [[20, 12, 8, 12, "light", 10], "30x8 30x8 30x9 30x8 30x8"],
  [[20, 10, 8, 12, "light", 10], "20x10 20x10 20x11 20x10 20x10"],
  [[10, 15, 10, 15, "light", 10], "10x15 10x15 10x16 10x15 10x15"],
  [[10, 16, 10, 15, "light", 10], "10x16 10x16 20x10 10x16 10x16"],
  [[10, 17, 10, 15, "light", 10], "20x10 20x10 20x11 20x10 20x10"],
  [[60, 12, 8, 12, "light", 5], "65x10 65x10 65x11 65x10 65x10"],
  [[235, 4, 5, 8, "light", 5], "235x5 235x5 235x5 235x5 235x5"],
  [[100, 15, 8, 12, "light", 2.5], "102.5x12 102.5x12 102.5x12 102.5x12 102.5x12"],
  [[17.5, 9, 6, 9, "light", 2.5], "20x8 20x8 20x9 20x8 20x8"],
  [[15, 8, 5, 8, "light", 5], "20x6 20x6 20x7 20x6 20x6"],
  [[0, 12, 8, 12, "light", 2.5], "0x12 0x12 0x13 0x12 0x12"],
]) assert.strictEqual(DATES.map((d) => ns(...args, d)).join(" "), want, args.join());
// The dated tables: light | moderate | aggressive, each on the five dates.
const TABLE = `20x10 8-12 /2.5 | 20x10 20x10 20x11 20x10 20x10 | 20x11 20x11 20x11 20x11 20x11 | 25x10 22.5x10 25x10 25x10 22.5x10
20x10 8-12 /5 | 20x10 20x10 20x11 20x10 20x10 | 20x11 20x11 20x11 20x11 20x11 | 25x10 25x9 25x10 25x10 25x9
20x12 8-12 /2.5 | 22.5x11 22.5x11 22.5x12 22.5x11 22.5x11 | 22.5x12 22.5x12 22.5x12 22.5x12 22.5x12 | 25x12 22.5x12 25x12 25x12 22.5x12
20x12 8-12 /5 | 25x10 25x10 25x11 25x10 25x10 | 25x11 25x11 25x11 25x11 25x11 | 25x12 25x11 25x12 25x12 25x11
60x10 8-12 /2.5 | 60x10 60x10 60x11 60x10 60x10 | 60x11 60x11 60x11 60x11 60x11 | 65x10 62.5x10 65x10 65x10 62.5x10
60x10 8-12 /5 | 60x10 60x10 60x11 60x10 60x10 | 60x11 60x11 60x11 60x11 60x11 | 65x10 65x9 65x10 65x10 65x9
60x12 8-12 /2.5 | 62.5x11 62.5x11 62.5x12 62.5x11 62.5x11 | 62.5x12 62.5x12 62.5x12 62.5x12 62.5x12 | 65x12 62.5x12 65x12 65x12 62.5x12
60x12 8-12 /5 | 65x10 65x10 65x11 65x10 65x10 | 65x11 65x11 65x11 65x11 65x11 | 65x12 65x11 65x12 65x12 65x11
95x8 6-10 /2.5 | 95x8 95x8 95x9 95x8 95x8 | 95x9 95x9 95x9 95x9 95x9 | 100x8 97.5x8 100x8 100x8 97.5x8
95x8 6-10 /5 | 95x8 95x8 95x9 95x8 95x8 | 95x9 95x9 95x9 95x9 95x9 | 100x8 100x7 100x8 100x8 100x7
95x10 6-10 /2.5 | 97.5x9 97.5x9 97.5x10 97.5x9 97.5x9 | 97.5x10 97.5x10 97.5x10 97.5x10 97.5x10 | 100x10 97.5x10 100x10 100x10 97.5x10
95x10 6-10 /5 | 100x8 100x8 100x9 100x8 100x8 | 100x9 100x9 100x9 100x9 100x9 | 100x10 100x9 100x10 100x10 100x9
135x10 8-12 /2.5 | 135x10 135x10 137.5x10 135x10 135x10 | 137.5x10 137.5x10 137.5x10 137.5x10 137.5x10 | 140x10 137.5x10 140x10 140x10 137.5x10
135x10 8-12 /5 | 135x10 135x10 135x11 135x10 135x10 | 135x11 135x11 135x11 135x11 135x11 | 135x12 140x10 135x12 135x12 140x10
135x12 8-12 /2.5 | 135x12 135x12 137.5x12 135x12 135x12 | 137.5x12 137.5x12 137.5x12 137.5x12 137.5x12 | 140x12 137.5x12 140x12 140x12 137.5x12
135x12 8-12 /5 | 140x11 140x11 140x12 140x11 140x11 | 140x12 140x12 140x12 140x12 140x12 | 145x11 140x12 145x11 145x11 140x12
185x10 8-12 /2.5 | 187.5x10 185x10 187.5x10 185x10 185x10 | 187.5x10 187.5x10 187.5x10 187.5x10 187.5x10 | 190x10 187.5x10 190x10 190x10 187.5x10
185x10 8-12 /5 | 185x10 185x10 185x11 185x10 185x10 | 185x11 185x11 185x11 185x11 185x11 | 195x10 190x10 195x10 195x10 190x10
185x12 8-12 /2.5 | 187.5x12 185x12 187.5x12 185x12 185x12 | 187.5x12 187.5x12 187.5x12 187.5x12 187.5x12 | 190x12 187.5x12 190x12 190x12 187.5x12
185x12 8-12 /5 | 190x11 190x11 190x12 190x11 190x11 | 190x12 190x12 190x12 190x12 190x12 | 195x12 190x12 195x12 195x12 190x12
225x6 5-8 /2.5 | 227.5x6 225x6 227.5x6 225x6 225x6 | 227.5x6 227.5x6 227.5x6 227.5x6 227.5x6 | 230x6 230x6 230x6 230x6 227.5x6
225x6 5-8 /5 | 225x6 225x6 230x6 225x6 225x6 | 230x6 230x6 230x6 230x6 230x6 | 230x6 230x6 230x6 230x6 230x6
225x8 5-8 /2.5 | 227.5x8 225x8 227.5x8 225x8 225x8 | 227.5x8 227.5x8 227.5x8 227.5x8 227.5x8 | 230x8 230x8 230x8 230x8 227.5x8
225x8 5-8 /5 | 225x8 225x8 230x8 225x8 225x8 | 230x8 230x8 230x8 230x8 230x8 | 235x8 230x8 235x8 235x8 230x8
315x4 3-6 /2.5 | 317.5x4 315x4 317.5x4 317.5x4 315x4 | 317.5x4 317.5x4 320x4 317.5x4 317.5x4 | 322.5x4 320x4 322.5x4 322.5x4 320x4
315x4 3-6 /5 | 320x4 315x4 320x4 315x4 315x4 | 320x4 320x4 320x4 320x4 320x4 | 320x4 320x4 320x4 320x4 320x4
315x6 3-6 /2.5 | 317.5x6 315x6 317.5x6 317.5x6 315x6 | 317.5x6 317.5x6 320x6 317.5x6 317.5x6 | 322.5x6 320x6 322.5x6 322.5x6 320x6
315x6 3-6 /5 | 320x6 315x6 320x6 315x6 315x6 | 320x6 320x6 320x6 320x6 320x6 | 325x6 320x6 325x6 325x6 320x6`;
const ROW_TABLE = `60x10 8-12 /2.5 | 60x10 60x10 60x10 60x11 60x10 | 60x11 60x11 60x11 60x11 60x11 | 62.5x10 65x10 62.5x10 65x10 62.5x10
60x10 8-12 /5 | 60x10 60x10 60x10 60x11 60x10 | 60x11 60x11 60x11 60x11 60x11 | 65x9 65x10 65x9 65x10 65x9
135x10 8-12 /2.5 | 135x10 135x10 135x10 137.5x10 135x10 | 137.5x10 137.5x10 137.5x10 137.5x10 137.5x10 | 137.5x10 140x10 137.5x10 140x10 137.5x10
135x10 8-12 /5 | 135x10 135x10 135x10 135x11 135x10 | 135x11 135x11 135x11 135x11 135x11 | 140x10 135x12 140x10 135x12 140x10
225x6 5-8 /2.5 | 225x6 227.5x6 225x6 227.5x6 225x6 | 227.5x6 227.5x6 227.5x6 227.5x6 227.5x6 | 227.5x6 230x6 230x6 230x6 230x6
225x6 5-8 /5 | 225x6 225x6 225x6 230x6 225x6 | 230x6 230x6 230x6 230x6 230x6 | 230x6 230x6 230x6 230x6 230x6`;
for (const [id, table] of [["bench", TABLE], ["row", ROW_TABLE]]) {
  for (const line of table.split("\n")) {
    const [, w, r, min, max, inc, ...cols] = line.match(/^([\d.]+)x(\d+) (\d+)-(\d+) \/([\d.]+) \| (.*) \| (.*) \| (.*)$/);
    PROGRESSIONS.forEach((p, k) => assert.strictEqual(DATES.map((d) => ns(+w, +r, +min, +max, p, +inc, d, id)).join(" "), cols[k], `${id} ${line} ${p}`));
  }
}
// The weekly gain (the owner: "the target in moderate and aggressive cases
// should be a weekly gain"): every week after the log's, Moderate asks at
// least one unit of the lever and Aggressive one or two. One set logged
// inside the range in an earlier week, Moderate and Aggressive, weights
// 5-500 lb, every week of a year, three phases: the weight never falls and
// the weight or the reps rise. Then the same for set 1 of a straight pair
// (nextSets: the second set can sit at the bottom and turn the lever to
// reps), on the phase of "bench" only (all three cost 4 s a run).
{
  const w0 = weekOf("2026-11-23"), phases = ["bench", "row", "curl"].map(phaseOf);
  const ranges = [[4, 8], [6, 10], [8, 12], [10, 15], [8, 8], [1, 5], [12, 20]];
  for (const p of ["moderate", "aggressive"]) for (let w = 5; w <= 500; w += 2.5) for (const inc of [1.25, 2.5, 5, 10]) for (const [min, max] of ranges)
    for (let r = min; r <= max; r++) for (let k = 0; k < 52; k++) for (const ph of phases) {
      const t = nextSet(set(w, r), min, max, p, inc, w0 + k, ph);
      if (!(t.weight >= w && (t.weight > w || t.reps > r))) assert.fail(`no weekly gain: ${p} ${w}x${r} ${min}-${max} /${inc} week ${w0 + k} phase ${ph} -> ${t.weight}x${t.reps}`);
    }
  for (const p of ["moderate", "aggressive"]) for (let w = 5; w <= 500; w += 12.5) for (const inc of [1.25, 2.5, 5, 10]) for (const [min, max] of ranges)
    for (let r1 = min; r1 <= max; r1++) for (let r2 = min; r2 <= max; r2++) for (let k = 0; k < 52; k++) for (const ph of phases.slice(0, 1)) {
      const [t] = nextSets([set(w, r1), set(w, r2)], [w, w], min, max, p, inc, w0 + k, ph);
      if (!(t.weight >= w && (t.weight > w || t.reps > r1))) assert.fail(`no weekly gain: ${p} ${w}x${r1}, ${w}x${r2} ${min}-${max} /${inc} week ${w0 + k} phase ${ph} -> ${t.weight}x${t.reps}`);
    }
}
// Aggressive's floor is dueUnits(1.5): one unit every week, a second in
// about half the weeks. On the five dates it is, per exercise:
const aggFloor = (id) => DATES.map((d) => dueUnits(PRESETS.aggressive.weeklyUnits, weekOf(d), phaseOf(id))).join(" ");
assert.deepStrictEqual(["curl", "bench", "squat", "machine", "deadlift"].map(aggFloor), ["2 1 2 1 2", "2 1 2 2 1", "1 2 2 1 2", "1 1 2 1 2", "1 2 2 1 2"]);
const onDates = (w, r, min, max, p, inc, id) => DATES.map((d) => ns(w, r, min, max, p, inc, d, id)).join(" ");
// Curl 20 lb, 5 lb step, 8-12 (a step costs 2 reps): on 2026-11-23 the pace
// has nothing due for "curl" on Moderate, on 2026-12-07 a rep.
const twoWeeks = (w, r, preset) => ["2026-11-23", "2026-12-07"].map((d) => ns(w, r, 8, 12, preset, 5, d, "curl"));
assert.deepStrictEqual(["2026-11-23", "2026-12-07"].map((d) => dueUnits(PRESETS.moderate.repsPerWeek, weekOf(d), phaseOf("curl"))), [0, 1]);
assert.deepStrictEqual(twoWeeks(20, 10, "moderate"), ["20x11", "20x11"]);
assert.deepStrictEqual(twoWeeks(20, 11, "moderate"), ["25x10", "25x10"]); // 20x12 at the jump point
// Aggressive: 20x10 is at the jump point, the logged 10 reps convert to 25x8,
// in the range, so the jump is taken with the week's 1 or 2 reps on top.
assert.strictEqual(onDates(20, 10, 8, 12, "aggressive", 5, "curl"), "25x10 25x9 25x10 25x9 25x10");
assert.strictEqual(onDates(20, 9, 8, 12, "aggressive", 5, "curl"), "20x11 20x10 20x11 20x10 20x11");
assert.strictEqual(onDates(60, 9, 8, 12, "aggressive", 5, "db"), "60x11 60x10 60x11 60x11 60x10"); // DB press
assert.deepStrictEqual(["moderate", "aggressive"].map((p) => onDates(0, 10, 8, 12, p, 2.5, "bench")), ["0x11 0x11 0x11 0x11 0x11", "0x12 0x11 0x12 0x12 0x11"]); // bodyweight
// Bench 225 lb, 2.5 lb step (0.44 reps), 6-10, over a year: a step every
// week on Moderate; one or two on Aggressive, never none.
{
  const w0 = weekOf("2026-11-23");
  for (const [p, want] of [["moderate", "227.5x8"], ["aggressive", "227.5x8 230x8"]]) {
    const o = new Set();
    for (let k = 0; k < 52; k++) { const t = nextSet(set(225, 8), 6, 10, p, 2.5, w0 + k, phaseOf("bench")); o.add(`${t.weight}x${t.reps}`); }
    assert.strictEqual([...o].sort().join(" "), want, p);
  }
}
// Squat 225 lb, 5 lb step (0.89 reps), 6-10, Aggressive: one or two steps;
// at 235x7 one step in both kinds of week (all the reps above the bottom pay
// for); at the bottom 235x6 one rep at most, in both kinds of week.
assert.deepStrictEqual([[225, 8], [235, 7], [235, 6]].map(([w, r]) => onDates(w, r, 6, 10, "aggressive", 5, "squat")),
  ["230x8 235x8 235x8 230x8 235x8", "240x7 240x7 240x7 240x7 240x7", "235x7 235x7 235x7 235x7 235x7"]);
// Moderate asks the same rep where its pace has none due (2026-11-23, 12-07, 12-14 for "squat").
assert.deepStrictEqual([DATES.map((d) => dueUnits(PRESETS.moderate.repsPerWeek, weekOf(d), phaseOf("squat"))).join(""), onDates(235, 6, 6, 10, "moderate", 5, "squat")], ["01001", "235x7 235x7 235x7 235x7 235x7"]);
// Machine 100 lb, 10 lb step, 8-12. Below the top the early jump is taken
// only where the logged reps, converted, stay in the range (version 35 gave
// Moderate 100x11 -> 110x8 in a week with a rep due); at the top it jumps.
assert.deepStrictEqual([11, 12].map((r) => onDates(100, r, 8, 12, "moderate", 10, "machine")), ["100x12 100x12 100x12 100x12 100x12", "110x9 110x9 110x9 110x9 110x9"]);
// Aggressive: 100x11 asks 100x12 also in a two-unit week (never past the top).
assert.deepStrictEqual([10, 11, 12].map((r) => onDates(100, r, 8, 12, "aggressive", 10, "machine")),
  ["100x11 100x11 100x12 100x11 100x12", "100x12 100x12 100x12 100x12 100x12", "110x9 110x9 110x10 110x9 110x10"]);
const nsg = (sets, min, max, preset, inc, date) => fmt(nextSets(sets.map(([w, r]) => set(w, r)), sets.map(() => sets[0][0]), min, max, preset, inc, weekOf(date), phaseOf("bench")));
// A group with a set at the bottom is asked reps: 405 lb at 2.5 (0.25 reps a
// step) asks one rep, so set 1 at the top jumps 3 steps (never 422.5).
assert.deepStrictEqual(["moderate", "aggressive"].map((p) => DATES.map((d) => nsg([[405, 8], [405, 4]], 4, 8, p, 2.5, d).join()).join(" ")), Array(2).fill(Array(5).fill("412.5x8,412.5x4").join(" ")));
assert.deepStrictEqual(DATES.map((d) => nsg([[225, 9], [225, 6]], 6, 10, "aggressive", 2.5, d).join()), Array(5).fill("225x10,225x7"));
// 150 lb (0.67 reps a step): one rep in both kinds of week, set 1 never above the top.
assert.deepStrictEqual(DATES.map((d) => nsg([[150, 11], [150, 8]], 8, 12, "aggressive", 2.5, d).join()), Array(5).fill("150x12,150x9"));
assert.deepStrictEqual(["moderate", "aggressive"].flatMap((p) => [2.5, 5].map((inc) => onDates(225, 8, 8, 8, p, inc, "bench"))), Array(4).fill(Array(5).fill("230x8").join(" "))); // a one-rep range
assert.deepStrictEqual(["moderate", "aggressive"].map((p) => [nsOwn(100, 9, 8, 12, p, 2.5, "2026-11-23"), nsOwn(225, 8, 6, 10, p, 2.5, "2026-11-23")].join(" ")), ["100x9 225x8", "100x9 225x8"]); // the log's own week: no units
// Deadlift 405 lb at 2.5: the pace asks 1-2 steps (Moderate) and 3-4
// (Aggressive) here, so the floor does not bind: the same as version 35.
assert.deepStrictEqual(["moderate", "aggressive"].map((p) => DATES.slice(0, 4).map((d) => ns(405, 6, 4, 8, p, 2.5, d, "deadlift")).join(" ")), ["407.5x6 410x6 410x6 407.5x6", "412.5x6 415x6 412.5x6 412.5x6"]);
// coach's spec-lines-t.txt: phase phaseOf("x"), week 2969 (= 2026-11-30;
// Aggressive floor 1, pace 0) and 2970 (floor 2); "year" = every target over
// 52 weeks from 2969 and 20 phases (k / 20), as a sorted set.
{
  const w0 = weekOf("2026-11-30");
  const ph = phaseOf("x");
  assert.deepStrictEqual([w0, [0, 1].map((k) => dueUnits(PRESETS.aggressive.weeklyUnits, w0 + k, ph)), [0, 1].map((k) => dueUnits(PRESETS.aggressive.repsPerWeek, w0 + k, ph))], [2969, [1, 2], [0, 1]]);
  const one = (s, min, max, p, inc, week, phase, logWeeks) => nextSets(s.map(([w, r]) => set(w, r)), s.map(() => s[0][0]), min, max, p, inc, week, phase, logWeeks).map((t) => `${t.weight}x${t.reps}`).join(", ");
  const year = (s, min, max, p, inc) => {
    const o = new Set();
    for (let k = 0; k < 52; k++) for (let j = 0; j < 20; j++) o.add(one(s, min, max, p, inc, w0 + k, j / 20));
    return [...o].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b)).join(" / ");
  };
  for (const [s, min, max, inc, want] of [
    [[[20, 9]], 8, 12, 5, "20x10"], // 3: reps first, at least the floor in reps
    [[[225, 7]], 6, 10, 2.5, "227.5x7"], // 4: weight first, at least the floor in steps
    [[[100, 11]], 8, 12, 10, "100x12"], // 7: no early jump the demand makes land
    [[[0, 10]], 8, 12, 2.5, "0x11"], // 9: bodyweight
    [[[405, 6]], 4, 8, 2.5, "407.5x6 / 410x6"], // the floor does not bind
  ]) assert.strictEqual(year(s, min, max, "moderate", inc), want, `${JSON.stringify(s)} ${min}-${max} /${inc}`);
  for (const [s, min, max, inc, want] of [
    [[[20, 9]], 8, 12, 5, "20x10 | 20x11"], // 3
    [[[225, 7]], 6, 10, 2.5, "227.5x7 | 230x7"], // 4
    [[[135, 8]], 6, 10, 2.5, "137.5x8 | 140x8"], // 4: the floor binds, 2 steps where the pace asks 1
    [[[405, 8], [405, 4]], 4, 8, 2.5, "412.5x8, 412.5x4 | 412.5x8, 412.5x4"], // 5: asked as reps, one rep at most
    [[[135, 6]], 6, 10, 2.5, "135x7 | 135x7"], // 5: 0.74 reps a step, one rep at most
    [[[270, 10], [270, 7], [270, 5]], 6, 10, 5, "275x10, 275x7, 275x5 | 275x10, 275x7, 275x5"], // 12b: one rep, so one step at the top (not 285)
    [[[225, 8]], 8, 8, 2.5, "230x8 | 230x8"], // 5: a one-rep range
    [[[135, 7]], 6, 10, 2.5, "137.5x7 | 137.5x7"], // 6: room = floor(1 / 0.74) = 1
    [[[225, 10], [225, 7]], 6, 10, 5, "230x10, 230x7 | 230x10, 230x7"], // 6: the weakest set's reps set the room (1 step)
    [[[100, 10]], 8, 12, 10, "100x11 | 100x12"], // 7: no early jump
    [[[100, 12]], 8, 12, 10, "110x9 | 110x10"], // 7: at the top the jump
    [[[135, 9], [135, 6]], 6, 10, 2.5, "135x10, 135x7 | 135x10, 135x7"], // 8: weakest at the bottom, one rep; set 1 at the top
    [[[0, 10]], 8, 12, 2.5, "0x11 | 0x12"], // 9
  ]) assert.strictEqual([0, 1].map((k) => one(s, min, max, "aggressive", inc, w0 + k, ph)).join(" | "), want, `${JSON.stringify(s)} ${min}-${max} /${inc}`);
  // 10: the log's own week: no units and no floor; under the range and the overshoot unchanged.
  assert.deepStrictEqual([one([[225, 7]], 6, 10, "aggressive", 2.5, w0 + 1, ph, [w0 + 1]), one([[20, 9]], 8, 12, "aggressive", 5, w0 + 1, ph, [w0 + 1]),
    one([[405, 8], [405, 4]], 4, 8, "aggressive", 2.5, w0 + 1, ph, [w0 + 1, w0 + 1]),
    one([[225, 5]], 6, 10, "aggressive", 2.5, w0 + 1, ph), one([[20, 20]], 8, 12, "aggressive", 2.5, w0 + 1, ph)], ["225x7", "20x9", "407.5x8, 407.5x4", "225x6", "22.5x12"]);
}
// Only a log imported with fractional reps can sit less than one step above the
// bottom: still one step, never none.
assert.strictEqual(ns(225, 8.25, 8, 12, "moderate", 2.5, "2026-11-23"), "227.5x8");
assert.strictEqual(onDates(225, 6.5, 6, 10, "aggressive", 5, "bench"), "230x7 230x7 230x7 230x7 230x7");
// At 109.6 lb a 1.37 lb step costs 0.5 reps, which float puts just above: at
// the bottom Aggressive in a two-unit week (bench on 2026-11-23) asks one rep
// (two half steps), not two; one rep above the bottom pays for two steps,
// not one.
assert.strictEqual(ns(109.6, 8, 8, 12, "aggressive", 1.37, "2026-11-23"), "109.6x9");
assert.strictEqual(ns(109.6, 9, 8, 12, "aggressive", 1.37, "2026-11-23"), "112.34x9");
// nextSets: the set-1 group.
const nss =(sets, min, max, inc, date, firstWeights = sets.map(() => sets[0][0]), preset = "moderate") =>
  fmt(nextSets(sets.map(([w, r]) => set(w, r)), firstWeights, min, max, preset, inc, weekOf(date), phaseOf("bench")));
assert.deepStrictEqual(nss([[185, 12], [185, 10], [185, 9]], 8, 12, 2.5, "2026-11-23"), ["187.5x12", "187.5x10", "187.5x9"]);
assert.deepStrictEqual(nss([[185, 11], [185, 9], [185, 8]], 8, 12, 2.5, "2026-11-23"), ["185x12", "185x10", "185x9"]);
assert.deepStrictEqual(nss([[60, 12], [60, 10], [60, 9]], 8, 12, 5, "2026-11-30", undefined, "light"), ["65x10", "65x8", "65x7"]);
assert.deepStrictEqual(nss([[60, 12], [60, 10], [60, 9]], 8, 12, 5, "2026-11-23"), ["65x11", "65x9", "65x8"]);
assert.deepStrictEqual(nss([[100, 11], [100, 13], [100, 12]], 8, 12, 2.5, "2026-11-23"), ["102.5x11", "102.5x12", "102.5x12"]);
assert.deepStrictEqual(nss([[10, 15], [10, 13], [10, 12]], 10, 15, 10, "2026-11-23"), ["10x16", "10x14", "10x13"]);
assert.deepStrictEqual(nss([[185, 7], [185, 9], [185, 6]], 8, 12, 2.5, "2026-11-23"), ["185x8", "185x9", "185x7"]);
assert.deepStrictEqual(nss([[0, 12], [0, 10], [0, 7]], 8, 12, 2.5, "2026-11-23"), ["0x13", "0x11", "0x8"]);
assert.deepStrictEqual(nss([[185, 11], [185, 9], [135, 12]], 8, 12, 2.5, "2026-11-23"), ["187.5x11", "187.5x9", "137.5x12"]);
// A straight set from an older workout at another weight (firstWeights[2] = its own weight there).
assert.deepStrictEqual([["2026-11-30", "light"], ["2026-11-23", "moderate"]].map(([d, p]) => nss([[250, 8], [250, 7], [245, 6]], 8, 12, 2.5, d, [250, 250, 245], p)), [["250x8", "250x8", "250x5"], ["250x9", "250x8", "250x6"]]);
assert.deepStrictEqual(nss([[35, 10], [35, 9], [20, 12]], 8, 12, 5, "2026-11-30", [35, 35, 20], "light"), ["35x10", "35x9", "35x-"]); // costs 6 reps
assert.deepStrictEqual(nss([[30, 10], [30, 9], [20, 12]], 8, 12, 5, "2026-11-30", [30, 30, 20], "light"), ["30x10", "30x9", "30x8"]); // exactly 4: a number
assert.deepStrictEqual(nss([[32.5, 10], [32.5, 9], [20, 12]], 8, 12, 2.5, "2026-11-30", [32.5, 32.5, 20], "light"), ["32.5x10", "32.5x9", "32.5x-"]); // 5 reps: over the limit
assert.deepStrictEqual(nss([[10, 22], [10, 20], [10, 19]], 10, 15, 10, "2026-11-30", undefined, "light"), ["20x15", "20x13", "20x12"]); // logged with set 1: always a number
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
// Predictions depend on the workout's calendar week: the units a preset's
// pace has due for an exercise (Light 0 or 1), and the first week from a date
// with that many. The fixtures' slots are Moderate, which asks at least one
// unit in every week after the log's; basesOn(..., "light") re-plans an entry
// on Light, where a week can have nothing due.
const dueOn = (iso, id = "bench", preset = "light") => dueUnits(PRESETS[preset].repsPerWeek, weekOf(iso), phaseOf(id));
const weekWith = (units, fromIso = todayIso, id = "bench", preset = "light") => {
  let d = parseLocalDate(fromIso);
  for (let n = 0; dueOn(isoDate(d), id, preset) !== units; n++) {
    if (n > 520) throw new Error(`no week with ${units} units`);
    d = addDays(d, 7);
  }
  return isoDate(d);
};
const basesOn = (w, iso, i = 0, preset) => buildEntrySets({ ...w, date: iso }, { ...w.exercises[i], targetSets: w.exercises[i].sets.length, ...(preset && { progression: preset }) }).map((s) => [s.baseWeight, s.baseReps]);
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
assert.deepStrictEqual([weekWith(1), weekWith(0)].map((d) => basesOn(ctx.workout, d, 0, "light")), [[[100, 9], [100, 8]], [[100, 8], [100, 8]]]); // set 2 under the range: +1 in any week
assert.deepStrictEqual([1, 0].map((u) => basesOn(ctx.workout, weekWith(u, todayIso, "bench", "moderate"))), [[[100, 9], [100, 8]], [[100, 9], [100, 8]]]); // Moderate: a rep also when its pace has none due
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

// A week off (Mon 11-09, Wed 11-11 and Fri 11-13 missed): every day of the
// program is offered once, at its earliest missed date, and the user picks
// which one to resume with.
seedMissed();
const picks = (x, today = x) => findMissedDays(activeMeso(), Store.getWorkouts(), x, today).map((m) => [m.dateIso, m.dayTemplate.id]);
assert.deepStrictEqual(picks("2026-11-10"), [["2026-11-09", "mon"]]);
assert.deepStrictEqual(picks("2026-11-15"), [["2026-11-09", "mon"], ["2026-11-11", "wed"], ["2026-11-13", "fri"]]);
assert.deepStrictEqual(picks("2026-11-17"), [["2026-11-09", "mon"], ["2026-11-11", "wed"], ["2026-11-13", "fri"]]); // Mon 11-16 missed too: still one entry a day
assert.deepStrictEqual(findMissedDay(activeMeso(), Store.getWorkouts(), "2026-11-15", "2026-11-15").dateIso, "2026-11-09"); // the default is the earliest
// Friday's day picked with a shift on rest day Sun 11-15: Sunday trains it
// and the program goes on from there (Mon's day on Wed 11-18).
made = doMissedDay(activeMeso(), "2026-11-15", "2026-11-15", true, "2026-11-13");
assert.deepStrictEqual([made.date, made.dayId], ["2026-11-15", "fri"]);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-13", days: 2 }]);
assert.deepStrictEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-20"].map((d) => dayOn(activeMeso(), d)), [null, null, "mon", "wed"]);
assert.strictEqual(validateBackup(JSON.parse(JSON.stringify(Store.exportBackup()))), null);
// The days skipped before the pick are not offered from an earlier date: a
// shift from there would start under this one and move the day it placed.
assert.deepStrictEqual([picks("2026-11-12", "2026-11-15"), picks("2026-11-11", "2026-11-15")], [[], []]);
assert.strictEqual(doMissedDay(activeMeso(), "2026-11-12", "2026-11-15", true), null);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-13", days: 2 }]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-15"), true);
assert.deepStrictEqual(snapshot(), beforeMissed);
// A date that is not in the list does nothing.
assert.strictEqual(doMissedDay(activeMeso(), "2026-11-15", "2026-11-15", true, "2026-11-10"), null);
assert.deepStrictEqual(snapshot(), beforeMissed);
// Wednesday's day picked without a shift: a makeup for that date only.
made = doMissedDay(activeMeso(), "2026-11-15", "2026-11-15", false, "2026-11-11");
assert.deepStrictEqual([made.date, made.dayId, made.makeup, made.makeupFor], ["2026-11-15", "wed", true, "2026-11-11"]);
assert.strictEqual("shifts" in activeMeso(), false);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-15"), true);
assert.deepStrictEqual(snapshot(), beforeMissed);

// What Today shows: the missed day, then the move that can be undone. The
// program() mesocycle started two weeks ago on today's weekday, nothing logged.
seed(program());
ctx = at();
assert.deepStrictEqual([ctx.missed.dateIso, ctx.missed.dayTemplate.id, ctx.madeUp], [dayIso(-14), "A", null]);
assert.strictEqual(ctx.missedDays[0], ctx.missed); // the card's list; its first entry is the default
doMissedDay(ctx.meso, todayIso, todayIso, true);
ctx = at();
assert.deepStrictEqual([ctx.workout.dayId, ctx.missed, ctx.madeUp], ["A", null, { dateIso: dayIso(-14), shifted: true }]);
assert.deepStrictEqual(ctx.missedDays, []);
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
assert.deepStrictEqual(copyWeek.exercises.map((e) => e.sets.map((s) => [s.baseWeight, s.baseReps])), [[[40, 9], [40, 9]], [[25, 11], [25, 11]]]);
assert.deepStrictEqual([1, 0].map((u) => [0, 1].map((i) => basesOn(copyWeek, weekWith(u, dayIso(7), "curl"), i, "light"))), [[[[40, 9], [40, 9]], [[25, 11], [25, 11]]], [[[40, 8], [40, 8]], [[25, 10], [25, 10]]]]);
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
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u, todayIso, "row"), 0, "light")), [[[80, 11], [80, 11]], [[80, 10], [80, 10]]]);
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
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u), 0, "light")), [[[100, 9], [100, 9], [95, 9]], [[100, 8], [100, 8], [95, 8]]]);
assert.deepStrictEqual([1, 0].map((u) => basesOn(Store.getWorkout("r"), weekWith(u, todayIso, "curl"), 1, "light")), [[[30, 11], [30, 11], [25, 11]], [[30, 10], [30, 10], [25, 10]]]);

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
assert.strictEqual(benchBase(), "102.5x12");
Store.updateExercise("bench", { minIncrement: 10 });
refreshPredictions();
assert.strictEqual(benchBase(), "110x9");
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
  [["aggressive", 97.5, 10, null], ["aggressive", 80, 11, 80]]); // aggressive jumps early from 10 of 8-12, here one rep's worth (moderate: 95x11)

// --- The set-1 group and the calendar week, through buildPrefilledSets ---
// (coach's spec-lines.txt sections 2 and 4). Bench 8-12 moderate, step
// 2.5, day A, slot sA; Moderate asks at least one unit every week. A Light
// unit is due for "bench" on 2026-12-07, none on 2026-11-23 or 2026-11-30.
seed(program());
const benchSlot = (targetSets = 3, progression = "moderate") => ({ id: "sA", exerciseId: "bench", targetSets, repRangeMin: 8, repRangeMax: 12, progression });
const B = (...sets) => ex("sA", "bench", "Bench", ...sets.map((s) => (s ? set(...s) : set(null, null))));
const predict = (history, date = "2026-11-23", targetSets = 3, dayId = "A", dayName = null, preset = "moderate") =>
  buildPrefilledSets(benchSlot(targetSets, preset), history, dayId, date, "Bench", dayName).map((s) => s.baseWeight == null ? null : `${s.baseWeight}x${s.baseReps ?? "-"}`);
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
assert.deepStrictEqual(predict(d1([70, 10], [70, 8]), "2026-11-30", 3, "A", null, "light"), ["70x10", "70x8", "70x6"]); // Light, no unit
assert.deepStrictEqual(predict(d1([70, 12], [70, 10])), ["75x11", "75x9", "75x5"]); // jump week
// A 10 lb gap from 17 to 100 lb costs exactly 4 reps, which float error puts
// just above 4 (60 -> 70, 45 -> 55): still a rep target (the 1e-9 guard).
const gap = (from, to) => [workout("2026-11-16", "A", [B([to, 10], [to, 8], null)]), workout("2026-11-09", "A", [B([from, 12], [from, 10], [from, 10])])];
assert.deepStrictEqual([["2026-11-23", "moderate"], ["2026-11-30", "light"]].map(([d, p]) => predict(gap(60, 70), d, 3, "A", null, p)), [["70x11", "70x9", "70x7"], ["70x10", "70x8", "70x6"]]);
assert.deepStrictEqual([["2026-11-23", "moderate"], ["2026-11-30", "light"]].map(([d, p]) => predict(gap(45, 55), d, 3, "A", null, p)), [["55x11", "55x9", "55x7"], ["55x10", "55x8", "55x6"]]);
seed(program());
// Set 1 is never asked below its last weight; set 2 follows it down.
assert.deepStrictEqual(predict([workout("2026-11-16", "A", [B([150, 10], null)]), workout("2026-11-09", "A", [B([200, 10], [200, 10])])], "2026-11-23", 2), ["152.5x10", "152.5x12"]);
// Calendar weeks: a week's unit counts once, skipped weeks are not caught up.
assert.deepStrictEqual(predict(on16([100, 9]), "2026-11-23", 1), ["100x10"]);
assert.deepStrictEqual(predict([workout("2026-11-23", "A", [B([100, 10])])], "2026-11-30", 1, "A", null, "light"), ["100x10"]);
assert.deepStrictEqual(predict(on16([100, 10]), "2026-11-30", 1, "A", null, "light"), ["100x10"]); // 2026-11-23 skipped
assert.deepStrictEqual(predict(on16([100, 10]), "2026-11-30", 1), ["100x11"]); // Moderate: its weekly rep, once
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
// ("Bench" as a key would give a Light unit on 2026-12-21, "bench" none).
assert.deepStrictEqual([{ exerciseId: "bench" }, { exerciseId: undefined }].map((s) => buildPrefilledSets({ ...benchSlot(1, "light"), ...s }, on16([100, 9]), "A", "2026-12-21", "Bench")[0].baseReps), [9, 9]);
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
// the same sets on every path, and a rename does not move it. On Light
// (Moderate asks a unit every week): "Bench" as a key has no unit due on
// 2026-12-07, where "bench" has one; "Press" has one on 2026-12-28, where
// "bench" has none.
const lightProgram = () => program().map((d) => ({ ...d, exercises: d.exercises.map((x) => ({ ...x, progression: "light" })) }));
const phaseHistory = [{ ...workout("2026-11-16", "A", [ex("s1", "bench", "Bench", set(100, 10), set(100, 10))]), id: "h", dayName: "Push" }];
const noId = (date, name = "Bench") => unfinished("u", date, "A", [wex("s1", undefined, name, 0, [{ ...blank(0), baseWeight: 1, baseReps: 1 }, blank(1)], { progression: "light" })], { dayName: "Push" });
const bases = (w) => w.exercises[0].sets.map((s) => [s.baseWeight, s.baseReps]);
seed(lightProgram(), phaseHistory);
assert.deepStrictEqual(bases(generateWorkout(Store.getActiveMesocycle(), lightProgram()[0], "2026-12-07")), [[100, 11], [100, 11]]);
seed(lightProgram(), [...phaseHistory, noId("2026-12-07")]);
assert.deepStrictEqual(basesOn(Store.getWorkout("u"), "2026-12-07"), [[100, 11], [100, 11]]);
refreshPredictions();
assert.deepStrictEqual(bases(Store.getWorkout("u")), [[100, 11], [100, 11]]);
// Reconcile: kept as the entry's own (swapped), so the set added by a raised
// set count is predicted from the entry itself.
seed(lightProgram(), [...phaseHistory, unfinished("u", "2026-12-07", "A", [wex("s1", undefined, "Bench", 0, [blank(0)], { swapped: true, progression: "light" })], { dayName: "Push" })]);
reconcileWorkoutWithTemplate(Store.getWorkout("u"), { ...lightProgram()[0], exercises: [{ ...slot("s1", "bench", 0, 2), progression: "light" }] });
assert.deepStrictEqual(Store.getWorkout("u").exercises[0].exerciseId, undefined);
assert.deepStrictEqual(bases(Store.getWorkout("u"))[1], [100, 11]);
seed(lightProgram(), [...phaseHistory, noId("2026-12-28")]);
Store.updateExercise("bench", { name: "Press" });
assert.deepStrictEqual(basesOn({ ...Store.getWorkout("u"), exercises: [{ ...Store.getWorkout("u").exercises[0], exerciseName: "Press" }] }, "2026-12-28"), [[100, 10], [100, 10]]);

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

// --- Cycle length: programs that do not span a week (6 days, 8 days) ---
const { cycleLength, cycleOffset, getDayWeekdayOffset, jsDateToWeekdayIndex, mesocycleStartWeekday, nextDateOfOffset, schedulePosition } = await import("../js/schedule.js");
const { cleanCycleLength } = await import("../js/store.js");
// A mesocycle without cycleLength (every one made before the field) resolves
// exactly as the weekly rule did; that rule is kept here as the oracle.
const weeklyRule = (meso, date) => {
  const position = schedulePosition(meso, date);
  if (position.gap) return null;
  const offset = (jsDateToWeekdayIndex(position.date) - mesocycleStartWeekday(meso) + 7) % 7;
  return meso.days.find((d) => getDayWeekdayOffset(d) === offset) || null;
};
for (const meso of [
  mwf(), // Mon/Wed/Fri from Mon 2026-11-02
  mwf({ startDate: "2026-03-05" }), // a Thursday start; both clock changes lie inside the sweep
  mwf({ shifts: [{ date: "2026-11-09", days: 1 }, { date: "2026-12-01", days: 5 }] }),
  mwf({ days: [{ id: "a", name: "A", order: 0, exercises: [] }, { id: "b", name: "B", order: 1, exercises: [] }] }), // days placed by the old `order`
  mwf({ cycleLength: 7 }), // 7 written out is the same program
  mwf({ cycleLength: 0 }), mwf({ cycleLength: 15 }), mwf({ cycleLength: 6.5 }), mwf({ cycleLength: "8" }), // not a length: weekly
]) {
  assert.strictEqual(cycleLength(meso), 7);
  for (let i = -400; i <= 400; i++) {
    const date = addDays(parseLocalDate(meso.startDate), i);
    assert.strictEqual(resolveDayForDate(meso, date), weeklyRule(meso, date), `${meso.startDate} ${isoDate(date)}`);
  }
}

// An 8-day rotation from Mon 11-02: A B - C D E - -, then A again on Tue 11-10.
const eightDays = () => [
  { id: "A", name: "Upper", weekdayOffset: 0, exercises: [slot("s1", "bench", 0)] },
  { id: "B", name: "Lower", weekdayOffset: 1, exercises: [slot("s2", "row", 0)] },
  { id: "C", name: "Push", weekdayOffset: 3, exercises: [slot("s3", "bench", 0)] },
  { id: "D", name: "Pull", weekdayOffset: 4, exercises: [slot("s4", "row", 0)] },
  { id: "E", name: "Legs", weekdayOffset: 5, exercises: [slot("s5", "curl", 0)] },
];
const eight = mwf({ cycleLength: 8, days: eightDays() });
assert.strictEqual(cycleLength(eight), 8);
assert.deepStrictEqual(daysOn(eight, "2026-11-02", 18), ["A", "B", null, "C", "D", "E", null, null, "A", "B", null, "C", "D", "E", null, null, "A", "B"]);
assert.deepStrictEqual(["2026-11-02", "2026-11-09", "2026-11-10", "2026-10-25", "2026-11-01"].map((d) => cycleOffset(eight, parseLocalDate(d))), [0, 7, 0, 0, 7]); // before the start it still counts in 0..7
// The weeks stay calendar weeks from the start: the header and the planned end do not follow the cycle.
assert.deepStrictEqual([weekNumber(eight, parseLocalDate("2026-11-08")), weekNumber(eight, parseLocalDate("2026-11-10")), plannedEndIso(eight)], [1, 2, "2026-11-29"]);
// Where a day of the cycle comes round next (Program's label off a weekly program).
assert.deepStrictEqual([nextDateOfOffset(eight, 3, "2026-11-10"), nextDateOfOffset(eight, 0, "2026-11-10"), nextDateOfOffset(eight, 1, "2026-10-01"), nextDateOfOffset(eight, 8, "2026-11-10")],
  ["2026-11-13", "2026-11-10", "2026-11-03", null]);
// Missed, picked, shifted, undone. A and B done; C, D, E, A and B missed; opened on rest day Thu 11-12.
const seedEight = () => {
  memory.clear();
  localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }, { id: "row", name: "Row" }, { id: "curl", name: "Curl" }]));
  localStorage.setItem("fah_mesocycles", JSON.stringify([eight]));
  localStorage.setItem("fah_workouts", JSON.stringify([fixedWorkout("2026-11-02", "A", { finished: true, touched: true }), fixedWorkout("2026-11-03", "B", { finished: true, touched: true })]));
};
seedEight();
const beforeEight = snapshot();
assert.deepStrictEqual(picks("2026-11-12"), [["2026-11-05", "C"], ["2026-11-06", "D"], ["2026-11-07", "E"], ["2026-11-10", "A"], ["2026-11-11", "B"]]);
made = doMissedDay(activeMeso(), "2026-11-12", "2026-11-12", true, "2026-11-06"); // pick back up from Pull
assert.deepStrictEqual([made.date, made.dayId], ["2026-11-12", "D"]);
assert.deepStrictEqual(activeMeso().shifts, [{ date: "2026-11-06", days: 6 }]);
assert.deepStrictEqual(daysOn(activeMeso(), "2026-11-05", 14), ["C", null, null, null, null, null, null, "D", "E", null, null, "A", "B", null]);
assert.strictEqual(nextDateOfOffset(activeMeso(), 4, "2026-11-07"), "2026-11-12"); // gap days hold no day of the cycle
assert.strictEqual(validateBackup(JSON.parse(JSON.stringify(Store.exportBackup()))), null);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-12"), true);
assert.deepStrictEqual(snapshot(), beforeEight);
made = doMissedDay(activeMeso(), "2026-11-12", "2026-11-12", false, "2026-11-10"); // unticked on a rest day: a makeup
assert.deepStrictEqual([made.dayId, made.makeup, made.makeupFor, "shifts" in activeMeso()], ["A", true, "2026-11-10", false]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-12"), true);
assert.deepStrictEqual(snapshot(), beforeEight);
// A copy keeps the cycle and starts on a cycle boundary after the planned
// weeks (4 weeks are 28 days: 4 cycles of 8 end after 32), so the rotation
// goes on in order; then on by whole cycles until it is not before today.
let cycleCopy = Store.cloneMesocycle("m", "2026-10-10");
assert.deepStrictEqual([cycleCopy.cycleLength, cycleCopy.startDate, cycleOffset(eight, parseLocalDate(cycleCopy.startDate))], [8, "2026-12-04", 0]);
assert.strictEqual(Store.cloneMesocycle("m", "2026-12-05").startDate, "2026-12-12");
assert.strictEqual(validateBackup(JSON.parse(JSON.stringify(Store.exportBackup()))), null);

// A 6-day rotation with no rest day: a missed day can only be done by a shift.
const six = mwf({ cycleLength: 6, days: ["d0", "d1", "d2", "d3", "d4", "d5"].map((id, i) => ({ id, name: id, weekdayOffset: i, exercises: [slot(`s${i}`, "bench", 0)] })) });
assert.deepStrictEqual(daysOn(six, "2026-11-02", 8), ["d0", "d1", "d2", "d3", "d4", "d5", "d0", "d1"]);
memory.clear();
localStorage.setItem("fah_exercises", JSON.stringify([{ id: "bench", name: "Bench" }]));
localStorage.setItem("fah_mesocycles", JSON.stringify([six]));
// Mon 11-02 logged at 100x10 and finished; d1 and d2 missed; opened Thu 11-05 (d3's day).
const sixFirst = generateWorkout(activeMeso(), activeMeso().days[0], "2026-11-02");
Store.updateWorkout(sixFirst.id, { exercises: [{ ...sixFirst.exercises[0], sets: [logged(0, 100, 10), logged(1, 100, 10)] }] });
Store.finishWorkout(sixFirst.id);
const beforeSix = snapshot();
assert.deepStrictEqual(picks("2026-11-05"), [["2026-11-03", "d1"], ["2026-11-04", "d2"]]);
assert.strictEqual(doMissedDay(activeMeso(), "2026-11-05", "2026-11-05", false, "2026-11-04"), null); // unticked on a training day: refused
made = doMissedDay(activeMeso(), "2026-11-05", "2026-11-05", true, "2026-11-04");
assert.deepStrictEqual([made.dayId, activeMeso().shifts], ["d2", [{ date: "2026-11-04", days: 1 }]]);
assert.deepStrictEqual(daysOn(activeMeso(), "2026-11-03", 6), ["d1", null, "d2", "d3", "d4", "d5"]);
assert.strictEqual(undoMissedDay(activeMeso(), "2026-11-05"), true);
assert.deepStrictEqual(snapshot(), beforeSix);
// The pace is counted in calendar weeks whatever the cycle: d0 comes round
// again on Sun 11-08, in the week of its own log, and gets no units (the same
// set again); on Sat 11-14, a week later, Moderate asks its rep.
const targets = (iso) => generateWorkout(activeMeso(), activeMeso().days[0], iso).exercises[0].sets.map((st) => `${st.baseWeight}x${st.baseReps}`);
assert.deepStrictEqual([weekOf("2026-11-08") === weekOf("2026-11-02"), targets("2026-11-08"), targets("2026-11-14")], [true, ["100x10", "100x10"], ["100x11", "100x11"]]);

// The length itself: 1 to 14 whole days, never shorter than the days placed in it; not a number is 7.
assert.deepStrictEqual([8, "6", 0, -3, 99, "x", 2.9, null].map((v) => cleanCycleLength(v)), [8, 6, 1, 1, 14, 7, 2, 1]);
assert.deepStrictEqual([cleanCycleLength(3, eightDays()), cleanCycleLength(1, [{ order: 4 }]), cleanCycleLength(9, eightDays()), cleanCycleLength(8, [{ order: 8.5 }])], [6, 5, 9, 10]);
memory.clear();
assert.strictEqual("cycleLength" in Store.createMesocycle({ name: "W", numWeeks: 4, startDate: "2026-11-02" }), false); // a weekly program is stored as before
assert.strictEqual("cycleLength" in Store.createMesocycle({ name: "W7", numWeeks: 4, startDate: "2026-11-02", cycleLength: "7" }), false);
const rotation = Store.createMesocycle({ name: "R", numWeeks: 4, startDate: "2026-11-02", cycleLength: "8" });
assert.strictEqual(rotation.cycleLength, 8);
Store.addDay(rotation.id, "Late", 5);
assert.strictEqual(Store.updateMesocycle(rotation.id, { cycleLength: "3" }).cycleLength, 6); // day 6 holds a workout
assert.strictEqual(Store.updateMesocycle(rotation.id, { cycleLength: 40 }).cycleLength, 14);
assert.strictEqual(Store.updateMesocycle(rotation.id, { name: "R2" }).cycleLength, 14); // another edit leaves it alone
// A backup: a day's offset has to fit a cycle (0-6 with no cycleLength, 0-13
// with one), the length only has to be a number and is brought into range,
// and lengthened to hold its days, when the backup is imported.
const backupOf = (m) => ({ app: "fa-hypertrophy", version: 1, exercises: [], workouts: [], mesocycles: [m] });
const dayAt = (weekdayOffset) => [{ id: "d", name: "D", weekdayOffset, exercises: [] }];
assert.deepStrictEqual([
  validateBackup(backupOf(mwf({ cycleLength: 8, days: dayAt(7) }))), validateBackup(backupOf(mwf({ cycleLength: 8, days: dayAt(13) }))),
  validateBackup(backupOf(mwf({ cycleLength: 99, days: dayAt(2) }))),
].map((error) => error === null), [true, true, true]);
assert.deepStrictEqual([
  validateBackup(backupOf(mwf({ days: dayAt(7) }))), validateBackup(backupOf(mwf({ cycleLength: 8, days: dayAt(14) }))),
  validateBackup(backupOf(mwf({ cycleLength: "8", days: dayAt(0) }))), validateBackup(backupOf(mwf({ cycleLength: 8, days: dayAt(1.5) }))),
].map((error) => typeof error), ["string", "string", "string", "string"]);
const loose = [mwf({ cycleLength: 99, days: dayAt(2) }), mwf({ cycleLength: 3, days: dayAt(5) }), mwf({ cycleLength: 8.7, days: dayAt(0) }), mwf()];
assert.strictEqual(normalizeMesocycles(loose), true);
assert.deepStrictEqual(loose.map((m) => m.cycleLength), [14, 6, 8, undefined]);
assert.strictEqual(Store.importBackup(backupOf(mwf({ cycleLength: 3, days: dayAt(5) }))), true);
assert.strictEqual(Store.getMesocycles()[0].cycleLength, 6);

// --- The preset library of a blank install (Store.seedLibrary) ---
{
  const { PRESET_EXERCISES } = await import("../js/presets.js");
  const { MUSCLE_GROUPS } = await import("../js/ui.js");
  // The list: unique names ignoring case (history follows the name), a known
  // muscle group, and a step that is stored as written.
  const names = PRESET_EXERCISES.map((e) => e.name.toLowerCase());
  assert.strictEqual(new Set(names).size, names.length);
  assert.ok(PRESET_EXERCISES.length >= 40);
  for (const e of PRESET_EXERCISES) {
    assert.ok(e.name === e.name.trim() && e.name.length > 0 && e.name.length <= 60, e.name);
    assert.ok(MUSCLE_GROUPS.includes(e.muscleGroup), e.name);
    assert.ok(!("minIncrement" in e) || cleanMinIncrement(e.minIncrement) === e.minIncrement, e.name);
    assert.deepStrictEqual(Object.keys(e).filter((k) => !["name", "muscleGroup", "minIncrement"].includes(k)), []);
  }
  // The call: once, at startup, before anything else reads or writes the store.
  const mainSource = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
  assert.strictEqual(mainSource.split("seedLibrary(").length, 2);
  assert.ok(mainSource.indexOf("Store.seedLibrary(PRESET_EXERCISES);") > 0);
  assert.ok(mainSource.indexOf("Store.seedLibrary(PRESET_EXERCISES);") < mainSource.indexOf("Store.normalize();"));
  const saved = new Map(memory);
  // Not blank: any one of the three keys, an emptied library included.
  for (const key of ["fah_exercises", "fah_mesocycles", "fah_workouts"]) {
    memory.clear();
    memory.set(key, "[]");
    assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), false);
    assert.deepStrictEqual([...memory], [[key, "[]"]]);
  }
  memory.clear();
  memory.set("fah_exercises", "not json"); // unreadable data is not a blank install either
  assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), false);
  assert.strictEqual(memory.get("fah_exercises"), "not json");
  // Blank: the library is written, with an id each, and nothing else.
  memory.clear();
  assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), true);
  assert.deepStrictEqual([...memory.keys()], ["fah_exercises"]);
  const seeded = Store.getExercises();
  assert.deepStrictEqual(seeded.map(({ id, ...rest }) => rest), PRESET_EXERCISES);
  assert.strictEqual(new Set(seeded.map((e) => e.id)).size, seeded.length);
  assert.strictEqual(validateBackup(Store.exportBackup()), null);
  Store.normalize();
  assert.deepStrictEqual(Store.getExercises(), seeded); // nothing to clamp
  // Once only: a second start changes nothing, and a removed exercise stays removed.
  assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), false);
  Store.removeExercise(seeded[0].id);
  assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), false);
  assert.strictEqual(Store.getExercises().length, seeded.length - 1);
  // A seeded exercise is an ordinary one: typing its name again adds nothing.
  assert.strictEqual(Store.addExercise("leg press", "Quads").id, seeded.find((e) => e.name === "Leg Press").id);
  // Storage refuses the write: no library, and the failure is flagged.
  memory.clear();
  fullKey = "fah_exercises";
  Store.writeFailed = false;
  console.error = () => {}; // the failure is logged on purpose
  assert.strictEqual(Store.seedLibrary(PRESET_EXERCISES), false);
  console.error = realError;
  assert.strictEqual(Store.writeFailed, true);
  assert.deepStrictEqual(Store.getExercises(), []);
  fullKey = null;
  Store.writeFailed = false;
  memory.clear();
  for (const [k, v] of saved) memory.set(k, v);
}

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

// The service worker, run in Node with fakes of self, caches, fetch and
// Request: install, the cache-first fetch, refill() of a lost cache (whole set
// into a scratch cache, copied only when its js/version.js is this version),
// and activate.
{
  const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const LOC = "http://x.test/app/sw.js";
  const NAME = `fa-hypertrophy-v${APP_VERSION}`, SCRATCH = `${NAME}-refill`;
  const assetUrls = [...assets.matchAll(/"([^"]*)"/g)].map((m) => new URL(m[1], LOC).href);
  const VERSION_URL = new URL("js/version.js", LOC).href;
  const res = (body, ok = true) => ({ ok, status: ok ? 200 : 404, body, text: async () => body });
  class Request {
    constructor(url, { method = "GET", cache } = {}) { this.url = new URL(url, LOC).href; this.method = method; this.cache = cache; }
  }
  const keyOf = (req, ignoreSearch) => { const u = new URL(typeof req === "string" ? req : req.url, LOC); if (ignoreSearch) u.search = ""; return u.href; };
  const boot = (version = APP_VERSION) => {
    const files = new Map([...assetUrls.map((u) => [u, `body of ${u}`]), [new URL("other.png", LOC).href, "png"]]);
    files.set(VERSION_URL, `export const APP_VERSION = ${version};`);
    const server = { files, offline: false, notOk: new Set(), calls: new Map(), modes: [] };
    const fetch = async (req) => {
      const url = keyOf(req);
      server.calls.set(url, (server.calls.get(url) || 0) + 1);
      server.modes.push([url, req.cache]);
      await null;
      if (server.offline) throw new TypeError("offline");
      return files.has(url) && !server.notOk.has(url) ? res(files.get(url)) : res("", false);
    };
    class Cache {
      constructor() { this.entries = new Map(); }
      async match(req, { ignoreSearch } = {}) { return this.entries.get(keyOf(req, ignoreSearch)); }
      async put(req, response) { this.entries.set(keyOf(req), response); }
      async keys() { return [...this.entries.keys()].map((u) => new Request(u)); }
      async addAll(reqs) {
        const got = await Promise.all(reqs.map((r) => fetch(r)));
        if (got.some((r) => !r.ok)) throw new TypeError("addAll: a response is not ok");
        reqs.forEach((r, i) => this.entries.set(r.url, got[i]));
      }
    }
    const store = new Map();
    const caches = {
      failOpen: false, failDeleteOnce: null, // m: open rejects; n: one delete of that name rejects
      async open(name) { if (this.failOpen) throw new Error("storage blocked"); if (!store.has(name)) store.set(name, new Cache()); return store.get(name); },
      async keys() { return [...store.keys()]; },
      async delete(name) { if (name === this.failDeleteOnce) { this.failDeleteOnce = null; throw new Error("delete failed"); } return store.delete(name); },
    };
    const handlers = {};
    const self = { location: LOC, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
    new Function("self", "caches", "fetch", "Request", "URL", swSource)(self, caches, fetch, Request, URL);
    const fire = (type, request) => {
      const ev = { request, responded: null, waited: [], respondWith(p) { this.responded = p; }, waitUntil(p) { this.waited.push(p); } };
      handlers[type](ev);
      return ev;
    };
    const install = async () => { await Promise.all(fire("install").waited); server.calls.clear(); server.modes.length = 0; };
    const done = (ev) => Promise.all(ev.waited);
    const cacheUrls = () => (store.has(NAME) ? [...store.get(NAME).entries.keys()].sort() : []);
    return { server, store, caches, fire, install, done, cacheUrls };
  };
  const all = [...assetUrls].sort();
  // a. install: one entry per ASSETS item, each fetched past the HTTP cache.
  let w = boot();
  await Promise.all(w.fire("install").waited);
  assert.deepStrictEqual(w.cacheUrls(), all);
  assert.strictEqual(assetUrls.length, new Set(assetUrls).size);
  assert.ok(w.server.modes.length === assetUrls.length && w.server.modes.every(([, mode]) => mode === "reload"));
  // b. a hit (search ignored): the cached body, no network, no scratch cache.
  w.server.calls.clear();
  let ev = w.fire("fetch", new Request("http://x.test/app/js/ui.js?x=1"));
  assert.strictEqual((await ev.responded).body, "body of http://x.test/app/js/ui.js");
  await w.done(ev);
  assert.strictEqual(w.server.calls.size, 0);
  assert.ok(!w.store.has(SCRATCH));
  // c. the whole cache deleted: answered from the network, then refilled.
  w = boot(); await w.install(); w.store.delete(NAME);
  ev = w.fire("fetch", new Request("http://x.test/app/"));
  assert.strictEqual((await ev.responded).body, "body of http://x.test/app/");
  await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), all);
  assert.ok(assetUrls.every((u) => w.store.get(NAME).entries.get(u).body === w.server.files.get(u)));
  assert.ok(!w.store.has(SCRATCH));
  // d. one entry deleted: refilled.
  w = boot(); await w.install(); w.store.get(NAME).entries.delete("http://x.test/app/js/ui.js");
  ev = w.fire("fetch", new Request("http://x.test/app/js/ui.js"));
  await ev.responded; await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), all);
  assert.ok(!w.store.has(SCRATCH));
  // e. the server already holds the next version: nothing written.
  w = boot(APP_VERSION + 1); await w.install(); w.store.get(NAME).entries.clear();
  ev = w.fire("fetch", new Request("http://x.test/app/"));
  await ev.responded; await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), []);
  assert.ok(!w.store.has(SCRATCH));
  // l. the same worker after that: no second refill, the page from the network.
  w.server.calls.clear(); w.server.modes.length = 0;
  ev = w.fire("fetch", new Request("http://x.test/app/js/ui.js"));
  assert.strictEqual((await ev.responded).body, "body of http://x.test/app/js/ui.js");
  await w.done(ev);
  assert.strictEqual(w.server.calls.get("http://x.test/app/js/ui.js"), 1);
  assert.ok(!w.server.modes.some(([, mode]) => mode === "reload"));
  assert.deepStrictEqual(w.cacheUrls(), []);
  assert.ok(!w.store.has(SCRATCH));
  // f. one file not ok on the server: all or nothing.
  w = boot(); await w.install(); w.store.get(NAME).entries.clear();
  w.server.notOk.add("http://x.test/app/js/chart.js");
  ev = w.fire("fetch", new Request("http://x.test/app/"));
  await ev.responded; await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), []);
  assert.ok(!w.store.has(SCRATCH));
  // g. offline with an empty cache: the response fails, the refill settles quietly.
  w = boot(); await w.install(); w.store.get(NAME).entries.clear(); w.server.offline = true;
  ev = w.fire("fetch", new Request("http://x.test/app/index.html"));
  await assert.rejects(ev.responded);
  await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), []);
  assert.ok(!w.store.has(SCRATCH));
  // Back online, the next miss (with a query string, as a launch can carry)
  // refills: a failed refill does not block the next one.
  w.server.offline = false;
  ev = w.fire("fetch", new Request("http://x.test/app/index.html?launch=1"));
  await ev.responded; await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), all);
  // h. a miss outside ASSETS: the network, one call, no refill.
  w = boot(); await w.install();
  ev = w.fire("fetch", new Request("http://x.test/app/other.png"));
  assert.strictEqual((await ev.responded).body, "png");
  assert.strictEqual(ev.waited.length, 0);
  assert.deepStrictEqual([...w.server.calls.values()], [1]);
  // i. not a GET: left to the browser.
  ev = w.fire("fetch", new Request("http://x.test/app/", { method: "POST" }));
  assert.ok(ev.responded === null && ev.waited.length === 0);
  // j. two misses at once: one refill.
  w = boot(); await w.install(); w.store.delete(NAME);
  const two = ["http://x.test/app/js/ui.js", "http://x.test/app/css/style.css"].map((u) => w.fire("fetch", new Request(u)));
  await Promise.all(two.map((e) => e.responded)); await Promise.all(two.map(w.done));
  assert.ok(assetUrls.every((u) => w.server.modes.filter(([url, mode]) => url === u && mode === "reload").length === 1));
  assert.deepStrictEqual(w.cacheUrls(), all);
  // k. activate: this app's other caches go, the scratch one too; another
  // project's cache on the same origin stays.
  w = boot(); await w.install();
  w.store.set("fa-hypertrophy-v1", null).set(SCRATCH, null).set("other-app-v1", null);
  await Promise.all(w.fire("activate").waited);
  assert.deepStrictEqual([...w.store.keys()].sort(), [NAME, "other-app-v1"].sort());
  // m. the cache cannot be opened: the page comes from the network, the refill settles.
  w = boot(); await w.install(); w.caches.failOpen = true;
  ev = w.fire("fetch", new Request("http://x.test/app/index.html"));
  assert.strictEqual((await ev.responded).body, "body of http://x.test/app/index.html");
  await w.done(ev);
  // n. a failed delete of the scratch cache does not block the next refill.
  w = boot(); await w.install(); w.store.delete(NAME); w.caches.failDeleteOnce = SCRATCH;
  ev = w.fire("fetch", new Request("http://x.test/app/"));
  await ev.responded; await w.done(ev);
  assert.strictEqual(w.caches.failDeleteOnce, null);
  w.store.get(NAME).entries.delete("http://x.test/app/js/ui.js"); // the miss is that file (index.html would be a hit)
  ev = w.fire("fetch", new Request("http://x.test/app/js/ui.js"));
  await ev.responded; await w.done(ev);
  assert.deepStrictEqual(w.cacheUrls(), all);
}

// A swipe between the bottom nav's screens: quick, long enough and mostly
// horizontal, or it is a scroll, a tap or a drag.
assert.deepStrictEqual([swipeStep(-80, 10, 200), swipeStep(80, -10, 200)], [1, -1]); // to the left: the next screen
assert.deepStrictEqual([swipeStep(-59, 0, 200), swipeStep(-80, 41, 200), swipeStep(-200, 20, 601), swipeStep(0, 0, 50), swipeStep(10, 300, 200)], [0, 0, 0, 0, 0]);

console.log("ok");
