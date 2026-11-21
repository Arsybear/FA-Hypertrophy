import { Store, uid } from "../store.js";
import { WEEKDAY_LABELS, addDays, isoDate, jsDateToWeekdayIndex, parseLocalDate, resolveDayForDate } from "../schedule.js";
import { DEFAULT_INCREMENT_PCT, blankSet, buildPrefilledSets, equivalentReps, isCompleteSet, nextSet } from "../progression.js";
import { App, cleanCount, cssEscape, emptyMesoState, escapeHtml, fmtNum, getExerciseMuscleGroup, renderCurrentView, renderExerciseOptionsGrouped, renderMuscleGroupSelect, renderMuscleTag, icon, pageHeader } from "../ui.js";
import { getExerciseHistory, getTodayContext, isTouchedSet } from "../workout.js";
import { renderLineChart } from "../chart.js";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function workoutStatusClass(workout) {
  return workout ? (workout.finished ? "finished" : "started") : "";
}

// Screen header plus a Monday-to-Sunday strip of the viewed date's week: each
// day is a link (an ordinary route change), with the same status dot as the
// month calendar. Like the calendar it only reads workouts, never generates.
export function renderDateNav(meso, dateIso, isToday, title) {
  const date = parseLocalDate(dateIso);
  const todayIso = isoDate(new Date());
  const monday = addDays(date, -jsDateToWeekdayIndex(date));
  const workoutsByDate = {};
  Store.getWorkouts()
    .filter((w) => w.mesocycleId === meso.id)
    .forEach((w) => { workoutsByDate[w.date] = w; });
  const week = Math.floor((date - parseLocalDate(meso.startDate)) / (7 * 86400000)) + 1;
  const subtitle = `${WEEKDAY_LABELS[jsDateToWeekdayIndex(date)]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
    + (dateIso >= meso.startDate ? ` · Week ${week}` : "");

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const iso = isoDate(d);
    const inBlock = iso >= meso.startDate;
    const workout = workoutsByDate[iso];
    const trains = inBlock && (workout || resolveDayForDate(meso, d));
    const classes = ["week-day", iso === dateIso ? "selected" : "", iso === todayIso ? "today" : "",
      trains ? "train" : "", workoutStatusClass(workout)].filter(Boolean).join(" ");
    const inner = `<span class="week-day-name">${WEEKDAY_LABELS[i].slice(0, 2)}</span>
      <span class="week-day-num">${d.getDate()}</span><span class="cal-dot"></span>`;
    return inBlock
      ? `<a class="${classes}" href="#/today?date=${iso}" aria-label="${WEEKDAY_LABELS[i]} ${iso}">${inner}</a>`
      : `<span class="${classes} outside">${inner}</span>`;
  }).join("");

  const prevWeekIso = isoDate(addDays(date, -7));
  const canGoPrev = isoDate(addDays(monday, -1)) >= meso.startDate;
  return `${pageHeader(title, subtitle, `
    ${!isToday ? `<a class="btn small ghost" href="#/today">Today</a>` : ""}
    <button class="icon-btn ${App.ui.calendarOpen ? "active" : ""}" data-action="toggle-calendar" aria-label="Show training block calendar">${icon("calendar")}</button>`)}
  <div class="week-strip">
    ${canGoPrev
      ? `<a class="icon-btn" href="#/today?date=${prevWeekIso < meso.startDate ? meso.startDate : prevWeekIso}" aria-label="Previous week">${icon("left")}</a>`
      : `<span class="icon-btn" aria-disabled="true">${icon("left")}</span>`}
    <div class="week-days">${days}</div>
    <a class="icon-btn" href="#/today?date=${isoDate(addDays(date, 7))}" aria-label="Next week">${icon("right")}</a>
  </div>
  ${App.ui.calendarOpen ? renderCalendarPanel(meso, dateIso) : ""}`;
}

// Read-only month view of the mesocycle — never generates or mutates workout
// instances, just reads existing fah_workouts for status. Pages from the
// start month to the last month that has anything in it: the program keeps
// scheduling past numWeeks, so the end is the latest of the planned end,
// today, the viewed date and the last workout.
export function renderCalendarPanel(meso, selectedIso) {
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
    return `<button class="icon-btn" data-action="calendar-month" data-month="${iso}" aria-label="${name} month" ${off ? "disabled" : ""}>${icon(label)}</button>`;
  };

  return `<div class="calendar-panel">
    <div class="calendar-month-nav">
      ${monthNavBtn("left", new Date(year, monthNum - 2, 1), "Previous")}
      <strong>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
      ${monthNavBtn("right", new Date(year, monthNum, 1), "Next")}
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

export function renderCalendarCell(c, todayIso, selectedIso) {
  if (!c) return `<span class="cal-cell empty"></span>`;
  const { dateIso, date, dayTemplate, workout } = c;
  if (!c.inBlock) return `<span class="cal-cell rest outside"><span class="cal-daynum">${date.getDate()}</span></span>`;
  const isRest = !dayTemplate && !workout;
  const classes = [
    "cal-cell",
    isRest ? "rest" : "train",
    dateIso === todayIso ? "today" : "",
    dateIso === selectedIso ? "selected" : "",
    workoutStatusClass(workout),
  ].filter(Boolean).join(" ");
  return `<a class="${classes}" href="#/today?date=${dateIso}" title="${escapeHtml(workout ? workout.dayName : dayTemplate ? dayTemplate.name : "Rest day")} — ${dateIso}">
    <span class="cal-daynum">${date.getDate()}</span>
    ${!isRest ? `<span class="cal-dot"></span>` : ""}
  </a>`;
}

export function renderToday(container) {
  const { meso, dayTemplate, workout, dateIso, isToday } = getTodayContext();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }

  if (!dayTemplate && !workout) {
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday, "Rest day")}
      <div class="empty-state">
        <h2>Nothing scheduled</h2>
        <p class="muted">${dateIso < meso.startDate ? "This is before the mesocycle starts." : "Recover. Next session is on the strip above."}</p>
      </div>`;
    return;
  }

  if (!workout) {
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday, dayTemplate.name)}
      <div class="empty-state">
        <h2>Not reached yet</h2>
        <p class="muted">This workout opens on its day.</p>
      </div>`;
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

  const allSets = workout.exercises.flatMap((ex) => ex.sets);
  const doneSets = allSets.filter((s) => isSetDone(workout, s)).length;

  container.innerHTML = `
    ${renderDateNav(meso, dateIso, isToday, workout.dayName)}
    <div class="progress-card ${workout.finished ? "finished" : ""}">
      <div class="progress-text">
        <span class="progress-count" data-role="sets-done"><strong>${doneSets}</strong> / ${allSets.length} sets</span>
        <span class="status-pill">${workout.finished ? "Finished" : doneSets > 0 ? "In progress" : "Not started"}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${allSets.length ? (100 * doneSets) / allSets.length : 0}%"></div></div>
    </div>
    ${exerciseBlocksHtml}
    ${!workout.finished ? `<div class="add-exercise-area">
      ${App.ui.addOpen ? renderAddExerciseForm() : `<button class="btn ghost wide" data-action="open-add-exercise">${icon("plus")} Add exercise</button>`}
    </div>` : ""}
    <div class="finish-area">
      ${workout.finished
        ? `<button class="btn secondary wide" data-action="reopen-workout">Reopen workout</button>`
        : `<button class="btn primary wide" data-action="finish-workout">Finish workout</button>`}
    </div>
  `;
  document.getElementById("overlay-root").innerHTML = historyEx ? renderHistorySheet(historyEx) : "";
}

