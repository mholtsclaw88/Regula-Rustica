import {
  INVITATION_ROLES,
  buildInvitationLink,
  invitationStatus,
  invitationTokenFromUrl
} from './cloud-invitations.mjs';
import { premiumCloudEntitled } from './sync/premium-access.mjs';

const status = document.querySelector('#cloudStatus');
const authForm = document.querySelector('#cloudAuthForm');
const signedIn = document.querySelector('#cloudSignedIn');
const membership = document.querySelector('#cloudMembership');
const onboarding = document.querySelector('#cloudOnboarding');
const passwordForm = document.querySelector('#cloudPasswordForm');
const memberManagement = document.querySelector('#cloudMemberManagement');
const invitationForm = document.querySelector('#cloudInvitationForm');
const invitationList = document.querySelector('#cloudInvitationList');
const invitationResult = document.querySelector('#cloudInvitationResult');
const premiumStatus = document.querySelector('#premiumStatus');
const premiumRedeemForm = document.querySelector('#premiumRedeemForm');
const premiumRedeemResult = document.querySelector('#premiumRedeemResult');
let invitationToken = invitationTokenFromUrl(location.href);

document.querySelector('#cloudInvitationToken').value = invitationToken;

const showStatus = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle('error', isError);
  window.dispatchEvent(new CustomEvent('regula-rustica:cloud-status'));
};

const config = window.REGULA_RUSTICA_CLOUD || {};

if (!config.url || !config.publishableKey) {
  showStatus('Cloud access is not configured. Local records and backups remain fully available.');
} else {
  initializeCloud().catch(error => showStatus(error.message || 'Cloud access could not start.', true));
}

