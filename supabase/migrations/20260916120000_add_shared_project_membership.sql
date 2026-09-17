-- Add shared-Project membership and invitations (MVP)
-- Daily Compass
--
-- PROPOSED MIGRATION — NOT EXECUTED. Run this against the live Supabase
-- project (SQL editor or `supabase db push`) to apply it.
--
-- Scope: database foundation only for "private shared Projects for two or
-- more people" — two new tables (public.project_members,
-- public.project_invitations), the additional Project/Task RLS policies an
-- accepted Editor needs, three small guard triggers (ownership immutability
-- on projects/tasks, the projects one also enforcing that only the Owner may
-- change status — see its own comment below), and one narrowly-scoped
-- SECURITY INVOKER function for atomic invitation acceptance.
-- No application, repository, or sync code depends on any of this yet — see
-- the shared-Projects inspection report this migration follows. No change to
-- public.goals, public.targets, or public.quick_notes: those remain entirely
-- private to their owner, unreachable by any policy added here.
--
-- MVP roles (confirmed): a Project's Owner is its existing `projects.user_id`
-- — there is no separate "owner" row anywhere, ownership is still exactly
-- what it always was. An Editor is a row in public.project_members. There is
-- no other role in this MVP; `role` is constrained to the literal 'editor'.
--
-- Design choices carried over from the existing schema (Phase 2 migration,
-- 20260830120000): no `service_role`, no privileged credential, and no
-- SECURITY DEFINER function anywhere in this file — every table here is
-- reachable only through ordinary RLS-checked access as the `authenticated`
-- role, exactly like every table before it. The one function this migration
-- adds (`accept_project_invitation`) is SECURITY INVOKER: it only bundles two
-- writes the calling user's own RLS policies already permit them to make
-- individually (insert their own membership row, update their own pending
-- invitation) into one atomic call, so a crash or error between the two
-- writes can never leave a half-accepted invitation (membership created but
-- invitation still 'pending', or vice versa) — it grants no privilege the
-- caller did not already have.
--
-- Recursion safety (checked explicitly, since it is the easiest way to break
-- Postgres RLS silently): public.projects' and public.tasks' new
-- member-access policies query public.project_members, but
-- public.project_members' own policies never query public.projects,
-- public.tasks, or public.project_invitations — and public.project_invitations'
-- policies never query public.projects, public.tasks, or public.project_members
-- either. Every policy predicate below is a leaf (references only its own
-- table, `auth.uid()`/`auth.email()`, and exactly one other table it is
-- allowed to depend on), so there is no cycle for Postgres to evaluate.
--
-- Ownership-immutability: three new BEFORE UPDATE triggers
-- (projects/tasks -> owner-change guards) exist so the exists-against-
-- project_members checks in the new member policies stay sound, and so that
-- "only the Owner may archive, restore, or otherwise change a shared
-- Project's status" cannot be worked around by a WITH CHECK clause that (by
-- construction) can only ever see the candidate new row, not the old one —
-- see each trigger's own comment for the details.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per (project, accepted collaborator). This is a pure relationship
-- table — the app never addresses a single membership row by its own stable
-- id the way it does Tasks/Projects/Goals/etc., so unlike every other table
-- in this schema it has no surrogate `id`; its natural key is exactly what a
-- membership *is*: which project, whose it is, and who was added to it.
--
-- `owner_id` is redundant with `projects.user_id` in the sense that it must
-- always equal it (enforced by project_members_project_fk below, against
-- projects' composite primary key) — it is stored directly, rather than
-- looked up via a join, so every policy that needs "does this membership
-- belong to project X owned by Y" can check it with a plain equality instead
-- of a second join back to public.projects. This is also what keeps
-- public.projects' and public.tasks' member-access policies from ever having
-- to touch public.projects recursively (see header comment).
--
-- There is deliberately no INSERT policy for the owner below — the only way
-- a row ever enters this table is an invited user accepting a pending
-- invitation addressed to their own authenticated email (see
-- project_members_insert_via_invitation and accept_project_invitation). This
-- keeps "who is a member of my Project" fully explained by "an invitation I
-- sent was accepted," with no second, parallel way to create membership that
-- could drift from that audit trail.
create table public.project_members (
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  member_id uuid not null references auth.users (id) on delete cascade,
  -- MVP: exactly one collaborator role exists. Constrained (not just
  -- defaulted) so a future role can only be introduced by a new migration
  -- that deliberately widens this check, never by an unvalidated client write.
  role text not null default 'editor' check (role = 'editor'),
  created_at timestamptz not null default now(),
  constraint project_members_pkey primary key (owner_id, project_id, member_id),
  -- Structural guarantee, same pattern as tasks_project_fk (Phase 2): this
  -- row can only ever reference a project actually owned by owner_id — the
  -- database rejects any attempt to record a membership against a project
  -- owner_id does not own, regardless of what a client sends.
  constraint project_members_project_fk
    foreign key (owner_id, project_id)
    references public.projects (user_id, id)
    on delete cascade
);

comment on table public.project_members is 'Accepted collaborators on a shared Project. One row per (project, member); role is always ''editor'' in this MVP. Deleting the Project (or the owner''s or member''s auth.users row) removes the membership.';

-- Reverse lookup: "which Projects is this user a member of" (used by the
-- member-access policies below via auth.uid(), and by a future "Projects
-- shared with me" read). The primary key above already covers "members of
-- project X" and the exact-membership check the policies below perform.
create index project_members_member_id_idx on public.project_members (member_id);

-- One row per invitation attempt. Unlike project_members, this table *is*
-- addressed by its own id (a pending invitation the invited user is looking
-- at, or one the owner is revoking, is a specific row a UI selects by id) —
-- so, like every other entity table in this schema, it gets the same
-- gen_random_uuid()::text id convention.
create table public.project_invitations (
  id text not null default gen_random_uuid()::text,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  -- Always stored lower(btrim(...)) — see normalize_project_invitation_email()
  -- below — so every comparison against auth.email() is a plain, exact,
  -- case-insensitive-by-construction equality, never an ad hoc lower() at
  -- every call site (and never a place a mismatched case could silently
  -- create a second, non-deduplicated invitation for "the same" address).
  invited_email text not null check (invited_email = lower(btrim(invited_email))),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  -- Set only when the *invited user* responds (accept or decline) — a
  -- revoke is the owner withdrawing the invitation, not a response from the
  -- invited person, so it deliberately leaves this null. See
  -- accept_project_invitation and project_invitations_decline_own.
  responded_at timestamptz,
  constraint project_invitations_pkey primary key (id),
  constraint project_invitations_project_fk
    foreign key (owner_id, project_id)
    references public.projects (user_id, id)
    on delete cascade
);

comment on table public.project_invitations is 'Pending/resolved invitations to collaborate on a shared Project, addressed by normalized email. Deleting the Project removes its invitations.';

-- Prevents more than one *active* (pending) invitation to the same
-- normalized email for the same Project — a resolved invitation (accepted/
-- declined/revoked) does not block a fresh one, so re-inviting after a
-- decline or revoke is just an ordinary new row, never an update of the old
-- one (keeping each invitation's own history intact).
create unique index project_invitations_unique_pending
  on public.project_invitations (owner_id, project_id, invited_email)
  where status = 'pending';

-- Lookups the app needs: "invitations for my Project" (owner-side list) and
-- "invitations addressed to me" (invited-side list, driven by auth.email()
-- at query time, not stored per-user).
create index project_invitations_owner_project_idx on public.project_invitations (owner_id, project_id);
create index project_invitations_invited_email_idx on public.project_invitations (invited_email);

-- ---------------------------------------------------------------------------
-- Email normalization
--
-- Belt-and-suspenders alongside the column check constraint above: the check
-- constraint rejects a non-normalized value outright (defends direct API
-- calls that skip application code entirely), and this trigger normalizes on
-- insert so ordinary callers never have to pre-normalize client-side and can
-- never trip the check constraint by, e.g., a trailing space or mixed case
-- from a pasted email address. invited_email never changes after insert (see
-- prevent_project_invitation_identity_change below), so normalization only
-- needs to happen once, here.
-- ---------------------------------------------------------------------------

create function public.normalize_project_invitation_email()
returns trigger
language plpgsql
as $$
begin
  new.invited_email = lower(btrim(new.invited_email));
  return new;
end;
$$;

create trigger project_invitations_normalize_email
  before insert on public.project_invitations
  for each row
  execute function public.normalize_project_invitation_email();

-- ---------------------------------------------------------------------------
-- Identity-column immutability
--
-- RLS policies below correctly restrict *which* rows an update's USING
-- clause can target, and WITH CHECK restricts what the resulting status may
-- be — but neither can compare a row's old and new values against each
-- other (that comparison needs OLD/NEW, which only a trigger sees), so
-- without a trigger, an UPDATE that an RLS policy otherwise permits (e.g. an
-- invited user declining their own invitation) could still smuggle in
-- changes to owner_id/project_id/invited_email/created_at in the same
-- statement — fields that must never change once a row exists. This is
-- exactly the "unauthorized direct API call that bypasses intended UI
-- restrictions" risk: the application's own UI would never send those
-- fields, but nothing stops a direct PostgREST request from trying.
-- ---------------------------------------------------------------------------

create function public.prevent_project_invitation_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id <> old.owner_id
    or new.project_id <> old.project_id
    or new.invited_email <> old.invited_email
    or new.created_at <> old.created_at
  then
    raise exception 'project_invitations.owner_id, project_id, invited_email, and created_at cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger project_invitations_prevent_identity_change
  before update on public.project_invitations
  for each row
  execute function public.prevent_project_invitation_identity_change();

-- Same concern, applied to public.projects and public.tasks: their new
-- member-access policies (below) trust that a project's/task's user_id is
-- exactly the Owner who granted membership. Without this guard, an owner's
-- own update (still permitted by the pre-existing projects_update_own /
-- tasks_update_own policies, which only ever checked auth.uid() = user_id
-- and were never scoped to "and user_id itself must not change") — or, in
-- principle, an Editor's update satisfying the new member-access WITH CHECK
-- below — could otherwise reassign a row's user_id and silently detach it
-- from, or misattribute it to, a project's real ownership. Ownership
-- transfer is not a feature this app has ever had; this trigger makes that
-- explicit and permanent rather than merely true by convention.
--
-- Also guards public.projects.status specifically: "Only the Owner can
-- archive or delete the Project" needs status to be a one-way street for an
-- Editor in *every* direction, not just the single active -> archived
-- transition — an Editor must not be able to restore an archived Project to
-- active (or move it to 'completed') either. A policy's WITH CHECK cannot
-- express "unless this value changed," since it only ever sees the
-- candidate new row, never the old one for comparison — a status-only
-- exclusion there (e.g. `status <> 'archived'`) is therefore asymmetric by
-- construction and leaves every other transition open to whoever the rest
-- of the policy already lets update the row. A trigger sees both OLD and
-- NEW and runs no matter which permissive policy authorized the statement,
-- so it is the only place this can be enforced correctly: any change to
-- status is rejected unless the actor is the row's real owner.
create function public.prevent_project_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'projects.user_id cannot be changed.';
  end if;
  if new.status <> old.status and auth.uid() <> old.user_id then
    raise exception 'Only the Project owner may change its status.';
  end if;
  return new;
end;
$$;

create trigger projects_prevent_owner_change
  before update on public.projects
  for each row
  execute function public.prevent_project_owner_change();

create function public.prevent_task_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'tasks.user_id cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger tasks_prevent_owner_change
  before update on public.tasks
  for each row
  execute function public.prevent_task_owner_change();

-- ---------------------------------------------------------------------------
-- Row Level Security — new tables
--
-- Same belt-and-suspenders pattern as every table in this schema: RLS
-- enabled, anon explicitly revoked, authenticated granted the privileges RLS
-- itself then narrows. project_members has no UPDATE policy at all (there is
-- nothing to update — role is fixed, and the MVP has no membership edit
-- path), so granting UPDATE at the table level is inert; it is granted only
-- for consistency with this file's existing convention of granting the
-- ordinary four and letting policy coverage (or its absence) be the real
-- restriction.
-- ---------------------------------------------------------------------------

alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;

revoke all on public.project_members from anon;
revoke all on public.project_invitations from anon;

grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.project_invitations to authenticated;

-- project_members -----------------------------------------------------------

-- Owner: full read of their own Projects' membership rosters.
create policy project_members_select_owner
  on public.project_members
  for select
  to authenticated
  using (owner_id = auth.uid());

-- Member: can see their own membership rows. Required not just for a future
-- "Projects shared with me" UI, but structurally: public.projects' and
-- public.tasks' member-access policies (below) run this same table's SELECT
-- policies as the querying Editor, not as some elevated role — without this
-- policy, an Editor's own membership row would be invisible to their own
-- session, and every exists(...) check that depends on seeing it would
-- silently evaluate to false.
create policy project_members_select_member
  on public.project_members
  for select
  to authenticated
  using (member_id = auth.uid());

-- The only path into this table: the invited user accepting their own
-- pending invitation. member_id must be the caller themselves (never a
-- value the caller could set on someone else's behalf), and a matching
-- pending invitation, addressed to the caller's own authenticated email
-- (never a client-supplied email — see accept_project_invitation), must
-- exist for the exact (owner_id, project_id) pair being inserted.
create policy project_members_insert_via_invitation
  on public.project_members
  for insert
  to authenticated
  with check (
    member_id = auth.uid()
    and exists (
      select 1
      from public.project_invitations pi
      where pi.owner_id = project_members.owner_id
        and pi.project_id = project_members.project_id
        and pi.invited_email = lower(btrim(auth.email()))
        and pi.status = 'pending'
    )
  );

-- Owner: remove a collaborator. There is no member-initiated delete
-- ("leave a Project") in this MVP — membership management is owner-only, per
-- the confirmed decisions.
create policy project_members_delete_owner
  on public.project_members
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- project_invitations ---------------------------------------------------------

create policy project_invitations_select_owner
  on public.project_invitations
  for select
  to authenticated
  using (owner_id = auth.uid());

-- The invited user can see every invitation ever addressed to their
-- authenticated email, in any status — not only pending — so they have a
-- plain record of what they accepted or declined. Never matched against a
-- client-supplied email; auth.email() is the current JWT's own verified
-- email claim.
create policy project_invitations_select_invited
  on public.project_invitations
  for select
  to authenticated
  using (invited_email = lower(btrim(auth.email())));

create policy project_invitations_insert_owner
  on public.project_invitations
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- Owner: revoke a still-pending invitation (withdraw it before it is acted
-- on). Scoped to the pending -> revoked transition only; an invitation that
-- has already been accepted or declined is a historical record, not
-- something to revoke (the owner can still delete the row outright — see
-- project_invitations_delete_owner — but flipping a resolved invitation's
-- status back and forth is not a supported operation).
create policy project_invitations_revoke_own
  on public.project_invitations
  for update
  to authenticated
  using (owner_id = auth.uid() and status = 'pending')
  with check (owner_id = auth.uid() and status = 'revoked');

create policy project_invitations_delete_owner
  on public.project_invitations
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- Invited user: accept. In practice this row is only ever reached through
-- accept_project_invitation (below), which performs this exact update as
-- part of one atomic call — but the policy itself is what actually
-- authorizes it (the function is SECURITY INVOKER, so it has no privilege
-- beyond what this policy already grants the caller directly).
create policy project_invitations_accept_own
  on public.project_invitations
  for update
  to authenticated
  using (invited_email = lower(btrim(auth.email())) and status = 'pending')
  with check (invited_email = lower(btrim(auth.email())) and status = 'accepted');

-- Invited user: decline. A single-statement status update is already
-- atomic on its own, so — unlike accept, which must also create a
-- membership row — decline needs no function, just this policy.
create policy project_invitations_decline_own
  on public.project_invitations
  for update
  to authenticated
  using (invited_email = lower(btrim(auth.email())) and status = 'pending')
  with check (invited_email = lower(btrim(auth.email())) and status = 'declined');

-- ---------------------------------------------------------------------------
-- Row Level Security — additional member-access policies on existing tables
--
-- Added alongside the untouched Phase 2 owner-only policies (projects_*_own,
-- tasks_*_own — not modified by this migration). Postgres combines multiple
-- permissive policies for the same command with OR, so these only ever add
-- reachability for an accepted Editor; they cannot narrow or replace what an
-- Owner could already do.
--
-- No insert/delete policy is added for Editors on public.projects: the MVP
-- gives Editors no ability to create a new Project (the existing
-- projects_insert_own policy already only allows auth.uid() = user_id, which
-- an Editor inserting under someone else's user_id can never satisfy) or to
-- delete/archive the shared one.
-- ---------------------------------------------------------------------------

-- projects --------------------------------------------------------------------

create policy projects_select_member
  on public.projects
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = projects.user_id
        and m.project_id = projects.id
        and m.member_id = auth.uid()
    )
  );

-- Deliberately does not restrict `status` here: a WITH CHECK only ever sees
-- the candidate new row, never the old one, so it cannot express "unless
-- status changed" — only a symmetric, always-wrong restriction like
-- "status <> 'archived'", which would still let an Editor restore an
-- already-archived Project to active or move it to 'completed'. The actual
-- "only the Owner may change status, in any direction" rule is enforced by
-- the projects_prevent_owner_change trigger above, which sees both OLD and
-- NEW and runs regardless of which policy authorized the statement — this
-- policy only needs to keep gating everything else an Editor may change.
create policy projects_update_member
  on public.projects
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = projects.user_id
        and m.project_id = projects.id
        and m.member_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = projects.user_id
        and m.project_id = projects.id
        and m.member_id = auth.uid()
    )
  );

-- tasks ---------------------------------------------------------------------

create policy tasks_select_member
  on public.tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = tasks.user_id
        and m.project_id = tasks.project_id
        and m.member_id = auth.uid()
    )
  );

