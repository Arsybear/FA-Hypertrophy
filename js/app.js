// updateAvailable lives outside App.ui (which resets on every hashchange)
// since it needs to persist across navigation until the user reloads.
const App = { ui: {}, updateAvailable: false };

const MUSCLE_GROUPS = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Quads", "Hamstrings", "Glutes", "Calves", "Abs", "Other",
];

// "Other" (and anything unrecognized) has no dedicated hue — the CSS
// default (--muted) applies when this returns "".
function muscleGroupClass(name) {
  return MUSCLE_GROUPS.includes(name) && name !== "Other" ? `mg-${name.toLowerCase()}` : "";
}

function renderMuscleTag(name) {
  return `<span class="muscle-tag ${muscleGroupClass(name)}">${escapeHtml(name)}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Sets / reps / weeks typed into a form: a whole number from 1 to 99 (an
// absurd set count would build that many set rows and overflow storage).
function cleanCount(v) {
  return Math.min(99, Math.max(1, Math.floor(Number(v)) || 1));
}

function fmtNum(n) {
  return n == null ? "" : n;
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function getExerciseMuscleGroup(exerciseId) {
  const exercise = Store.getExercises().find((e) => e.id === exerciseId);
  return (exercise && exercise.muscleGroup) || "Other";
}

function renderExerciseOptionsGrouped(excludeId, onlyGroup) {
  let library = Store.getExercises().filter((e) => e.id !== excludeId);
  if (onlyGroup) library = library.filter((e) => (e.muscleGroup || "Other") === onlyGroup);
  const byGroup = {};
  for (const ex of library) {
    const group = ex.muscleGroup || "Other";
    (byGroup[group] = byGroup[group] || []).push(ex);
  }
  return Object.keys(byGroup).sort().map((group) => `
    <optgroup label="${escapeHtml(group)}">
      ${byGroup[group].map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")}
    </optgroup>`).join("");
}

function renderMuscleGroupSelect(dataRole, dataAttrs = "", lockedValue = null) {
  return `<select data-role="${dataRole}" ${dataAttrs} ${lockedValue ? 'disabled data-locked="true"' : ""}>
    ${MUSCLE_GROUPS.map((g) => `<option value="${g}" ${g === lockedValue ? "selected" : ""}>${g}</option>`).join("")}
  </select>`;
}

function currentRoute() {
  return (location.hash.replace(/^#\/?/, "") || "today").split("?")[0];
}

function renderCurrentView() {
  const route = currentRoute();
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  const view = document.getElementById("view");
  document.getElementById("overlay-root").innerHTML = "";
  if (route === "today") renderToday(view);
  else if (route === "program") renderProgram(view);
  else if (route === "history") renderHistory(view);
  else if (route === "settings") renderSettings(view);
  else renderToday(view);
}

function emptyMesoState() {
  return `<div class="empty-state"><p>No active mesocycle yet.</p>
    <a href="#/settings" class="btn">Create one in Settings</a></div>`;
}

/* ---------------- TODAY ---------------- */

function generateWorkout(meso, dayTemplate, dateIso) {
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
function reconcileWorkoutWithTemplate(workout, dayTemplate) {
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
function migrateLegacyPrefill(workout) {
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
function currentDateParam() {
  const q = location.hash.split("?")[1];
  const d = q ? new URLSearchParams(q).get("date") : null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && isoDate(parseLocalDate(d)) === d ? d : null;
}

function isTouchedSet(s) {
  return !!s.isLogged || !!s.done || s.weight != null || s.reps != null;
}

function getTodayContext() {
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
function getExerciseHistory(slotId, exerciseId, exerciseName) {
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

function renderDateNav(meso, dateIso, isToday) {
  const date = parseLocalDate(dateIso);
  const prevIso = isoDate(addDays(date, -1));
  const nextIso = isoDate(addDays(date, 1));
  const canGoPrev = dateIso > meso.startDate;
  return `<div class="date-nav">
    ${canGoPrev
      ? `<a class="btn small" href="#/today?date=${prevIso}">‹ Prev</a>`
      : `<span class="btn small" aria-disabled="true">‹ Prev</span>`}
    <span class="muted">${WEEKDAY_LABELS[jsDateToWeekdayIndex(date)]} · ${dateIso}</span>
    <button class="btn small" data-action="toggle-calendar" aria-label="Show training block calendar">📅</button>
    ${!isToday ? `<a class="btn small" href="#/today?date=${nextIso}">Next ›</a>
    <a class="btn small" href="#/today">Today</a>` : ""}
  </div>
  ${App.ui.calendarOpen ? renderCalendarPanel(meso, dateIso) : ""}`;
}

// Read-only month view of the mesocycle — never generates or mutates workout
// instances, just reads existing fah_workouts for status. Pages from the
// start month to the last month that has anything in it: the program keeps
// scheduling past numWeeks, so the end is the latest of the planned end,
// today, the viewed date and the last workout.
function renderCalendarPanel(meso, selectedIso) {
  const todayIso = isoDate(new Date());
  const workoutsByDate = {};
  Store.getWorkouts()
    .filter((w) => w.mesocycleId === meso.id)
    .forEach((w) => { workoutsByDate[w.date] = w; });

  let lastIso = isoDate(addDays(parseLocalDate(meso.startDate), meso.numWeeks * 7 - 1));
  for (const iso of [todayIso, selectedIso, ...Object.keys(workoutsByDate)]) {
    if (iso > lastIso) lastIso = iso;
  }
  const firstMonth = meso.startDate.slice(0, 7);
  const lastMonth = lastIso.slice(0, 7);
  let month = App.ui.calendarMonth || selectedIso.slice(0, 7);
  if (month < firstMonth) month = firstMonth;
  if (month > lastMonth) month = lastMonth;

  const [year, monthNum] = month.split("-").map(Number);
  const first = new Date(year, monthNum - 1, 1);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const cells = Array.from({ length: jsDateToWeekdayIndex(first) }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, monthNum - 1, d);
    const dateIso = isoDate(date);
    const inBlock = dateIso >= meso.startDate;
    cells.push({ dateIso, date, inBlock, dayTemplate: inBlock ? resolveDayForDate(meso, date) : null, workout: workoutsByDate[dateIso] });
  }
  const monthNavBtn = (label, target, name) => {
    const iso = isoDate(target).slice(0, 7);
    const off = iso < firstMonth || iso > lastMonth;
    return `<button class="btn small" data-action="calendar-month" data-month="${iso}" aria-label="${name} month" ${off ? "disabled" : ""}>${label}</button>`;
  };

  return `<div class="calendar-panel">
    <div class="calendar-month-nav">
      ${monthNavBtn("‹", new Date(year, monthNum - 2, 1), "Previous")}
      <strong>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
      ${monthNavBtn("›", new Date(year, monthNum, 1), "Next")}
    </div>
    <div class="calendar-weekdays">${WEEKDAY_LABELS.map((w) => `<span>${w.slice(0, 2)}</span>`).join("")}</div>
    <div class="calendar-grid">
      ${cells.map((c) => renderCalendarCell(c, todayIso, selectedIso)).join("")}
    </div>
    <div class="calendar-legend muted">
      <span><span class="cal-dot finished"></span> Finished</span>
      <span><span class="cal-dot started"></span> In progress</span>
      <span><span class="cal-dot"></span> Training day</span>
    </div>
  </div>`;
}

function renderCalendarCell(c, todayIso, selectedIso) {
  if (!c) return `<span class="cal-cell empty"></span>`;
  const { dateIso, date, dayTemplate, workout } = c;
  if (!c.inBlock) return `<span class="cal-cell rest outside"><span class="cal-daynum">${date.getDate()}</span></span>`;
  const isRest = !dayTemplate && !workout;
  const finished = workout && workout.finished;
  const classes = [
    "cal-cell",
    isRest ? "rest" : "train",
    dateIso === todayIso ? "today" : "",
    dateIso === selectedIso ? "selected" : "",
    finished ? "finished" : (workout ? "started" : ""),
  ].filter(Boolean).join(" ");
  return `<a class="${classes}" href="#/today?date=${dateIso}" title="${escapeHtml(workout ? workout.dayName : dayTemplate ? dayTemplate.name : "Rest day")} — ${dateIso}">
    <span class="cal-daynum">${date.getDate()}</span>
    ${!isRest ? `<span class="cal-dot"></span>` : ""}
  </a>`;
}

function renderToday(container) {
  const { meso, dayTemplate, workout, dateIso, isToday } = getTodayContext();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }

  if (!dayTemplate && !workout) {
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday)}
      <div class="card">
        <h2>Rest day</h2>
        <p class="muted">nothing scheduled.</p>
      </div>`;
    return;
  }

  if (!workout) {
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday)}
      <div class="card"><p class="muted">Not reached yet.</p></div>`;
    return;
  }

  const sortedExercises = [...workout.exercises].sort((a, b) => a.order - b.order);
  const historyEx = App.ui.historyOpen ? workout.exercises.find((e) => e.slotId === App.ui.historyOpen) : null;

  const exerciseGroups = sortedExercises.map((ex) => getExerciseMuscleGroup(ex.exerciseId));
  const exerciseBlocksHtml = sortedExercises.map((ex, i) => {
    const isGroupStart = i === 0 || exerciseGroups[i] !== exerciseGroups[i - 1];
    const isGroupEnd = i === exerciseGroups.length - 1 || exerciseGroups[i] !== exerciseGroups[i + 1];
    return renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd);
  }).join("");

  container.innerHTML = `
    ${renderDateNav(meso, dateIso, isToday)}
    <div class="workout-header">
      <h2>${escapeHtml(workout.dayName)}</h2>
      <p class="muted">${workout.finished ? "Finished" : ""}</p>
    </div>
    ${exerciseBlocksHtml}
    ${!workout.finished ? `<div class="add-exercise-area">
      ${App.ui.addOpen ? renderAddExerciseForm() : `<button class="btn" data-action="open-add-exercise">+ Add Exercise</button>`}
    </div>` : ""}
    <div class="finish-area">
      ${workout.finished
        ? `<button class="btn secondary" data-action="reopen-workout">Reopen Workout</button>`
        : `<button class="btn primary" data-action="finish-workout">Finish Workout</button>`}
    </div>
  `;
  document.getElementById("overlay-root").innerHTML = historyEx ? renderHistorySheet(historyEx) : "";
}

function renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd) {
  const removeOpen = App.ui.removeOpen === ex.slotId;
  const subOpen = App.ui.substituteOpen === ex.slotId;
  const complete = ex.sets.length > 0 && ex.sets.every((s) => isSetDone(workout, s));
  const cardClass = [
    !isGroupStart ? "merge-top" : "", !isGroupEnd ? "merge-bottom" : "", complete ? "complete" : "",
  ].filter(Boolean).join(" ");
  return `
    <div class="card exercise ${cardClass}" data-slot="${ex.slotId}">
      <div class="exercise-header">
        <div class="reorder-btns">
          <button data-action="move-up" data-slot="${ex.slotId}" ${workout.finished ? "disabled" : ""}>▲</button>
          <button data-action="move-down" data-slot="${ex.slotId}" ${workout.finished ? "disabled" : ""}>▼</button>
        </div>
        <div class="ex-name-group">
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId))}
          <strong class="ex-name">${escapeHtml(ex.exerciseName)}${complete ? `<span class="ex-done-mark" aria-label="completed">✓</span>` : ""}</strong>
        </div>
        <span class="rep-range muted">${ex.repRangeMin}-${ex.repRangeMax} reps</span>
      </div>
      <div class="exercise-actions">
        <button data-action="open-history" data-slot="${ex.slotId}">History</button>
        ${!workout.finished ? `
          <button data-action="open-substitute" data-slot="${ex.slotId}">Swap</button>
          <button data-action="open-remove" data-slot="${ex.slotId}">Remove</button>
        ` : ""}
      </div>
      ${removeOpen ? renderRemoveForm(ex) : ""}
      ${subOpen ? renderSubstituteForm(ex) : ""}
      <table class="sets">
        <thead><tr><th>Set</th><th>Weight</th><th>Reps</th><th class="set-done-col" aria-label="Done"></th></tr></thead>
        <tbody>
          ${ex.sets.map((s, i) => {
            const done = isSetDone(workout, s);
            const locked = workout.finished || done ? "disabled" : "";
            return `
            <tr>
              <td>${i + 1}</td>
              <td><input type="number" step="0.5" inputmode="decimal" placeholder="${setWeightHint(s)}"
                data-field="weight" data-slot="${ex.slotId}" data-set="${i}"
                value="${fmtNum(s.weight)}" ${locked}></td>
              <td><input type="number" inputmode="numeric" placeholder="${setRepsHint(ex, s)}"
                data-field="reps" data-slot="${ex.slotId}" data-set="${i}"
                value="${fmtNum(s.reps)}" ${locked}></td>
              <td class="set-done-col"><input type="checkbox" data-role="set-done"
                data-slot="${ex.slotId}" data-set="${i}" aria-label="Set ${i + 1} done"
                ${done ? "checked" : ""} ${workout.finished ? "disabled" : ""}></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistorySheet(ex) {
  const rows = getExerciseHistory(ex.slotId, ex.exerciseId, ex.exerciseName);
  return `<div class="history-sheet-backdrop" data-action="close-history">
    <div class="history-sheet" data-action="">
      <div class="history-sheet-header">
        <strong>${escapeHtml(ex.exerciseName)}</strong>
        <button data-action="close-history">✕</button>
      </div>
      ${rows.length === 0
        ? `<p class="muted">No history yet.</p>`
        : rows.map((r) => `<div class="history-row">
            <span class="muted">${r.date} · ${escapeHtml(r.dayName)}</span>
            ${r.sets.map((s) => isCompleteSet(s) ? `${s.weight}×${s.reps}` : "—").join(", ")}
          </div>`).join("")}
    </div>
  </div>`;
}

function renderRemoveForm(ex) {
  return `<div class="inline-form" data-slot="${ex.slotId}">
    <p>Remove ${escapeHtml(ex.exerciseName)}?</p>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button data-action="confirm-remove" data-slot="${ex.slotId}">Remove</button>
      <button data-action="cancel-remove" data-slot="${ex.slotId}">Cancel</button>
    </div>
  </div>`;
}

function renderSubstituteForm(ex) {
  const currentGroup = getExerciseMuscleGroup(ex.exerciseId);
  return `<div class="inline-form" data-slot="${ex.slotId}">
    <p>Swap ${escapeHtml(ex.exerciseName)} for another ${escapeHtml(currentGroup)} exercise:</p>
    <select data-role="sub-exercise-select" data-slot="${ex.slotId}">
      <option value="">-- choose existing --</option>
      ${renderExerciseOptionsGrouped(ex.exerciseId, currentGroup)}
    </select>
    <input type="text" data-role="sub-new-name" data-slot="${ex.slotId}" placeholder="or create new exercise">
    ${renderMuscleGroupSelect("sub-new-group", `data-slot="${ex.slotId}"`, currentGroup)}
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button data-action="confirm-substitute" data-slot="${ex.slotId}">Swap</button>
      <button data-action="cancel-substitute" data-slot="${ex.slotId}">Cancel</button>
    </div>
  </div>`;
}

function renderAddExerciseForm() {
  return `<div class="inline-form">
    <p>Add exercise:</p>
    <select data-role="add-exercise-select">
      <option value="">-- choose existing --</option>
      ${renderExerciseOptionsGrouped(null)}
    </select>
    <input type="text" data-role="add-new-name" placeholder="or create new exercise">
    ${renderMuscleGroupSelect("add-new-group")}
    <div class="form-row">
      <label>Sets <input type="number" data-role="add-sets" value="2" min="1"></label>
      <label>Rep min <input type="number" data-role="add-rep-min" value="5" min="1"></label>
      <label>Rep max <input type="number" data-role="add-rep-max" value="10" min="1"></label>
      <label>+% <input type="number" step="0.5" data-role="add-increment" value="${DEFAULT_INCREMENT_PCT}"></label>
    </div>
    <label><input type="radio" name="add-scope" value="workout" checked> This workout only</label>
    <label><input type="radio" name="add-scope" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button data-action="confirm-add-exercise">Add</button>
      <button data-action="cancel-add-exercise">Cancel</button>
    </div>
  </div>`;
}

function handleTodayAction(action, btn, view) {
  const { meso, workout } = getTodayContext();
  if (!meso) return;
  if (action === "toggle-calendar") {
    App.ui.calendarOpen = !App.ui.calendarOpen;
    App.ui.calendarMonth = null;
    App.ui.removeOpen = null; App.ui.substituteOpen = null; App.ui.addOpen = false; App.ui.historyOpen = null;
    renderCurrentView();
    return;
  }
  if (action === "calendar-month") {
    App.ui.calendarMonth = btn.dataset.month;
    renderCurrentView();
    return;
  }
  if (action === "close-history") {
    App.ui.historyOpen = null;
    renderCurrentView();
    return;
  }
  if (!workout) return;
  const slotId = btn.dataset.slot;

  if (action === "move-up" || action === "move-down") {
    const dir = action === "move-up" ? -1 : 1;
    const sorted = [...workout.exercises].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((x) => x.slotId === slotId);
    const swapIdx = idx + dir;
    if (idx >= 0 && swapIdx >= 0 && swapIdx < sorted.length) {
      // Swap the same two slots in the template — unless either is a
      // "this workout only" addition, which the template doesn't have.
      if (!sorted[idx].oneOff && !sorted[swapIdx].oneOff) {
        Store.swapExerciseSlotOrder(meso.id, workout.dayId, sorted[idx].slotId, sorted[swapIdx].slotId);
      }
      [sorted[idx].order, sorted[swapIdx].order] = [sorted[swapIdx].order, sorted[idx].order];
      Store.updateWorkout(workout.id, { exercises: workout.exercises });
    }
  } else if (action === "open-history") {
    App.ui.historyOpen = slotId; App.ui.removeOpen = null; App.ui.substituteOpen = null; App.ui.addOpen = false; App.ui.calendarOpen = false;
  } else if (action === "open-remove") {
    App.ui.removeOpen = slotId; App.ui.substituteOpen = null; App.ui.addOpen = false; App.ui.calendarOpen = false; App.ui.historyOpen = null;
  } else if (action === "cancel-remove") {
    App.ui.removeOpen = null;
  } else if (action === "confirm-remove") {
    const scope = view.querySelector(`input[name="remove-scope-${cssEscape(slotId)}"]:checked`).value;
    if (scope === "future") {
      Store.removeExerciseSlot(meso.id, workout.dayId, slotId);
    } else {
      // Remember it, so reconciliation doesn't re-add it from the template.
      workout.skippedSlotIds = [...(workout.skippedSlotIds || []), slotId];
    }
    workout.exercises = workout.exercises.filter((x) => x.slotId !== slotId);
    Store.updateWorkout(workout.id, { exercises: workout.exercises, skippedSlotIds: workout.skippedSlotIds });
    App.ui.removeOpen = null;
  } else if (action === "open-substitute") {
    App.ui.substituteOpen = slotId; App.ui.removeOpen = null; App.ui.addOpen = false; App.ui.calendarOpen = false; App.ui.historyOpen = null;
  } else if (action === "cancel-substitute") {
    App.ui.substituteOpen = null;
  } else if (action === "confirm-substitute") {
    const select = view.querySelector(`select[data-role="sub-exercise-select"][data-slot="${cssEscape(slotId)}"]`);
    const newName = view.querySelector(`input[data-role="sub-new-name"][data-slot="${cssEscape(slotId)}"]`).value.trim();
    const newGroup = view.querySelector(`select[data-role="sub-new-group"][data-slot="${cssEscape(slotId)}"]`).value;
    const scope = view.querySelector(`input[name="sub-scope-${cssEscape(slotId)}"]:checked`).value;
    const exercise = newName ? Store.addExercise(newName, newGroup) : Store.getExercises().find((x) => x.id === select.value);
    if (exercise) {
      const ex = workout.exercises.find((x) => x.slotId === slotId);
      ex.exerciseId = exercise.id;
      ex.exerciseName = exercise.name;
      // Sets belong to the exercise: anything already entered was the old
      // exercise's and would be saved as the new one's history, so the sets
      // start over with the new exercise's own predictions.
      const fresh = buildPrefilledSets(
        { id: slotId, exerciseId: exercise.id, targetSets: ex.sets.length, repRangeMin: ex.repRangeMin, repRangeMax: ex.repRangeMax, weightIncrementPct: ex.weightIncrementPct },
        Store.getWorkouts(), workout.dayId, workout.date, exercise.name
      );
      ex.sets.forEach((s, i) => {
        Object.assign(s, blankSet(i), { baseWeight: fresh[i].baseWeight, baseReps: fresh[i].baseReps });
      });
      if (scope === "future") Store.updateExerciseSlot(meso.id, workout.dayId, slotId, { exerciseId: exercise.id });
      Store.updateWorkout(workout.id, { exercises: workout.exercises });
    }
    App.ui.substituteOpen = null;
  } else if (action === "open-add-exercise") {
    App.ui.addOpen = true; App.ui.removeOpen = null; App.ui.substituteOpen = null; App.ui.calendarOpen = false; App.ui.historyOpen = null;
  } else if (action === "cancel-add-exercise") {
    App.ui.addOpen = false;
  } else if (action === "confirm-add-exercise") {
    const select = view.querySelector('select[data-role="add-exercise-select"]');
    const newName = view.querySelector('input[data-role="add-new-name"]').value.trim();
    const newGroup = view.querySelector('select[data-role="add-new-group"]').value;
    const targetSets = cleanCount(view.querySelector('input[data-role="add-sets"]').value);
    const repRangeMin = cleanCount(view.querySelector('input[data-role="add-rep-min"]').value);
    const repRangeMax = Math.max(repRangeMin, cleanCount(view.querySelector('input[data-role="add-rep-max"]').value));
    const weightIncrementPct = Math.max(0, Number(view.querySelector('input[data-role="add-increment"]').value) || 0);
    const scope = view.querySelector('input[name="add-scope"]:checked').value;
    const exercise = newName ? Store.addExercise(newName, newGroup) : Store.getExercises().find((x) => x.id === select.value);
    if (exercise) {
      // slot is null when the workout's day is no longer in the program
      // (see getTodayContext) — the add then stays on this workout only.
      const slot = scope === "future"
        ? Store.addExerciseSlot(meso.id, workout.dayId, { exerciseId: exercise.id, targetSets, repRangeMin, repRangeMax, weightIncrementPct })
        : null;
      const newSlotId = slot ? slot.id : uid();
      workout.exercises.push({
        slotId: newSlotId, exerciseId: exercise.id, exerciseName: exercise.name,
        order: workout.exercises.length, repRangeMin, repRangeMax, weightIncrementPct,
        sets: Array.from({ length: targetSets }, (_, i) => blankSet(i)),
        // Not in the template — tells reconciliation to keep it anyway.
        ...(slot ? {} : { oneOff: true }),
      });
      Store.updateWorkout(workout.id, { exercises: workout.exercises });
    }
    App.ui.addOpen = false;
  } else if (action === "finish-workout") {
    Store.finishWorkout(workout.id);
  } else if (action === "reopen-workout") {
    // A finished workout shows every complete set as done (isSetDone), even
    // ones never ticked (e.g. finished before the checkbox existed) — persist
    // that on reopen so the sets don't suddenly read as unticked/unlocked.
    workout.exercises.forEach((ex) => ex.sets.forEach((s) => {
      if (isCompleteSet(s)) s.done = true;
    }));
    Store.updateWorkout(workout.id, { finished: false, finishedAt: null, exercises: workout.exercises });
  }
  renderCurrentView();
}

// Placeholder text for a set's inputs: the double-progression prediction
// (baseWeight/baseReps, see buildPrefilledSets) when there is one, else the
// generic "wt"/"reps" hint. Predictions are never written into the inputs'
// values — only what the user typed is — so a glance at the table shows
// which sets are actually done. Once a weight is in (typed or carried), the
// reps hint becomes the estimated rep target at that weight, clamped to the
// exercise's rep range, same as nextSet.
function setWeightHint(s) {
  return s.baseWeight ?? "wt";
}

function setRepsHint(ex, s) {
  if (s.weight != null) {
    const estimate = equivalentReps(s.baseWeight, s.baseReps, s.weight);
    if (estimate != null) return Math.min(Math.max(estimate, ex.repRangeMin), ex.repRangeMax);
  }
  return s.baseReps ?? "reps";
}

// Workouts finished before the done checkbox existed have no `done` flags,
// so on a finished workout any complete set reads as done.
function isSetDone(workout, s) {
  return !!s.done || (workout.finished && isCompleteSet(s));
}

// Ticking a set's checkbox marks it done and locks its inputs. Any box still
// empty accepts its placeholder hint (so a set done exactly as predicted is
// one tap); if a box has no numeric hint either, the tick doesn't stick and
// focus goes to that box. Unlike handleTodayChange this does re-render —
// the no-re-render rule protects focus while typing, and a checkbox tap
// isn't typing — so locks and the card's completed state update in one place.
function handleSetDoneChange(target) {
  const { workout } = getTodayContext();
  if (!workout) return;
  const slotId = target.dataset.slot;
  const setIndex = Number(target.dataset.set);
  const ex = workout.exercises.find((e) => e.slotId === slotId);
  if (!ex) return;
  const set = ex.sets[setIndex];
  if (target.checked) {
    if (set.weight == null && set.baseWeight != null) set.weight = set.baseWeight;
    if (set.reps == null) {
      const hint = setRepsHint(ex, set);
      if (typeof hint === "number") set.reps = hint;
    }
    set.isLogged = set.weight != null || set.reps != null;
    if (!isCompleteSet(set)) {
      target.checked = false;
      const emptyField = set.weight == null ? "weight" : "reps";
      Store.updateWorkout(workout.id, { exercises: workout.exercises });
      renderCurrentView();
      const input = document.querySelector(
        `input[data-field="${emptyField}"][data-slot="${cssEscape(slotId)}"][data-set="${setIndex}"]`
      );
      if (input) input.focus();
      return;
    }
    set.done = true;
    set.isLogged = true;
  } else {
    set.done = false;
  }
  Store.updateWorkout(workout.id, { exercises: workout.exercises });
  renderCurrentView();
}

// Patches a set's live reps placeholder directly, since handleTodayChange
// deliberately avoids a full re-render (see below).
function refreshRepsHint(ex, index) {
  const repsInput = document.querySelector(
    `input[data-field="reps"][data-slot="${cssEscape(ex.slotId)}"][data-set="${index}"]`
  );
  if (repsInput) repsInput.placeholder = setRepsHint(ex, ex.sets[index]);
}

function handleTodayChange(target) {
  const { workout } = getTodayContext();
  if (!workout) return;
  const slotId = target.dataset.slot;
  const setIndex = Number(target.dataset.set);
  const field = target.dataset.field;
  const ex = workout.exercises.find((e) => e.slotId === slotId);
  if (!ex) return;
  const set = ex.sets[setIndex];
  const raw = target.value;
  const num = raw === "" ? null : parseFloat(raw);
  set[field] = Number.isNaN(num) ? null : num;
  set.isLogged = set.weight != null || set.reps != null;

  // Once a weight is entered, carry it into any other set of this exercise
  // the user hasn't touched yet — but only one whose predicted weight matched
  // this set's: if the prediction had every set at the same weight, same
  // weight across all sets is the common case; if it had deliberately
  // different weights (e.g. last week's drop set), those should stick. With
  // no prediction at all (baseline entry), every baseWeight is null, so the
  // weight carries everywhere. Carried sets stay unlogged, so their weight
  // keeps following later edits; reps are never carried, only re-hinted.
  if (field === "weight" && set.weight != null) {
    ex.sets.forEach((s, i) => {
      if (i === setIndex || s.isLogged || s.baseWeight !== set.baseWeight) return;
      s.weight = set.weight;
      const otherInput = document.querySelector(
        `input[data-field="weight"][data-slot="${cssEscape(slotId)}"][data-set="${i}"]`
      );
      if (otherInput) otherInput.value = set.weight;
      refreshRepsHint(ex, i);
    });
  }
  if (field === "weight") refreshRepsHint(ex, setIndex);

  Store.updateWorkout(workout.id, { exercises: workout.exercises });
  // No renderCurrentView() here: a full re-render would replace the input
  // DOM nodes out from under the user's next click/tab while filling in a
  // table of set rows, silently dropping focus (and whatever they typed
  // next).
}

/* ---------------- PROGRAM ---------------- */

function renderProgram(container) {
  const meso = Store.getActiveMesocycle();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }
  const sortedDays = [...meso.days].sort((a, b) => getDayWeekdayOffset(a) - getDayWeekdayOffset(b));
  const usedOffsets = new Set(meso.days.map((d) => getDayWeekdayOffset(d)));
  const availableOffsets = [0, 1, 2, 3, 4, 5, 6].filter((i) => !usedOffsets.has(i));

  container.innerHTML = `
    <h2>${escapeHtml(meso.name)}</h2>
    <p class="muted">Start day: ${WEEKDAY_LABELS[mesocycleStartWeekday(meso)]} (${meso.startDate})</p>
    ${sortedDays.map((day) => renderDayCard(meso, day)).join("")}
    <div class="add-exercise-area">
      ${App.ui.addDayOpen
        ? `<div class="inline-form">
             <input type="text" data-role="new-day-name" placeholder="Day name (e.g. Push)">
             <label>Trains on
               <select data-role="new-day-weekday">
                 ${availableOffsets.map((i) => `<option value="${i}">${WEEKDAY_LABELS[(mesocycleStartWeekday(meso) + i) % 7]}</option>`).join("")}
               </select>
             </label>
             <div class="form-actions">
               <button data-action="confirm-add-day">Add Day</button>
               <button data-action="cancel-add-day">Cancel</button>
             </div>
           </div>`
        : availableOffsets.length === 0
          ? `<p class="muted">No more days can be added — every weekday is already scheduled.</p>`
          : `<button class="btn" data-action="open-add-day">+ Add Day</button>`}
    </div>
  `;
}

function renderDayCard(meso, day) {
  const weekday = WEEKDAY_LABELS[(mesocycleStartWeekday(meso) + getDayWeekdayOffset(day)) % 7];
  const sortedExercises = [...day.exercises].sort((a, b) => a.order - b.order);
  const removeConfirm = App.ui.removeDayConfirm === day.id;
  const addExOpen = App.ui.addExerciseToDay === day.id;
  return `
    <div class="card day-card" data-day="${day.id}">
      <div class="day-header">
        <strong>${escapeHtml(day.name)}</strong>
        <span class="muted">${weekday}</span>
        ${removeConfirm
          ? `<span><button data-action="confirm-remove-day" data-day="${day.id}">Confirm</button>
             <button data-action="cancel-remove-day" data-day="${day.id}">Cancel</button></span>`
          : `<button data-action="open-remove-day" data-day="${day.id}">Remove Day</button>`}
      </div>
      <table class="slots">
        <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>+%</th><th></th></tr></thead>
        <tbody>
          ${(() => {
            let prevGroup = null;
            const rows = [];
            sortedExercises.forEach((slot) => {
              const group = getExerciseMuscleGroup(slot.exerciseId);
              if (prevGroup !== null && group !== prevGroup) {
                rows.push(`<tr class="group-divider-row"><td colspan="5"><div class="muscle-divider-line"></div></td></tr>`);
              }
              prevGroup = group;
              rows.push(renderSlotRow(day, slot));
            });
            return rows.join("");
          })()}
        </tbody>
      </table>
      ${addExOpen
        ? renderAddSlotForm(day)
        : `<button class="btn small" data-action="open-add-slot" data-day="${day.id}">+ Add Exercise</button>`}
    </div>
  `;
}

function renderSlotRow(day, slot) {
  const exercise = Store.getExercises().find((e) => e.id === slot.exerciseId);
  return `<tr data-slot="${slot.id}" data-day="${day.id}">
    <td>
      ${renderMuscleTag((exercise && exercise.muscleGroup) || "Other")}
      <div>${escapeHtml(exercise ? exercise.name : "(unknown)")}</div>
    </td>
    <td><input type="number" min="1" value="${slot.targetSets}" data-role="slot-sets" data-day="${day.id}" data-slot="${slot.id}"></td>
    <td>
      <input type="number" min="1" value="${slot.repRangeMin}" class="rep-input" data-role="slot-rep-min" data-day="${day.id}" data-slot="${slot.id}">-
      <input type="number" min="1" value="${slot.repRangeMax}" class="rep-input" data-role="slot-rep-max" data-day="${day.id}" data-slot="${slot.id}">
    </td>
    <td><input type="number" step="0.5" value="${slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT}" class="rep-input" data-role="slot-increment" data-day="${day.id}" data-slot="${slot.id}"></td>
    <td>
      <div class="slot-actions">
        <span class="slot-reorder">
          <button data-action="move-slot-up" data-day="${day.id}" data-slot="${slot.id}">▲</button>
          <button data-action="move-slot-down" data-day="${day.id}" data-slot="${slot.id}">▼</button>
        </span>
        <button class="btn-danger" data-action="remove-slot" data-day="${day.id}" data-slot="${slot.id}">✕</button>
      </div>
    </td>
  </tr>`;
}

function renderAddSlotForm(day) {
  return `<div class="inline-form" data-day="${day.id}">
    <select data-role="new-slot-exercise" data-day="${day.id}">
      <option value="">-- choose existing --</option>
      ${renderExerciseOptionsGrouped(null)}
    </select>
    <input type="text" data-role="new-slot-name" data-day="${day.id}" placeholder="or create new exercise">
    ${renderMuscleGroupSelect("new-slot-group", `data-day="${day.id}"`)}
    <div class="form-row">
      <label>Sets <input type="number" data-role="new-slot-sets" data-day="${day.id}" value="2" min="1"></label>
      <label>Rep min <input type="number" data-role="new-slot-rep-min" data-day="${day.id}" value="5" min="1"></label>
      <label>Rep max <input type="number" data-role="new-slot-rep-max" data-day="${day.id}" value="10" min="1"></label>
      <label>+% <input type="number" step="0.5" data-role="new-slot-increment" data-day="${day.id}" value="${DEFAULT_INCREMENT_PCT}"></label>
    </div>
    <div class="form-actions">
      <button data-action="confirm-add-slot" data-day="${day.id}">Add</button>
      <button data-action="cancel-add-slot" data-day="${day.id}">Cancel</button>
    </div>
  </div>`;
}

const SLOT_FIELD_MAP = { "slot-sets": "targetSets", "slot-rep-min": "repRangeMin", "slot-rep-max": "repRangeMax", "slot-increment": "weightIncrementPct" };

function handleProgramAction(action, btn, view) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return;
  const dayId = btn.dataset.day;
  const slotId = btn.dataset.slot;

  if (action === "open-remove-day") {
    App.ui.removeDayConfirm = dayId;
  } else if (action === "cancel-remove-day") {
    App.ui.removeDayConfirm = null;
  } else if (action === "confirm-remove-day") {
    Store.removeDay(meso.id, dayId); App.ui.removeDayConfirm = null;
  } else if (action === "open-add-slot") {
    App.ui.addExerciseToDay = dayId;
  } else if (action === "cancel-add-slot") {
    App.ui.addExerciseToDay = null;
  } else if (action === "confirm-add-slot") {
    const select = view.querySelector(`select[data-role="new-slot-exercise"][data-day="${cssEscape(dayId)}"]`);
    const newName = view.querySelector(`input[data-role="new-slot-name"][data-day="${cssEscape(dayId)}"]`).value.trim();
    const newGroup = view.querySelector(`select[data-role="new-slot-group"][data-day="${cssEscape(dayId)}"]`).value;
    const targetSets = cleanCount(view.querySelector(`input[data-role="new-slot-sets"][data-day="${cssEscape(dayId)}"]`).value);
    const repRangeMin = cleanCount(view.querySelector(`input[data-role="new-slot-rep-min"][data-day="${cssEscape(dayId)}"]`).value);
    const repRangeMax = Math.max(repRangeMin, cleanCount(view.querySelector(`input[data-role="new-slot-rep-max"][data-day="${cssEscape(dayId)}"]`).value));
    const weightIncrementPct = Math.max(0, Number(view.querySelector(`input[data-role="new-slot-increment"][data-day="${cssEscape(dayId)}"]`).value) || 0);
    const exercise = newName ? Store.addExercise(newName, newGroup) : Store.getExercises().find((x) => x.id === select.value);
    if (exercise) {
      Store.addExerciseSlot(meso.id, dayId, { exerciseId: exercise.id, targetSets, repRangeMin, repRangeMax, weightIncrementPct });
    }
    App.ui.addExerciseToDay = null;
  } else if (action === "move-slot-up" || action === "move-slot-down") {
    Store.reorderExerciseSlot(meso.id, dayId, slotId, action === "move-slot-up" ? -1 : 1);
  } else if (action === "remove-slot") {
    Store.removeExerciseSlot(meso.id, dayId, slotId);
  } else if (action === "open-add-day") {
    App.ui.addDayOpen = true;
  } else if (action === "cancel-add-day") {
    App.ui.addDayOpen = false;
  } else if (action === "confirm-add-day") {
    const name = view.querySelector('input[data-role="new-day-name"]').value.trim();
    const weekdaySelect = view.querySelector('select[data-role="new-day-weekday"]');
    if (name && weekdaySelect) Store.addDay(meso.id, name, Number(weekdaySelect.value));
    App.ui.addDayOpen = false;
  }
  renderCurrentView();
}

function handleProgramChange(target) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return;
  const dayId = target.dataset.day, slotId = target.dataset.slot;
  const field = SLOT_FIELD_MAP[target.dataset.role];
  if (!field) return;
  // The inputs' min is only a hint: an empty, zero, negative or fractional
  // value here would reach today's workout (0 sets, a broken rep range).
  const value = field === "weightIncrementPct" ? Math.max(0, Number(target.value) || 0) : cleanCount(target.value);
  target.value = value;
  const updates = { [field]: value };
  const day = meso.days.find((d) => d.id === dayId);
  const slot = day && day.exercises.find((e) => e.id === slotId);
  // Keep min <= max by dragging the other end along.
  const other = field === "repRangeMin" && slot && value > slot.repRangeMax ? ["repRangeMax", "slot-rep-max"]
    : field === "repRangeMax" && slot && value < slot.repRangeMin ? ["repRangeMin", "slot-rep-min"] : null;
  if (other) {
    updates[other[0]] = value;
    const otherInput = target.closest("tr").querySelector(`input[data-role="${other[1]}"]`);
    if (otherInput) otherInput.value = value;
  }
  Store.updateExerciseSlot(meso.id, dayId, slotId, updates);
  // No renderCurrentView(): see the comment in handleTodayChange — this
  // table has the same rapid-tab-through-inputs pattern.
}

/* ---------------- HISTORY ---------------- */

function renderHistory(container) {
  const workouts = Store.getWorkouts()
    .filter((w) => w.finished)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const mesos = Store.getMesocycles();

  if (workouts.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No finished workouts yet.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="history-list">
    ${workouts.map((w) => {
      const meso = mesos.find((m) => m.id === w.mesocycleId);
      const open = App.ui.historyExpanded === w.id;
      return `<div class="card history-entry">
        <div class="history-entry-header" data-action="toggle-workout" data-id="${w.id}">
          <strong>${w.date}</strong> — ${escapeHtml(w.dayName)}
          <span class="muted">${meso ? escapeHtml(meso.name) : ""}</span>
        </div>
        ${open ? `<div class="history-detail">
          ${[...w.exercises].sort((a, b) => a.order - b.order).map((ex) => `
            <div class="history-exercise">
              <span>${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId))} <strong>${escapeHtml(ex.exerciseName)}</strong></span>
              <span>${ex.sets.map((s) => isCompleteSet(s) ? `${s.weight}×${s.reps}` : "—").join(", ")}</span>
            </div>`).join("")}
        </div>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function handleHistoryAction(action, btn) {
  if (action === "toggle-workout") {
    const id = btn.dataset.id;
    App.ui.historyExpanded = App.ui.historyExpanded === id ? null : id;
    renderCurrentView();
  }
}

/* ---------------- SETTINGS ---------------- */

function renderSettings(container) {
  const mesos = Store.getMesocycles().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const active = mesos.find((m) => m.active);
  const exercises = Store.getExercises().sort((a, b) => a.name.localeCompare(b.name));
  // An exercise a program still uses can't be removed: its slots would turn
  // into "(unknown exercise)". Take it out of the program first.
  const inUse = new Set(mesos.flatMap((m) => m.days.flatMap((d) => d.exercises.map((slot) => slot.exerciseId))));

  container.innerHTML = `
    ${App.updateAvailable ? `
      <div class="card update-banner">
        <p>A new version of this app is available.</p>
        <button class="btn primary" data-action="reload-app">Refresh Now</button>
      </div>
    ` : ""}
    <h2>Mesocycles</h2>
    ${mesos.length === 0 ? `<p class="muted">No mesocycles yet.</p>` : `
      <div class="meso-list">
        ${mesos.map((m) => `
          <div class="card meso-item ${m.active ? "active-meso" : ""}">
            <div>
              <strong>${escapeHtml(m.name)}</strong>
              <span class="muted">${m.numWeeks}wk · starts ${m.startDate}</span>
            </div>
            ${m.active ? `<span class="badge">Active</span>` : `<button data-action="switch-active" data-id="${m.id}">Make Active</button>`}
          </div>`).join("")}
      </div>
    `}

    ${active ? `
      <h3>Edit "${escapeHtml(active.name)}"</h3>
      <div class="card">
        <label>Name <input type="text" data-role="edit-name" value="${escapeHtml(active.name)}"></label>
        <label>Weeks <input type="number" min="1" data-role="edit-weeks" value="${active.numWeeks}"></label>
        <label>Start date <input type="date" data-role="edit-start-date" value="${active.startDate}"></label>
        <p class="muted">Falls on a <span data-role="edit-start-weekday-hint">${WEEKDAY_LABELS[mesocycleStartWeekday(active)]}</span> — day 1 of the program always starts there.</p>
      </div>
    ` : ""}

    <h3>Create New Mesocycle</h3>
    <div class="card">
      <label>Name <input type="text" data-role="new-meso-name" placeholder="e.g. Meso 1"></label>
      <label>Weeks <input type="number" min="1" value="6" data-role="new-meso-weeks"></label>
      <label>Start date <input type="date" data-role="new-meso-start-date" value="${isoDate(new Date())}"></label>
      <p class="muted">Falls on a <span data-role="new-meso-start-weekday-hint">${WEEKDAY_LABELS[jsDateToWeekdayIndex(new Date())]}</span> — day 1 of the program always starts there.</p>
      <button class="btn primary" data-action="create-meso">Create</button>
    </div>

    <h3>Exercise Library</h3>
    ${exercises.length === 0 ? `<p class="muted">No exercises yet.</p>` : `
      <div class="meso-list">
        ${exercises.map((ex) => `
          <div class="card meso-item">
            <div>
              ${renderMuscleTag(ex.muscleGroup || "Other")}
              <strong>${escapeHtml(ex.name)}</strong>
            </div>
            ${inUse.has(ex.id) ? `<span class="muted">In a program</span>` : App.ui.removeExerciseOpen === ex.id
              ? `<span><button data-action="confirm-remove-exercise" data-id="${ex.id}">Confirm</button>
                 <button data-action="cancel-remove-exercise" data-id="${ex.id}">Cancel</button></span>`
              : `<button class="btn-danger" data-action="open-remove-exercise" data-id="${ex.id}">Remove</button>`}
          </div>`).join("")}
      </div>
    `}
  `;
}

const MESO_EDIT_FIELD_MAP = {
  "edit-name": ["name", (v) => v],
  "edit-weeks": ["numWeeks", cleanCount],
  "edit-start-date": ["startDate", (v) => v],
};

function handleSettingsAction(action, btn, view) {
  if (action === "reload-app") {
    location.reload();
    return;
  }
  if (action === "switch-active") {
    Store.setActiveMesocycle(btn.dataset.id);
  } else if (action === "create-meso") {
    const name = view.querySelector('[data-role="new-meso-name"]').value.trim() || "New Mesocycle";
    const numWeeks = cleanCount(view.querySelector('[data-role="new-meso-weeks"]').value || 6);
    const startDate = view.querySelector('[data-role="new-meso-start-date"]').value || isoDate(new Date());
    Store.createMesocycle({ name, numWeeks, startDate });
  } else if (action === "open-remove-exercise") {
    App.ui.removeExerciseOpen = btn.dataset.id;
  } else if (action === "cancel-remove-exercise") {
    App.ui.removeExerciseOpen = null;
  } else if (action === "confirm-remove-exercise") {
    Store.removeExercise(btn.dataset.id);
    App.ui.removeExerciseOpen = null;
  } else {
    return;
  }
  renderCurrentView();
}

// The mesocycle's start weekday is always derived from its startDate (see
// mesocycleStartWeekday in schedule.js) — there's no separate field for it,
// so it can never disagree with the calendar. This just updates the
// "Falls on a <Weekday>" hint text next to a start-date input as the user
// picks a date.
function updateStartWeekdayHint(dateInput, hintDataRole) {
  if (!dateInput.value) return;
  const weekday = jsDateToWeekdayIndex(parseLocalDate(dateInput.value));
  const hint = document.querySelector(`[data-role="${hintDataRole}"]`);
  if (hint) hint.textContent = WEEKDAY_LABELS[weekday];
}

function handleSettingsChange(target) {
  const mapping = MESO_EDIT_FIELD_MAP[target.dataset.role];
  if (!mapping) return;
  const active = Store.getActiveMesocycle();
  if (!active) return;
  const [field, parse] = mapping;
  // A cleared name or start date is not saved (an empty start date would
  // turn every day into a rest day); the box goes back to the stored value.
  if (field !== "numWeeks" && !target.value.trim()) { target.value = active[field]; return; }
  Store.updateMesocycle(active.id, { [field]: parse(target.value) });
  if (field === "numWeeks") target.value = parse(target.value);
  if (target.dataset.role === "edit-start-date") {
    updateStartWeekdayHint(target, "edit-start-weekday-hint");
  }
  // No renderCurrentView(): avoid stealing focus mid-edit (see
  // handleTodayChange). Patch the mesocycle-list summary line in place so
  // it still reflects the edit.
  const updated = Store.getActiveMesocycle();
  const item = document.querySelector(".meso-item.active-meso");
  if (item) {
    item.querySelector("strong").textContent = updated.name;
    item.querySelector(".muted").textContent = `${updated.numWeeks}wk · starts ${updated.startDate}`;
  }
}

/* ---------------- GLOBAL EVENT DELEGATION ---------------- */

function handleGlobalClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const view = document.getElementById("view");
  const route = currentRoute();
  const action = btn.dataset.action;
  if (route === "today") handleTodayAction(action, btn, view);
  else if (route === "program") handleProgramAction(action, btn, view);
  else if (route === "history") handleHistoryAction(action, btn);
  else if (route === "settings") handleSettingsAction(action, btn, view);
}

const EXISTING_EXERCISE_SELECT_ROLES =
  'select[data-role="add-exercise-select"], select[data-role="sub-exercise-select"], select[data-role="new-slot-exercise"]';
const NEW_EXERCISE_NAME_INPUT_ROLES =
  'input[data-role="add-new-name"], input[data-role="sub-new-name"], input[data-role="new-slot-name"]';

// When an existing exercise is picked from one of the add/swap dropdowns,
// its muscle group is already fixed — grey out the sibling group select so
// it can't be edited into a value that doesn't match. Clearing the pick
// re-enables it. A "locked" group select (swap's create-new field, always
// pinned to the current slot's group) is left alone either way.
function handleExercisePickChange(selectEl) {
  const container = selectEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  const nameInput = container.querySelector('input[data-role$="-name"]');
  if (groupSelect.dataset.locked === "true") return;
  const exercise = selectEl.value ? Store.getExercises().find((e) => e.id === selectEl.value) : null;
  if (exercise) {
    groupSelect.value = exercise.muscleGroup || "Other";
    groupSelect.disabled = true;
    nameInput.value = "";
  } else {
    groupSelect.disabled = false;
  }
}

// Typing a new exercise name means the "pick existing" path no longer
// applies — reset that dropdown and re-enable the group select (unless it's
// permanently locked, e.g. the swap form's same-muscle-group constraint).
function handleNewNameTyped(inputEl) {
  if (inputEl.value.trim() === "") return;
  const container = inputEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  if (groupSelect.dataset.locked !== "true") groupSelect.disabled = false;
  const existingSelect = container.querySelector(EXISTING_EXERCISE_SELECT_ROLES);
  if (existingSelect) existingSelect.value = "";
}

function handleGlobalChange(e) {
  const t = e.target;
  const route = currentRoute();
  if (route === "today" && t.matches('input[data-role="set-done"]')) handleSetDoneChange(t);
  else if (route === "today" && t.matches("input[data-field]")) handleTodayChange(t);
  else if (route === "program" && t.matches('input[data-role^="slot-"]')) handleProgramChange(t);
  else if (route === "settings" && t.dataset.role === "new-meso-start-date") updateStartWeekdayHint(t, "new-meso-start-weekday-hint");
  else if (route === "settings" && t.matches('[data-role^="edit-"]')) handleSettingsChange(t);
  else if (t.matches(EXISTING_EXERCISE_SELECT_ROLES)) handleExercisePickChange(t);
  else if (t.matches(NEW_EXERCISE_NAME_INPUT_ROLES)) handleNewNameTyped(t);
}

/* ---------------- INIT ---------------- */

window.addEventListener("hashchange", () => { App.ui = {}; renderCurrentView(); });
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("view").addEventListener("click", handleGlobalClick);
  document.getElementById("view").addEventListener("change", handleGlobalChange);
  // Full-screen overlays (see index.html) render outside #view, so they need
  // their own delegated listener — handleGlobalClick itself doesn't care
  // which container an event came from (it re-derives state from Store and
  // currentRoute() rather than closing over anything from the listener).
  document.getElementById("overlay-root").addEventListener("click", handleGlobalClick);
  if (!location.hash) location.hash = "#/today";
  renderCurrentView();
  if ("serviceWorker" in navigator) {
    // A controllerchange with no prior controller is just this page's first
    // ever activation (nothing to tell the user about). One that happens
    // *after* a controller already existed means a newly-deployed service
    // worker just took over from an older one while this page was open —
    // that's the "new version available" signal the Settings banner shows.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;
      App.updateAvailable = true;
      if (currentRoute() === "settings") renderCurrentView();
    });
  }
});
