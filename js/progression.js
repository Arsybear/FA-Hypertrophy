const DEFAULT_INCREMENT_PCT = 2.5;
const PLATE_INCREMENT = 2.5;
const LIGHT_WEIGHT_THRESHOLD = 45; // below this: light (rep-first)
const HEAVY_WEIGHT_THRESHOLD = 135; // at/above this: heavy (weight-first)

function roundToPlate(n) {
  return Math.round(n / PLATE_INCREMENT) * PLATE_INCREMENT;
}

function weightClass(weight) {
  if (weight < LIGHT_WEIGHT_THRESHOLD) return "light";
  if (weight >= HEAVY_WEIGHT_THRESHOLD) return "heavy";
  return "medium";
}

// Heavy exercises bump weight once reps clear the rep range's midpoint
// instead of forcing a full climb to repRangeMax first — one more rep at
// a heavy weight is disproportionately harder than at a light one, so a
// smaller, more frequent weight bump is the smoother progression. Light
// and medium exercises keep the classic full-climb trigger.
function weightBumpTriggerReps(cls, repRangeMin, repRangeMax) {
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
const LIGHT_PCT_PER_REP = 15;
const HEAVY_PCT_PER_REP = 2.5;

function pctPerRep(weight) {
  if (weight <= LIGHT_WEIGHT_THRESHOLD) return LIGHT_PCT_PER_REP;
  if (weight >= HEAVY_WEIGHT_THRESHOLD) return HEAVY_PCT_PER_REP;
  const t = (weight - LIGHT_WEIGHT_THRESHOLD) / (HEAVY_WEIGHT_THRESHOLD - LIGHT_WEIGHT_THRESHOLD);
  return LIGHT_PCT_PER_REP + t * (HEAVY_PCT_PER_REP - LIGHT_PCT_PER_REP);
}

// Estimate the rep target at newWeight relative to the (baseWeight,
// baseReps) anchor: one rep lost (or gained, for a lighter weight) per
// pctPerRep(baseWeight)% of load change. Callers clamp to the rep range.
function equivalentReps(baseWeight, baseReps, newWeight) {
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
function nextSet(prevSet, repRangeMin, repRangeMax, weightIncrementPct) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  const cls = weightClass(prevSet.weight);
  const triggerReps = weightBumpTriggerReps(cls, repRangeMin, repRangeMax);
  if (prevSet.reps >= triggerReps) {
    const bumped = roundToPlate(prevSet.weight * (1 + weightIncrementPct / 100));
    const weight = bumped > prevSet.weight ? bumped : prevSet.weight + PLATE_INCREMENT;
    const equivReps = equivalentReps(prevSet.weight, prevSet.reps, weight);
    const reps = equivReps == null ? repRangeMin : Math.min(Math.max(equivReps, repRangeMin), repRangeMax);
    return { weight, reps };
  }
  return { weight: prevSet.weight, reps: Math.min(prevSet.reps + 1, repRangeMax) };
}

// Find the most recent finished workout (date < beforeDate) that contains a
// matching exercise slot, preferring an exact slotId match and falling back
// to exerciseId (e.g. after a substitution reset history for that slot).
function findLastLoggedExercise(workouts, dayId, slotId, exerciseId, beforeIsoDate) {
  const candidates = workouts
    .filter((w) => w.finished && w.dayId === dayId && w.date < beforeIsoDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  for (const w of candidates) {
    const match = w.exercises.find((e) => e.slotId === slotId);
    if (match) return match;
  }
  for (const w of candidates) {
    const match = w.exercises.find((e) => e.exerciseId === exerciseId);
    if (match) return match;
  }
  return null;
}

// Build the prefilled sets array for a slot given prior history (or blank
// sets if no history exists yet — manual baseline entry).
function buildPrefilledSets(slot, workouts, dayId, beforeIsoDate) {
  const prevExercise = findLastLoggedExercise(
    workouts,
    dayId,
    slot.id,
    slot.exerciseId,
    beforeIsoDate
  );

  const sets = [];
  for (let i = 0; i < slot.targetSets; i++) {
    const prevSet = prevExercise && prevExercise.sets[i];
    if (prevSet && prevSet.weight != null && prevSet.reps != null) {
      const suggestion = nextSet(prevSet, slot.repRangeMin, slot.repRangeMax, slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT);
      sets.push({
        setIndex: i,
        weight: suggestion ? suggestion.weight : null,
        reps: suggestion ? suggestion.reps : null,
        baseWeight: suggestion ? suggestion.weight : null,
        baseReps: suggestion ? suggestion.reps : null,
        prefilled: !!suggestion,
        isLogged: false,
        repsManual: false,
      });
    } else {
      sets.push({ setIndex: i, weight: null, reps: null, baseWeight: null, baseReps: null, prefilled: false, isLogged: false, repsManual: false });
    }
  }
  return sets;
}
