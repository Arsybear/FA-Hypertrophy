// localStorage-backed data access for FA-Hypertrophy.
// Keys: fah_exercises, fah_mesocycles, fah_workouts

const KEYS = {
  exercises: "fah_exercises",
  mesocycles: "fah_mesocycles",
  workouts: "fah_workouts",
};

function uid() {
  return crypto.randomUUID();
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("Failed to read", key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Store = {
  // --- Exercise library ---
  getExercises() {
    return readJSON(KEYS.exercises, []);
  },
  addExercise(name) {
    const exercises = Store.getExercises();
    const existing = exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const ex = { id: uid(), name };
    exercises.push(ex);
    writeJSON(KEYS.exercises, exercises);
    return ex;
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
  createMesocycle({ name, numWeeks, startDate, startDayOfWeek }) {
    const list = Store.getMesocycles();
    const meso = {
      id: uid(),
      name,
      numWeeks,
      startDate,
      startDayOfWeek,
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
  addDay(mesoId, name) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return null;
    const day = { id: uid(), name, order: meso.days.length, exercises: [] };
    meso.days.push(day);
    Store.saveMesocycles(list);
    return day;
  },
  removeDay(mesoId, dayId) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return;
    meso.days = meso.days.filter((d) => d.id !== dayId);
    meso.days.forEach((d, i) => (d.order = i));
    Store.saveMesocycles(list);
  },
  reorderDay(mesoId, dayId, direction) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return;
    const sorted = [...meso.days].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((d) => d.id === dayId);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx].order, sorted[swapIdx].order] = [sorted[swapIdx].order, sorted[idx].order];
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
  finishWorkout(id) {
    return Store.updateWorkout(id, { finished: true, finishedAt: new Date().toISOString() });
  },
};
