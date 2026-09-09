import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { getGoalProgress, getGoalTargets, getTargetProgress, getVisibleGoals } from '../store/reducer';
import { GoalForm } from '../components/GoalForm';
import { ProgressBar } from '../components/ProgressBar';

export function GoalsView() {
  const { state } = useApp();
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [creating, setCreating] = useState(false);

  const goals = useMemo(
    () => (showAbandoned ? state.goals : getVisibleGoals(state.goals)),
    [state.goals, showAbandoned],
  );

  return (
    <div className="view">
      <header className="view-header view-header-row">
        <div>
          <h1>Goals</h1>
          <p className="subtitle">Track outcomes with measurable Targets.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)}>
          New goal
        </button>
      </header>

      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={showAbandoned}
          onChange={(e) => setShowAbandoned(e.target.checked)}
        />
        Show abandoned goals
      </label>

      {goals.length === 0 ? (
        <p className="empty">No goals yet.</p>
      ) : (
        <ul className="project-list">
          {goals.map((goal) => {
            const activeTargets = getGoalTargets(state.targets, goal.id);
            const completedCount = activeTargets.filter(
              (t) => getTargetProgress(t, state.tasks) === 100,
            ).length;
            const progress = getGoalProgress(goal, state.targets, state.tasks);
            const linkedProjects = state.projects.filter((p) => goal.projectIds.includes(p.id));

            return (
              <li key={goal.id} className="project-card">
                <div className="project-card-header">
                  <div>
                    <h2>
                      <Link to={`/goals/${goal.id}`}>{goal.name}</Link>
                    </h2>
                    <div className="task-meta">
                      <span className={`badge goal-${goal.status}`}>{goal.status}</span>
                      {goal.priority !== 'Normal' && <span className="badge">{goal.priority}</span>}
                      {goal.dueDate && <span className="meta-text">Due {goal.dueDate}</span>}
                    </div>
                    <ProgressBar progress={progress} label={`${goal.name} progress`} />
                    <p className="meta-text">
                      {completedCount} of {activeTargets.length} targets complete
                    </p>
                    {linkedProjects.length > 0 && (
                      <div className="task-meta">
                        {linkedProjects.map((p) => (
                          <span key={p.id} className="badge">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <GoalForm onClose={() => setCreating(false)} />}
    </div>
  );
}
