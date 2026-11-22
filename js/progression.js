import { Store } from "./store.js";

// Progression presets (coach's research, report.md section 4). A preset
// says when the weight goes up (trigger: the top of the rep range, or its
// middle) and by about how much (stepPct of the weight). The step is always
// a whole number of the exercise's minimum increment (its equipment: 5 lb
// dumbbells, 10 lb machine stacks), stored on the library exercise.
export const REP_COST_LB = 2.5; // one rep per 2.5 lb: the user's points (17.5x9 -> 20x8, 15x8 -> 20x6)
export const MAX_PCT_PER_REP = 15; // cap for very light weights
export const MIN_PCT_PER_REP = 2.5; // floor, reached at 100 lb
export const DEFAULT_MIN_INCREMENT = 2.5;
export const DEFAULT_PROGRESSION = "moderate";
export const PRESETS = {
  light: { stepPct: 0, trigger: "top" },
  moderate: { stepPct: 2.5, trigger: "top" },
  aggressive: { stepPct: 5, trigger: "mid" },
};
export const PROGRESSIONS = Object.keys(PRESETS);

// How many percent of load change costs one rep, from the weight the
// estimate starts at: one rep per 2.5 lb, between 2.5 % and 15 % per rep.
export function pctPerRep(weight) {
  return Math.min(MAX_PCT_PER_REP, Math.max(MIN_PCT_PER_REP, (REP_COST_LB / weight) * 100));
}

// Estimate the rep target at newWeight relative to the (baseWeight,
// baseReps) anchor: one rep lost (or gained, for a lighter weight) per
// pctPerRep(baseWeight)% of load change. Callers clamp to the rep range.
// Not a 1RM formula (Epley/Brzycki): one curve for every exercise turned
// 15x9 -> 20lb into 20x1.
export function equivalentReps(baseWeight, baseReps, newWeight) {
  if (baseWeight == null || baseReps == null || newWeight == null || newWeight <= 0 || baseWeight <= 0) return null;
  const pctChange = (newWeight / baseWeight - 1) * 100;
  return Math.max(1, Math.round(baseReps - pctChange / pctPerRep(baseWeight)));
}

// The reps placeholder for a set whose weight box holds `weight`: the
// estimate from the prediction (baseWeight x baseReps), held to the rep range
// widened to include baseReps, so at the predicted weight it is exactly
// baseReps (a prediction outside the range is shown, and saved by a tick,
// as predicted). Null when there is no estimate.
export function hintReps(baseWeight, baseReps, weight, repRangeMin, repRangeMax) {
  const estimate = equivalentReps(baseWeight, baseReps, weight);
  if (estimate == null) return null;
  return Math.min(Math.max(estimate, Math.min(repRangeMin, baseReps)), Math.max(repRangeMax, baseReps));
}

// Slots and entries saved before presets have only weightIncrementPct: the
// nearest preset's stepPct (0 / 2.5 / 5), a tie going to moderate.
export function presetFromPct(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return DEFAULT_PROGRESSION;
  if (pct < 1.25) return "light";
  if (pct <= 3.75) return "moderate";
  return "aggressive";
}

// A slot's or entry's preset. Checked with includes, never PRESETS[x]: a
// value like "constructor" would find an inherited property.
export function progressionOf(slotOrEntry) {
  return PROGRESSIONS.includes(slotOrEntry.progression) ? slotOrEntry.progression : presetFromPct(slotOrEntry.weightIncrementPct);
}

// The exercise's minimum weight step from the library: by id, then by name
// (entries with a missing or stale id; never the shared unknown name), else
// the default. Read when a prediction is built, never copied.
export function minIncrementFor(library, exerciseId, exerciseName) {
  const ex = (exerciseId != null && library.find((e) => e.id === exerciseId))
    || (exerciseName != null && exerciseName !== UNKNOWN_EXERCISE && library.find((e) => e.name === exerciseName));
  const v = ex && ex.minIncrement;
  return typeof v === "number" && v > 0 ? v : DEFAULT_MIN_INCREMENT;
}

