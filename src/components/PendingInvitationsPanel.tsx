import { useEffect, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useCloudSync } from '../store/useCloudSync';
import {
  acceptInvitation,
  declineInvitation,
  listPendingInvitationsForMe,
} from '../repository/projectInvitationsRepository';
import type { ProjectInvitation } from '../repository/types';

/**
 * Shared-Project invitations addressed to the signed-in user. Shown only
 * when there is at least one pending — loaded directly from the repository
 * on mount, never from `useApp()`'s AppData, since invitations are never
 * part of the offline-first local store (Stage 3 inspection). Nothing here
 * polls or subscribes; the list is only ever (re-)read on mount and after an
 * action this component itself performs.
 *
 * Because this MVP sends no invitation email and an invitee cannot read
 * Project details before accepting (no access yet), every invitation is
 * shown with the same generic "Project invitation" label rather than a
 * Project name or the inviting Owner's identity — there is nothing more
 * specific this device is allowed to know yet.
 */
export function PendingInvitationsPanel() {
  const auth = useAuth();
  const cloudSync = useCloudSync();
  const accountId = auth.isSupabaseConfigured ? auth.user?.id : undefined;

  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!accountId) {
      setInvitations([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    listPendingInvitationsForMe().then((result) => {
      if (!active) return;
      if (result.ok) {
        setInvitations(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [accountId]);

  // Quiet while loading or empty — a load failure is not surfaced here
  // either (this section simply doesn't appear), since the requirement is
  // "show only when there are pending invitations," not "always show a
  // status." A failed *action* (accept/decline) below is what actually
  // needs to be visible, once the section already exists on screen.
  if (!accountId || !loaded || invitations.length === 0) return null;

  async function handleAccept(id: string) {
    if (!accountId) return;
    setBusyId(id);
    setError(null);
    const result = await acceptInvitation(id, accountId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setInvitations((current) => current.filter((invitation) => invitation.id !== id));
    // The newly shared Project (and its Tasks) become visible to
    // listVisibleProjects/listVisibleTasks the instant membership exists —
    // this is the same "Refresh from cloud" action already wired to
    // SyncStatusPanel, reused rather than inventing a second refresh path.
    cloudSync.refreshAcceptingServer();
  }

  async function handleDecline(id: string) {
    if (!accountId) return;
    setBusyId(id);
    setError(null);
    const result = await declineInvitation(id, accountId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setInvitations((current) => current.filter((invitation) => invitation.id !== id));
  }

  return (
    <section className="section settings-section project-invitations">
      <h2>Project invitations</h2>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      <ul className="task-list">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="task-row compact">
            <div className="task-row-main">
              <h3 className="task-title">Project invitation</h3>
              {invitation.createdAt && (
                <p className="meta-text">Invited {invitation.createdAt.slice(0, 10)}</p>
              )}
            </div>
            <div className="task-actions">
              <button type="button" onClick={() => handleAccept(invitation.id)} disabled={busyId !== null}>
                Accept
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleDecline(invitation.id)}
                disabled={busyId !== null}
              >
                Decline
              </button>
              {busyId === invitation.id && <span className="meta-text">Working…</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
