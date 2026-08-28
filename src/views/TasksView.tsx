import { useMemo, useState } from 'react';
import { useApp } from '../store/useApp';
import { TaskForm } from '../components/TaskForm';
import { TaskRow } from '../components/TaskRow';
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '../types';

export function TasksView() {
  const { state } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.tasks
      .filter((t) => (showArchived ? t.archived : !t.archived))
      .filter((t) => statusFilter === 'all' || t.status === statusFilter)
      .filter((t) => priorityFilter === 'all' || t.priority === priorityFilter)
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => {
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          (t.notes?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state.tasks, search, statusFilter, priorityFilter, projectFilter, showArchived]);

  return (
    <div className="view">
      <header className="view-header view-header-row">
        <div>
          <h1>Tasks</h1>
          <p className="subtitle">Search, filter, and manage all tasks.</p>
        </div>
        <button type="button" onClick={() => setShowNewForm(true)}>
          New task
        </button>
      </header>

      <div className="filters">
        <div className="field">
          <label htmlFor="task-search">Search</label>
          <input
            id="task-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or notes"
          />
        </div>

        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select
            id="filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
          >
            <option value="all">All</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-priority">Priority</label>
          <select
            id="filter-priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
          >
            <option value="all">All</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-project">Project</label>
          <select
            id="filter-project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field checkbox-field">
          <label htmlFor="show-archived">
            <input
              id="show-archived"
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">No tasks match your filters.</p>
      ) : (
        <ul className="task-list">
          {filtered.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} showPrimaryToggle={task.status === 'Today'} />
            </li>
          ))}
        </ul>
      )}

      {showNewForm && <TaskForm onClose={() => setShowNewForm(false)} />}
    </div>
  );
}
