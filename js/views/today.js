import { Store, cleanCount, cleanPct, uid } from "../store.js";
import { WEEKDAY_LABELS, addDays, daysBetween, formatDay, formatShortDate, isoDate, jsDateToWeekdayIndex, parseLocalDate, resolveDayForDate } from "../schedule.js";
import { DEFAULT_INCREMENT_PCT, blankSet, buildPrefilledSets, equivalentReps, isCompleteSet } from "../progression.js";
import { App, cssEscape, emptyMesoState, escapeHtml, fmtNum, getExerciseMuscleGroup, icon, pageHeader, plural, renderCurrentView, renderExerciseOptionsGrouped, renderFormError, renderMuscleGroupSelect, renderMuscleTag } from "../ui.js";
import { getExerciseHistory, getTodayContext, isTouchedSet } from "../workout.js";
import { renderLineChart } from "../chart.js";

// Dot colour for a day: green once finished, amber once anything is entered.
// Just opening a day generates its workout, so an untouched one is not "in
// progress" — it shows the plain training-day dot.
function workoutStatusClass(workout) {
  if (!workout) return "";
  if (workout.finished) return "finished";
  return workout.exercises.some((ex) => ex.sets.some(isTouchedSet)) ? "started" : "";
}

function plannedEndIso(meso) {
  return isoDate(addDays(parseLocalDate(meso.startDate), meso.numWeeks * 7 - 1));
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
  // Nothing stops the program at numWeeks, so past the plan it is just "Week n".
  const week = Math.floor(daysBetween(parseLocalDate(meso.startDate), date) / 7) + 1;
  const weekText = dateIso < meso.startDate ? "" : week <= meso.numWeeks ? `Week ${week} of ${meso.numWeeks}` : `Week ${week}`;
  // Short weekday: the line has to fit beside the Today button.
  const subtitle = [formatDay(dateIso), weekText];

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
      ? `<a class="${classes}" href="#/today?date=${iso}" aria-label="${WEEKDAY_LABELS[i]}, ${formatShortDate(iso)}"${iso === dateIso ? ' aria-current="date"' : ""}>${inner}</a>`
      : `<span class="${classes} outside">${inner}</span>`;
  }).join("");

  const prevWeekIso = isoDate(addDays(date, -7));
  const canGoPrev = isoDate(addDays(monday, -1)) >= meso.startDate;
  return `${pageHeader(title, subtitle, `
    ${!isToday ? `<a class="btn small ghost" href="#/today">Today</a>` : ""}
    <button class="icon-btn ${App.ui.calendarOpen ? "active" : ""}" data-action="toggle-calendar" aria-label="Month calendar" aria-expanded="${!!App.ui.calendarOpen}">${icon("calendar")}</button>`)}
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
// instances, just reads existing fah_workouts for status. It pages back to
// the start month and forward without limit: the program keeps scheduling
// past numWeeks, so there is no last month to stop at.
export function renderCalendarPanel(meso, selectedIso) {
  const todayIso = isoDate(new Date());
  const workoutsByDate = {};
  Store.getWorkouts()
    .filter((w) => w.mesocycleId === meso.id)
    .forEach((w) => { workoutsByDate[w.date] = w; });

  const firstMonth = meso.startDate.slice(0, 7);
  let month = App.ui.calendarMonth || selectedIso.slice(0, 7);
  if (month < firstMonth) month = firstMonth;

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
    return `<button class="icon-btn" data-action="calendar-month" data-month="${iso}" aria-label="${name} month" ${iso < firstMonth ? "disabled" : ""}>${icon(label)}</button>`;
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
  const what = workout ? workout.dayName : dayTemplate ? dayTemplate.name : "Rest day";
  return `<a class="${classes}" href="#/today?date=${dateIso}" aria-label="${escapeHtml(what)}, ${formatShortDate(dateIso)}">
    <span class="cal-daynum">${date.getDate()}</span>
    ${!isRest ? `<span class="cal-dot"></span>` : ""}
  </a>`;
}

// Short notes above the workout for the two states that would otherwise be
// silent: the planned weeks are over (the program just keeps going), and a
// workout kept after the schedule moved under it (see getTodayContext).
function renderNotices(meso, dayTemplate, workout, dateIso, isToday) {
  const notes = [];
  const plannedEnd = plannedEndIso(meso);
  if (isToday && dateIso > plannedEnd) {
    notes.push(`The ${meso.numWeeks} planned weeks of this mesocycle ended ${formatShortDate(plannedEnd)}. Keep going, or <a href="#/settings">copy it in Settings</a> to start the next one.`);
  }
  if (workout && (!dayTemplate || workout.dayId !== dayTemplate.id)) {
    notes.push("The schedule changed after this workout was started. It is kept as it was logged.");
  }
  return notes.map((note) => `<p class="notice">${note}</p>`).join("");
}

// What a future training day will hold, from the day template (nothing is
// generated until the day arrives).
function renderPlanPreview(dayTemplate) {
  const slots = [...dayTemplate.exercises].sort((a, b) => a.order - b.order);
  if (slots.length === 0) return "";
  const library = Store.getExercises();
  return `<div class="card">
    ${slots.map((slot) => {
      const exercise = library.find((e) => e.id === slot.exerciseId);
      return `<div class="preview-row">
        <span class="slot-name">${renderMuscleTag((exercise && exercise.muscleGroup) || "Other")}<span>${escapeHtml(exercise ? exercise.name : "(unknown exercise)")}</span></span>
        <span class="muted">${slot.targetSets} × ${slot.repRangeMin}–${slot.repRangeMax}</span>
      </div>`;
    }).join("")}
  </div>`;
}

export function renderToday(container) {
  const { meso, dayTemplate, workout, dateIso, isToday } = getTodayContext();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }
  const notices = renderNotices(meso, dayTemplate, workout, dateIso, isToday);

  if (!dayTemplate && !workout) {
    const noDays = meso.days.length === 0;
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday, noDays ? meso.name : "Rest day")}
      ${notices}
      <div class="empty-state">
        <h2>${noDays ? "No training days yet" : "Nothing scheduled"}</h2>
        <p class="muted">${noDays ? "Add the days you train and their exercises." : dateIso < meso.startDate ? "This is before the mesocycle starts." : "Rest and recover."}</p>
        ${noDays ? `<a href="#/program" class="btn primary">Set up in Program</a>` : ""}
      </div>`;
    return;
  }

  if (!workout) {
    container.innerHTML = `
      ${renderDateNav(meso, dateIso, isToday, dayTemplate.name)}
      ${notices}
      <p class="section-label">Planned · opens on its day</p>
      ${renderPlanPreview(dayTemplate) || `<div class="empty-state"><p class="muted">No exercises in this day yet.</p></div>`}`;
    return;
  }

  const sortedExercises = [...workout.exercises].sort((a, b) => a.order - b.order);
  const historyEx = App.ui.historyOpen ? workout.exercises.find((e) => e.slotId === App.ui.historyOpen) : null;

  const exerciseGroups = sortedExercises.map((ex) => getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName));
  const exerciseBlocksHtml = sortedExercises.map((ex, i) => {
    const isGroupStart = i === 0 || exerciseGroups[i] !== exerciseGroups[i - 1];
    const isGroupEnd = i === exerciseGroups.length - 1 || exerciseGroups[i] !== exerciseGroups[i + 1];
    return renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd, i === 0, i === sortedExercises.length - 1);
  }).join("");

  const allSets = workout.exercises.flatMap((ex) => ex.sets);
  const doneSets = allSets.filter((s) => isSetDone(workout, s)).length;
  const blankSets = allSets.filter((s) => !isCompleteSet(s)).length;

  container.innerHTML = `
    ${renderDateNav(meso, dateIso, isToday, workout.dayName)}
    ${notices}
    <div class="progress-card ${workout.finished ? "finished" : ""}">
      <div class="progress-text">
        <span class="progress-count"><strong>${doneSets}</strong> / ${plural(allSets.length, "set")}</span>
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
        : App.ui.finishConfirm
          ? `<div class="inline-form">
              <p class="form-title">${blankSets} of ${allSets.length} sets have no weight and reps</p>
              <p class="muted">They are saved blank and left out of history.</p>
              <div class="form-actions">
                <button class="btn small primary" data-action="confirm-finish">Finish anyway</button>
                <button class="btn small ghost" data-action="cancel-finish">Keep going</button>
              </div>
            </div>`
          : `<button class="btn primary wide" data-action="finish-workout">Finish workout</button>`}
    </div>
  `;
  document.getElementById("overlay-root").innerHTML = historyEx ? renderHistorySheet(historyEx) : "";
}

