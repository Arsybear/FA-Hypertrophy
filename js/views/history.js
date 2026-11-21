import { Store } from "../store.js";
import { isCompleteSet } from "../progression.js";
import { App, escapeHtml, getExerciseMuscleGroup, renderCurrentView, renderMuscleTag } from "../ui.js";

export function renderHistory(container) {
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

export function handleHistoryAction(action, btn) {
  if (action === "toggle-workout") {
    const id = btn.dataset.id;
    App.ui.historyExpanded = App.ui.historyExpanded === id ? null : id;
    renderCurrentView();
  }
}
