import { useMemo, useState } from 'react';
import { useApp } from '../store/useApp';
import { buildAISnapshot, type CopyToAIScope } from '../ai/aiSnapshot';

interface CopyToAIDialogProps {
  onClose: () => void;
}

type CopyState = 'idle' | 'success' | 'error';

export function CopyToAIDialog({ onClose }: CopyToAIDialogProps) {
  const { state } = useApp();
  const [scopeType, setScopeType] = useState<CopyToAIScope['type']>('current-work');
  const [projectId, setProjectId] = useState('');
  const [copyState, setCopyState] = useState<CopyState>('idle');

  // Fixed for the life of this dialog session, so the preview never changes
  // out from under a user reading it, and repeated renders stay deterministic.
  const [generatedAt] = useState(() => new Date());

  const activeProjects = state.projects.filter((p) => p.status === 'active');

  const scope: CopyToAIScope = useMemo(() => {
    if (scopeType === 'project') return { type: 'project', projectId };
    return { type: scopeType };
  }, [scopeType, projectId]);

  const previewText = useMemo(
    () => buildAISnapshot(state.projects, state.tasks, state.goals, state.targets, scope, generatedAt),
    [state.projects, state.tasks, state.goals, state.targets, scope, generatedAt],
  );

  function changeScope(next: CopyToAIScope['type']) {
    setScopeType(next);
    setCopyState('idle');
    if (next === 'project' && !projectId && activeProjects.length > 0) {
      setProjectId(activeProjects[0].id);
    }
  }

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(previewText);
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
  }

  const copyDisabled = scope.type === 'project' && !projectId;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog copy-ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-to-ai-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="copy-ai-header">
          <h2 id="copy-to-ai-title">Copy to AI</h2>
          <p className="subtitle">
            Copy a plain-text summary of your tasks to paste into an AI assistant you already use.
          </p>
        </div>

        <div className="copy-ai-body">
          <div className="copy-ai-controls">
            <fieldset className="field copy-ai-scope-fieldset">
              <legend>Scope</legend>
              <label className="copy-ai-scope-option">
                <input
                  type="radio"
                  name="copy-ai-scope"
                  value="current-work"
                  checked={scopeType === 'current-work'}
                  onChange={() => changeScope('current-work')}
                />
                Current work
              </label>
              <label className="copy-ai-scope-option">
                <input
                  type="radio"
                  name="copy-ai-scope"
                  value="today"
                  checked={scopeType === 'today'}
                  onChange={() => changeScope('today')}
                />
                Today
              </label>
              <label className="copy-ai-scope-option">
                <input
                  type="radio"
                  name="copy-ai-scope"
                  value="project"
                  checked={scopeType === 'project'}
                  onChange={() => changeScope('project')}
                />
                One project
              </label>
            </fieldset>

            {scopeType === 'project' && (
              <div className="field">
                <label htmlFor="copy-ai-project">Project</label>
                <select
                  id="copy-ai-project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setCopyState('idle');
                  }}
                >
                  <option value="">Select a project</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {activeProjects.length === 0 && (
                  <p className="section-help">No active projects are available to copy.</p>
                )}
              </div>
            )}

            <p className="section-help">
              Only the text shown here is copied. Compass does not send it anywhere.
            </p>

            {copyState === 'success' && (
              <p className="message" role="status">
                Copied to clipboard.
              </p>
            )}
            {copyState === 'error' && (
              <p className="message error" role="alert">
                Couldn&rsquo;t copy automatically. Select the text above and copy it manually.
              </p>
            )}
          </div>

          <div className="field copy-ai-preview-pane">
            <label htmlFor="copy-ai-preview">Preview</label>
            <textarea
              id="copy-ai-preview"
              className="copy-ai-preview"
              value={previewText}
              readOnly
              rows={10}
            />
          </div>
        </div>

        <div className="dialog-actions copy-ai-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleCopy} disabled={copyDisabled}>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
