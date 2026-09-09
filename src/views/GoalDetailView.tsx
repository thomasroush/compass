import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { getArchivedGoalTargets, getGoalProgress, getGoalTargets } from '../store/reducer';
import { GoalForm } from '../components/GoalForm';
import { ProgressBar } from '../components/ProgressBar';
import { TargetForm } from '../components/TargetForm';
import { TargetRow } from '../components/TargetRow';

export function GoalDetailView() {
  const { id } = useParams<{ id: string }>();
  const { state } = useApp();
  const [editingGoal, setEditingGoal] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const goal = state.goals.find((g) => g.id === id);

  const activeTargets = useMemo(
    () => (goal ? getGoalTargets(state.targets, goal.id) : []),
    [state.targets, goal],
  );
  const archivedTargets = useMemo(
    () => (goal ? getArchivedGoalTargets(state.targets, goal.id) : []),
    [state.targets, goal],
  );
  const progress = goal ? getGoalProgress(goal, state.targets, state.tasks) : null;
  const linkedProjects = goal ? state.projects.filter((p) => goal.projectIds.includes(p.id)) : [];

  if (!goal) {
    return (
      <div className="view">
        <p className="empty">This goal could not be found.</p>
        <Link to="/goals" className="secondary">
          &larr; Back to Goals
        </Link>
      </div>
    );
  }

  return (
    <div className="view">
      <header className="view-header view-header-row">
        <div>
          <p>
            <Link to="/goals">&larr; Goals</Link>
          </p>
          <h1>{goal.name}</h1>
          <div className="task-meta">
            <span className={`badge goal-${goal.status}`}>{goal.status}</span>
            {goal.priority !== 'Normal' && <span className="badge">{goal.priority}</span>}
            {goal.dueDate && <span className="meta-text">Due {goal.dueDate}</span>}
          </div>
        </div>
        <button type="button" className="secondary" onClick={() => setEditingGoal(true)}>
          Edit goal
        </button>
      </header>

      {goal.description && <p>{goal.description}</p>}

      <div className="section">
        <ProgressBar progress={progress} label={`${goal.name} overall progress`} />
      </div>

      <div className="section">
        <h2>Linked projects</h2>
        {linkedProjects.length === 0 ? (
          <p className="empty">No linked projects.</p>
        ) : (
          <div className="task-meta">
            {linkedProjects.map((p) => (
              <span key={p.id} className="badge">
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <header className="view-header-row">
          <h2>Targets</h2>
          <button type="button" onClick={() => setAddingTarget(true)}>
            Add target
          </button>
        </header>

        {activeTargets.length === 0 ? (
          <p className="empty">No targets yet.</p>
        ) : (
          <ul className="task-list">
            {activeTargets.map((target) => (
              <TargetRow key={target.id} target={target} goal={goal} />
            ))}
          </ul>
        )}

        {archivedTargets.length > 0 && (
          <div className="project-tasks">
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived targets ({archivedTargets.length})
            </label>
            {showArchived && (
              <ul className="task-list">
                {archivedTargets.map((target) => (
                  <TargetRow key={target.id} target={target} goal={goal} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {editingGoal && <GoalForm goal={goal} onClose={() => setEditingGoal(false)} />}
      {addingTarget && <TargetForm goal={goal} onClose={() => setAddingTarget(false)} />}
    </div>
  );
}
