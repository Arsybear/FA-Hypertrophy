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

// Estimate the rep count at newWeight that represents the same effort as
// the (baseWeight, baseReps) anchor, by averaging the Epley and Brzycki
// 1RM formulas (each inverted with itself, then averaged) — this cancels
// most of Epley's high-rep overestimate and Brzycki's underestimate. Still
// an estimate, most reliable in the ~2-10 rep range.
function equivalentReps(baseWeight, baseReps, newWeight) {
  if (baseWeight == null || baseReps == null || newWeight == null || newWeight <= 0) return null;
  const epley1RM = baseWeight * (1 + baseReps / 30);
  const repsEpley = 30 * (epley1RM / newWeight - 1);
  let repsAvg = repsEpley;
  if (baseReps < 37) {
    const brzycki1RM = (baseWeight * 36) / (37 - baseReps);
    const repsBrzycki = 37 - (36 * newWeight) / brzycki1RM;
    repsAvg = (repsEpley + repsBrzycki) / 2;
  }
  return Math.max(1, Math.round(repsAvg));
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
// 95x12, even though 97.5x11 is roughly the same effort).
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