async function initializeCloud() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm');
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const setBusy = busy => document.querySelectorAll('.cloud-card button, .cloud-card input, .cloud-card select, .premium-card button, .premium-card input')
    .forEach(element => { element.disabled = busy; });

  const formatDate = value => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(value));

  const clearInvitationResult = () => {
    invitationResult.classList.add('hidden');
    document.querySelector('#cloudInvitationLink').value = '';
  };

  function renderPremium(entitlement, hasMembership, canManageHomestead, error = null) {
    premiumRedeemForm?.classList.toggle('hidden', !hasMembership || !canManageHomestead);
    if (!premiumStatus) return;
    premiumStatus.classList.toggle('error', Boolean(error));
    if (error) {
      premiumStatus.textContent = 'Premium status is temporarily unavailable. Cloud Sync is paused; local work remains safe on this device.';
      return;
    }
    if (!hasMembership) {
      premiumStatus.textContent = 'Sign in and join a cloud Homestead to check Premium.';
      return;
    }
    if (premiumCloudEntitled(entitlement)) {
      premiumStatus.textContent = entitlement.ends_at
        ? `Premium is active through ${formatDate(entitlement.ends_at)} for this Homestead. Cloud Sync is included.`
        : 'Premium is active for this Homestead. Cloud Sync is included.';
      return;
    }
    premiumStatus.textContent = canManageHomestead
      ? 'This Homestead is using the standard local plan. Redeem a Premium gift below to enable Cloud Sync and Cyril.'
      : 'This Homestead is using the standard local plan. A Steward can enable Premium Cloud Sync.';
  }

  async function loadPremiumEntitlement(hasMembership) {
    if (!hasMembership) return { entitlement: null, error: null };
    const result = await client.rpc('current_premium_entitlement');
    return { entitlement: result.data?.[0] || null, error: result.error || null };
  }

  function renderInvitations(invitations = []) {
    invitationList.replaceChildren();
    if (!invitations.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No invitations yet.';
      invitationList.append(empty);
      return;
    }
    for (const invitation of invitations) {
      const item = document.createElement('div');
      item.className = 'invitation-item';
      const main = document.createElement('div');
      main.className = 'invitation-item-main';
      const email = document.createElement('div');
      email.className = 'invitation-email';
      email.textContent = invitation.email;
      const details = document.createElement('div');
      details.className = 'meta';
      const state = invitationStatus(invitation);
      details.textContent = `${invitation.role[0].toUpperCase()}${invitation.role.slice(1)} · ${state} · Expires ${formatDate(invitation.expires_at)}`;
      main.append(email, details);
      item.append(main);
      if (state === 'pending') {
        const revoke = document.createElement('button');
        revoke.className = 'btn secondary';
        revoke.type = 'button';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', () => {
          if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
          run(async () => {
            const result = await client.rpc('revoke_invitation', { invitation_id: invitation.invitation_id });
            if (!result.error) await refreshInvitations();
            return result;
          }, 'Invitation revoked.');
        });
        item.append(revoke);
      }
      invitationList.append(item);
    }
  }

  async function refreshInvitations() {
    const result = await client.rpc('list_invitations');
    if (result.error) throw result.error;
    renderInvitations(result.data);
  }

  async function refreshAccount(session, event = '') {
    const user = session?.user;
    authForm.classList.toggle('hidden', Boolean(user));
    signedIn.classList.toggle('hidden', !user);
    passwordForm.classList.toggle('hidden', event !== 'PASSWORD_RECOVERY');
    if (event === 'PASSWORD_RECOVERY' || invitationToken) document.querySelector('#accountCloudAccountDetails').open = true;

    if (!user) {
      clearInvitationResult();
      membership.classList.add('hidden');
      onboarding.classList.add('hidden');
      memberManagement.classList.add('hidden');
      renderPremium(null, false, false);
      showStatus(invitationToken
        ? 'Private invitation detected. Sign in or create an account to review and accept it.'
        : 'Cloud access is ready. Sign in or create an account.');
      window.REGULA_RUSTICA_CLOUD_CONTEXT = { client, session: null, homesteadId: null, role: null, canManageHomestead: false, homesteadIdentity: null, premium: null };
      window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: window.REGULA_RUSTICA_CLOUD_CONTEXT }));
      return;
    }

    document.querySelector('#cloudUserEmail').textContent = user.email || 'Signed in';
    const [
      { data: homesteadId, error: homesteadError },
      { data: role, error: roleError },
      { data: canManageMembers, error: capabilityError },
      { data: canManageHomestead, error: homesteadCapabilityError }
    ] = await Promise.all([
      client.rpc('current_homestead_id'),
      client.rpc('current_member_role'),
      client.rpc('has_capability', { capability: 'manage_members' }),
      client.rpc('has_capability', { capability: 'manage_homestead' })
    ]);
    if (homesteadError || roleError || capabilityError || homesteadCapabilityError) throw homesteadError || roleError || capabilityError || homesteadCapabilityError;

    const hasMembership = Boolean(homesteadId);
    let homesteadIdentity = null;
    if (hasMembership) {
      const result = await client.from('homesteads').select('name,motto,location,logo_storage_path,logo_crop').eq('id', homesteadId).single();
      if (result.error) throw result.error;
      homesteadIdentity = result.data;
    }
    const premiumResult = await loadPremiumEntitlement(hasMembership);
    const mayManageMembers = hasMembership && Boolean(canManageMembers);
    membership.classList.toggle('hidden', !hasMembership);
    onboarding.classList.toggle('hidden', hasMembership);
    memberManagement.classList.toggle('hidden', !mayManageMembers);
    if (!mayManageMembers) clearInvitationResult();
    document.querySelector('#cloudRole').textContent = role || '';
    renderPremium(premiumResult.entitlement, hasMembership, Boolean(canManageHomestead), premiumResult.error);
    showStatus(hasMembership
      ? premiumCloudEntitled(premiumResult.entitlement)
        ? 'Account connected. Premium Cloud Sync is available below.'
        : 'Account connected. Cloud Sync is paused until this Homestead has Premium; local work remains available.'
      : invitationToken
        ? 'Invitation ready. Review it below and accept when you are ready.'
        : 'Account ready. Choose how this account joins a Homestead.');
    if (mayManageMembers) await refreshInvitations();
    window.REGULA_RUSTICA_CLOUD_CONTEXT = {
      client,
      session,
      homesteadId,
      role,
      canManageHomestead: Boolean(canManageHomestead),
      homesteadIdentity,
      premium: premiumResult.entitlement
    };
    window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: window.REGULA_RUSTICA_CLOUD_CONTEXT }));
  }

  async function run(action, successMessage) {
    setBusy(true);
    try {
      const result = await action();
      if (result?.error) throw result.error;
      if (successMessage) showStatus(successMessage);
      return result;
    } catch (error) {
      showStatus(error.message || 'The request could not be completed.', true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function signIn(email, password) {
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    return result.data;
  }

  async function signUp(displayName, email, password) {
    const result = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: location.href }
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function createHomestead(name) {
    const result = await client.rpc('create_homestead', { homestead_name: name });
    if (result.error) throw result.error;
    const session = (await client.auth.getSession()).data.session;
    await refreshAccount(session);
    return window.REGULA_RUSTICA_CLOUD_CONTEXT;
  }

  async function createInvitation(email, role) {
    const result = await client.rpc('create_invitation', {
      invitation_email: email,
      invitation_role: role
    });
    if (result.error) throw result.error;
    const invitation = result.data?.[0];
    if (!invitation?.raw_token) throw new Error('The private invitation could not be created.');
    await refreshInvitations();
    return { invitation, link: buildInvitationLink(invitation.raw_token, location.href) };
  }

  window.RegulaRusticaCloudAuth = Object.freeze({ signIn, signUp, createHomestead, createInvitation });
  window.dispatchEvent(new CustomEvent('regula-rustica:cloud-auth-ready'));

  authForm.addEventListener('submit', event => {
    event.preventDefault();
    run(() => signIn(document.querySelector('#cloudEmail').value.trim(), document.querySelector('#cloudPassword').value));
  });

  document.querySelector('#cloudSignUp').addEventListener('click', () => run(async () => {
    const data = await signUp(
      document.querySelector('#cloudDisplayName').value.trim(),
      document.querySelector('#cloudEmail').value.trim(),
      document.querySelector('#cloudPassword').value
    );
    if (!data.session) showStatus('Check your email to confirm the account, then sign in.');
    return data;
  }));

  document.querySelector('#cloudResetRequest').addEventListener('click', () => run(() =>
    client.auth.resetPasswordForEmail(document.querySelector('#cloudEmail').value.trim(), {
      redirectTo: `${location.origin}${location.pathname}`
    }), 'If that account exists, a password-reset email has been sent.'));

  document.querySelector('#cloudSignOut').addEventListener('click', () => run(() => client.auth.signOut()));

  document.querySelector('#cloudCreateHomestead').addEventListener('click', () => run(async () => {
    return createHomestead(document.querySelector('#cloudHomesteadName').value.trim());
  }, 'Homestead created.'));

  document.querySelector('#cloudAcceptInvitation').addEventListener('click', () => run(async () => {
    const result = await client.rpc('accept_invitation', {
      invitation_token: document.querySelector('#cloudInvitationToken').value.trim()
    });
    if (!result.error) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('invitation');
      history.replaceState(null, '', cleanUrl);
      invitationToken = '';
      document.querySelector('#cloudInvitationToken').value = '';
      await refreshAccount((await client.auth.getSession()).data.session);
    }
    return result;
  }, 'Invitation accepted.'));

  const roleSelect = document.querySelector('#cloudInvitationRole');
  const updateRoleDescription = () => {
    document.querySelector('#cloudRoleDescription').textContent = INVITATION_ROLES[roleSelect.value];
  };
  roleSelect.addEventListener('change', updateRoleDescription);
  updateRoleDescription();

  invitationForm.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      clearInvitationResult();
      const result = await createInvitation(document.querySelector('#cloudInvitationEmail').value.trim(), roleSelect.value);
      document.querySelector('#cloudInvitationLink').value = result.link;
      invitationResult.classList.remove('hidden');
      document.querySelector('#cloudInvitationEmail').value = '';
      return result;
    }, 'Private invitation created. Copy the link below.');
  });

  premiumRedeemForm?.addEventListener('submit', event => {
    event.preventDefault();
    setBusy(true);
    premiumRedeemResult.textContent = '';
    (async () => {
      try {
        const giftCode = document.querySelector('#premiumGiftCode').value.trim();
        const result = await client.rpc('redeem_premium_gift', { gift_code: giftCode });
        if (result.error) throw result.error;
        document.querySelector('#premiumGiftCode').value = '';
        premiumRedeemResult.textContent = 'Premium gift redeemed for this Homestead.';
        const session = (await client.auth.getSession()).data.session;
        await refreshAccount(session);
      } catch (error) {
        premiumRedeemResult.textContent = error.message || 'The Premium gift could not be redeemed.';
      } finally {
        setBusy(false);
      }
    })();
  });

  document.querySelector('#cloudCopyInvitation').addEventListener('click', () => run(async () => {
    const link = document.querySelector('#cloudInvitationLink');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link.value);
    else {
      link.select();
      if (!document.execCommand('copy')) throw new Error('Copy is unavailable. Select and copy the link manually.');
    }
  }, 'Invitation link copied.'));

  passwordForm.addEventListener('submit', event => {
    event.preventDefault();
    run(() => client.auth.updateUser({ password: document.querySelector('#cloudNewPassword').value }), 'Password updated.');
  });

  client.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => refreshAccount(session, event).catch(error => showStatus(error.message, true)), 0);
  });

  window.addEventListener('online', async () => {
    const { data: { session } } = await client.auth.getSession();
    refreshAccount(session).catch(error => showStatus(error.message || 'Cloud access could not reconnect.', true));
  });

  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  await refreshAccount(session);
}
