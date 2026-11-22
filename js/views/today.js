import { Store, cleanCount, cleanSetValue, uid } from "../store.js";
import { WEEKDAY_LABELS, addDays, daysBetween, formatDay, formatShortDate, isoDate, jsDateToWeekdayIndex, parseLocalDate, plannedEndIso, resolveDayForDate, weekNumber } from "../schedule.js";
import { PROGRESSIONS, blankSet, exercisePR, hintReps, isCompleteSet, progressionOf } from "../progression.js";
import { App, PRESET_HELP, cssEscape, emptyMesoState, escapeHtml, findLibraryExercise, fmtNum, getExerciseMuscleGroup, icon, pageHeader, plural, renderCurrentView, renderExerciseOptionsGrouped, renderFormError, renderMuscleGroupSelect, renderMuscleTag, renderPrBadge, renderProgressionSelect } from "../ui.js";
import { buildEntrySets, doMissedDay, getExerciseHistory, getTodayContext, isTouchedSet, refreshPredictions, undoMissedDay } from "../workout.js";
import { renderLineChart } from "../chart.js";

// Dot colour for a day: green once finished, amber once anything is entered.
// Just opening a day generates its workout, so an untouched one is not "in
// progress" — it shows the plain training-day dot.
function workoutStatusClass(workout) {
  if (!workout) return "";
  if (workout.finished) return "finished";
  return workout.exercises.some((ex) => ex.sets.some(isTouchedSet)) ? "started" : "";
}

// The same status in words, for the strip's and the calendar's aria-labels
// (the dot alone is colour and shape only).
const STATUS_TEXT = { finished: "finished", started: "in progress" };

// The workouts the week strip and the calendar draw, by date. An untouched
// one is left out: it shows exactly as the schedule says anyway, and one left
// behind by a schedule change (start date edited, day removed) is dropped
// when its date is opened, so drawing it would show a day the Today screen
// calls a rest day.
function shownWorkoutsByDate(meso) {
  const byDate = {};
  Store.getWorkouts()
    .filter((w) => w.mesocycleId === meso.id && (w.finished || w.makeup || workoutStatusClass(w)))
    .forEach((w) => { byDate[w.date] = w; });
  return byDate;
}

// Screen header plus a Monday-to-Sunday strip of the viewed date's week: each
// day is a link (an ordinary route change), with the same status dot as the
// month calendar. Like the calendar it only reads workouts, never generates.
export function renderDateNav(meso, dateIso, isToday, title) {
  const date = parseLocalDate(dateIso);
  const todayIso = isoDate(new Date());
  const monday = addDays(date, -jsDateToWeekdayIndex(date));
  const workoutsByDate = shownWorkoutsByDate(meso);
  // Nothing stops the program at numWeeks, so past the plan it is just "Week n".
  const week = weekNumber(meso, date);
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
      ? `<a class="${classes}" href="#/today?date=${iso}" aria-label="${WEEKDAY_LABELS[i]}, ${formatShortDate(iso)}, ${trains ? STATUS_TEXT[workoutStatusClass(workout)] || "training day" : "rest day"}"${iso === dateIso ? ' aria-current="date"' : ""}>${inner}</a>`
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
  const workoutsByDate = shownWorkoutsByDate(meso);

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
  return `<a class="${classes}" href="#/today?date=${dateIso}" aria-label="${escapeHtml(what)}, ${formatShortDate(dateIso)}${isRest ? "" : `, ${STATUS_TEXT[workoutStatusClass(workout)] || "not started"}`}">
    <span class="cal-daynum">${date.getDate()}</span>
    ${!isRest ? `<span class="cal-dot"></span>` : ""}
  </a>`;
}

