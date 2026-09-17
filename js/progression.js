// Double-progression prefill: given the previous logged set and an
// exercise's rep range / weight increment, compute the next suggested set.
function nextSet(prevSet, repRangeMin, repRangeMax, weightIncrement) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  if (prevSet.reps >= repRangeMax) {
    return { weight: round2(prevSet.weight + weightIncrement), reps: repRangeMin };
  }
  return { weight: prevSet.weight, reps: Math.min(prevSet.reps + 1, repRangeMax) };
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
      const suggestion = nextSet(prevSet, slot.repRangeMin, slot.repRangeMax, slot.weightIncrement);
      sets.push({
        setIndex: i,
        weight: suggestion ? suggestion.weight : null,
        reps: suggestion ? suggestion.reps : null,
        prefilled: !!suggestion,
        isLogged: false,
      });
    } else {
      sets.push({ setIndex: i, weight: null, reps: null, prefilled: false, isLogged: false });
    }
  }
  return sets;
}
