import { FormEvent, useState } from 'react';
import { useApp } from '../store/useApp';
import { getProjectTasks, getVisibleProjects } from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Project, ProjectStatus } from '../types';

export function ProjectsView() {
  const { state, dispatch } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [archiving, setArchiving] = useState<Project | null>(null);

  const sorted = getVisibleProjects(state.projects).sort((a, b) => a.name.localeCompare(b.name));

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch({ type: 'ADD_PROJECT', name, description });
    setName('');
    setDescription('');
  }

  function startEdit(project: Project) {
    setEditing(project);
    setEditName(project.name);
    setEditDescription(project.description ?? '');
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editName.trim()) return;
    dispatch({
      type: 'UPDATE_PROJECT',
      id: editing.id,
      name: editName,
      description: editDescription,
    });
    setEditing(null);
  }

  function setStatus(id: string, status: ProjectStatus) {
    dispatch({ type: 'UPDATE_PROJECT', id, status });
  }

  function confirmArchive() {
    if (!archiving) return;
    setStatus(archiving.id, 'archived');
    if (expandedId === archiving.id) setExpandedId(null);
    setArchiving(null);
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Projects</h1>
        <p className="subtitle">Group related tasks under projects.</p>
      </header>

      <form className="inline-form" onSubmit={handleAdd}>
        <div className="field">
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="project-desc">Description</label>
          <input
            id="project-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button type="submit">Add project</button>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">No projects yet.</p>
      ) : (
        <ul className="project-list">
          {sorted.map((project) => {
            const tasks = getProjectTasks(state.tasks, project.id);
            const expanded = expandedId === project.id;

            return (
              <li key={project.id} className="project-card">
                <div className="project-card-header">
                  <div>
                    <h2>{project.name}</h2>
                    <span className="badge">{project.status}</span>
                    {project.description && (
                      <p className="project-desc">{project.description}</p>
                    )}
                    <p className="meta-text">{tasks.length} active task(s)</p>
                  </div>
                  <div className="project-actions">
                    <button type="button" className="secondary" onClick={() => startEdit(project)}>
                      Edit
                    </button>
                    {project.status === 'active' && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setStatus(project.id, 'completed')}
                      >
                        Mark completed
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setArchiving(project)}
                    >
                      Archive
                    </button>
                    {project.status !== 'active' && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setStatus(project.id, 'active')}
                      >
                        Mark active
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setExpandedId(expanded ? null : project.id)}
                    >
                      {expanded ? 'Hide tasks' : 'Show tasks'}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="project-tasks">
                    {tasks.length === 0 ? (
                      <p className="empty">No active tasks for this project.</p>
                    ) : (
                      <ul className="task-list">
                        {tasks.map((task) => (
                          <li key={task.id}>
                            <TaskRow task={task} compact />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit project</h2>
            <form onSubmit={saveEdit} className="stack-form">
              <div className="field">
                <label htmlFor="edit-project-name">Name</label>
                <input
                  id="edit-project-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="edit-project-desc">Description</label>
                <input
                  id="edit-project-desc"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={archiving !== null}
        title="Archive project"
        message={`Archive "${archiving?.name}"? It will be hidden from projects and task selection, but its data is kept and it can be restored from Settings.`}
        confirmLabel="Archive"
        onConfirm={confirmArchive}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