// Short notes above the workout for states that would otherwise be silent:
// the planned weeks are over (the program just keeps going), a workout kept
// after the schedule moved under it (see getTodayContext), an earlier workout
// left unfinished, and a missed workout just moved here (with its undo).
function renderNotices(meso, dayTemplate, workout, dateIso, isToday, madeUp) {
  const notes = [];
  if (isToday) {
    const unfinished = Store.getWorkouts()
      .filter((w) => w.mesocycleId === meso.id && w.date < dateIso && !w.finished && w.exercises.some((ex) => ex.sets.some(isTouchedSet)))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (unfinished) {
      notes.push(`${escapeHtml(unfinished.dayName)} on ${formatDay(unfinished.date)} is not finished. <a href="#/today?date=${unfinished.date}">Open it</a>`);
    }
  }
  const plannedEnd = plannedEndIso(meso);
  if (isToday && dateIso > plannedEnd) {
    notes.push(`The ${meso.numWeeks} planned weeks of this mesocycle ended ${formatShortDate(plannedEnd)}. Keep going, or <a href="#/settings">copy it in Settings</a> to start the next one.`);
  }
  // A makeup sits off its schedule on purpose: say why once it is under way
  // (while untouched, the "moved here" notice with Undo says it).
  const makeupLine = workout && workout.makeup && !madeUp ? `<p class="muted makeup-line">Makeup for ${formatDay(workout.makeupFor)}.</p>` : "";
  if (workout && !workout.makeup && (!dayTemplate || workout.dayId !== dayTemplate.id)) {
    notes.push("The schedule changed after this workout was started. It is kept as it was logged.");
  }
  let html = makeupLine + notes.map((note) => `<p class="notice">${note}</p>`).join("");
  if (madeUp && workout) {
    const moved = madeUp.shifted ? ` Later workouts moved ${plural(daysBetween(parseLocalDate(madeUp.dateIso), parseLocalDate(dateIso)), "day")}.` : "";
    html += `<div class="notice notice-action">
      <span>${escapeHtml(workout.dayName)} from ${formatDay(madeUp.dateIso)} moved here.${moved}</span>
      <button class="btn small" data-action="undo-missed">Undo</button>
    </div>`;
  }
  return html;
}

// A training day earlier in the week with nothing logged (findMissedDay):
// do it on the viewed date, either alone (a makeup on a rest day) or by
// shifting every later workout along. The checkbox is read when the button
// is pressed, like the scope radios.
function renderMissedCard(meso, missed, dateIso, isToday) {
  if (!missed) return "";
  const n = daysBetween(parseLocalDate(missed.dateIso), parseLocalDate(dateIso));
  const forced = !!resolveDayForDate(meso, parseLocalDate(dateIso));
  return `<div class="card missed-card">
    <p class="missed-title">Missed: ${escapeHtml(missed.dayTemplate.name)}</p>
    <p class="muted">${formatDay(missed.dateIso)}</p>
    <label class="check-row"><input type="checkbox" data-role="missed-shift" ${forced ? "checked disabled" : ""}> Shift mesocycle to fit</label>
    <p class="muted hint">${forced ? "This day already has a workout, so later workouts must move." : `Later workouts move ${plural(n, "day")}. Unticked, only this workout moves.`}</p>
    <button class="btn primary wide" data-action="do-missed">${isToday ? "Do it today" : `Do it on ${formatShortDate(dateIso)}`}</button>
  </div>`;
}

