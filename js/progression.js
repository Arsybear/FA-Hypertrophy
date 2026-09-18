const DEFAULT_INCREMENT_PCT = 2.5;
const PLATE_INCREMENT = 2.5;

function roundToPlate(n) {
  return Math.round(n / PLATE_INCREMENT) * PLATE_INCREMENT;
}

// Double-progression prefill: given the previous logged set and an
// exercise's rep range / weight increment (% of current weight), compute
// the next suggested set.
function nextSet(prevSet, repRangeMin, repRangeMax, weightIncrementPct) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  if (prevSet.reps >= repRangeMax) {
    return { weight: roundToPlate(prevSet.weight * (1 + weightIncrementPct / 100)), reps: repRangeMin };
  }
  return { weight: prevSet.weight, reps: Math.min(prevSet.reps + 1, repRangeMax) };
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
