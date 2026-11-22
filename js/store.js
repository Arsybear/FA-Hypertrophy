import { addDays, isIsoDate, isoDate, parseLocalDate, totalShiftDays } from "./schedule.js";
import { PROGRESSIONS } from "./progression.js";

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

// A write can fail (storage full or blocked). The change is then gone on the
// next read, so it must not be silent: the UI shows a notice (see main.js).
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("Failed to write", key, e);
    Store.writeFailed = true;
    if (Store.onWriteError) Store.onWriteError();
    return false;
  }
}

// Sets / reps / weeks: a whole number from 1 to 99 (an absurd set count
// would build that many set rows and overflow storage).
export function cleanCount(v) {
  return Math.min(99, Math.max(1, Math.floor(Number(v)) || 1));
}

// Weight increment in percent: 0 to 50.
export function cleanPct(v) {
  return Math.min(50, Math.max(0, Number(v) || 0));
}

// An exercise's minimum weight step in lb, as typed: blank, not a number,
// or 0 or less is null (no value: the 2.5 default), else 0.25 to 100, to 0.01.
export function cleanMinIncrement(raw) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(100, Math.max(0.25, n)) * 100) / 100;
}

// A slot's or entry's preset: removed unless it is one of PROGRESSIONS (it
// is rendered into an attribute). Returns whether it changed.
function cleanProgression(obj) {
  if (!("progression" in obj) || PROGRESSIONS.includes(obj.progression)) return false;
  delete obj.progression;
  return true;
}

// Library minimum steps: clamped, or removed when not a number. Returns
// whether anything changed.
function cleanLibrary(exercises) {
  let changed = false;
  for (const e of exercises) {
    if (!("minIncrement" in e)) continue;
    const v = typeof e.minIncrement === "number" ? cleanMinIncrement(e.minIncrement) : null;
    if (v == null) delete e.minIncrement;
    else if (v !== e.minIncrement) e.minIncrement = v;
    else continue;
    changed = true;
  }
  return changed;
}

// Workout entries' presets, as cleanProgression. Returns whether anything changed.
function cleanEntries(workouts) {
  let changed = false;
  for (const w of workouts) for (const entry of w.exercises || []) if (cleanProgression(entry)) changed = true;
  return changed;
}

// A set value as typed on Today: weight 0 (bodyweight) to 2000 lb, reps a
// whole number 0 to 999. Anything else (text, negative, 7.5 reps, 1e20) is
// refused as blank: it would be saved as history and drive the predictions.
export function cleanSetValue(field, raw) {
  const n = String(raw).trim() === "" ? NaN : Number(raw);
  if (field === "reps") return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null;
  return n >= 0 && n <= 2000 ? n : null;
}

// A mesocycle's start moved to startIso: shifts dated before it go (the key
// too when none is left), so no shift starts before the mesocycle. Returns
// whether anything changed.
function dropShiftsBefore(meso, startIso) {
  if (!meso.shifts) return false;
  const kept = meso.shifts.filter((s) => s.date >= startIso);
  if (kept.length === meso.shifts.length) return false;
  if (kept.length) meso.shifts = kept;
  else delete meso.shifts;
  return true;
}