// Totals for a finished workout: complete sets, volume and PRs.
function renderSummary(workout, prs) {
  const sets = workout.exercises.flatMap((ex) => ex.sets.filter(isCompleteSet));
  const volume = Math.round(sets.reduce((sum, s) => sum + s.weight * s.reps, 0));
  const prCount = [...prs.values()].filter(Boolean).length;
  return `<div class="card summary-card">
    <div><strong>${sets.length}</strong><span class="muted">Sets</span></div>
    <div><strong>${volume.toLocaleString("en-US")}</strong><span class="muted">Volume (lb)</span></div>
    <div class="${prCount ? "has-pr" : ""}"><strong>${prCount}</strong><span class="muted">${prCount === 1 ? "PR" : "PRs"}</span></div>
  </div>`;
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
  const { meso, dayTemplate, workout, dateIso, isToday, missed, madeUp } = getTodayContext();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }
  const notices = renderNotices(meso, dayTemplate, workout, dateIso, isToday, madeUp) + renderMissedCard(meso, missed, dateIso, isToday);

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

  const all = workout.finished ? Store.getWorkouts() : null;
  const prs = new Map(workout.finished ? workout.exercises.map((ex) => [ex.slotId, exercisePR(all, workout, ex)]) : []);
  const exerciseGroups = sortedExercises.map((ex) => getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName));
  const exerciseBlocksHtml = sortedExercises.map((ex, i) => {
    const isGroupStart = i === 0 || exerciseGroups[i] !== exerciseGroups[i - 1];
    const isGroupEnd = i === exerciseGroups.length - 1 || exerciseGroups[i] !== exerciseGroups[i + 1];
    return renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd, i === 0, i === sortedExercises.length - 1, prs.get(ex.slotId));
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
        <span class="status-pill">${{ finished: "Finished", started: "In progress" }[workoutStatusClass(workout)] || "Not started"}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${allSets.length ? (100 * doneSets) / allSets.length : 0}%"></div></div>
    </div>
    ${workout.finished ? renderSummary(workout, prs) : ""}
    ${exerciseBlocksHtml}
    ${workout.exercises.length === 0 && !workout.finished ? `<p class="notice">No exercises on this day yet. Add one here, or add them to the day in <a href="#/program">Program</a>.</p>` : ""}
    ${!workout.finished ? `<div class="add-exercise-area">
      ${App.ui.addOpen ? renderAddExerciseForm() : `<button class="btn ghost wide" data-action="open-add-exercise">${icon("plus")} Add exercise</button>`}
    </div>` : ""}
    <div class="finish-area">
      ${workout.exercises.length === 0 && !workout.finished ? "" : workout.finished
        ? `<button class="btn secondary wide" data-action="reopen-workout">Reopen workout</button>`
        : App.ui.finishConfirm
          ? `<div class="inline-form">
              <p class="form-title">${blankSets} of ${plural(allSets.length, "set")} not complete</p>
              <p class="muted">A set needs both weight and reps. Incomplete sets are left out of history.</p>
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

export function renderExerciseBlock(workout, ex, isGroupStart, isGroupEnd, isFirst, isLast, pr = null) {
  const removeOpen = App.ui.removeOpen === ex.slotId;
  const subOpen = App.ui.substituteOpen === ex.slotId;
  const menuOpen = App.ui.menuOpen === ex.slotId && !workout.finished;
  const complete = ex.sets.length > 0 && ex.sets.every((s) => isSetDone(workout, s));
  const cardClass = [
    !isGroupStart ? "merge-top" : "", !isGroupEnd ? "merge-bottom" : "", complete ? "complete" : "",
  ].filter(Boolean).join(" ");
  const attrs = `data-slot="${ex.slotId}"`;
  const name = escapeHtml(ex.exerciseName);
  const lib = findLibraryExercise(ex.exerciseId, ex.exerciseName);
  const noteOpen = App.ui.noteOpen === ex.slotId && lib;
  return `
    <div class="card exercise ${cardClass}" ${attrs}>
      <div class="exercise-header">
        <div class="ex-name-group">
          ${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName))}
          <strong class="ex-name">${name}${complete ? `<span class="ex-done-mark" role="img" aria-label="completed">${icon("check")}</span>` : ""}${renderPrBadge(pr)}</strong>
          <span class="rep-range muted">${ex.sets.length} × ${ex.repRangeMin}–${ex.repRangeMax} reps</span>
          ${lib && lib.note ? `<span class="ex-note">${escapeHtml(lib.note)}</span>` : ""}
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
        ${lib ? `<button class="btn small" data-action="open-note" ${attrs}>${icon("edit")} Note</button>` : ""}
      </div>` : ""}
      ${removeOpen ? renderRemoveForm(ex) : ""}
      ${noteOpen ? renderNoteForm(ex, lib) : ""}
      ${subOpen ? renderSubstituteForm(ex) : ""}
      <div class="sets">
        <div class="set-row set-head muted"><span>Set</span><span>Weight (lb)</span><span>Reps</span><span></span></div>
        ${ex.sets.map((s, i) => {
          const done = isSetDone(workout, s);
          const locked = workout.finished || done ? "disabled" : "";
          return `
          <div class="set-row ${done ? "done" : ""}">
            <span class="set-num">${i + 1}</span>
            <input type="number" step="0.5" min="0" max="2000" inputmode="decimal" placeholder="${setWeightHint(s)}"
              data-field="weight" ${attrs} data-set="${i}" aria-label="Set ${i + 1} weight"
              value="${fmtNum(s.weight)}" ${locked}>
            <input type="number" step="1" min="0" max="999" inputmode="numeric" placeholder="${setRepsHint(ex, s)}"
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
// (see pctPerRep in progression.js). Needs at least two sessions. One point
// per date: a day with the exercise in two slots counts as one session. Only
// the latest 12 dates, so each point stays big enough to tap.
function renderProgressCharts(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const sets = r.sets.filter(isCompleteSet);
    if (sets.length) byDate.set(r.date, [...(byDate.get(r.date) || []), ...sets]);
  }
  const sessions = [...byDate]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 12)
    .reverse()
    .map(([date, sets]) => ({ label: formatShortDate(date), sets }));
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
            <span class="muted">${formatDay(r.date)} · <strong class="history-day">${escapeHtml(r.dayName)}</strong>${r.parts > 1 ? ` · ${r.part} of ${r.parts}` : ""}</span>
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

