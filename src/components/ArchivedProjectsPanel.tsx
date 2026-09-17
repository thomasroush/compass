import { useApp } from '../store/useApp';
import { useAuth } from '../store/useAuth';
import { getArchivedProjects, isSharedProject } from '../store/reducer';

/**
 * Settings-only view of archived projects. Archiving hides a project from
 * ProjectsView, task-selection dropdowns, and project filters (see
 * `getVisibleProjects`/`getArchivedProjects` in `src/store/reducer.ts`), but
 * never deletes it — this panel is the one place to see and undo that,
 * via the same `UPDATE_PROJECT` pathway ProjectsView already uses. No
 * permanent deletion exists here or anywhere else yet.
 *
 * An archived shared Project (one this account can see only through
 * membership) can appear here too — RLS still lets an Editor select it, and
 * archiving doesn't hide a row from `listVisibleProjects`. Restoring it is
 * Owner-only in the database (see prevent_project_owner_change), so the
 * Restore control is hidden for it here, the same as every other
 * Owner-only status control in ProjectsView.
 */
export function ArchivedProjectsPanel() {
  const { state, dispatch } = useApp();
  const auth = useAuth();
  const accountId = auth.isSupabaseConfigured ? auth.user?.id : undefined;
  const archived = getArchivedProjects(state.projects).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  function restore(id: string) {
    dispatch({ type: 'UPDATE_PROJECT', id, status: 'active' });
  }

  return (
    <section className="section settings-section">
      <h2>Archived projects</h2>
      {archived.length === 0 ? (
        <p className="empty">No archived projects.</p>
      ) : (
        <ul className="project-list">
          {archived.map((project) => (
            <li key={project.id} className="project-card">
              <div className="project-card-header">
                <div>
                  <h2>{project.name}</h2>
                  {isSharedProject(project, accountId) && <span className="badge">Shared</span>}
                  {project.description && <p className="project-desc">{project.description}</p>}
                </div>
                <div className="project-actions">
                  {!isSharedProject(project, accountId) && (
                    <button type="button" className="secondary" onClick={() => restore(project.id)}>
                      Restore
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