// Brings every number a mesocycle is built from into the range the forms
// allow. Data saved by older versions (which did not clamp) and imported
// backups both go through this, so the rest of the app can rely on it.
// Changes the list in place; returns whether anything changed.
export function normalizeMesocycles(list) {
  let changed = false;
  const set = (obj, key, value) => {
    if (obj[key] !== value) { obj[key] = value; changed = true; }
  };
  for (const meso of list) {
    set(meso, "numWeeks", cleanCount(meso.numWeeks));
    // A start date Date cannot hold (a date input takes years up to 275760)
    // blanks every screen that shows it, with no way back in the app, and
    // one that is not a real padded date fails the backup check. One that
    // only lacks zero padding ("2026-9-1") is the same day written padded;
    // anything else becomes today.
    if (!isIsoDate(meso.startDate)) {
      const m = typeof meso.startDate === "string" && /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(meso.startDate);
      const padded = m && `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      set(meso, "startDate", isIsoDate(padded) ? padded : isoDate(new Date()));
      if (dropShiftsBefore(meso, meso.startDate)) changed = true;
    }
    for (const day of meso.days || []) {
      for (const slot of day.exercises || []) {
        set(slot, "targetSets", cleanCount(slot.targetSets));
        set(slot, "repRangeMin", cleanCount(slot.repRangeMin));
        set(slot, "repRangeMax", Math.max(slot.repRangeMin, cleanCount(slot.repRangeMax)));
        if (slot.weightIncrementPct != null) set(slot, "weightIncrementPct", cleanPct(slot.weightIncrementPct));
        if (cleanProgression(slot)) changed = true;
      }
    }
  }
  // One active mesocycle (getActiveMesocycle takes the first, Settings
  // showed another): a hand-edited file may mark several, and must restore.
  let active = false;
  for (const meso of list) {
    if (meso.active && active) set(meso, "active", false);
    else if (meso.active) active = true;
  }
  return changed;
}

// A slot or its updates with `progression` left out unless it is a preset.
function withoutBadProgression(obj) {
  if (!("progression" in obj) || PROGRESSIONS.includes(obj.progression)) return obj;
  const { progression, ...rest } = obj;
  return rest;
}

export const Store = {
  // Set by a failed write; main.js points onWriteError at the notice.
  writeFailed: false,
  onWriteError: null,

  // Run once at startup: see normalizeMesocycles. Writes only on a change.
  normalize() {
    const list = Store.getMesocycles();
    if (normalizeMesocycles(list)) Store.saveMesocycles(list);
    const exercises = Store.getExercises();
    if (cleanLibrary(exercises)) writeJSON(KEYS.exercises, exercises);
    const workouts = Store.getWorkouts();
    if (cleanEntries(workouts)) Store.saveWorkouts(workouts);
  },

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
  // Edits a library entry. Returns it, or null when the id is unknown, the
  // name is empty or another exercise has it. A rename is carried into every
  // logged workout of this exercise (by id, or by the old name for entries
  // without one), so history keeps showing one name. A name that workout
  // entries of another exerciseId carry (a deleted exercise's history) is
  // refused too: those entries would merge into this exercise by name.
  updateExercise(id, { name, muscleGroup, note, minIncrement } = {}) {
    const exercises = Store.getExercises();
    const before = Store.getExercises(); // a separate copy, to put back
    const ex = exercises.find((e) => e.id === id);
    if (!ex) return null;
    const oldName = ex.name;
    if (name !== undefined) {
      const clean = String(name).trim();
      if (!clean) return null;
      const lower = clean.toLowerCase();
      if (exercises.some((e) => e.id !== id && e.name.toLowerCase() === lower)) return null;
      const taken = Store.getWorkouts().some((w) => w.exercises.some((entry) => entry.exerciseId !== id
        && typeof entry.exerciseName === "string" && entry.exerciseName.toLowerCase() === lower
        && entry.exerciseName.toLowerCase() !== oldName.toLowerCase()));
      if (taken) return null;
      ex.name = clean;
    }
    if (muscleGroup !== undefined) ex.muscleGroup = muscleGroup || "Other";
    if (minIncrement !== undefined) {
      const clean = cleanMinIncrement(minIncrement);
      if (clean == null) delete ex.minIncrement;
      else ex.minIncrement = clean;
    }
    if (note !== undefined) {
      // At most 200, the limit validateBackup holds a backup to.
      const clean = String(note ?? "").trim().slice(0, 200);
      if (clean) ex.note = clean;
      else delete ex.note;
    }
    writeJSON(KEYS.exercises, exercises);
    if (ex.name !== oldName) {
      const workouts = Store.getWorkouts();
      let renamed = false;
      for (const w of workouts) {
        for (const entry of w.exercises) {
          if (entry.exerciseId === id || (typeof entry.exerciseName === "string" && entry.exerciseName.toLowerCase() === oldName.toLowerCase())) {
            entry.exerciseName = ex.name;
            renamed = true;
          }
        }
      }
      // Storage full: a renamed library over unrenamed history would cut the
      // history off (and refuse the rename back), so the library goes back.
      if (renamed && !writeJSON(KEYS.workouts, workouts)) {
        writeJSON(KEYS.exercises, before);
        return null;
      }
    }
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
      startDate: isIsoDate(startDate) ? startDate : isoDate(new Date()),
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
    // An unusable start date is ignored, like an empty one (see isIsoDate).
    // A new start keeps the shifts on or after it; earlier ones go.
    const { startDate, ...rest } = updates;
    Object.assign(meso, rest);
    if (isIsoDate(startDate) && startDate !== meso.startDate) {
      meso.startDate = startDate;
      dropShiftsBefore(meso, startDate);
    }
    Store.saveMesocycles(list);
    return meso;
  },
  // A new, inactive mesocycle with the same days and exercises (all new ids)
  // and no workouts — a starting point to adjust instead of rebuilding.
  // Days are pinned to offsets from the start weekday, so the copy starts
  // where the source's schedule would have gone on (its end, shifts
  // included), moved on by whole weeks until it is not before today: every
  // training day stays on the weekday it has now.
  cloneMesocycle(mesoId, todayIso) {
    const list = Store.getMesocycles();
    const source = list.find((m) => m.id === mesoId);
    if (!source) return null;
    const start = parseLocalDate(source.startDate);
    start.setDate(start.getDate() + source.numWeeks * 7 + totalShiftDays(source));
    while (isoDate(start) < todayIso) start.setDate(start.getDate() + 7);
    const copy = {
      ...structuredClone(source),
      id: uid(),
      name: `${source.name} (copy)`,
      startDate: isoDate(start),
      active: false,
    };
    delete copy.shifts;
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
  // Inserts a shift (see schedulePosition in schedule.js), kept sorted.
  addShift(mesoId, dateIso, days) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso) return null;
    meso.shifts = [...(meso.shifts || []), { date: dateIso, days }].sort((a, b) => (a.date < b.date ? -1 : 1));
    Store.saveMesocycles(list);
    return meso;
  },
  removeShift(mesoId, dateIso) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    if (!meso || !meso.shifts) return;
    meso.shifts = meso.shifts.filter((s) => s.date !== dateIso);
    // No empty list left behind: the mesocycle reads exactly as before.
    if (meso.shifts.length === 0) delete meso.shifts;
    Store.saveMesocycles(list);
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
      ...withoutBadProgression(slot),
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
    // Renumbered in the order shown, not the order they were added.
    [...day.exercises].sort((a, b) => a.order - b.order).forEach((e, i) => (e.order = i));
    Store.saveMesocycles(list);
  },
  updateExerciseSlot(mesoId, dayId, slotId, updates) {
    const list = Store.getMesocycles();
    const meso = list.find((m) => m.id === mesoId);
    const day = meso && meso.days.find((d) => d.id === dayId);
    const slot = day && day.exercises.find((e) => e.id === slotId);
    if (!slot) return null;
    Object.assign(slot, withoutBadProgression(updates));
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
  // being replaced is kept under fah_before_import (when there is room), so
  // a wrong file can be undone by hand. All or nothing: if storage runs out
  // part-way, what was there is put back and false is returned, so the app
  // never runs on a mix of two data sets.
  importBackup(data) {
    const before = Store.exportBackup();
    // An older import's copy goes first: no copy beats a misleading one.
    localStorage.removeItem("fah_before_import");
    try { localStorage.setItem("fah_before_import", JSON.stringify(before)); } catch (e) { /* no room for the copy */ }
    // The same clean-up as Store.normalize, on the file before anything is written.
    normalizeMesocycles(data.mesocycles);
    cleanLibrary(data.exercises);
    cleanEntries(data.workouts);
    const keys = ["exercises", "mesocycles", "workouts"];
    try {
      for (const k of keys) localStorage.setItem(KEYS[k], JSON.stringify(data[k]));
      return true;
    } catch (e) {
      console.error("Import failed", e);
      try {
        // The copy is the same data that is being put back: free its space.
        localStorage.removeItem("fah_before_import");
        // Cleared first: the old values fit together before the import, but
        // not always next to part of the new data.
        for (const k of keys) localStorage.removeItem(KEYS[k]);
        for (const k of keys) localStorage.setItem(KEYS[k], JSON.stringify(before[k]));
      } catch (e2) { console.error("Restore after a failed import failed", e2); }
      return false;
    }
  },
};

const BACKUP_APP = "fa-hypertrophy";

// A backup file is outside input: ids, dates and numbers from it end up in
// HTML attributes and text without escaping (they are app-generated
// everywhere else). So the whole file is rejected unless every one of them
// has the shape the app itself writes. Returns an error message, or null.
// Numbers only have to be numbers: one out of range is not rejected (data
// from older versions can hold such values and must still restore) but
// clamped by normalizeMesocycles when the backup is imported.
export function validateBackup(data) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  // Names are escaped wherever they are shown, and the forms never limited
  // their length, so any length the app could have saved must restore.
  const str = (v) => typeof v === "string";
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const optNum = (v) => v == null || num(v);
  const optBool = (v) => v == null || typeof v === "boolean";
  const optOffset = (v) => v == null || (Number.isInteger(v) && v >= 0 && v <= 6);
  const date = isIsoDate;
  const all = (list, test) => Array.isArray(list) && list.every((item) => isObj(item) && test(item));

  if (!isObj(data) || data.app !== BACKUP_APP) return "This is not an FA Hypertrophy backup file.";
  if (data.version !== 1) return "This backup was made by a newer version of the app.";

  // Shifts: real dates not before the start, whole days 1-366, sorted and
  // not overlapping.
  const shiftsOk = (list, start) => list == null || (Array.isArray(list) && list.every((sh, i) =>
    isObj(sh) && date(sh.date) && sh.date >= start && Number.isInteger(sh.days) && sh.days >= 1 && sh.days <= 366
    && (i === 0 || isoDate(addDays(parseLocalDate(list[i - 1].date), list[i - 1].days)) <= sh.date)));
  // A preset is rendered into an attribute: absent or exactly one of them.
  const optProgression = (v) => v === undefined || PROGRESSIONS.includes(v);
  const exercisesOk = all(data.exercises, (e) => id(e.id) && str(e.name) && (e.muscleGroup == null || str(e.muscleGroup)) && optNum(e.minIncrement)
    && (e.note == null || (str(e.note) && e.note.length <= 200)));
  const mesocyclesOk = all(data.mesocycles, (m) =>
    id(m.id) && str(m.name) && num(m.numWeeks) && date(m.startDate) && typeof m.active === "boolean" && shiftsOk(m.shifts, m.startDate)
    && all(m.days, (d) => id(d.id) && str(d.name) && optOffset(d.weekdayOffset) && optNum(d.order)
      && all(d.exercises, (slot) => id(slot.id) && id(slot.exerciseId) && num(slot.order) && num(slot.targetSets)
        && num(slot.repRangeMin) && num(slot.repRangeMax) && optNum(slot.weightIncrementPct) && optProgression(slot.progression))));
  const workoutsOk = all(data.workouts, (w) =>
    id(w.id) && id(w.mesocycleId) && id(w.dayId) && date(w.date) && str(w.dayName) && typeof w.finished === "boolean"
    && (w.finishedAt == null || str(w.finishedAt)) && optBool(w.makeup) && (w.makeupFor == null ? !w.makeup : date(w.makeupFor))
    && (w.skippedSlotIds == null || (Array.isArray(w.skippedSlotIds) && w.skippedSlotIds.every(id)))
    && all(w.exercises, (ex) => id(ex.slotId) && (ex.exerciseId == null || id(ex.exerciseId)) && str(ex.exerciseName)
      && num(ex.order) && num(ex.repRangeMin) && num(ex.repRangeMax) && optNum(ex.weightIncrementPct) && optBool(ex.oneOff) && optBool(ex.swapped) && optProgression(ex.progression)
      && all(ex.sets, (set) => optNum(set.weight) && optNum(set.reps) && optNum(set.baseWeight) && optNum(set.baseReps)
        && optNum(set.setIndex) && optBool(set.isLogged) && optBool(set.done) && optBool(set.prefilled) && optBool(set.repsManual))));
  // Ids are storage keys: a duplicate sends writes to the wrong item (a
  // finished workout overwritten from today's screen).
  const unique = (ids) => new Set(ids).size === ids.length;
  const idsOk = () => unique(data.exercises.map((e) => e.id)) && unique(data.mesocycles.map((m) => m.id)) && unique(data.workouts.map((w) => w.id))
    && data.mesocycles.every((m) => unique(m.days.map((d) => d.id)) && unique(m.days.flatMap((d) => d.exercises.map((s) => s.id))));
  if (!exercisesOk || !mesocyclesOk || !workoutsOk || !idsOk()) return "This backup file is damaged or was edited. Nothing was imported.";
  return null;
}
