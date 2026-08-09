-- Steward-managed invitation lifecycle. Raw invitation tokens are returned once
-- by create_invitation(); only their SHA-256 hashes are stored.

alter table public.invitations
  drop constraint if exists invitations_role_check;

create or replace function public.create_invitation(
  invitation_email text,
  invitation_role public.member_role
)
returns table (
  invitation_id uuid,
  email text,
  role public.member_role,
  raw_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  normalized_email text := lower(btrim(invitation_email));
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  created_invitation public.invitations%rowtype;
begin
  if tenant is null or not public.has_capability('manage_members') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(normalized_email) not between 3 and 254
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email address is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.homestead_members member
    join auth.users invited_user on invited_user.id = member.user_id
    where member.homestead_id = tenant
      and member.status = 'active'
      and lower(invited_user.email) = normalized_email
  ) then
    raise exception 'That person is already an active member' using errcode = '23505';
  end if;

  -- Expired invitations no longer prevent a fresh invitation for the address.
  update public.invitations invitation
  set revoked_at = now(), revoked_by = actor
  where invitation.homestead_id = tenant
    and invitation.email_normalized = normalized_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at <= now();

  insert into public.invitations (
    homestead_id, email_normalized, role, token_hash, invited_by
  ) values (
    tenant, normalized_email, invitation_role,
    encode(extensions.digest(token, 'sha256'), 'hex'), actor
  )
  returning * into created_invitation;

  return query select
    created_invitation.id,
    created_invitation.email_normalized,
    created_invitation.role,
    token,
    created_invitation.expires_at;
exception
  when unique_violation then
    raise exception 'A pending invitation already exists for that email address' using errcode = '23505';
end
$$;

create or replace function public.list_invitations()
returns table (
  invitation_id uuid,
  email text,
  role public.member_role,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare tenant uuid := public.current_homestead_id();
begin
  perform private.require_user();
  if tenant is null or not public.has_capability('manage_members') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select invitation.id,
      invitation.email_normalized,
      invitation.role,
      case
        when invitation.accepted_at is not null then 'accepted'
        when invitation.revoked_at is not null then 'revoked'
        when invitation.expires_at <= now() then 'expired'
        else 'pending'
      end,
      invitation.created_at,
      invitation.expires_at
    from public.invitations invitation
    where invitation.homestead_id = tenant
    order by invitation.created_at desc;
end
$$;

create or replace function public.revoke_invitation(invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  revoked_id uuid;
begin
  if tenant is null or not public.has_capability('manage_members') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.invitations
  set revoked_at = now(), revoked_by = actor
  where id = invitation_id
    and homestead_id = tenant
    and accepted_at is null
    and revoked_at is null
  returning id into revoked_id;
  if revoked_id is null then
    raise exception 'Pending invitation not found' using errcode = '22023';
  end if;
  return revoked_id;
end
$$;

-- Invitation changes are part of the Homestead audit trail; the existing audit
-- function removes token_hash before writing before/after snapshots.
create trigger audit_invitations
after insert or update on public.invitations
for each row execute function private.audit_row();

-- The browser uses the narrow RPCs above. Direct table access would expose the
-- token hash and allow callers to bypass lifecycle validation.
revoke select, insert, update on public.invitations from authenticated;

revoke execute on function public.create_invitation(text, public.member_role) from public, anon;
revoke execute on function public.list_invitations() from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.create_invitation(text, public.member_role) to authenticated;
grant execute on function public.list_invitations() to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
