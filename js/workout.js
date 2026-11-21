import { Store } from "./store.js";
import { isoDate, parseLocalDate, resolveDayForDate } from "./schedule.js";
import { DEFAULT_INCREMENT_PCT, blankSet, buildPrefilledSets, exerciseMatchers, findMatchingExercise } from "./progression.js";

export function generateWorkout(meso, dayTemplate, dateIso) {
  const workouts = Store.getWorkouts();
  const library = Store.getExercises();
  const sortedSlots = [...dayTemplate.exercises].sort((a, b) => a.order - b.order);
  const exercises = sortedSlots.map((slot, idx) => {
    const exercise = library.find((e) => e.id === slot.exerciseId);
    const sets = buildPrefilledSets(slot, workouts, dayTemplate.id, dateIso, exercise && exercise.name);
    return {
      slotId: slot.id,
      exerciseId: slot.exerciseId,
      exerciseName: exercise ? exercise.name : "(unknown exercise)",
      order: idx,
      repRangeMin: slot.repRangeMin,
      repRangeMax: slot.repRangeMax,
      weightIncrementPct: slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT,
      sets,
    };
  });
  return Store.createWorkout({
    mesocycleId: meso.id,
    date: dateIso,
    dayId: dayTemplate.id,
    dayName: dayTemplate.name,
    exercises,
  });
}

// Reconciles an already-generated but not-yet-finished workout instance
// against its (possibly since-edited) day template — so a #/program change
// reaches #/today without needing to regenerate history. Finished workouts
// are never passed in here; they stay frozen as-logged.
//
// "This workout only" edits are respected: an exercise added that way is
// flagged `oneOff` (it has no template slot, so it would otherwise look
// stale and be dropped), and a template slot removed that way is listed in
// `workout.skippedSlotIds` (so it isn't re-added). Ordering: template-backed
// exercises follow the template's relative order, within the positions they
// already occupy — one-off exercises keep their own positions.
export function reconcileWorkoutWithTemplate(workout, dayTemplate) {
  const templateSlots = [...dayTemplate.exercises].sort((a, b) => a.order - b.order);
  const templateIds = new Set(templateSlots.map((s) => s.id));
  const skipped = new Set(workout.skippedSlotIds || []);
  let changed = false;

  const before = workout.exercises.length;
  workout.exercises = workout.exercises.filter((ex) => ex.oneOff || templateIds.has(ex.slotId));
  if (workout.exercises.length !== before) changed = true;

  templateSlots.forEach((slot, idx) => {
    if (skipped.has(slot.id)) return;
    const existing = workout.exercises.find((ex) => ex.slotId === slot.id);
    const pct = slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT;
    if (!existing) {
      const exercise = Store.getExercises().find((e) => e.id === slot.exerciseId);
      workout.exercises.push({
        slotId: slot.id, exerciseId: slot.exerciseId,
        exerciseName: exercise ? exercise.name : "(unknown exercise)",
        order: workout.exercises.length + idx, repRangeMin: slot.repRangeMin, repRangeMax: slot.repRangeMax,
        weightIncrementPct: pct,
        sets: buildPrefilledSets(slot, Store.getWorkouts(), dayTemplate.id, workout.date, exercise && exercise.name),
      });
      changed = true;
      return;
    }
    if (existing.repRangeMin !== slot.repRangeMin ||
        existing.repRangeMax !== slot.repRangeMax || existing.weightIncrementPct !== pct) {
      Object.assign(existing, { repRangeMin: slot.repRangeMin, repRangeMax: slot.repRangeMax, weightIncrementPct: pct });
      changed = true;
    }
    if (existing.sets.length < slot.targetSets) {
      for (let i = existing.sets.length; i < slot.targetSets; i++) {
        existing.sets.push(blankSet(i));
      }
      changed = true;
    }
    // Fewer target sets: drop trailing sets, but never one already typed into.
    while (existing.sets.length > Math.max(slot.targetSets, 0) && !isTouchedSet(existing.sets[existing.sets.length - 1])) {
      existing.sets.pop();
      changed = true;
    }
  });

  const templateIndex = new Map(templateSlots.map((s, i) => [s.id, i]));
  const current = [...workout.exercises].sort((a, b) => a.order - b.order);
  const backedInTemplateOrder = current
    .filter((ex) => !ex.oneOff)
    .sort((a, b) => templateIndex.get(a.slotId) - templateIndex.get(b.slotId));
  let next = 0;
  current
    .map((ex) => (ex.oneOff ? ex : backedInTemplateOrder[next++]))
    .forEach((ex, i) => {
      if (ex.order !== i) { ex.order = i; changed = true; }
    });

  if (changed) Store.updateWorkout(workout.id, { exercises: workout.exercises });
  return workout;
}