export function renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd, isFirst, isLast) {
  const removeOpen = App.ui.removeOpen === ex.slotId;
  const subOpen = App.ui.substituteOpen === ex.slotId;
  const menuOpen = App.ui.menuOpen === ex.slotId && !workout.finished;
  const complete = ex.sets.length > 0 && ex.sets.every((s) => isSetDone(workout, s));
  const cardClass = [
    !isGroupStart ? "merge-top" : "", !isGroupEnd ? "merge-bottom" : "", complete ? "complete" : "",
  ].filter(Boolean).join(" ");
  const attrs = `data-slot="${ex.slotId}"`;
  const name = escapeHtml(ex.exerciseName);
  return `
    <div class="card exercise ${cardClass}" ${attrs}>
      <div class="exercise-header">
        <div class="ex-name-group">
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName))}
          <strong class="ex-name">${name}${complete ? `<span class="ex-done-mark" role="img" aria-label="completed">${icon("check")}</span>` : ""}</strong>
          <span class="rep-range muted">${ex.sets.length} × ${ex.repRangeMin}–${ex.repRangeMax} reps</span>
        </div>
        <div class="exercise-actions">
          <button class="icon-btn" data-action="open-history" ${attrs} aria-label="History of ${name}">${icon("history")}</button>
          ${!workout.finished ? `<button class="icon-btn ${menuOpen ? "active" : ""}" data-action="toggle-menu" ${attrs} aria-label="More actions for ${name}" aria-expanded="${menuOpen}">${icon("more")}</button>` : ""}
        </div>
      </div>
      ${menuOpen ? `<div class="exercise-menu">
        <button class="btn small" data-action="open-substitute" ${attrs}>${icon("swap")} Swap</button>
        <button class="btn small" data-action="open-remove" ${attrs}>${icon("trash")} Remove</button>
        <button class="btn small" data-action="move-up" ${attrs} ${isFirst ? "disabled" : ""}>${icon("up")} Up</button>
        <button class="btn small" data-action="move-down" ${attrs} ${isLast ? "disabled" : ""}>${icon("down")} Down</button>
      </div>` : ""}
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
              data-field="weight" ${attrs} data-set="${i}" aria-label="Set ${i + 1} weight"
              value="${fmtNum(s.weight)}" ${locked}>
            <input type="number" inputmode="numeric" placeholder="${setRepsHint(ex, s)}"
              data-field="reps" ${attrs} data-set="${i}" aria-label="Set ${i + 1} reps"
              value="${fmtNum(s.reps)}" ${locked}>
            <input type="checkbox" class="set-check" data-role="set-done"
              ${attrs} data-set="${i}" aria-label="Set ${i + 1} done"
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
    .map((r) => ({ label: formatShortDate(r.date), sets: r.sets.filter(isCompleteSet) }))
    .filter((r) => r.sets.length > 0)
    .reverse();
  if (sessions.length < 2) return "";
  return `<div class="charts">
    ${renderLineChart("Top set", "lb", sessions.map((r) => ({ label: r.label, value: Math.max(...r.sets.map((s) => s.weight)) })))}
    ${renderLineChart("Volume", "lb", sessions.map((r) => ({ label: r.label, value: r.sets.reduce((sum, s) => sum + s.weight * s.reps, 0) })))}
  </div>`;
}

// data-action="" on the sheet itself is a click shield: a click inside the
// sheet resolves to it (not to the backdrop's close-history behind it), and
// handleGlobalClick ignores an empty action.
export function renderHistorySheet(ex) {
  const rows = getExerciseHistory(ex.slotId, ex.exerciseId, ex.exerciseName);
  return `<div class="history-sheet-backdrop" data-action="close-history">
    <div class="history-sheet" data-action="" role="dialog" aria-modal="true" aria-label="${escapeHtml(ex.exerciseName)} history">
      <div class="history-sheet-header">
        <div>
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName))}
          <h2>${escapeHtml(ex.exerciseName)}</h2>
        </div>
        <button class="icon-btn" data-action="close-history" aria-label="Close">${icon("close")}</button>
      </div>
      ${renderProgressCharts(rows)}
      ${rows.length === 0
        ? `<p class="muted">No history yet.</p>`
        : rows.map((r) => `<div class="history-row">
            <span class="muted">${formatDay(r.date)} · ${escapeHtml(r.dayName)}</span>
            <span class="set-chips">${r.sets.map((s) => isCompleteSet(s) ? `<span class="set-chip">${s.weight}×${s.reps}</span>` : `<span class="set-chip empty">—</span>`).join("")}</span>
          </div>`).join("")}
    </div>
  </div>`;
}

export function renderRemoveForm(ex) {
  return `<div class="inline-form" data-slot="${ex.slotId}">
    <p class="form-title">Remove ${escapeHtml(ex.exerciseName)}?</p>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="remove-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button class="btn small danger" data-action="confirm-remove" data-slot="${ex.slotId}">Remove</button>
      <button class="btn small ghost" data-action="cancel-remove" data-slot="${ex.slotId}">Cancel</button>
    </div>
  </div>`;
}

// A swap stays inside the exercise's muscle group (so the day keeps its
// shape): pick one of that group's other exercises or name a new one, which
// is created in the same group.
export function renderSubstituteForm(ex) {
  const group = getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName);
  const options = renderExerciseOptionsGrouped(ex.exerciseId, group).trim();
  const attrs = `data-slot="${ex.slotId}"`;
  return `<div class="inline-form" ${attrs}>
    <p class="form-title">Swap ${escapeHtml(ex.exerciseName)} for another ${escapeHtml(group)} exercise</p>
    ${ex.sets.some(isTouchedSet) ? `<p class="warn-text">Sets already entered for ${escapeHtml(ex.exerciseName)} will be cleared.</p>` : ""}
    ${renderFormError()}
    ${options
      ? `<select data-role="sub-exercise-select" ${attrs} aria-label="Existing ${escapeHtml(group)} exercise">
          <option value="">Choose an exercise</option>
          ${options}
        </select>`
      : `<p class="muted">No other ${escapeHtml(group)} exercises yet. Name a new one:</p>`}
    <input type="text" data-role="sub-new-name" ${attrs} placeholder="${options ? "or name a new exercise" : "New exercise name"}" aria-label="New exercise name">
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="workout" checked> This workout only</label>
    <label><input type="radio" name="sub-scope-${ex.slotId}" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button class="btn small primary" data-action="confirm-substitute" ${attrs}>Swap</button>
      <button class="btn small ghost" data-action="cancel-substitute" ${attrs}>Cancel</button>
    </div>
  </div>`;
}

export function renderAddExerciseForm() {
  return `<div class="inline-form">
    <p class="form-title">Add exercise</p>
    ${renderFormError()}
    <select data-role="add-exercise-select" aria-label="Existing exercise">
      <option value="">Choose an exercise</option>
      ${renderExerciseOptionsGrouped(null)}
    </select>
    <input type="text" data-role="add-new-name" placeholder="or name a new exercise" aria-label="New exercise name">
    <label>Muscle group of a new exercise ${renderMuscleGroupSelect("add-new-group")}</label>
    <div class="form-row">
      <label>Sets <input type="number" inputmode="numeric" data-role="add-sets" value="2" min="1"></label>
      <label>Rep min <input type="number" inputmode="numeric" data-role="add-rep-min" value="5" min="1"></label>
      <label>Rep max <input type="number" inputmode="numeric" data-role="add-rep-max" value="10" min="1"></label>
      <label>+ % <input type="number" inputmode="decimal" step="0.5" data-role="add-increment" value="${DEFAULT_INCREMENT_PCT}"></label>
    </div>
    <label><input type="radio" name="add-scope" value="workout" checked> This workout only</label>
    <label><input type="radio" name="add-scope" value="future"> All future workouts of this day</label>
    <div class="form-actions">
      <button class="btn small primary" data-action="confirm-add-exercise">Add</button>
      <button class="btn small ghost" data-action="cancel-add-exercise">Cancel</button>
    </div>
  </div>`;
}

// Only one panel is open at a time: the calendar, the history sheet, one
// exercise's menu or form, the add form, or the finish confirmation.
function closePanels() {
  Object.assign(App.ui, {
    calendarOpen: false, calendarMonth: null, historyOpen: null, menuOpen: null,
    removeOpen: null, substituteOpen: null, addOpen: false, finishConfirm: false, formError: null,
  });
}

const NOTHING_CHOSEN = "Choose an exercise or type a name for a new one.";

export function handleTodayAction(action, btn, view) {
  const { meso, workout } = getTodayContext();
  if (!meso) return;
  if (action === "toggle-calendar") {
    const open = !App.ui.calendarOpen;
    closePanels();
    App.ui.calendarOpen = open;
    renderCurrentView();
    return;
  }
  if (action === "calendar-month") {
    App.ui.calendarMonth = btn.dataset.month;
    renderCurrentView();
    return;
  }
  if (action === "close-history") {
    const slot = App.ui.historyOpen;
    closePanels();
    renderCurrentView();
    // Focus goes back to the button that opened the sheet.
    const opener = slot && document.querySelector(`[data-action="open-history"][data-slot="${cssEscape(slot)}"]`);
    if (opener) opener.focus();
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
  } else if (action === "toggle-menu") {
    const open = App.ui.menuOpen !== slotId;
    closePanels();
    App.ui.menuOpen = open ? slotId : null;
  } else if (action === "open-history") {
    closePanels();
    App.ui.historyOpen = slotId;
  } else if (action === "open-remove") {
    closePanels();
    App.ui.removeOpen = slotId;
  } else if (action === "open-substitute") {
    closePanels();
    App.ui.substituteOpen = slotId;
  } else if (action === "open-add-exercise") {
    closePanels();
    App.ui.addOpen = true;
  } else if (["cancel-remove", "cancel-substitute", "cancel-add-exercise", "cancel-finish"].includes(action)) {
    closePanels();
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
    closePanels();
  } else if (action === "confirm-substitute") {
    const ex = workout.exercises.find((x) => x.slotId === slotId);
    const select = view.querySelector(`select[data-role="sub-exercise-select"][data-slot="${cssEscape(slotId)}"]`);
    const newName = view.querySelector(`input[data-role="sub-new-name"][data-slot="${cssEscape(slotId)}"]`).value.trim();
    const scope = view.querySelector(`input[name="sub-scope-${cssEscape(slotId)}"]:checked`).value;
    const exercise = newName
      ? Store.addExercise(newName, getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName))
      : Store.getExercises().find((x) => select && x.id === select.value);
    if (!exercise) {
      App.ui.formError = NOTHING_CHOSEN;
    } else {
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
      closePanels();
    }
  } else if (action === "confirm-add-exercise") {
    const select = view.querySelector('select[data-role="add-exercise-select"]');
    const newName = view.querySelector('input[data-role="add-new-name"]').value.trim();
    const newGroup = view.querySelector('select[data-role="add-new-group"]').value;
    const targetSets = cleanCount(view.querySelector('input[data-role="add-sets"]').value);
    const repRangeMin = cleanCount(view.querySelector('input[data-role="add-rep-min"]').value);
    const repRangeMax = Math.max(repRangeMin, cleanCount(view.querySelector('input[data-role="add-rep-max"]').value));
    const weightIncrementPct = cleanPct(view.querySelector('input[data-role="add-increment"]').value);
    const scope = view.querySelector('input[name="add-scope"]:checked').value;
    const exercise = newName ? Store.addExercise(newName, newGroup) : Store.getExercises().find((x) => x.id === select.value);
    if (!exercise) {
      App.ui.formError = NOTHING_CHOSEN;
    } else {
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
      closePanels();
    }
  } else if (action === "finish-workout" || action === "confirm-finish") {
    // A set without weight and reps is saved blank and skipped by history
    // and predictions, so finishing with some left asks first. A set that is
    // filled in but not ticked is complete and needs no question.
    const blank = workout.exercises.some((ex) => ex.sets.some((s) => !isCompleteSet(s)));
    closePanels();
    if (blank && action === "finish-workout") App.ui.finishConfirm = true;
    else Store.finishWorkout(workout.id);
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
  if (action === "open-history") {
    const close = document.querySelector("#overlay-root .history-sheet .icon-btn");
    if (close) close.focus();
  }
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
  App.ui.finishConfirm = false;
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
  const previousWeight = set.weight;
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
  // keeps following later edits — including being cleared again when this
  // weight is cleared; reps are never carried, only re-hinted.
  if (field === "weight") {
    ex.sets.forEach((s, i) => {
      if (i === setIndex || s.isLogged || s.done || s.baseWeight !== set.baseWeight) return;
      if (set.weight == null && s.weight !== previousWeight) return;
      s.weight = set.weight;
      const otherInput = document.querySelector(
        `input[data-field="weight"][data-slot="${cssEscape(slotId)}"][data-set="${i}"]`
      );
      if (otherInput) otherInput.value = fmtNum(set.weight);
      refreshRepsHint(ex, i);
    });
    refreshRepsHint(ex, setIndex);
  }

  Store.updateWorkout(workout.id, { exercises: workout.exercises });
  // No renderCurrentView() here: a full re-render would replace the input
  // DOM nodes out from under the user's next click/tab while filling in a
  // table of set rows, silently dropping focus (and whatever they typed
  // next).
}
