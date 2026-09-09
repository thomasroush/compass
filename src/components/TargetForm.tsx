import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/useApp';
import { getActiveTasks } from '../store/reducer';
import { TARGET_TYPES, type Goal, type Target, type TargetType, type TargetValueFormat } from '../types';

interface TargetFormProps {
  goal: Goal;
  target?: Target;
  onClose: () => void;
}

const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  numeric: 'Numeric',
  yesno: 'Yes/No',
  'linked-tasks': 'Linked tasks',
};

/**
 * Type is chosen once at creation and is not editable afterward (mirrors
 * TaskForm/GoalForm's dialog shell). A straightforward checkbox list with an
 * optional plain-text filter is used for linked-tasks — no search library or
 * advanced picker component, per instruction.
 */
export function TargetForm({ goal, target, onClose }: TargetFormProps) {
  const { state, dispatch } = useApp();
  const isNew = !target;

  const [name, setName] = useState(target?.name ?? '');
  const [targetType, setTargetType] = useState<TargetType>(target?.type ?? 'numeric');

  const [startValue, setStartValue] = useState(target?.type === 'numeric' ? String(target.startValue) : '0');
  const [currentValue, setCurrentValue] = useState(
    target?.type === 'numeric' ? String(target.currentValue) : '0',
  );
  const [targetValue, setTargetValue] = useState(
    target?.type === 'numeric' ? String(target.targetValue) : '100',
  );
  const [valueFormat, setValueFormat] = useState<TargetValueFormat>(
    target?.type === 'numeric' ? target.valueFormat : 'number',
  );
  const [unit, setUnit] = useState(target?.type === 'numeric' ? (target.unit ?? '') : '');

  const [achieved, setAchieved] = useState(target?.type === 'yesno' ? target.achieved : false);

  const [taskIds, setTaskIds] = useState<string[]>(target?.type === 'linked-tasks' ? target.taskIds : []);
  const [taskFilter, setTaskFilter] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const availableTasks = useMemo(() => {
    const active = getActiveTasks(state.tasks);
    const filter = taskFilter.trim().toLowerCase();
    return filter ? active.filter((t) => t.title.toLowerCase().includes(filter)) : active;
  }, [state.tasks, taskFilter]);

  function toggleTask(taskId: string, checked: boolean) {
    setTaskIds((prev) => (checked ? [...prev, taskId] : prev.filter((id) => id !== taskId)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (isNew) {
      if (targetType === 'numeric') {
        dispatch({
          type: 'ADD_TARGET',
          goalId: goal.id,
          targetType: 'numeric',
          name: trimmed,
          startValue: Number(startValue) || 0,
          currentValue: Number(currentValue) || 0,
          targetValue: Number(targetValue) || 0,
          unit: valueFormat === 'number' ? unit.trim() || undefined : undefined,
          valueFormat,
        });
      } else if (targetType === 'yesno') {
        dispatch({ type: 'ADD_TARGET', goalId: goal.id, targetType: 'yesno', name: trimmed, achieved });
      } else {
        dispatch({ type: 'ADD_TARGET', goalId: goal.id, targetType: 'linked-tasks', name: trimmed, taskIds });
      }
    } else if (target.type === 'numeric') {
      dispatch({
        type: 'UPDATE_TARGET',
        id: target.id,
        updates: {
          name: trimmed,
          startValue: Number(startValue) || 0,
          currentValue: Number(currentValue) || 0,
          targetValue: Number(targetValue) || 0,
          unit: valueFormat === 'number' ? unit.trim() || undefined : undefined,
          valueFormat,
        },
      });
    } else if (target.type === 'yesno') {
      dispatch({ type: 'UPDATE_TARGET', id: target.id, updates: { name: trimmed, achieved } });
    } else {
      dispatch({ type: 'UPDATE_TARGET', id: target.id, updates: { name: trimmed, taskIds } });
    }
    onClose();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="target-form-title">{isNew ? 'New target' : 'Edit target'}</h2>
        <form onSubmit={handleSubmit} className="stack-form">
          <div className="field">
            <label htmlFor="target-name">Name</label>
            <input
              id="target-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {isNew ? (
            <fieldset className="copy-ai-scope-fieldset">
              <legend>Type</legend>
              {TARGET_TYPES.map((t) => (
                <label key={t} className="copy-ai-scope-option">
                  <input
                    type="radio"
                    name="target-type"
                    value={t}
                    checked={targetType === t}
                    onChange={() => setTargetType(t)}
                  />
                  {TARGET_TYPE_LABELS[t]}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="meta-text">Type: {TARGET_TYPE_LABELS[target.type]}</p>
          )}

          {targetType === 'numeric' && (
            <>
              <div className="field">
                <label htmlFor="target-start">Starting value</label>
                <input
                  id="target-start"
                  type="number"
                  value={startValue}
                  onChange={(e) => setStartValue(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="target-current">Current value</label>
                <input
                  id="target-current"
                  type="number"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="target-target">Target value</label>
                <input
                  id="target-target"
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="target-format">Display</label>
                <select
                  id="target-format"
                  value={valueFormat}
                  onChange={(e) => setValueFormat(e.target.value as TargetValueFormat)}
                >
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                </select>
              </div>
              {valueFormat === 'number' && (
                <div className="field">
                  <label htmlFor="target-unit">Unit (optional)</label>
                  <input
                    id="target-unit"
                    type="text"
                    placeholder="e.g. lb, opportunities"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {targetType === 'yesno' && (
            <label className="field checkbox-field">
              <input type="checkbox" checked={achieved} onChange={(e) => setAchieved(e.target.checked)} />
              Achieved
            </label>
          )}

          {targetType === 'linked-tasks' && (
            <div className="field">
              <label htmlFor="target-task-filter">Linked tasks</label>
              <input
                id="target-task-filter"
                type="text"
                placeholder="Filter tasks…"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              />
              {availableTasks.length === 0 ? (
                <p className="section-help">No tasks match.</p>
              ) : (
                <div className="checkbox-list">
                  {availableTasks.map((t) => (
                    <label key={t.id} className="field checkbox-field">
                      <input
                        type="checkbox"
                        checked={taskIds.includes(t.id)}
                        onChange={(e) => toggleTask(t.id, e.target.checked)}
                      />
                      {t.title}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{isNew ? 'Add target' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