-- The inserted row's user_id must be the Project Owner's id, never the
-- Editor's own id — this is the one place this migration deliberately
-- departs from "auth.uid() = user_id" as the shape of an insert check.
-- tasks.user_id is not asserted to equal auth.uid() anywhere in this policy;
-- it only has to be *some* owner_id for which a project_members row proves
-- this Editor has access to that exact (owner, project) pair. This is what
-- keeps a collaborative Task stored under the shared Project's Owner —
-- exactly like every Task that Owner creates themselves — rather than
-- forking a second, Editor-owned copy of the same conceptual row.
create policy tasks_insert_member
  on public.tasks
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = tasks.user_id
        and m.project_id = tasks.project_id
        and m.member_id = auth.uid()
    )
  );

-- with check re-evaluates the same membership test against the *new* row —
-- so an Editor cannot reassign a shared Task's project_id to null or to any
-- other project_id, including another private Project the same Owner has
-- that this Editor is not a member of: no project_members row would match
-- that new project_id, so the check fails and the update is rejected. This
-- is the direct answer to "Editors changing a Task to point to a different
-- private Project." (tasks.user_id itself cannot change at all — see
-- prevent_task_owner_change above — so there is no way to retarget a Task at
-- a different Owner's data via this policy either.)
create policy tasks_update_member
  on public.tasks
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = tasks.user_id
        and m.project_id = tasks.project_id
        and m.member_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = tasks.user_id
        and m.project_id = tasks.project_id
        and m.member_id = auth.uid()
    )
  );