// Migrate sets from before predictions became placeholder-only: those wrote
// the prediction into weight/reps and flagged it `prefilled`. An untouched
// one is cleared back to blank (the prediction survives in
// baseWeight/baseReps, now shown as the placeholder). New sets never have
// the `prefilled` key, so this only ever runs once per old set. Runs on any
// unfinished workout, past or present — unlike template reconciliation.
export function migrateLegacyPrefill(workout) {
  let changed = false;
  workout.exercises.forEach((ex) => ex.sets.forEach((s) => {
    if (!("prefilled" in s)) return;
    if (!s.isLogged) {
      if (s.prefilled && s.baseWeight == null) { s.baseWeight = s.weight; s.baseReps = s.reps; }
      s.weight = null;
      s.reps = null;
    }
    delete s.prefilled;
    delete s.repsManual;
    changed = true;
  }));
  if (changed) Store.updateWorkout(workout.id, { exercises: workout.exercises });
}

// Only a real, zero-padded YYYY-MM-DD is accepted — the value is used as a
// workout key, compared as a string, and rendered into the page.
export function currentDateParam() {
  const q = location.hash.split("?")[1];
  const d = q ? new URLSearchParams(q).get("date") : null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && isoDate(parseLocalDate(d)) === d ? d : null;
}

export function isTouchedSet(s) {
  return !!s.isLogged || !!s.done || s.weight != null || s.reps != null;
}

export function getTodayContext() {
  const meso = Store.getActiveMesocycle();
  if (!meso) return { meso: null, dayTemplate: null, workout: null, dateIso: null, isToday: true };
  const realTodayIso = isoDate(new Date());
  const dateIso = currentDateParam() || realTodayIso;
  const isToday = dateIso === realTodayIso;
  const date = parseLocalDate(dateIso);
  // Before the mesocycle starts nothing is scheduled.
  const dayTemplate = dateIso < meso.startDate ? null : resolveDayForDate(meso, date);
  let workout = Store.findWorkoutByDate(meso.id, dateIso);
  // The schedule can move under an existing workout (start date edited, day
  // removed and re-added). An untouched unfinished one is just a stale
  // snapshot: drop it and follow the new schedule. One with anything logged
  // is kept as it is and never reconciled against the other day's template,
  // which would delete every exercise in it.
  const sameDay = !!workout && !!dayTemplate && workout.dayId === dayTemplate.id;
  if (workout && !sameDay && !workout.finished && !workout.exercises.some((ex) => ex.sets.some(isTouchedSet))) {
    Store.removeWorkout(workout.id);
    workout = null;
  }
  if (workout && !workout.finished) {
    migrateLegacyPrefill(workout);
    // Only today's (or a later-dated) workout follows #/program edits. A
    // past one — even reopened — stays as it was: reconciling it would add
    // exercises added to the program since, and drop (with their logged
    // sets) ones removed since.
    if (sameDay && dateIso >= realTodayIso) workout = reconcileWorkoutWithTemplate(workout, dayTemplate);
  } else if (!workout && dayTemplate && dateIso <= realTodayIso) {
    workout = generateWorkout(meso, dayTemplate, dateIso);
  }
  return { meso, dayTemplate, workout, dateIso, isToday };
}

// Every finished workout, any day or mesocycle, that logged this exercise
// (see exerciseMatchers in progression.js: by exercise, never by slot).
export function getExerciseHistory(slotId, exerciseId, exerciseName) {
  const matchers = exerciseMatchers(slotId, exerciseId, exerciseName);
  const rows = [];
  Store.getWorkouts()
    .filter((w) => w.finished)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach((w) => {
      const ex = findMatchingExercise(w, matchers);
      if (ex) rows.push({ date: w.date, dayName: w.dayName, sets: ex.sets });
    });
  return rows;
}
