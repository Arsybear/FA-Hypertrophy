import { isoDate, parseLocalDate } from "./schedule.js";

// localStorage-backed data access for FA-Hypertrophy.
// Keys: fah_exercises, fah_mesocycles, fah_workouts

export const KEYS = {
  exercises: "fah_exercises",
  mesocycles: "fah_mesocycles",
  workouts: "fah_workouts",
};

export function uid() {
  return crypto.randomUUID();
}

export function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
  } catch (e) {
    console.error("Failed to read", key, e);
  }
  // Unreadable data: the next write would replace it with the fallback, so
  // keep a copy first (never overwriting an earlier copy).
  try {
    if (localStorage.getItem(key + "_corrupt") == null) localStorage.setItem(key + "_corrupt", raw);
  } catch (e) { /* storage full: nothing more to do */ }
  return fallback;
}

export function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const Store = {
  // --- Exercise library ---
  getExercises() {
    return readJSON(KEYS.exercises, []);
  },
  addExercise(name, muscleGroup) {
    const exercises = Store.getExercises();
    const existing = exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const ex = { id: uid(), name, muscleGroup: muscleGroup || "Other" };
    exercises.push(ex);
    writeJSON(KEYS.exercises, exercises);
    return ex;
  },
  removeExercise(id) {
    writeJSON(KEYS.exercises, Store.getExercises().filter((e) => e.id !== id));
  },

  // --- Mesocycles ---
  getMesocycles() {
    return readJSON(KEYS.mesocycles, []);
  },
  saveMesocycles(list) {
    writeJSON(KEYS.mesocycles, list);
  },
  getActiveMesocycle() {
    return Store.getMesocycles().find((m) => m.active) || null;
  },
  createMesocycle({ name, numWeeks, startDate }) {
    const list = Store.getMesocycles();
    const meso = {
      id: uid(),
      name,
      numWeeks,
      startDate,
      active: list.length === 0, // first mesocycle auto-activates; later ones don't
      days: [],
    };
    list.push(meso);
    Store.saveMesocycles(list);
    return meso;
  },
  setActiveMesocycle(mesoId) {
    const list = Store.getMesocycles();
    for (const m of list) m.active = m.id === mesoId;
    Store.saveMesocycles(list);
  },
  updateMesocycle(mesoId, updates) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return null;
    Object.assign(meso, updates);
    Store.saveMesocycles(list);
    return meso;
  },
  // A new, inactive mesocycle with the same days and exercises (all new ids)
  // and no workouts — a starting point to adjust instead of rebuilding.
  // Days are pinned to offsets from the start weekday, so the copy starts on
  // the same weekday as the original to keep every training day where it
  // was: the first such date after the original's planned end, or after
  // today if that has already passed.
  cloneMesocycle(mesoId, todayIso) {
    const list = Store.getMesocycles();
    const source = list.find((m) => m.id === mesoId);
    if (!source) return null;
    const start = parseLocalDate(source.startDate);
    start.setDate(start.getDate() + source.numWeeks * 7);
    while (isoDate(start) < todayIso) start.setDate(start.getDate() + 7);
    const copy = {
      ...structuredClone(source),
      id: uid(),
      name: `${source.name} (copy)`,
      startDate: isoDate(start),
      active: false,
    };
    copy.days.forEach((day) => {
      day.id = uid();
      day.exercises.forEach((slot) => { slot.id = uid(); });
    });
    list.push(copy);
    Store.saveMesocycles(list);
    return copy;
  },
  addDay(mesoId, name, weekdayOffset) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return null;
    const day = { id: uid(), name, weekdayOffset, exercises: [] };
    meso.days.push(day);
    Store.saveMesocycles(list);
    return day;
  },
  removeDay(mesoId, dayId) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return;
    meso.days = meso.days.filter((d) => d.id !== dayId);
    Store.saveMesocycles(list);
  },
  addExerciseSlot(mesoId, dayId, slot) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    if (!day) return null;
    const newSlot = {
      id: uid(),
      order: day.exercises.length,
      ...slot,
    };
    day.exercises.push(newSlot);
    Store.saveMesocycles(list);
    return newSlot;
  },
  removeExerciseSlot(mesoId, dayId, slotId) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    if (!day) return;
    day.exercises = day.exercises.filter((e) => e.id !== slotId);
    day.exercises.forEach((e, i) => (e.order = i));
    Store.saveMesocycles(list);
  },
  updateExerciseSlot(mesoId, dayId, slotId, updates) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    const slot = day && day.exercises.find((e) => e.id === slotId);
    if (!slot) return null;
    Object.assign(slot, updates);
    Store.saveMesocycles(list);
    return slot;
  },
  reorderExerciseSlot(mesoId, dayId, slotId, direction) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    if (!day) return;
    const sorted = [...day.exercises].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((e) => e.id === slotId);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx].order, sorted[swapIdx].order] = [sorted[swapIdx].order, sorted[idx].order];
    Store.saveMesocycles(list);
  },
  // Swaps two specific slots' order (not necessarily adjacent in the
  // template) — #/today uses this so a swap of two neighbors in a workout
  // instance swaps those same two in the template, even when a slot skipped
  // for that workout sits between them.
  swapExerciseSlotOrder(mesoId, dayId, slotIdA, slotIdB) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    const a = day && day.exercises.find((e) => e.id === slotIdA);
    const b = day && day.exercises.find((e) => e.id === slotIdB);
    if (!a || !b) return;
    [a.order, b.order] = [b.order, a.order];
    Store.saveMesocycles(list);
  },

  // --- Workouts ---
  getWorkouts() {
    return readJSON(KEYS.workouts, []);
  },
  saveWorkouts(list) {
    writeJSON(KEYS.workouts, list);
  },
  getWorkout(id) {
    return Store.getWorkouts().find((w) => w.id === id) || null;
  },
  findWorkoutByDate(mesoId, dateIso) {
    return Store.getWorkouts().find((w) => w.mesocycleId === mesoId && w.date === dateIso) || null;
  },
  createWorkout(workout) {
    const list = Store.getWorkouts();
    const w = { id: uid(), finished: false, finishedAt: null, ...workout };
    list.push(w);
    Store.saveWorkouts(list);
    return w;
  },
  updateWorkout(id, updates) {
    const list = Store.getWorkouts();
    const w = list.find((w) => w.id === id);
    if (!w) return null;
    Object.assign(w, updates);
    Store.saveWorkouts(list);
    return w;
  },
  removeWorkout(id) {
    Store.saveWorkouts(Store.getWorkouts().filter((w) => w.id !== id));
  },
  finishWorkout(id) {
    return Store.updateWorkout(id, { finished: true, finishedAt: new Date().toISOString() });
  },

  // --- Backup ---
  exportBackup() {
    return {
      app: BACKUP_APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      exercises: Store.getExercises(),
      mesocycles: Store.getMesocycles(),
      workouts: Store.getWorkouts(),
    };
  },
  // Replaces everything. The caller has already run validateBackup. The data
  // being replaced is kept under fah_before_import, so a wrong file can be
  // undone by hand.
  importBackup(data) {
    localStorage.setItem("fah_before_import", JSON.stringify(Store.exportBackup()));
    writeJSON(KEYS.exercises, data.exercises);
    writeJSON(KEYS.mesocycles, data.mesocycles);
    writeJSON(KEYS.workouts, data.workouts);
  },
};

