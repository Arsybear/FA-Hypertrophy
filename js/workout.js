import { Store } from "./store.js";
import { addDays, daysBetween, isIsoDate, isoDate, parseLocalDate, resolveDayForDate, schedulePosition } from "./schedule.js";
import { UNKNOWN_EXERCISE, buildPrefilledSets, exerciseMatchers, matchingEntries, progressionOf } from "./progression.js";

// How many of the slots or workout entries in `list` hold the same exercise
// as `item` and sit before it in order: the "occurrence" of
// findMatchingExercise in progression.js (k-th slot of an exercise on a day).
function occurrenceIn(list, item) {
  const key = (e) => e.exerciseId ?? e.exerciseName;
  return list.filter((e) => e !== item && key(e) === key(item) && (e.order ?? 0) < (item.order ?? 0)).length;
}

// The sets, with predictions, for one entry of `workout`: entry is
// { slotId, exerciseId, exerciseName, targetSets, repRangeMin, repRangeMax,
// progression, order } (order: where it sits or will sit; progression falls
// back to an older entry's weightIncrementPct, see progressionOf). Predicted
// as of the workout's date, from the same day, then a day of the same name,
// then any day; the k-th entry of an exercise follows the k-th of history.
// Every caller that builds an entry's sets outside generateWorkout uses this,
// so a swap or an added exercise follows the same history as everything else.
export function buildEntrySets(workout, entry, history = Store.getWorkouts()) {
  return buildPrefilledSets({
    id: entry.slotId, exerciseId: entry.exerciseId, targetSets: entry.targetSets,
    repRangeMin: entry.repRangeMin, repRangeMax: entry.repRangeMax, progression: progressionOf(entry),
  }, history, workout.dayId, workout.date, entry.exerciseName, workout.dayName, occurrenceIn(workout.exercises, entry));
}

// A workout entry for a template slot, with fresh predictions as of dateIso.
function entryFromSlot(slot, dayTemplate, daySlots, dateIso, order, library, workouts) {
  const exercise = library.find((e) => e.id === slot.exerciseId);
  return {
    slotId: slot.id,
    exerciseId: slot.exerciseId,
    exerciseName: exercise ? exercise.name : UNKNOWN_EXERCISE,
    order,
    repRangeMin: slot.repRangeMin,
    repRangeMax: slot.repRangeMax,
    progression: progressionOf(slot),
    sets: buildPrefilledSets(slot, workouts, dayTemplate.id, dateIso, exercise && exercise.name, dayTemplate.name, occurrenceIn(daySlots, slot)),
  };
}