export function renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd) {
  const removeOpen = App.ui.removeOpen === ex.slotId;
  const subOpen = App.ui.substituteOpen === ex.slotId;
  const complete = ex.sets.length > 0 && ex.sets.every((s) => isSetDone(workout, s));
  const cardClass = [
    !isGroupStart ? "merge-top" : "", !isGroupEnd ? "merge-bottom" : "", complete ? "complete" : "",
  ].filter(Boolean).join(" ");
  const off = workout.finished ? "disabled" : "";
  return `
    <div class="card exercise ${cardClass}" data-slot="${ex.slotId}">
      <div class="exercise-header">
        <div class="ex-name-group">
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId))}
          <strong class="ex-name">${escapeHtml(ex.exerciseName)}${complete ? `<span class="ex-done-mark" aria-label="completed">${icon("check")}</span>` : ""}</strong>
          <span class="rep-range muted">${ex.sets.length} × ${ex.repRangeMin}–${ex.repRangeMax} reps</span>
        </div>
        <div class="exercise-actions">
          <button class="icon-btn" data-action="open-history" data-slot="${ex.slotId}" aria-label="History">${icon("history")}</button>
          ${!workout.finished ? `
            <button class="icon-btn" data-action="open-substitute" data-slot="${ex.slotId}" aria-label="Swap exercise">${icon("swap")}</button>
            <button class="icon-btn" data-action="open-remove" data-slot="${ex.slotId}" aria-label="Remove exercise">${icon("trash")}</button>
            <button class="icon-btn" data-action="move-up" data-slot="${ex.slotId}" aria-label="Move up" ${off}>${icon("up")}</button>
            <button class="icon-btn" data-action="move-down" data-slot="${ex.slotId}" aria-label="Move down" ${off}>${icon("down")}</button>
          ` : ""}
        </div>
      </div>
      ${removeOpen ? renderRemoveForm(ex) : ""}
      ${subOpen ? renderSubstituteForm(ex) : ""}
      <div class="sets">
        <div class="set-row set-head muted"><span>Set</span><span>Weight (lb)</span><span>Reps</span><span></span></div>
        ${ex.sets.map((s, i) => {
          const done = isSetDone(workout, s);
          const locked = workout.finished || done ? "disabled" : "";
          return `
          <div class="set-row ${done ? "done" : ""}">
            <span class="set-num">${i + 1}</span>
            <input type="number" step="0.5" inputmode="decimal" placeholder="${setWeightHint(s)}"
              data-field="weight" data-slot="${ex.slotId}" data-set="${i}" aria-label="Set ${i + 1} weight"
              value="${fmtNum(s.weight)}" ${locked}>
            <input type="number" inputmode="numeric" placeholder="${setRepsHint(ex, s)}"
              data-field="reps" data-slot="${ex.slotId}" data-set="${i}" aria-label="Set ${i + 1} reps"
              value="${fmtNum(s.reps)}" ${locked}>
            <input type="checkbox" class="set-check" data-role="set-done"
              data-slot="${ex.slotId}" data-set="${i}" aria-label="Set ${i + 1} done"
              ${done ? "checked" : ""} ${workout.finished ? "disabled" : ""}>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

// Two small charts over the exercise's sessions, oldest to newest: the
// heaviest set, and total volume (weight × reps over all sets). Under double
// progression the weight sits flat for weeks while reps climb, so weight
// alone looks like no progress; volume moves with both. Deliberately not an
// estimated 1RM: one rep/weight curve does not fit light and heavy lifts
// (see pctPerRep in progression.js). Needs at least two sessions.
function renderProgressCharts(rows) {
  const sessions = rows
    .map((r) => ({ label: r.date.slice(5).replace("-", "/"), sets: r.sets.filter(isCompleteSet) }))
    .filter((r) => r.sets.length > 0)
    .reverse();
  if (sessions.length < 2) return "";
  return `<div class="charts">
    ${renderLineChart("Top set", "lb", sessions.map((r) => ({ label: r.label, value: Math.max(...r.sets.map((s) => s.weight)) })))}
    ${renderLineChart("Volume", "lb", sessions.map((r) => ({ label: r.label, value: r.sets.reduce((sum, s) => sum + s.weight * s.reps, 0) })))}
  </div>`;
}

export function renderHistorySheet(ex) {
  const rows = getExerciseHistory(ex.slotId, ex.exerciseId, ex.exerciseName);
  return `<div class="history-sheet-backdrop" data-action="close-history">
    <div class="history-sheet" data-action="">
      <div class="history-sheet-header">
        <div>
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId))}
          <h2>${escapeHtml(ex.exerciseName)}</h2>
        </div>
        <button class="icon-btn" data-action="close-history" aria-label="Close">${icon("close")}</button>
      </div>
      ${renderProgressCharts(rows)}
      ${rows.length === 0
        ? `<p class="muted">No history yet.</p>`
        : rows.map((r) => `<div class="history-row">
            <span class="muted">${r.date} · ${escapeHtml(r.dayName)}</span>
            <span class="set-chips">${r.sets.map((s) => isCompleteSet(s) ? `<span class="set-chip">${s.weight}×${s.reps}</span>` : `<span class="set-chip empty">—</span>`).join("")}</span>
          </div>`).join("")}
    </div>
  </div>`;
}

export function renderRemoveForm(ex) {
  return `<div class="inline-form" data-slot="${ex.slotId}">
    <p>Remove ${escapeHtml(ex.exerciseName)}?</p>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button class="btn small danger" data-action="confirm-remove" data-slot="${ex.slotId}">Remove</button>
      <button class="btn small ghost" data-action="cancel-remove" data-slot="${ex.slotId}">Cancel</button>
    </div>
  </div>`;
}

export function renderSubstituteForm(ex) {
  const currentGroup = getExerciseMuscleGroup(ex.exerciseId);
  return `<div class="inline-form" data-slot="${ex.slotId}">
    <p>Swap ${escapeHtml(ex.exerciseName)} for another ${escapeHtml(currentGroup)} exercise:</p>
    ${ex.sets.some(isTouchedSet) ? `<p class="warn-text">Sets already entered for ${escapeHtml(ex.exerciseName)} will be cleared.</p>` : ""}
    <select data-role="sub-exercise-select" data-slot="${ex.slotId}">
      <option value="">-- choose existing --</option>
      ${renderExerciseOptionsGrouped(ex.exerciseId, currentGroup)}
    </select>
    <input type="text" data-role="sub-new-name" data-slot="${ex.slotId}" placeholder="or create new exercise">
    ${renderMuscleGroupSelect("sub-new-group", `data-slot="${ex.slotId}"`, currentGroup)}
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button class="btn small primary" data-action="confirm-substitute" data-slot="${ex.slotId}">Swap</button>
      <button class="btn small ghost" data-action="cancel-substitute" data-slot="${ex.slotId}">Cancel</button>
    </div>
  </div>`;
}

export function renderAddExerciseForm() {
  return `<div class="inline-form">
    <p class="form-title">Add exercise</p>
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
      <button class="btn small primary" data-action="confirm-add-exercise">Add</button>
      <button class="btn small ghost" data-action="cancel-add-exercise">Cancel</button>
    </div>
  </div>`;
}

export function handleTodayAction(action, btn, view) {
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
export function setWeightHint(s) {
  return s.baseWeight ?? "wt";
}

export function setRepsHint(ex, s) {
  if (s.weight != null) {
    const estimate = equivalentReps(s.baseWeight, s.baseReps, s.weight);
    if (estimate != null) return Math.min(Math.max(estimate, ex.repRangeMin), ex.repRangeMax);
  }
  return s.baseReps ?? "reps";
}

// Workouts finished before the done checkbox existed have no `done` flags,
// so on a finished workout any complete set reads as done.
export function isSetDone(workout, s) {
  return !!s.done || (workout.finished && isCompleteSet(s));
}

// Ticking a set's checkbox marks it done and locks its inputs. Any box still
// empty accepts its placeholder hint (so a set done exactly as predicted is
// one tap); if a box has no numeric hint either, the tick doesn't stick and
// focus goes to that box. Unlike handleTodayChange this does re-render —
// the no-re-render rule protects focus while typing, and a checkbox tap
// isn't typing — so locks and the card's completed state update in one place.
export function handleSetDoneChange(target) {
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
export function refreshRepsHint(ex, index) {
  const repsInput = document.querySelector(
    `input[data-field="reps"][data-slot="${cssEscape(ex.slotId)}"][data-set="${index}"]`
  );
  if (repsInput) repsInput.placeholder = setRepsHint(ex, ex.sets[index]);
}

export function handleTodayChange(target) {
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