const BACKUP_APP = "fa-hypertrophy";

// A backup file is outside input: ids, dates and numbers from it end up in
// HTML attributes and text without escaping (they are app-generated
// everywhere else). So the whole file is rejected unless every one of them
// has the shape the app itself writes. Returns an error message, or null.
export function validateBackup(data) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  const str = (v) => typeof v === "string" && v.length <= 200;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const optNum = (v) => v == null || num(v);
  const optBool = (v) => v == null || typeof v === "boolean";
  const date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(parseLocalDate(v)) === v;
  const all = (list, test) => Array.isArray(list) && list.every((item) => isObj(item) && test(item));

  if (!isObj(data) || data.app !== BACKUP_APP) return "This is not an FA Hypertrophy backup file.";
  if (data.version !== 1) return "This backup was made by a newer version of the app.";

  const exercisesOk = all(data.exercises, (e) => id(e.id) && str(e.name) && (e.muscleGroup == null || str(e.muscleGroup)));
  const mesocyclesOk = all(data.mesocycles, (m) =>
    id(m.id) && str(m.name) && num(m.numWeeks) && date(m.startDate) && typeof m.active === "boolean"
    && all(m.days, (d) => id(d.id) && str(d.name) && optNum(d.weekdayOffset) && optNum(d.order)
      && all(d.exercises, (slot) => id(slot.id) && id(slot.exerciseId) && num(slot.order) && num(slot.targetSets)
        && num(slot.repRangeMin) && num(slot.repRangeMax) && optNum(slot.weightIncrementPct))));
  const workoutsOk = all(data.workouts, (w) =>
    id(w.id) && id(w.mesocycleId) && id(w.dayId) && date(w.date) && str(w.dayName) && typeof w.finished === "boolean"
    && (w.finishedAt == null || str(w.finishedAt))
    && (w.skippedSlotIds == null || (Array.isArray(w.skippedSlotIds) && w.skippedSlotIds.every(id)))
    && all(w.exercises, (ex) => id(ex.slotId) && (ex.exerciseId == null || id(ex.exerciseId)) && str(ex.exerciseName)
      && num(ex.order) && num(ex.repRangeMin) && num(ex.repRangeMax) && optNum(ex.weightIncrementPct) && optBool(ex.oneOff)
      && all(ex.sets, (set) => optNum(set.weight) && optNum(set.reps) && optNum(set.baseWeight) && optNum(set.baseReps)
        && optNum(set.setIndex) && optBool(set.isLogged) && optBool(set.done) && optBool(set.prefilled) && optBool(set.repsManual))));
  if (!exercisesOk || !mesocyclesOk || !workoutsOk) return "This backup file is damaged or was edited. Nothing was imported.";
  return null;
}
