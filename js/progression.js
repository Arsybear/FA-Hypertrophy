import { Store } from "./store.js";

export const DEFAULT_INCREMENT_PCT = 2.5;
export const PLATE_INCREMENT = 2.5;
export const LIGHT_WEIGHT_THRESHOLD = 45; // below this: light (rep-first)
export const HEAVY_WEIGHT_THRESHOLD = 135; // at/above this: heavy (weight-first)

export function roundToPlate(n) {
  return Math.round(n / PLATE_INCREMENT) * PLATE_INCREMENT;
}

export function weightClass(weight) {
  if (weight < LIGHT_WEIGHT_THRESHOLD) return "light";
  if (weight >= HEAVY_WEIGHT_THRESHOLD) return "heavy";
  return "medium";
}

// Heavy exercises bump weight once reps clear the rep range's midpoint
// instead of forcing a full climb to repRangeMax first — one more rep at
// a heavy weight is disproportionately harder than at a light one, so a
// smaller, more frequent weight bump is the smoother progression. Light
// and medium exercises keep the classic full-climb trigger.
export function weightBumpTriggerReps(cls, repRangeMin, repRangeMax) {
  if (cls === "heavy") {
    return repRangeMin + Math.ceil((repRangeMax - repRangeMin) / 2);
  }
  return repRangeMax;
}

// How many percent of load increase costs one rep. Light exercises move in
// big equipment-forced jumps (15 -> 20lb dumbbells) that cost far fewer reps
// than the same percentage on a heavy lift — fitted to real progressions
// (17.5x9 -> 20x8, 15x8 -> 20x6: ~1 rep per 15%). Heavy matches what the old
// Epley/Brzycki estimate gave at typical hypertrophy rep counts (~1 rep per
// 2.5%). Medium interpolates linearly by weight so exercises either side of
// a threshold don't behave wildly differently — that band is a guess, not
// yet fitted to data.
export const LIGHT_PCT_PER_REP = 15;
export const HEAVY_PCT_PER_REP = 2.5;

export function pctPerRep(weight) {
  if (weight <= LIGHT_WEIGHT_THRESHOLD) return LIGHT_PCT_PER_REP;
  if (weight >= HEAVY_WEIGHT_THRESHOLD) return HEAVY_PCT_PER_REP;
  const t = (weight - LIGHT_WEIGHT_THRESHOLD) / (HEAVY_WEIGHT_THRESHOLD - LIGHT_WEIGHT_THRESHOLD);
  return LIGHT_PCT_PER_REP + t * (HEAVY_PCT_PER_REP - LIGHT_PCT_PER_REP);
}

// Estimate the rep target at newWeight relative to the (baseWeight,
// baseReps) anchor: one rep lost (or gained, for a lighter weight) per
// pctPerRep(baseWeight)% of load change. Callers clamp to the rep range.
export function equivalentReps(baseWeight, baseReps, newWeight) {
  if (baseWeight == null || baseReps == null || newWeight == null || newWeight <= 0 || baseWeight <= 0) return null;
  const pctChange = (newWeight / baseWeight - 1) * 100;
  return Math.max(1, Math.round(baseReps - pctChange / pctPerRep(baseWeight)));
}

// Double-progression prefill: given the previous logged set and an
// exercise's rep range / weight increment (% of current weight), compute
// the next suggested set. The trigger rep count for the weight bump
// depends on the previous set's weight class (see weightBumpTriggerReps);
// the bump itself is always forced to change the weight by at least one
// plate increment, since a small percentage of a light weight can round
// back to the same number and silently stall progression. weightIncrementPct
// is defined as the week-over-week weight increase at a constant rep count,
// so once the weight is bumped, the new rep target is derived via
// equivalentReps (not reset to repRangeMin) — otherwise the "same reps"
// premise behind the percentage is broken and the new prescription reads as
// an accidental deload (e.g. 95x12 -> 97.5x8 is a much easier set than
// 95x12, when 97.5x12 is the real next step).
export function nextSet(prevSet, repRangeMin, repRangeMax, weightIncrementPct) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  const cls = weightClass(prevSet.weight);
  const triggerReps = weightBumpTriggerReps(cls, repRangeMin, repRangeMax);
  // A 0lb set is bodyweight: there is no weight to bump, only reps.
  if (prevSet.weight > 0 && prevSet.reps >= triggerReps) {
    const bumped = roundToPlate(prevSet.weight * (1 + weightIncrementPct / 100));
    const weight = bumped > prevSet.weight ? bumped : prevSet.weight + PLATE_INCREMENT;
    const equivReps = equivalentReps(prevSet.weight, prevSet.reps, weight);
    const reps = equivReps == null ? repRangeMin : Math.min(Math.max(equivReps, repRangeMin), repRangeMax);
    return { weight, reps };
  }
  return { weight: prevSet.weight, reps: Math.min(prevSet.reps + 1, repRangeMax) };
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
  const sets = [];
  for (let i = 0; i < slot.targetSets; i++) {
    const set = blankSet(i);
    const prevSet = findLastLoggedSet(workouts, dayId, slot.id, slot.exerciseId, i, beforeIsoDate, exerciseName, dayName, occurrence);
    const suggestion = prevSet && nextSet(prevSet, slot.repRangeMin, slot.repRangeMax, slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT);
    if (suggestion) {
      set.baseWeight = suggestion.weight;
      set.baseReps = suggestion.reps;
    }
    sets.push(set);
  }
  return sets;
}
