import { Store } from "./store.js";
import { addDays, daysBetween, isIsoDate, isoDate, parseLocalDate, resolveDayForDate, schedulePosition } from "./schedule.js";
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
  return isIsoDate(d) ? d : null;
}

export function isTouchedSet(s) {
  return !!s.isLogged || !!s.done || s.weight != null || s.reps != null;
}

const isTouchedWorkout = (w) => w.exercises.some((ex) => ex.sets.some(isTouchedSet));

export function getTodayContext() {
  const realTodayIso = isoDate(new Date());
  return contextFor(currentDateParam() || realTodayIso, realTodayIso);
}

function contextFor(dateIso, realTodayIso) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return { meso: null, dayTemplate: null, workout: null, dateIso: null, isToday: true, missed: null, madeUp: null };
  const isToday = dateIso === realTodayIso;
  const date = parseLocalDate(dateIso);
  // Before the mesocycle starts nothing is scheduled.
  const scheduled = dateIso < meso.startDate ? null : resolveDayForDate(meso, date);
  let workout = Store.findWorkoutByDate(meso.id, dateIso);
  // A missed workout done on another day (makeup) follows its own day
  // template, not the schedule of the date it was done on.
  const makeup = !!workout && !!workout.makeup;
  const dayTemplate = makeup ? meso.days.find((d) => d.id === workout.dayId) || null : scheduled;
  // The schedule can move under an existing workout (start date edited, day
  // removed and re-added). An untouched unfinished one is just a stale
  // snapshot: drop it and follow the new schedule. One with anything logged
  // is kept as it is and never reconciled against the other day's template,
  // which would delete every exercise in it.
  const sameDay = !!workout && !!dayTemplate && workout.dayId === dayTemplate.id;
  if (workout && !makeup && !sameDay && !workout.finished && !isTouchedWorkout(workout)) {
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
  const missed = findMissedDay(meso, Store.getWorkouts(), dateIso, realTodayIso);
  return { meso, dayTemplate, workout, dateIso, isToday, missed, madeUp: madeUpState(meso, workout, dateIso) };
}

// The missed-day move that undoMissedDay can still take back: the workout at
// the date is untouched and is a makeup, or the date ends a shift's gap.
function madeUpState(meso, workout, dateIso) {
  if (!workout || workout.finished || isTouchedWorkout(workout)) return null;
  if (workout.makeup) return { dateIso: workout.makeupFor, shifted: false };
  const shift = shiftEndingAt(meso, dateIso);
  return shift ? { dateIso: shift.date, shifted: true } : null;
}

function shiftEndingAt(meso, dateIso) {
  return (meso.shifts || []).find((s) => isoDate(addDays(parseLocalDate(s.date), s.days)) === dateIso) || null;
}

// The earliest training day missed right before the viewed date X, which can
// still be done on X: nothing of this mesocycle is logged or finished on X or
// later, and the scan back from X - 1 stops at a gap day, a day with a
// logged or finished workout, or a day already made up. Earliest, so after
// two missed sessions the first is resumed and the program keeps its order.
export function findMissedDay(meso, workouts, dateIso, todayIso) {
  if (dateIso < meso.startDate || dateIso > todayIso) return null;
  const mine = workouts.filter((w) => w.mesocycleId === meso.id);
  const used = (w) => w.finished || isTouchedWorkout(w);
  if (mine.some((w) => w.date >= dateIso && used(w))) return null;
  const blocked = new Set(mine.filter(used).map((w) => w.date));
  mine.forEach((w) => { if (w.makeupFor) blocked.add(w.makeupFor); });
  let found = null;
  for (let d = addDays(parseLocalDate(dateIso), -1); isoDate(d) >= meso.startDate; d = addDays(d, -1)) {
    if (blocked.has(isoDate(d)) || schedulePosition(meso, d).gap) break;
    const dayTemplate = resolveDayForDate(meso, d);
    if (dayTemplate) found = { dateIso: isoDate(d), dayTemplate };
  }
  return found;
}

const removeUntouchedFrom = (mesoId, fromIso) => Store.saveWorkouts(Store.getWorkouts()
  .filter((w) => !(w.mesocycleId === mesoId && w.date >= fromIso && !w.finished && !isTouchedWorkout(w))));

// Does the missed day M on the viewed date X. With `shift`, the rest of the
// mesocycle moves out by the days between (X then trains M's day); without,
// only this workout moves, which needs X to be a rest day. Returns the
// workout for X, or null when nothing was done.
export function doMissedDay(meso, dateIso, todayIso, shift) {
  const missed = findMissedDay(meso, Store.getWorkouts(), dateIso, todayIso);
  if (!missed) return null;
  if (shift) {
    Store.addShift(meso.id, missed.dateIso, daysBetween(parseLocalDate(missed.dateIso), parseLocalDate(dateIso)));
    removeUntouchedFrom(meso.id, missed.dateIso);
    return contextFor(dateIso, todayIso).workout;
  }
  if (resolveDayForDate(meso, parseLocalDate(dateIso))) return null;
  const stale = Store.findWorkoutByDate(meso.id, dateIso);
  if (stale && !stale.finished && !isTouchedWorkout(stale)) Store.removeWorkout(stale.id);
  const workout = generateWorkout(meso, missed.dayTemplate, dateIso);
  return Store.updateWorkout(workout.id, { makeup: true, makeupFor: missed.dateIso });
}

// Takes back doMissedDay while the workout at X is still untouched. Returns
// whether anything was undone.
export function undoMissedDay(meso, dateIso) {
  const current = Store.getMesocycles().find((m) => m.id === meso.id);
  if (!current) return false;
  const workout = Store.findWorkoutByDate(current.id, dateIso);
  if (workout && (workout.finished || isTouchedWorkout(workout))) return false;
  const shift = shiftEndingAt(current, dateIso);
  if (shift) {
    Store.removeShift(current.id, shift.date);
    removeUntouchedFrom(current.id, shift.date);
    return true;
  }
  if (workout && workout.makeup) {
    Store.removeWorkout(workout.id);
    return true;
  }
  return false;
}

// Rebuilds the predictions of every exercise not yet started in any
// unfinished workout, as of that workout's date: finishing (or reopening)
// one workout, or importing a backup, changes the history the others were
// predicted from. Not run on every render: it reads all history.
export function refreshPredictions() {
  const workouts = Store.getWorkouts();
  let changed = false;
  for (const w of workouts) {
    if (w.finished) continue;
    for (const ex of w.exercises) {
      if (ex.sets.some(isTouchedSet)) continue;
      const fresh = buildPrefilledSets({
        id: ex.slotId, exerciseId: ex.exerciseId, targetSets: ex.sets.length,
        repRangeMin: ex.repRangeMin, repRangeMax: ex.repRangeMax, weightIncrementPct: ex.weightIncrementPct,
      }, workouts, w.dayId, w.date, ex.exerciseName);
      ex.sets.forEach((s, i) => {
        if (s.baseWeight !== fresh[i].baseWeight || s.baseReps !== fresh[i].baseReps) {
          s.baseWeight = fresh[i].baseWeight;
          s.baseReps = fresh[i].baseReps;
          changed = true;
        }
      });
    }
  }
  if (changed) Store.saveWorkouts(workouts);
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