create policy tasks_delete_member
  on public.tasks
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.project_members m
      where m.owner_id = tasks.user_id
        and m.project_id = tasks.project_id
        and m.member_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Atomic invitation acceptance
--
-- SECURITY INVOKER (the default — stated explicitly here for clarity), not
-- SECURITY DEFINER: every statement inside runs with the calling Editor's own
-- privileges and is subject to exactly the RLS policies above, the same as
-- if the caller ran these two statements themselves. This function grants no
-- access the caller did not already have from
-- project_members_insert_via_invitation and project_invitations_accept_own
-- individually — it exists only to make "insert the membership, then mark
-- the invitation accepted" a single atomic unit, so a failure between the
-- two (or two concurrent accept attempts on the same invitation) can never
-- leave a half-accepted invitation. A plpgsql function body is one statement
-- from the caller's perspective: if the UPDATE raises or is never reached,
-- the INSERT it already performed is rolled back along with it.
--
-- `for update` locks the located invitation row for the remainder of this
-- function call, so a second, concurrent accept (or a decline racing an
-- accept) on the very same invitation blocks until the first call commits or
-- rolls back — after which its `status = 'pending'` condition no longer
-- matches, and the second call correctly reports "no pending invitation"
-- instead of double-accepting.
--
-- Every table reference is schema-qualified (public.*) and search_path is
-- pinned defensively, even though SECURITY INVOKER functions do not carry
-- the classic SECURITY DEFINER search-path-hijack risk (they never run with
-- privileges the caller lacks) — cheap insurance, no behavioral cost.
create function public.accept_project_invitation(p_invitation_id text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invitation public.project_invitations;
begin
  select *
    into v_invitation
    from public.project_invitations
   where id = p_invitation_id
     and status = 'pending'
     and invited_email = lower(btrim(auth.email()))
   for update;

  if not found then
    raise exception 'No pending invitation for this account with that id.';
  end if;

  -- on conflict do nothing: re-accepting an invitation for a (owner,
  -- project) pair the caller already has a membership row for (e.g. a stale
  -- second browser tab) is treated as idempotent, not an error.
  insert into public.project_members (owner_id, project_id, member_id, role)
  values (v_invitation.owner_id, v_invitation.project_id, auth.uid(), 'editor')
  on conflict (owner_id, project_id, member_id) do nothing;

  update public.project_invitations
     set status = 'accepted',
         responded_at = now()
   where id = v_invitation.id;
end;
$$;

comment on function public.accept_project_invitation(text) is
  'Atomically accepts the caller''s own pending invitation (matched by auth.email(), never a client-supplied email): creates the Editor membership, then marks the invitation accepted with a response time. SECURITY INVOKER — grants no privilege beyond what the caller''s own RLS policies already allow.';

revoke all on function public.accept_project_invitation(text) from public;
revoke all on function public.accept_project_invitation(text) from anon;
grant execute on function public.accept_project_invitation(text) to authenticated;
