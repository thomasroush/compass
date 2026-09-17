-- Add member_email to project_members
-- Daily Compass
--
-- PROPOSED MIGRATION — NOT EXECUTED. Run this against the live Supabase
-- project (SQL editor or `supabase db push`) to apply it.
--
-- Scope: one nullable column on public.project_members (defined in
-- 20260916120000_add_shared_project_membership.sql), the one INSERT policy
-- on that table that needs to keep pace with the new column, and a
-- `create or replace` of accept_project_invitation to populate it. No other
-- table, policy, or function is touched.
--
-- Why: the future "Manage collaborators" screen needs to show the Owner
-- *who* a collaborator is, not their opaque auth.users id, and doing that by
-- matching invitations to memberships on timing or position would be
-- unreliable — project_members has never stored an email at all. This adds
-- one, sourced the same way every identity check in this schema already is:
-- the authenticated caller's own JWT (auth.email()), never a client-supplied
-- value.
--
-- Nullable, not backfilled: an existing project_members row (from manual
-- testing against 20260916120000, before this column existed) keeps
-- member_email = null rather than blocking this migration on a NOT NULL
-- constraint it can't satisfy. The column itself stays nullable for that
-- reason alone — it is not an invitation to insert a new row without one.
-- Every membership accepted from this migration forward is required, by the
-- INSERT policy below (not just by convention), to carry the accepting
-- member's own normalized email — accept_project_invitation, replaced
-- below, is still the only way a row ever enters this table (see
-- 20260916120000's own comment on why project_members has no owner-insert
-- policy).

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

alter table public.project_members
  add column member_email text
    check (member_email is null or member_email = lower(btrim(member_email)));

comment on column public.project_members.member_email is
  'The accepted collaborator''s email, normalized lower(btrim(...)), recorded at accept time by accept_project_invitation. Null only for a membership row that predates this column.';

-- ---------------------------------------------------------------------------
-- RLS — the one policy that needed to keep pace with the new column
--
-- project_members_insert_via_invitation (20260916120000) is still the only
-- way a row ever enters this table, and its existing conditions (member_id =
-- auth.uid(), a matching pending invitation addressed to the caller's own
-- email) are unchanged below. The added clause closes the gap the
-- member_email column introduces, and does it by *requiring* the value, not
-- merely constraining it: without this clause, a direct API call already
-- satisfying every existing condition could either set member_email to an
-- arbitrary string (impersonating a different person to the Owner's future
-- "Manage collaborators" view) or omit it entirely, creating an unidentified
-- collaborator the column's own nullability would otherwise silently allow.
-- Requiring an exact match against the caller's own normalized email closes
-- both: every *newly inserted* row must carry the accepting member's real
-- email, with no null-email escape hatch, while member_email stays nullable
-- at the column level purely so a pre-existing row from before this
-- migration is not rejected — see the header comment above.
-- ---------------------------------------------------------------------------

drop policy if exists project_members_insert_via_invitation on public.project_members;

create policy project_members_insert_via_invitation
  on public.project_members
  for insert
  to authenticated
  with check (
    member_id = auth.uid()
    and member_email = lower(btrim(auth.email()))
    and exists (
      select 1
      from public.project_invitations pi
      where pi.owner_id = project_members.owner_id
        and pi.project_id = project_members.project_id
        and pi.invited_email = lower(btrim(auth.email()))
        and pi.status = 'pending'
    )
  );

-- ---------------------------------------------------------------------------
-- accept_project_invitation — replaced to also store member_email
--
-- Same signature, same SECURITY INVOKER, same pinned search_path, same
-- atomic insert-then-mark-accepted sequence, and the same `for update` row
-- lock as the original (20260916120000) — only the INSERT now includes
-- member_email, sourced from auth.email() exactly like every other identity
-- check in this function, never a parameter. `create or replace` preserves
-- the function's existing grants (revoke ... from public/anon; grant
-- execute ... to authenticated, both from 20260916120000) unchanged —
-- nothing below re-runs them.
-- ---------------------------------------------------------------------------

create or replace function public.accept_project_invitation(p_invitation_id text)
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
  -- second browser tab) is treated as idempotent, not an error — same
  -- behavior as the original migration. member_email is not re-synced by a
  -- no-op conflict; email changes at the auth provider are not a case this
  -- MVP handles.
  insert into public.project_members (owner_id, project_id, member_id, member_email, role)
  values (v_invitation.owner_id, v_invitation.project_id, auth.uid(), lower(btrim(auth.email())), 'editor')
  on conflict (owner_id, project_id, member_id) do nothing;

  update public.project_invitations
     set status = 'accepted',
         responded_at = now()
   where id = v_invitation.id;
end;
$$;

comment on function public.accept_project_invitation(text) is
  'Atomically accepts the caller''s own pending invitation (matched by auth.email(), never a client-supplied email): creates the Editor membership — recording the caller''s own normalized email as member_email — then marks the invitation accepted with a response time. SECURITY INVOKER — grants no privilege beyond what the caller''s own RLS policies already allow.';
