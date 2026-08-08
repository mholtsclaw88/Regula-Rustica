const status = document.querySelector('#cloudStatus');
const authForm = document.querySelector('#cloudAuthForm');
const signedIn = document.querySelector('#cloudSignedIn');
const membership = document.querySelector('#cloudMembership');
const onboarding = document.querySelector('#cloudOnboarding');
const passwordForm = document.querySelector('#cloudPasswordForm');

const showStatus = (message, isError = false) => {
  status.textContent = message;
  status.classList.toggle('error', isError);
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

  const setBusy = busy => document.querySelectorAll('.cloud-card button, .cloud-card input')
    .forEach(element => { element.disabled = busy; });

  async function refreshAccount(session, event = '') {
    const user = session?.user;
    authForm.classList.toggle('hidden', Boolean(user));
    signedIn.classList.toggle('hidden', !user);
    passwordForm.classList.toggle('hidden', event !== 'PASSWORD_RECOVERY');

    if (!user) {
      membership.classList.add('hidden');
      onboarding.classList.add('hidden');
      showStatus('Cloud access is ready. Sign in or create an account.');
      window.REGULA_RUSTICA_CLOUD_CONTEXT = { client, session: null, homesteadId: null, role: null };
      window.dispatchEvent(new CustomEvent('regula-rustica:cloud-context', { detail: window.REGULA_RUSTICA_CLOUD_CONTEXT }));
      return;
    }

    document.querySelector('#cloudUserEmail').textContent = user.email || 'Signed in';
    const [{ data: homesteadId, error: homesteadError }, { data: role, error: roleError }] = await Promise.all([
      client.rpc('current_homestead_id'),
      client.rpc('current_member_role')
    ]);
    if (homesteadError || roleError) throw homesteadError || roleError;

    const hasMembership = Boolean(homesteadId);
    membership.classList.toggle('hidden', !hasMembership);
    onboarding.classList.toggle('hidden', hasMembership);
    document.querySelector('#cloudRole').textContent = role || '';
    showStatus(hasMembership
      ? 'Account connected. Local-first synchronization is available below.'
      : 'Account ready. Choose how this account joins a Homestead.');
    window.REGULA_RUSTICA_CLOUD_CONTEXT = { client, session, homesteadId, role };
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

  authForm.addEventListener('submit', event => {
    event.preventDefault();
    run(() => client.auth.signInWithPassword({
      email: document.querySelector('#cloudEmail').value.trim(),
      password: document.querySelector('#cloudPassword').value
    }));
  });

  document.querySelector('#cloudSignUp').addEventListener('click', () => run(async () => {
    const result = await client.auth.signUp({
      email: document.querySelector('#cloudEmail').value.trim(),
      password: document.querySelector('#cloudPassword').value,
      options: { data: { display_name: document.querySelector('#cloudDisplayName').value.trim() } }
    });
    if (!result.error && !result.data.session) showStatus('Check your email to confirm the account, then sign in.');
    return result;
  }));

  document.querySelector('#cloudResetRequest').addEventListener('click', () => run(() =>
    client.auth.resetPasswordForEmail(document.querySelector('#cloudEmail').value.trim(), {
      redirectTo: `${location.origin}${location.pathname}`
    }), 'If that account exists, a password-reset email has been sent.'));

  document.querySelector('#cloudSignOut').addEventListener('click', () => run(() => client.auth.signOut()));

  document.querySelector('#cloudCreateHomestead').addEventListener('click', () => run(async () => {
    const result = await client.rpc('create_homestead', {
      homestead_name: document.querySelector('#cloudHomesteadName').value.trim()
    });
    if (!result.error) await refreshAccount((await client.auth.getSession()).data.session);
    return result;
  }, 'Homestead created.'));

  document.querySelector('#cloudAcceptInvitation').addEventListener('click', () => run(async () => {
    const result = await client.rpc('accept_invitation', {
      invitation_token: document.querySelector('#cloudInvitationToken').value.trim()
    });
    if (!result.error) await refreshAccount((await client.auth.getSession()).data.session);
    return result;
  }, 'Invitation accepted.'));

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
