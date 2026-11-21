import { Store, cleanCount, cleanPct } from "../store.js";
import { WEEKDAY_LABELS, formatDay, getDayWeekdayOffset, mesocycleStartWeekday } from "../schedule.js";
import { DEFAULT_INCREMENT_PCT } from "../progression.js";
import { App, cssEscape, emptyMesoState, escapeHtml, getExerciseMuscleGroup, icon, pageHeader, plural, renderCurrentView, renderExerciseOptionsGrouped, renderFormError, renderMuscleGroupSelect, renderMuscleTag } from "../ui.js";

export function renderProgram(container) {
  const meso = Store.getActiveMesocycle();
  if (!meso) { container.innerHTML = emptyMesoState(); return; }
  const sortedDays = [...meso.days].sort((a, b) => getDayWeekdayOffset(a) - getDayWeekdayOffset(b));
  const usedOffsets = new Set(meso.days.map((d) => getDayWeekdayOffset(d)));
  const availableOffsets = [0, 1, 2, 3, 4, 5, 6].filter((i) => !usedOffsets.has(i));

  container.innerHTML = `
    ${pageHeader(meso.name, [plural(meso.numWeeks, "week"), `starts ${formatDay(meso.startDate)}`])}
    ${sortedDays.length === 0 ? `<p class="muted intro">Add the days you train. Each day holds its exercises and repeats every week.</p>` : ""}
    ${sortedDays.map((day) => renderDayCard(meso, day)).join("")}
    <div class="add-exercise-area">
      ${App.ui.addDayOpen
        ? `<div class="inline-form">
             <p class="form-title">Add day</p>
             ${renderFormError()}
             <input type="text" data-role="new-day-name" placeholder="Day name (e.g. Push)" aria-label="Day name">
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
          <span class="muted">${weekday} · ${plural(sortedExercises.length, "exercise")}</span>
        </div>
        ${removeConfirm
          ? `<button class="btn small danger" data-action="confirm-remove-day" data-day="${day.id}">Remove day</button>
             <button class="btn small ghost" data-action="cancel-remove-day" data-day="${day.id}">Cancel</button>`
          : `<button class="icon-btn" data-action="open-remove-day" data-day="${day.id}" aria-label="Remove ${escapeHtml(day.name)}">${icon("trash")}</button>`}
      </div>
      ${sortedExercises.map((slot, i) => {
        const group = getExerciseMuscleGroup(slot.exerciseId);
        const groupStart = prevGroup !== null && group !== prevGroup;
        prevGroup = group;
        return renderSlotRow(day, slot, groupStart, i === 0, i === sortedExercises.length - 1);
      }).join("")}
      ${addExOpen
        ? renderAddSlotForm(day)
        : `<button class="btn small ghost" data-action="open-add-slot" data-day="${day.id}">${icon("plus")} Add exercise</button>`}
    </div>
  `;
}

export function renderSlotRow(day, slot, groupStart, isFirst, isLast) {
  const exercise = Store.getExercises().find((e) => e.id === slot.exerciseId);
  const name = escapeHtml(exercise ? exercise.name : "(unknown exercise)");
  const attrs = `data-day="${day.id}" data-slot="${slot.id}"`;
  return `<div class="slot-row ${groupStart ? "group-start" : ""}" ${attrs}>
    <div class="slot-top">
      <div class="slot-name">
        ${renderMuscleTag((exercise && exercise.muscleGroup) || "Other")}
        <span>${name}</span>
      </div>
      <div class="slot-actions">
        ${App.ui.removeSlotConfirm === slot.id
          ? `<button class="btn small danger" data-action="confirm-remove-slot" ${attrs}>Remove</button>
             <button class="btn small ghost" data-action="cancel-remove-slot" ${attrs}>Cancel</button>`
          : `<button class="icon-btn" data-action="move-slot-up" ${attrs} aria-label="Move ${name} up" ${isFirst ? "disabled" : ""}>${icon("up")}</button>
             <button class="icon-btn" data-action="move-slot-down" ${attrs} aria-label="Move ${name} down" ${isLast ? "disabled" : ""}>${icon("down")}</button>
             <button class="icon-btn" data-action="open-remove-slot" ${attrs} aria-label="Remove ${name}">${icon("trash")}</button>`}
      </div>
    </div>
    <div class="slot-fields">
      <label>Sets <input type="number" inputmode="numeric" min="1" max="99" value="${slot.targetSets}" data-role="slot-sets" ${attrs}></label>
      <label>Rep range
        <span class="rep-pair">
          <input type="number" inputmode="numeric" min="1" max="99" value="${slot.repRangeMin}" data-role="slot-rep-min" ${attrs} aria-label="Rep range minimum">–
          <input type="number" inputmode="numeric" min="1" max="99" value="${slot.repRangeMax}" data-role="slot-rep-max" ${attrs} aria-label="Rep range maximum">
        </span>
      </label>
      <label>+ % <input type="number" inputmode="decimal" step="0.5" min="0" max="50" value="${slot.weightIncrementPct ?? DEFAULT_INCREMENT_PCT}" data-role="slot-increment" ${attrs}></label>
    </div>
  </div>`;
}

export function renderAddSlotForm(day) {
  const attrs = `data-day="${day.id}"`;
  return `<div class="inline-form" ${attrs}>
    <p class="form-title">Add exercise</p>
    ${renderFormError()}
    <select data-role="new-slot-exercise" ${attrs} aria-label="Existing exercise">
      <option value="">Choose an exercise</option>
      ${renderExerciseOptionsGrouped(null)}
    </select>
    <input type="text" data-role="new-slot-name" ${attrs} placeholder="or name a new exercise" aria-label="New exercise name">
    <label>Muscle group of a new exercise ${renderMuscleGroupSelect("new-slot-group", attrs)}</label>
    <div class="form-row">
      <label>Sets <input type="number" inputmode="numeric" data-role="new-slot-sets" ${attrs} value="2" min="1"></label>
      <label>Rep min <input type="number" inputmode="numeric" data-role="new-slot-rep-min" ${attrs} value="5" min="1"></label>
      <label>Rep max <input type="number" inputmode="numeric" data-role="new-slot-rep-max" ${attrs} value="10" min="1"></label>
      <label>+ % <input type="number" inputmode="decimal" step="0.5" data-role="new-slot-increment" ${attrs} value="${DEFAULT_INCREMENT_PCT}"></label>
    </div>
    <div class="form-actions">
      <button class="btn small primary" data-action="confirm-add-slot" ${attrs}>Add</button>
      <button class="btn small ghost" data-action="cancel-add-slot" ${attrs}>Cancel</button>
    </div>
  </div>`;
}

export const SLOT_FIELD_MAP = { "slot-sets": "targetSets", "slot-rep-min": "repRangeMin", "slot-rep-max": "repRangeMax", "slot-increment": "weightIncrementPct" };

// Only one form or confirmation is open at a time.
function closePanels() {
  Object.assign(App.ui, { removeDayConfirm: null, removeSlotConfirm: null, addExerciseToDay: null, addDayOpen: false, formError: null });
}

export function handleProgramAction(action, btn, view) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return;
  const dayId = btn.dataset.day;
  const slotId = btn.dataset.slot;

  if (action === "open-remove-day") {
    closePanels();
    App.ui.removeDayConfirm = dayId;
  } else if (action === "confirm-remove-day") {
    Store.removeDay(meso.id, dayId);
    closePanels();
  } else if (action === "open-add-slot") {
    closePanels();
    App.ui.addExerciseToDay = dayId;
  } else if (action === "confirm-add-slot") {
    const field = (role) => view.querySelector(`[data-role="${role}"][data-day="${cssEscape(dayId)}"]`).value;
    const newName = field("new-slot-name").trim();
    const targetSets = cleanCount(field("new-slot-sets"));
    const repRangeMin = cleanCount(field("new-slot-rep-min"));
    const repRangeMax = Math.max(repRangeMin, cleanCount(field("new-slot-rep-max")));
    const weightIncrementPct = cleanPct(field("new-slot-increment"));
    const exercise = newName
      ? Store.addExercise(newName, field("new-slot-group"))
      : Store.getExercises().find((x) => x.id === field("new-slot-exercise"));
    if (!exercise) {
      App.ui.formError = "Choose an exercise or type a name for a new one.";
    } else {
      Store.addExerciseSlot(meso.id, dayId, { exerciseId: exercise.id, targetSets, repRangeMin, repRangeMax, weightIncrementPct });
      closePanels();
    }
  } else if (action === "move-slot-up" || action === "move-slot-down") {
    Store.reorderExerciseSlot(meso.id, dayId, slotId, action === "move-slot-up" ? -1 : 1);
  } else if (action === "open-remove-slot") {
    closePanels();
    App.ui.removeSlotConfirm = slotId;
  } else if (action === "confirm-remove-slot") {
    Store.removeExerciseSlot(meso.id, dayId, slotId);
    closePanels();
  } else if (action === "open-add-day") {
    closePanels();
    App.ui.addDayOpen = true;
  } else if (action === "confirm-add-day") {
    const name = view.querySelector('input[data-role="new-day-name"]').value.trim();
    const weekdaySelect = view.querySelector('select[data-role="new-day-weekday"]');
    if (!name) {
      App.ui.formError = "Give the day a name.";
    } else {
      Store.addDay(meso.id, name, Number(weekdaySelect.value));
      closePanels();
    }
  } else if (action.startsWith("cancel-")) {
    closePanels();
  }
  renderCurrentView();
}

export function handleProgramChange(target) {
  const meso = Store.getActiveMesocycle();
  if (!meso) return;
  const dayId = target.dataset.day, slotId = target.dataset.slot;
  const field = SLOT_FIELD_MAP[target.dataset.role];
  if (!field) return;
  // The inputs' min and max are only hints: an empty, zero, negative or
  // fractional value here would reach today's workout (0 sets, a broken rep
  // range).
  const value = field === "weightIncrementPct" ? cleanPct(target.value) : cleanCount(target.value);
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