// The rep count at which the weight goes up: the top of the range, or (mid)
// its middle, rounded up (8-12 -> 10, 5-8 -> 7).
export function triggerReps(progression, repRangeMin, repRangeMax) {
  return PRESETS[progression].trigger === "mid" ? repRangeMin + Math.ceil((repRangeMax - repRangeMin) / 2) : repRangeMax;
}

// The weight after one jump: the preset's % of the weight, rounded to the
// NEAREST whole number of minIncrements (a half up), at least one. 1e-9
// keeps an exact half from falling below through float error. The step is a
// multiple of minIncrement; the new weight need not be.
export function jumpedWeight(weight, progression, minIncrement) {
  const steps = Math.max(1, Math.floor((weight * PRESETS[progression].stepPct) / 100 / minIncrement + 0.5 + 1e-9));
  return Math.round((weight + steps * minIncrement) * 1000) / 1000;
}

// Double progression: the next set from the previous logged one. Below the
// trigger, one more rep (up to the range top). At it, the weight jumps and
// the reps follow equivalentReps (not reset to repRangeMin: 95x12 -> 97.5x8
// would read as a deload). When the equipment's step is too big to land in
// the range yet, one more rep instead, even past the range top.
export function nextSet(prevSet, repRangeMin, repRangeMax, progression, minIncrement = DEFAULT_MIN_INCREMENT) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  const { weight, reps } = prevSet;
  // Bodyweight (0 lb): nothing to add but reps, so no cap at the range top.
  if (weight <= 0) return { weight, reps: reps + 1 };
  if (reps < triggerReps(progression, repRangeMin, repRangeMax)) return { weight, reps: Math.min(reps + 1, repRangeMax) };
  const newWeight = jumpedWeight(weight, progression, minIncrement);
  const estimate = equivalentReps(weight, reps, newWeight);
  if (estimate < repRangeMin) return { weight, reps: reps + 1 };
  return { weight: newWeight, reps: Math.min(estimate, repRangeMax) };
}

export function isCompleteSet(s) {
  return !!s && s.weight != null && s.reps != null;
}

// Ordered tests for "is this logged entry the exercise I mean". History and
// predictions follow the exercise, never the slot: a slot's exercise can be
// swapped, and the swapped-in one must not inherit the old one's numbers.
// slotId only breaks the tie when one day has the same exercise in two
// slots. The name fallback covers entries whose exerciseId is missing or
// stale (exercise removed from the library and re-created) — library names
// are unique (Store.addExercise), so a name match is the same exercise.
// With no exerciseId to look for, only the name can match: a missing id
// would otherwise equal every other entry's missing id. UNKNOWN_EXERCISE is
// the name given to a slot whose exercise is not in the library: two
// different missing exercises share it, so it never matches by name.
export const UNKNOWN_EXERCISE = "(unknown exercise)";

export function exerciseMatchers(slotId, exerciseId, exerciseName) {
  const byName = exerciseName != null && exerciseName !== UNKNOWN_EXERCISE;
  return [
    (e) => exerciseId != null && e.exerciseId === exerciseId && e.slotId === slotId,
    (e) => exerciseId != null && e.exerciseId === exerciseId,
    (e) => byName && e.exerciseName === exerciseName,
  ];
}

