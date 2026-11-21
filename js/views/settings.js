import { APP_VERSION } from "../version.js";
import { Store, cleanCount, validateBackup } from "../store.js";
import { WEEKDAY_LABELS, formatDay, isoDate, jsDateToWeekdayIndex, mesocycleStartWeekday, parseLocalDate } from "../schedule.js";
import { App, escapeHtml, icon, pageHeader, plural, renderCurrentView, renderMuscleTag } from "../ui.js";

// One line under a mesocycle's name in the list.
function mesoSummary(m) {
  return `${plural(m.numWeeks, "week")} · starts ${formatDay(m.startDate)}`;
}

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
              <span class="muted">${mesoSummary(m)}</span>
            </div>
            <span class="form-actions">
              ${m.active ? `<span class="badge">Active</span>` : `<button class="btn small" data-action="switch-active" data-id="${m.id}">Make active</button>`}
              <button class="btn small ghost" data-action="copy-meso" data-id="${m.id}" aria-label="Copy ${escapeHtml(m.name)}">Copy</button>
            </span>
          </div>`).join("")}
      </div>
    `}

    ${active ? `
      <h3 data-role="edit-heading">Edit "${escapeHtml(active.name)}"</h3>
      <div class="card">
        <label>Name <input type="text" data-role="edit-name" value="${escapeHtml(active.name)}"></label>
        <label>Weeks <input type="number" inputmode="numeric" min="1" max="99" data-role="edit-weeks" value="${active.numWeeks}"></label>
        <label>Start date <input type="date" data-role="edit-start-date" value="${active.startDate}"></label>
        <p class="muted">Falls on a <span data-role="edit-start-weekday-hint">${WEEKDAY_LABELS[mesocycleStartWeekday(active)]}</span> — day 1 of the program always starts there.</p>
      </div>
    ` : ""}

    <h3>Create new mesocycle</h3>
    <div class="card">
      <label>Name <input type="text" data-role="new-meso-name" placeholder="e.g. Meso 1"></label>
      <label>Weeks <input type="number" inputmode="numeric" min="1" max="99" value="6" data-role="new-meso-weeks"></label>
      <label>Start date <input type="date" data-role="new-meso-start-date" value="${isoDate(new Date())}"></label>
      <p class="muted">Falls on a <span data-role="new-meso-start-weekday-hint">${WEEKDAY_LABELS[jsDateToWeekdayIndex(new Date())]}</span> — day 1 of the program always starts there.</p>
      <button class="btn primary wide" data-action="create-meso">Create mesocycle</button>
    </div>

    <h3>Backup</h3>
    <div class="card">
      <p class="muted">Everything is stored only in this browser. Export a backup file now and then; clearing site data or losing the phone erases it.</p>
      ${App.ui.backupMessage ? `<p class="${App.ui.backupError ? "warn-text" : "ok-text"}">${escapeHtml(App.ui.backupMessage)}</p>` : ""}
      ${App.pendingImport ? `
        <div class="inline-form">
          <p><strong>Replace all current data?</strong></p>
          <p class="muted">Now: ${plural(Store.getMesocycles().length, "mesocycle")}, ${plural(Store.getWorkouts().length, "workout")}.<br>
          Backup${backupDate(App.pendingImport)}: ${plural(App.pendingImport.mesocycles.length, "mesocycle")}, ${plural(App.pendingImport.workouts.length, "workout")}.</p>
          <div class="form-actions">
            <button class="btn small danger" data-action="confirm-import">Replace</button>
            <button class="btn small ghost" data-action="cancel-import">Cancel</button>
          </div>
        </div>` : `
        <div class="form-actions">
          <button class="btn small primary" data-action="export-backup">Export backup</button>
          <label class="btn small file-btn">Import backup<input type="file" accept=".json,application/json" data-role="import-file"></label>
        </div>`}
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
    <p class="about muted">FA Hypertrophy · version ${APP_VERSION}</p>
  `;
}

// " from Sat, Nov 21" for the import confirmation; exportedAt is outside
// input, so anything that is not a date is left out.
function backupDate(backup) {
  const day = String(backup.exportedAt || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && isoDate(parseLocalDate(day)) === day ? ` from ${formatDay(day)}` : "";
}

// Hands the backup to the user as a file. An installed iOS app cannot
// download, so where the share sheet takes files that is used instead
// ("Save to Files").
async function exportBackup() {
  const name = `fa-hypertrophy-backup-${isoDate(new Date())}.json`;
  const file = new File([JSON.stringify(Store.exportBackup())], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A picked backup file is only validated here; nothing is written until the
// inline "Replace" confirmation (App.pendingImport survives navigation,
// App.ui does not).
export async function handleImportFile(input) {
  let data = null;
  try { data = JSON.parse(await input.files[0].text()); } catch (e) { /* not JSON: validateBackup rejects null */ }
  const error = validateBackup(data);
  App.pendingImport = error ? null : data;
  App.ui.backupMessage = error;
  App.ui.backupError = !!error;
  renderCurrentView();
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
  if (action === "export-backup") {
    exportBackup();
    return;
  }
  if (action === "switch-active") {
    Store.setActiveMesocycle(btn.dataset.id);
  } else if (action === "copy-meso") {
    Store.cloneMesocycle(btn.dataset.id, isoDate(new Date()));
  } else if (action === "confirm-import") {
    const imported = Store.importBackup(App.pendingImport);
    App.pendingImport = null;
    App.ui.backupMessage = imported ? "Backup imported." : "Not enough storage space for this backup. Nothing was changed.";
    App.ui.backupError = !imported;
  } else if (action === "cancel-import") {
    App.pendingImport = null;
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
  // handleTodayChange). Patch what shows the edited values in place: the
  // mesocycle's line in the list, its Copy button's label and the heading.
  const updated = Store.getActiveMesocycle();
  const item = document.querySelector(".meso-item.active-meso");
  if (item) {
    item.querySelector("strong").textContent = updated.name;
    item.querySelector(".muted").textContent = mesoSummary(updated);
    item.querySelector('[data-action="copy-meso"]').setAttribute("aria-label", `Copy ${updated.name}`);
  }
  const heading = document.querySelector('[data-role="edit-heading"]');
  if (heading) heading.textContent = `Edit "${updated.name}"`;
}
