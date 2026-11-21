import { Store } from "../store.js";
import { WEEKDAY_LABELS, isoDate, jsDateToWeekdayIndex, mesocycleStartWeekday, parseLocalDate } from "../schedule.js";
import { App, cleanCount, escapeHtml, renderCurrentView, renderMuscleTag, icon, pageHeader } from "../ui.js";
import { handleTodayChange } from "./today.js";

export function renderSettings(container) {
  const mesos = Store.getMesocycles().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const active = mesos.find((m) => m.active);
  const exercises = Store.getExercises().sort((a, b) => a.name.localeCompare(b.name));
  // An exercise a program still uses can't be removed: its slots would turn
  // into "(unknown exercise)". Take it out of the program first.
  const inUse = new Set(mesos.flatMap((m) => m.days.flatMap((d) => d.exercises.map((slot) => slot.exerciseId))));

  container.innerHTML = `
    ${pageHeader("Settings")}
    ${App.updateAvailable ? `
      <div class="card update-banner">
        <p>A new version of this app is available.</p>
        <button class="btn small primary" data-action="reload-app">Refresh now</button>
      </div>
    ` : ""}
    <h3>Mesocycles</h3>
    ${mesos.length === 0 ? `<p class="muted">No mesocycles yet.</p>` : `
      <div class="meso-list">
        ${mesos.map((m) => `
          <div class="card meso-item ${m.active ? "active-meso" : ""}">
            <div>
              <strong>${escapeHtml(m.name)}</strong>
              <span class="muted">${m.numWeeks}wk · starts ${m.startDate}</span>
            </div>
            ${m.active ? `<span class="badge">Active</span>` : `<button class="btn small" data-action="switch-active" data-id="${m.id}">Make active</button>`}
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

    <h3>Create new mesocycle</h3>
    <div class="card">
      <label>Name <input type="text" data-role="new-meso-name" placeholder="e.g. Meso 1"></label>
      <label>Weeks <input type="number" min="1" value="6" data-role="new-meso-weeks"></label>
      <label>Start date <input type="date" data-role="new-meso-start-date" value="${isoDate(new Date())}"></label>
      <p class="muted">Falls on a <span data-role="new-meso-start-weekday-hint">${WEEKDAY_LABELS[jsDateToWeekdayIndex(new Date())]}</span> — day 1 of the program always starts there.</p>
      <button class="btn primary wide" data-action="create-meso">Create mesocycle</button>
    </div>

    <h3>Exercise library</h3>
    ${exercises.length === 0 ? `<p class="muted">No exercises yet.</p>` : `
      <div class="meso-list">
        ${exercises.map((ex) => `
          <div class="card meso-item">
            <div>
              ${renderMuscleTag(ex.muscleGroup || "Other")}
              <strong>${escapeHtml(ex.name)}</strong>
            </div>
            ${inUse.has(ex.id) ? `<span class="muted">In a program</span>` : App.ui.removeExerciseOpen === ex.id
              ? `<span class="form-actions"><button class="btn small danger" data-action="confirm-remove-exercise" data-id="${ex.id}">Remove</button>
                 <button class="btn small ghost" data-action="cancel-remove-exercise" data-id="${ex.id}">Cancel</button></span>`
              : `<button class="icon-btn" data-action="open-remove-exercise" data-id="${ex.id}" aria-label="Remove ${escapeHtml(ex.name)}">${icon("trash")}</button>`}
          </div>`).join("")}
      </div>
    `}
  `;
}

export const MESO_EDIT_FIELD_MAP = {
  "edit-name": ["name", (v) => v],
  "edit-weeks": ["numWeeks", cleanCount],
  "edit-start-date": ["startDate", (v) => v],
};

export function handleSettingsAction(action, btn, view) {
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
export function updateStartWeekdayHint(dateInput, hintDataRole) {
  if (!dateInput.value) return;
  const weekday = jsDateToWeekdayIndex(parseLocalDate(dateInput.value));
  const hint = document.querySelector(`[data-role="${hintDataRole}"]`);
  if (hint) hint.textContent = WEEKDAY_LABELS[weekday];
}

export function handleSettingsChange(target) {
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