export function generateWorkout(meso, dayTemplate, dateIso) {
  const workouts = Store.getWorkouts();
  const library = Store.getExercises();
  const sortedSlots = [...dayTemplate.exercises].sort((a, b) => a.order - b.order);
  const exercises = sortedSlots.map((slot, idx) => entryFromSlot(slot, dayTemplate, sortedSlots, dateIso, idx, library, workouts));
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
// An exercise whose slot left the program goes, unless a set of it is
// already touched: then it stays, as this workout's own (oneOff). An
// untouched entry whose exercise differs from its slot's (the slot was
// swapped for all future elsewhere) is rebuilt to the slot's exercise,
// unless it was swapped for this workout only (`swapped: true`). A rep range
// or preset edited on Program reaches the entry; an untouched entry's sets
// are then predicted again, a touched one keeps its sets.
export function reconcileWorkoutWithTemplate(workout, dayTemplate) {
  const templateSlots = [...dayTemplate.exercises].sort((a, b) => a.order - b.order);
  const templateIds = new Set(templateSlots.map((s) => s.id));
  const skipped = new Set(workout.skippedSlotIds || []);
  const library = Store.getExercises();
  const history = Store.getWorkouts();
  let changed = false;

  workout.exercises = workout.exercises.filter((ex) => {
    if (ex.oneOff || templateIds.has(ex.slotId)) return true;
    changed = true;
    if (!ex.sets.some(isTouchedSet)) return false;
    ex.oneOff = true;
    return true;
  });

  templateSlots.forEach((slot, idx) => {
    if (skipped.has(slot.id)) return;
    const existing = workout.exercises.find((ex) => ex.slotId === slot.id);
    const progression = progressionOf(slot);
    if (!existing) {
      workout.exercises.push(entryFromSlot(slot, dayTemplate, templateSlots, workout.date, workout.exercises.length + idx, library, history));
      changed = true;
      return;
    }
    if (existing.exerciseId !== slot.exerciseId && !existing.swapped && !existing.sets.some(isTouchedSet)) {
      Object.assign(existing, entryFromSlot(slot, dayTemplate, templateSlots, workout.date, existing.order, library, history));
      changed = true;
      return;
    }
    if (existing.repRangeMin !== slot.repRangeMin ||
        existing.repRangeMax !== slot.repRangeMax || progressionOf(existing) !== progression) {
      Object.assign(existing, { repRangeMin: slot.repRangeMin, repRangeMax: slot.repRangeMax, progression });
      if (!existing.sets.some(isTouchedSet)) existing.sets = buildEntrySets(workout, { ...existing, targetSets: slot.targetSets }, history);
      changed = true;
    }
    if (existing.sets.length < slot.targetSets) {
      // The new sets get their own predictions, for this entry's exercise
      // (a this-workout-only swap keeps its own numbers).
      const fresh = buildEntrySets(workout, { ...existing, targetSets: slot.targetSets }, history);
      existing.sets.push(...fresh.slice(existing.sets.length));
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
// A set ticked done (a reopened workout) is logged. An unlogged set with a
// weight that is not a prediction got it carried from another set, which
// today's model keeps as a real value: only its reps go.
export function migrateLegacyPrefill(workout) {
  if (migratePrefilledSets(workout)) Store.updateWorkout(workout.id, { exercises: workout.exercises });
}

// The migration itself, in memory; returns whether a set changed.
function migratePrefilledSets(workout) {
  let changed = false;
  workout.exercises.forEach((ex) => ex.sets.forEach((s) => {
    if (!("prefilled" in s)) return;
    if (!s.isLogged && !s.done) {
      if (s.prefilled && s.baseWeight == null) { s.baseWeight = s.weight; s.baseReps = s.reps; }
      if (s.prefilled) s.weight = null;
      s.reps = null;
    }
    delete s.prefilled;
    delete s.repsManual;
    changed = true;
  }));
  return changed;
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
// Finished or touched: the user did something with this workout.
const isUsed = (w) => w.finished || isTouchedWorkout(w);

// How far back findMissedDay looks (a shift is at most 366 days).
const MAX_MISSED_SCAN_DAYS = 366;

export function getTodayContext() {
  const realTodayIso = isoDate(new Date());
  return contextFor(currentDateParam() || realTodayIso, realTodayIso);
}

function contextFor(dateIso, realTodayIso) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return { meso: null, dayTemplate: null, workout: null, dateIso: null, isToday: true, missed: null, missedDays: [], madeUp: null };
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
  // Migrated first: an untouched legacy set would otherwise read as logged.
  if (workout && !workout.finished) migrateLegacyPrefill(workout);
  const sameDay = !!workout && !!dayTemplate && workout.dayId === dayTemplate.id;
  if (workout && !makeup && !sameDay && !workout.finished && !isTouchedWorkout(workout)) {
    Store.removeWorkout(workout.id);
    workout = null;
  }
  if (workout && !workout.finished) {
    // Only today's (or a later-dated) workout follows #/program edits. A
    // past one — even reopened — stays as it was: reconciling it would add
    // exercises added to the program since, and drop (with their logged
    // sets) ones removed since.
    if (sameDay && dateIso >= realTodayIso) workout = reconcileWorkoutWithTemplate(workout, dayTemplate);
  } else if (!workout && dayTemplate && dateIso <= realTodayIso) {
    workout = generateWorkout(meso, dayTemplate, dateIso);
  }
  const move = workout ? undoableMove(meso, dateIso) : null;
  const madeUp = move && (move.shift ? { dateIso: move.shift.date, shifted: true } : { dateIso: move.workout.makeupFor, shifted: false });
  // Never both: the missed card and the "moved here / Undo" notice.
  const missedDays = madeUp ? [] : findMissedDays(meso, Store.getWorkouts(), dateIso, realTodayIso);
  return { meso, dayTemplate, workout, dateIso, isToday, missed: missedDays[0] || null, missedDays, madeUp };
}

// The missed-day move on date X that undoMissedDay can still take back, as
// { shift, workout } (shift null for a makeup), or null. Nothing of this
// mesocycle may be finished or touched on X or later, and X must end the
// LAST shift's gap (an earlier one has later shifts built on it) or hold a
// makeup workout.
function undoableMove(meso, dateIso) {
  const mine = Store.getWorkouts().filter((w) => w.mesocycleId === meso.id);
  if (mine.some((w) => w.date >= dateIso && isUsed(w))) return null;
  const workout = mine.find((w) => w.date === dateIso) || null;
  const shifts = meso.shifts || [];
  const shift = shifts.find((s) => isoDate(addDays(parseLocalDate(s.date), s.days)) === dateIso);
  if (shift) return shift === shifts[shifts.length - 1] ? { shift, workout } : null;
  return workout && workout.makeup ? { shift: null, workout } : null;
}

// The training days missed right before the viewed date X that can still be
// done on X: nothing of this mesocycle is logged or finished on X or later,
// and the scan back from X - 1 (at most MAX_MISSED_SCAN_DAYS) stops at a gap
// day, a day with a logged or finished workout, or a day made up by a logged
// or finished makeup. One entry per day template, at its earliest missed
// date, earliest first: after a week off every day of the program is in the
// list and the user picks which one to resume with. The first entry is the
// default, so after two missed sessions the first is resumed and the program
// keeps its order.
export function findMissedDays(meso, workouts, dateIso, todayIso) {
  if (dateIso < meso.startDate || dateIso > todayIso) return [];
  // A gap day of a shift: a new shift from here would leave X a rest day.
  if (schedulePosition(meso, parseLocalDate(dateIso)).gap) return [];
  // Before a shift that is already there (a later day was picked and the
  // days before it were skipped): a shift from here would start under that
  // one, move the day it put on its date and take its Undo away.
  if ((meso.shifts || []).some((s) => s.date > dateIso)) return [];
  const mine = workouts.filter((w) => w.mesocycleId === meso.id);
  if (mine.some((w) => w.date >= dateIso && isUsed(w))) return [];
  const blocked = new Set();
  mine.filter(isUsed).forEach((w) => {
    blocked.add(w.date);
    if (w.makeupFor) blocked.add(w.makeupFor);
  });
  const x = parseLocalDate(dateIso);
  const earliest = new Map(); // day id -> its missed date furthest back
  for (let n = 1; n <= MAX_MISSED_SCAN_DAYS; n++) {
    const d = addDays(x, -n);
    const iso = isoDate(d);
    if (iso < meso.startDate || blocked.has(iso) || schedulePosition(meso, d).gap) break;
    const dayTemplate = resolveDayForDate(meso, d);
    if (dayTemplate) earliest.set(dayTemplate.id, { dateIso: iso, dayTemplate });
  }
  return [...earliest.values()].sort((a, b) => (a.dateIso < b.dateIso ? -1 : 1));
}

export function findMissedDay(meso, workouts, dateIso, todayIso) {
  return findMissedDays(meso, workouts, dateIso, todayIso)[0] || null;
}

const removeUntouchedFrom = (mesoId, fromIso) => Store.saveWorkouts(Store.getWorkouts()
  .filter((w) => !(w.mesocycleId === mesoId && w.date >= fromIso && !isUsed(w))));

// Does the missed day M on the viewed date X. With `shift`, the rest of the
// mesocycle moves out by the days between (X then trains M's day); without,
// only this workout moves, which needs X to be a rest day. An untouched
// makeup already made for M elsewhere is replaced. M is the earliest missed
// day, or the one of findMissedDays dated `pickIso` (a date that is not in
// that list does nothing: the screen showed something else). With a later
// pick and `shift`, the missed days before M stay behind as they are.
// Returns the workout for X, or null when nothing was done.
export function doMissedDay(meso, dateIso, todayIso, shift, pickIso = null) {
  const choices = findMissedDays(meso, Store.getWorkouts(), dateIso, todayIso);
  const missed = pickIso ? choices.find((m) => m.dateIso === pickIso) : choices[0];
  if (!missed) return null;
  if (!shift && resolveDayForDate(meso, parseLocalDate(dateIso))) return null;
  const all = Store.getWorkouts();
  const kept = all.filter((w) => !(w.mesocycleId === meso.id && w.makeupFor === missed.dateIso && !isUsed(w)));
  if (kept.length !== all.length) Store.saveWorkouts(kept);
  if (shift) {
    Store.addShift(meso.id, missed.dateIso, daysBetween(parseLocalDate(missed.dateIso), parseLocalDate(dateIso)));
    removeUntouchedFrom(meso.id, missed.dateIso);
    return contextFor(dateIso, todayIso).workout;
  }
  const stale = Store.findWorkoutByDate(meso.id, dateIso);
  if (stale && !isUsed(stale)) Store.removeWorkout(stale.id);
  const workout = generateWorkout(meso, missed.dayTemplate, dateIso);
  return Store.updateWorkout(workout.id, { makeup: true, makeupFor: missed.dateIso });
}

// Takes back doMissedDay while it can be (see undoableMove; a missing
// workout at X counts as untouched). Returns whether anything was undone.
export function undoMissedDay(meso, dateIso) {
  const current = Store.getMesocycles().find((m) => m.id === meso.id);
  const move = current && undoableMove(current, dateIso);
  if (!move) return false;
  if (move.shift) {
    Store.removeShift(current.id, move.shift.date);
    removeUntouchedFrom(current.id, move.shift.date);
  } else {
    Store.removeWorkout(move.workout.id);
  }
  return true;
}

// Rebuilds the predictions of every exercise not yet started in any
// unfinished workout, as of that workout's date: finishing (or reopening)
// one workout, or importing a backup, changes the history the others were
// predicted from. Not run on every render: it reads all history.
export function refreshPredictions() {
  const workouts = Store.getWorkouts();
  let changed = false;
  // Legacy prefilled sets first (it runs at startup and after an import), so
  // no unfinished workout keeps an untouched old prediction that reads as
  // logged on every screen but its own day's.
  for (const w of workouts) if (!w.finished && migratePrefilledSets(w)) changed = true;
  for (const w of workouts) {
    if (w.finished) continue;
    for (const ex of w.exercises) {
      if (ex.sets.some(isTouchedSet)) continue;
      const fresh = buildEntrySets(w, { ...ex, targetSets: ex.sets.length }, workouts);
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

// Every entry of this exercise in every finished workout, any day or
// mesocycle: newest workout first, one workout's entries in order. Matched
// by exerciseId, else (no entry of it in that workout) by name — see
// exerciseMatchers in progression.js. Each row says which of how many
// entries of the exercise that workout had (`part` of `parts`), so the same
// exercise done twice in a day shows as two labelled rows. slotId is kept
// for callers; it does not narrow the result.
export function getExerciseHistory(slotId, exerciseId, exerciseName) {
  const [, byId, byName] = exerciseMatchers(slotId, exerciseId, exerciseName);
  const rows = [];
  Store.getWorkouts()
    .filter((w) => w.finished)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach((w) => {
      const byIdHits = matchingEntries(w, byId);
      const entries = byIdHits.length ? byIdHits : matchingEntries(w, byName);
      entries.forEach((ex, i) => rows.push({ date: w.date, dayName: w.dayName, sets: ex.sets, part: i + 1, parts: entries.length }));
    });
  return rows;
}