// The note lives on the library exercise, so it shows on every workout of it.
export function renderNoteForm(ex, lib) {
  const attrs = `data-slot="${ex.slotId}"`;
  return `<div class="inline-form" ${attrs}>
    <p class="form-title">Note for ${escapeHtml(lib.name)}</p>
    <input type="text" data-role="note-text" ${attrs} maxlength="200" value="${escapeHtml(lib.note || "")}" placeholder="e.g. Seat 4, grip just outside the rings" aria-label="Note">
    <p class="muted hint">Shows on every workout with this exercise. Clear it to remove.</p>
    <div class="form-actions">
      <button class="btn small primary" data-action="save-note" ${attrs}>Save</button>
      <button class="btn small ghost" data-action="cancel-note" ${attrs}>Cancel</button>
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
    </div>
    <label>Progression ${renderProgressionSelect("add-progression")}</label>
    ${PRESET_HELP}
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
    removeOpen: null, substituteOpen: null, noteOpen: null, addOpen: false, finishConfirm: false, formError: null,
  });
}

const NOTHING_CHOSEN = "Choose an exercise or type a name for a new one.";

export function handleTodayAction(action, btn, view) {
  const { meso, workout, dateIso } = getTodayContext();
  if (!meso) return;
  // These two work on a rest day too, where there is no workout yet.
  if (action === "do-missed" || action === "undo-missed") {
    if (action === "undo-missed") undoMissedDay(meso, dateIso);
    else {
      const box = view.querySelector('input[data-role="missed-shift"]');
      doMissedDay(meso, dateIso, isoDate(new Date()), !!(box && box.checked));
    }
    closePanels();
    renderCurrentView();
    return;
  }
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
    // Only today's workout is renumbered by reconciliation: a past one can
    // hold gapped or equal orders, and swapping two equal orders moves nothing.
    sorted.forEach((x, i) => { x.order = i; });
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
  } else if (action === "open-note") {
    closePanels();
    App.ui.noteOpen = slotId;
  } else if (action === "save-note") {
    const ex = workout.exercises.find((x) => x.slotId === slotId);
    const lib = ex && findLibraryExercise(ex.exerciseId, ex.exerciseName);
    const input = view.querySelector(`input[data-role="note-text"][data-slot="${cssEscape(slotId)}"]`);
    if (lib && input) Store.updateExercise(lib.id, { note: input.value });
    closePanels();
  } else if (action === "open-add-exercise") {
    closePanels();
    App.ui.addOpen = true;
  } else if (["cancel-remove", "cancel-substitute", "cancel-note", "cancel-add-exercise", "cancel-finish"].includes(action)) {
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
      const fresh = buildEntrySets(workout, { slotId, exerciseId: exercise.id, exerciseName: exercise.name, targetSets: ex.sets.length,
        repRangeMin: ex.repRangeMin, repRangeMax: ex.repRangeMax, progression: progressionOf(ex), order: ex.order });
      ex.sets.forEach((s, i) => {
        Object.assign(s, blankSet(i), { baseWeight: fresh[i].baseWeight, baseReps: fresh[i].baseReps });
      });
      // A one-off swap is flagged so reconciliation keeps it instead of
      // rebuilding the entry to the template slot's exercise.
      if (scope === "future") {
        Store.updateExerciseSlot(meso.id, workout.dayId, slotId, { exerciseId: exercise.id });
        delete ex.swapped;
      } else ex.swapped = true;
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
    const picked = view.querySelector('select[data-role="add-progression"]').value;
    const progression = PROGRESSIONS.includes(picked) ? picked : progressionOf({});
    const scope = view.querySelector('input[name="add-scope"]:checked').value;
    const exercise = newName ? Store.addExercise(newName, newGroup) : Store.getExercises().find((x) => x.id === select.value);
    if (!exercise) {
      App.ui.formError = NOTHING_CHOSEN;
    } else {
      // slot is null when the workout's day is no longer in the program
      // (see getTodayContext) — the add then stays on this workout only.
      const slot = scope === "future"
        ? Store.addExerciseSlot(meso.id, workout.dayId, { exerciseId: exercise.id, targetSets, repRangeMin, repRangeMax, progression })
        : null;
      const newSlotId = slot ? slot.id : uid();
      // After the highest order, not the count: a removal leaves a gap.
      const order = Math.max(-1, ...workout.exercises.map((x) => x.order)) + 1;
      workout.exercises.push({
        slotId: newSlotId, exerciseId: exercise.id, exerciseName: exercise.name,
        order, repRangeMin, repRangeMax, progression,
        // Predicted from the exercise's history, like a substitute's sets.
        sets: buildEntrySets(workout, { slotId: newSlotId, exerciseId: exercise.id, exerciseName: exercise.name, targetSets,
          repRangeMin, repRangeMax, progression, order }),
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
    else {
      Store.finishWorkout(workout.id);
      // Later unfinished workouts were predicted without this one.
      refreshPredictions();
    }
  } else if (action === "reopen-workout") {
    // A finished workout shows every complete set as done (isSetDone), even
    // ones never ticked (e.g. finished before the checkbox existed) — persist
    // that on reopen so the sets don't suddenly read as unticked/unlocked.
    workout.exercises.forEach((ex) => ex.sets.forEach((s) => {
      if (isCompleteSet(s)) s.done = true;
    }));
    Store.updateWorkout(workout.id, { finished: false, finishedAt: null, exercises: workout.exercises });
    refreshPredictions();
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
// reps hint becomes the estimated rep target at that weight (hintReps): held
// to the rep range, widened to take in the predicted reps, which nextSet puts
// outside the range on purpose (one rep past the top when the step is too
// big, logged reps + 1 after a missed set). So at the predicted weight the
// hint is the prediction, and a tick saves what the placeholder showed.
export function setWeightHint(s) {
  return s.baseWeight ?? "wt";
}

export function setRepsHint(ex, s) {
  if (s.weight != null) {
    const estimate = hintReps(s.baseWeight, s.baseReps, s.weight, ex.repRangeMin, ex.repRangeMax);
    if (estimate != null) return estimate;
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
    // The reps hint as the placeholder showed it, read before the weight is filled.
    const repsHint = setRepsHint(ex, set);
    if (set.weight == null && set.baseWeight != null) set.weight = set.baseWeight;
    if (set.reps == null && typeof repsHint === "number") set.reps = repsHint;
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
  set[field] = cleanSetValue(field, target.value);
  // A refused entry (negative, 7.5 reps, absurd) clears from the box, as text
  // does; a valid one is left as typed so focus and "22.50" stay untouched.
  if (set[field] == null && target.value !== "") target.value = "";
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
