import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { ConfirmDialog } from './ConfirmDialog';
import {
  createInvitation,
  listInvitationsForProject,
  normalizeInvitationEmail,
  revokeInvitation,
} from '../repository/projectInvitationsRepository';
import { listMembers, removeMember } from '../repository/projectMembersRepository';
import type { ProjectInvitation, ProjectMember } from '../repository/types';
import type { Project } from '../types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ManageSharingDialogProps {
  project: Project;
  /** The Owner's own account id — always the caller of this dialog, verified by the parent view; never derived from the Project itself. */
  accountId: string;
  onClose: () => void;
}

/**
 * Owner-only sharing management for one Project: invite a collaborator by
 * email, see and revoke that Project's pending invitations, and see and
 * remove its current collaborators. Invitations and memberships are loaded
 * directly from their repositories (never from `useApp()`'s AppData — see
 * PendingInvitationsPanel's matching doc comment) and simply re-loaded after
 * every successful action here, rather than optimistically patched — this
 * dialog's own list is the only thing that needs to reflect the change
 * immediately; nothing else in the app reads invitation/membership data.
 */
export function ManageSharingDialog({ project, accountId, onClose }: ManageSharingDialogProps) {
  const auth = useAuth();
  const ownEmail = auth.isSupabaseConfigured ? auth.user?.email : undefined;

  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);

  /**
   * Deliberately has no "is this still mounted" guard. React 18 already
   * makes a `setState` call on an unmounted component a silent no-op (no
   * warning, no error) — there is nothing left to protect against here, and
   * a `useRef` flag flipped by a *separate*, mount-only effect is actively
   * unsafe: React 18 `StrictMode` (enabled in `main.tsx`) runs every effect
   * through mount → cleanup → mount again in development, and refs are not
   * reset by that simulated remount (only effects are). A ref-based guard
   * would have its cleanup fire once, permanently flip the ref, and then
   * silently discard every result this function ever loads for the rest of
   * the component's real lifetime — every section stuck on "Loading…"
   * forever. That was a real, previously-shipped bug this comment replaces.
   */
  async function loadLists() {
    setListsLoaded(false);
    try {
      const [invitationsResult, membersResult] = await Promise.all([
        listInvitationsForProject(project.id),
        listMembers(project.id),
      ]);

      if (invitationsResult.ok) setInvitations(invitationsResult.data);
      if (membersResult.ok) setMembers(membersResult.data);

      if (!invitationsResult.ok) {
        setListError(invitationsResult.error.message);
      } else if (!membersResult.ok) {
        setListError(membersResult.error.message);
      } else {
        setListError(null);
      }
    } catch (thrown) {
      // A repository function is expected to resolve with a typed
      // `{ ok: false }` result, never throw — this catch exists only so an
      // unexpected rejection (e.g. a genuine network-level failure) still
      // ends the loading state and shows a message, rather than leaving both
      // sections on "Loading…" forever.
      setListError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setListsLoaded(true);
    }
  }

  useEffect(() => {
    void loadLists();
    // project.id only — accountId is stable for the lifetime of this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setInviteError('Enter a valid email address.');
      return;
    }
    const normalized = normalizeInvitationEmail(trimmed);
    if (ownEmail && normalized === normalizeInvitationEmail(ownEmail)) {
      setInviteError('You cannot invite your own email address.');
      return;
    }

    setInviting(true);
    const result = await createInvitation(project.id, trimmed, accountId);
    setInviting(false);

    if (!result.ok) {
      setInviteError(
        result.error.type === 'duplicate'
          ? 'This person already has a pending invitation to this Project.'
          : result.error.message,
      );
      return;
    }

    setEmail('');
    await loadLists();
  }

  async function handleRevoke(invitationId: string) {
    setBusyId(invitationId);
    const result = await revokeInvitation(invitationId, accountId);
    setBusyId(null);
    if (!result.ok) {
      setListError(result.error.message);
      return;
    }
    await loadLists();
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyId(removing.memberId);
    const result = await removeMember(project.id, removing.memberId, accountId);
    setBusyId(null);
    setRemoving(null);
    if (!result.ok) {
      setListError(result.error.message);
      return;
    }
    await loadLists();
  }

  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');

  return (
    <>
      {/* ConfirmDialog is rendered as a sibling below, not nested inside this
          backdrop — nesting it would make a click meant only to dismiss the
          confirmation bubble up through this backdrop's own onClick and close
          the whole panel too, since React event bubbling follows the DOM
          tree regardless of each dialog's independent fixed positioning. */}
      <div className="dialog-backdrop" role="presentation" onClick={onClose}>
        <div
          className="dialog dialog-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-sharing-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="manage-sharing-title">Manage sharing — {project.name}</h2>

          <section className="section">
            <h3>Invite collaborator</h3>
            <p className="section-help">
              GSD does not send an invitation email yet. Tell this person to sign in with this exact email
              address.
            </p>
            {/* noValidate: this form's own JS validation produces the
                specific, friendly messages required here (invalid format,
                own-email, duplicate) — native browser constraint validation
                on type="email" would otherwise silently block submission
                before handleInvite ever runs. type="email" is kept for the
                mobile-optimized keyboard it still brings up. */}
            <form onSubmit={handleInvite} className="stack-form" noValidate>
              <div className="field">
                <label htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {inviteError && (
                <p className="message error" role="alert">
                  {inviteError}
                </p>
              )}
              <div>
                <button type="submit" disabled={inviting}>
                  {inviting ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </form>
          </section>

          {listError && (
            <p className="message error" role="alert">
              {listError}
            </p>
          )}

          <section className="section">
            <h3>Pending invitations</h3>
            {!listsLoaded ? (
              <p className="empty">Loading…</p>
            ) : pendingInvitations.length === 0 ? (
              <p className="empty">No pending invitations.</p>
            ) : (
              <ul className="task-list">
                {pendingInvitations.map((invitation) => (
                  <li key={invitation.id} className="task-row compact">
                    <div className="task-row-main">
                      <h4 className="task-title email-text">{invitation.invitedEmail}</h4>
                      <p className="meta-text">Invited {invitation.createdAt.slice(0, 10)}</p>
                    </div>
                    <div className="task-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleRevoke(invitation.id)}
                        disabled={busyId === invitation.id}
                      >
                        Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <h3>Current collaborators</h3>
            {!listsLoaded ? (
              <p className="empty">Loading…</p>
            ) : members.length === 0 ? (
              <p className="empty">No collaborators yet.</p>
            ) : (
              <ul className="task-list">
                {members.map((member) => (
                  <li key={member.memberId} className="task-row compact">
                    <div className="task-row-main">
                      <h4 className="task-title email-text">{member.memberEmail ?? 'Unknown collaborator'}</h4>
                      <span className="badge">Editor</span>
                    </div>
                    <div className="task-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setRemoving(member)}
                        disabled={busyId === member.memberId}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Remove collaborator"
        message={`Remove ${removing?.memberEmail ?? 'this collaborator'} from "${project.name}"? They will lose access immediately.`}
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