// A workout's entries matching one test, in their order on the screen.
export function matchingEntries(workout, match) {
  return workout.exercises.filter(match).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// The one entry of `workout` that is the exercise meant: the most specific
// matcher that finds any. When the slot itself is not there (a cloned
// mesocycle's new slot ids) and the exercise has several entries, the
// `occurrence`-th one (0-based, by order) stands for the occurrence-th slot of
// that exercise on the day, or the last one when there are fewer.
export function findMatchingExercise(workout, matchers, occurrence = 0) {
  for (const match of matchers) {
    const hits = matchingEntries(workout, match);
    if (hits.length) return hits[Math.min(occurrence, hits.length - 1)];
  }
  return null;
}

// Whether this workout's entry `ex` beat every earlier finished workout of
// the same exercise: "weight" (heaviest complete set ever), else "reps" (a
// set with more reps than any earlier set at that weight or heavier, where
// that exact weight was done before), else null — also when there is
// nothing earlier to beat.
export function exercisePR(workouts, workout, ex) {
  const matchers = exerciseMatchers(ex.slotId, ex.exerciseId, ex.exerciseName);
  const earlier = workouts
    .filter((w) => w.finished && w.date < workout.date)
    .flatMap((w) => w.exercises.filter((e) => matchers.some((match) => match(e))))
    .flatMap((e) => e.sets.filter(isCompleteSet));
  const mine = ex.sets.filter(isCompleteSet);
  if (earlier.length === 0 || mine.length === 0) return null;
  const heaviest = (sets) => Math.max(...sets.map((s) => s.weight));
  if (heaviest(mine) > heaviest(earlier)) return "weight";
  const repPR = mine.some((s) => {
    const atLeast = earlier.filter((e) => e.weight >= s.weight);
    return atLeast.some((e) => e.weight === s.weight) && s.reps > Math.max(...atLeast.map((e) => e.reps));
  });
  return repPR ? "reps" : null;
}

// Find the most recent finished workout (date < beforeIsoDate) where this
// exercise has a complete set at setIndex. Same day template first (the same
// exercise can run heavier on one day than another), then a day of the same
// name (a copied mesocycle has new day ids but keeps the names), and only
// then any day — e.g. an exercise just swapped in.
// Looked up per set, not per exercise: a set left blank last time (skipped,
// since untouched predictions are never saved) falls back to the most
// recent workout where it was actually logged. Each workout stands for one
// entry (findMatchingExercise), so a skipped set never takes the set of
// another slot of the same exercise. `occurrence`: see findMatchingExercise.
export function findLastLoggedSet(workouts, dayId, slotId, exerciseId, setIndex, beforeIsoDate, exerciseName, dayName = null, occurrence = 0) {
  const candidates = workouts
    .filter((w) => w.finished && w.date < beforeIsoDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const matchers = exerciseMatchers(slotId, exerciseId, exerciseName);
  const pools = [candidates.filter((w) => w.dayId === dayId)];
  if (dayName != null) pools.push(candidates.filter((w) => w.dayName === dayName));
  pools.push(candidates);

  for (const pool of pools) {
    for (const w of pool) {
      const ex = findMatchingExercise(w, matchers, occurrence);
      if (ex && isCompleteSet(ex.sets[setIndex])) return ex.sets[setIndex];
    }
  }
  return null;
}

export function blankSet(setIndex) {
  return { setIndex, weight: null, reps: null, baseWeight: null, baseReps: null, isLogged: false, done: false };
}

// Build a slot's sets for a new workout. weight/reps stay null — they only
// ever hold what the user actually typed. The double-progression prediction
// lives in baseWeight/baseReps and is shown as the inputs' placeholder.
// dayName and occurrence: see findLastLoggedSet (optional).
export function buildPrefilledSets(slot, workouts, dayId, beforeIsoDate, exerciseName, dayName = null, occurrence = 0) {
  const progression = progressionOf(slot);
  const inc = minIncrementFor(Store.getExercises(), slot.exerciseId, exerciseName);
  const sets = [];
  for (let i = 0; i < slot.targetSets; i++) {
    const set = blankSet(i);
    const prevSet = findLastLoggedSet(workouts, dayId, slot.id, slot.exerciseId, i, beforeIsoDate, exerciseName, dayName, occurrence);
    const suggestion = prevSet && nextSet(prevSet, slot.repRangeMin, slot.repRangeMax, progression, inc);
    if (suggestion) {
      set.baseWeight = suggestion.weight;
      set.baseReps = suggestion.reps;
    }
    sets.push(set);
  }
  return sets;
}
