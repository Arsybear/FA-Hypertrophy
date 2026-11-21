import { Store } from "../store.js";
import { WEEKDAY_LABELS, getDayWeekdayOffset, mesocycleStartWeekday } from "../schedule.js";
import { DEFAULT_INCREMENT_PCT } from "../progression.js";
import { App, cleanCount, cssEscape, emptyMesoState, escapeHtml, getExerciseMuscleGroup, renderCurrentView, renderExerciseOptionsGrouped, renderMuscleGroupSelect, renderMuscleTag, icon, pageHeader } from "../ui.js";
import { handleTodayChange } from "./today.js";

export function renderProgram(container) {
  const meso = Store.getActiveMesocycle();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }
  const sortedDays = [...meso.days].sort((a, b) => getDayWeekdayOffset(a) - getDayWeekdayOffset(b));
  const usedOffsets = new Set(meso.days.map((d) => getDayWeekdayOffset(d)));
  const availableOffsets = [0, 1, 2, 3, 4, 5, 6].filter((i) => !usedOffsets.has(i));

  container.innerHTML = `
    ${pageHeader(meso.name, `${meso.numWeeks} weeks · starts ${WEEKDAY_LABELS[mesocycleStartWeekday(meso)]} ${meso.startDate}`)}
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
               <button class="btn small primary" data-action="confirm-add-day">Add day</button>
               <button class="btn small ghost" data-action="cancel-add-day">Cancel</button>
             </div>
           </div>`
        : availableOffsets.length === 0
          ? `<p class="muted">No more days can be added — every weekday is already scheduled.</p>`
          : `<button class="btn ghost wide" data-action="open-add-day">${icon("plus")} Add day</button>`}
    </div>
  `;
}

export function renderDayCard(meso, day) {
  const weekday = WEEKDAY_LABELS[(mesocycleStartWeekday(meso) + getDayWeekdayOffset(day)) % 7];
  const sortedExercises = [...day.exercises].sort((a, b) => a.order - b.order);
  const removeConfirm = App.ui.removeDayConfirm === day.id;
  const addExOpen = App.ui.addExerciseToDay === day.id;
  let prevGroup = null;
  return `
    <div class="card day-card" data-day="${day.id}">
      <div class="day-header">
        <div class="day-titles">
          <h2>${escapeHtml(day.name)}</h2>
          <span class="muted">${weekday} · ${sortedExercises.length} exercise${sortedExercises.length === 1 ? "" : "s"}</span>
        </div>
        ${removeConfirm
          ? `<button class="btn small danger" data-action="confirm-remove-day" data-day="${day.id}">Remove</button>
             <button class="btn small ghost" data-action="cancel-remove-day" data-day="${day.id}">Cancel</button>`
          : `<button class="icon-btn" data-action="open-remove-day" data-day="${day.id}" aria-label="Remove day">${icon("trash")}</button>`}
      </div>
      ${sortedExercises.map((slot) => {
        const group = getExerciseMuscleGroup(slot.exerciseId);
        const groupStart = prevGroup !== null && group !== prevGroup;
        prevGroup = group;
        return renderSlotRow(day, slot, groupStart);
      }).join("")}
      ${addExOpen
        ? renderAddSlotForm(day)
        : `<button class="btn small ghost" data-action="open-add-slot" data-day="${day.id}">${icon("plus")} Add exercise</button>`}
    </div>
  `;
}

export function renderSlotRow(day, slot, groupStart) {
  const exercise = Store.getExercises().find((e) => e.id === slot.exerciseId);
  const attrs = `data-day="${day.id}" data-slot="${slot.id}"`;
  return `<div class="slot-row ${groupStart ? "group-start" : ""}" ${attrs}>
    <div class="slot-top">
      <div class="slot-name">
        ${renderMuscleTag((exercise && exercise.muscleGroup) || "Other")}
        <span>${escapeHtml(exercise ? exercise.name : "(unknown)")}</span>
      </div>
      <div class="slot-actions">
        <button class="icon-btn" data-action="move-slot-up" ${attrs} aria-label="Move up">${icon("up")}</button>
        <button class="icon-btn" data-action="move-slot-down" ${attrs} aria-label="Move down">${icon("down")}</button>
        <button class="icon-btn" data-action="remove-slot" ${attrs} aria-label="Remove exercise">${icon("trash")}</button>
      </div>
    </div>
    <div class="slot-fields">
      <label>Sets <input type="number" inputmode="numeric" min="1" value="${slot.targetSets}" data-role="slot-sets" ${attrs}></label>
      <label>Rep range
        <span class="rep-pair">
          <input type="number" inputmode="numeric" min="1" value="${slot.repRangeMin}" data-role="slot-rep-min" ${attrs} aria-label="Rep range minimum">–
          <input type="number" inputmode="numeric" min="1" value="${slot.repRangeMax}" data-role="slot-rep-max" ${attrs} aria-label="Rep range maximum">
        </span>
      </label>
      <label>+ % <input type="number" inputmode="decimal" step="0.5" value="${slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT}" data-role="slot-increment" ${attrs}></label>
    </div>
  </div>`;
}

export function renderAddSlotForm(day) {
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
      <button class="btn small primary" data-action="confirm-add-slot" data-day="${day.id}">Add</button>
      <button class="btn small ghost" data-action="cancel-add-slot" data-day="${day.id}">Cancel</button>
    </div>
  </div>`;
}

export const SLOT_FIELD_MAP = { "slot-sets": "targetSets", "slot-rep-min": "repRangeMin", "slot-rep-max": "repRangeMax", "slot-increment": "weightIncrementPct" };

export function handleProgramAction(action, btn, view) {
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

export function handleProgramChange(target) {
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
    const otherInput = target.closest(".slot-row").querySelector(`input[data-role="${other[1]}"]`);
    if (otherInput) otherInput.value = value;
  }
  Store.updateExerciseSlot(meso.id, dayId, slotId, updates);
  // No renderCurrentView(): see the comment in handleTodayChange — this
  // table has the same rapid-tab-through-inputs pattern.
}
