import { Store } from "../store.js";
import { MONTHS_SHORT } from "../schedule.js";
import { exercisePR, isCompleteSet } from "../progression.js";
import { App, escapeHtml, getExerciseMuscleGroup, icon, metaLine, pageHeader, plural, renderCurrentView, renderMuscleTag, renderPrBadge } from "../ui.js";

export function renderHistory(container) {
  const workouts = Store.getWorkouts()
    .filter((w) => w.finished)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const mesos = Store.getMesocycles();
  const all = Store.getWorkouts();

  if (workouts.length === 0) {
    container.innerHTML = `${pageHeader("History")}
      <div class="empty-state"><h2>No finished workouts yet</h2>
      <p class="muted">Finish a workout and it shows up here.</p></div>`;
    return;
  }

  container.innerHTML = `${pageHeader("History", `${plural(workouts.length, "workout")} logged`)}
  <div class="history-list">
    ${workouts.map((w) => {
      const meso = mesos.find((m) => m.id === w.mesocycleId);
      const open = App.ui.historyExpanded === w.id;
      const [year, month, day] = w.date.split("-").map(Number);
      const setCount = w.exercises.reduce((n, ex) => n + ex.sets.filter(isCompleteSet).length, 0);
      return `<div class="card history-entry">
        <button class="history-entry-header" data-action="toggle-workout" data-id="${w.id}" aria-expanded="${open}">
          <span class="date-badge"><span class="day">${day}</span><span class="mon">${MONTHS_SHORT[month - 1]}</span></span>
          <span class="history-entry-titles">
            <strong>${escapeHtml(w.dayName)}</strong>
            <span class="muted">${metaLine([plural(w.exercises.length, "exercise"), plural(setCount, "set")])}</span>
            <span class="muted">${metaLine([meso && meso.name, String(year)])}</span>
          </span>
          ${icon(open ? "up" : "down")}
        </button>
        ${open ? `<div class="history-detail">
          ${[...w.exercises].sort((a, b) => a.order - b.order).map((ex) => `
            <div class="history-exercise">
              <span>${renderMuscleTag(getExerciseMuscleGroup(ex.exerciseId, ex.exerciseName))} <span class="ex-title"><strong>${escapeHtml(ex.exerciseName)}</strong>${renderPrBadge(exercisePR(all, w, ex))}</span></span>
              <span class="set-chips">${ex.sets.map((s) => isCompleteSet(s) ? `<span class="set-chip">${s.weight}×${s.reps}</span>` : `<span class="set-chip empty">—</span>`).join("")}</span>
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
