import { premiumSyncAvailable } from './sync/premium-access.mjs';

const dialog = document.querySelector('#calendarSubscriptionDialog');
const status = document.querySelector('#calendarSubscriptionStatus');
const controls = document.querySelector('#calendarSubscriptionControls');
const create = document.querySelector('#calendarSubscriptionCreate');
const copy = document.querySelector('#calendarSubscriptionCopy');
const revoke = document.querySelector('#calendarSubscriptionRevoke');
const linkLabel = document.querySelector('#calendarSubscriptionLinkLabel');
const link = document.querySelector('#calendarSubscriptionLink');
let active = false;
let shownForHomestead = null;

function context() { return window.REGULA_RUSTICA_CLOUD_CONTEXT; }
function canManage() { return premiumSyncAvailable(context()) && context()?.canManageHomestead; }
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}
function showLink(token) {
  // Deploy Preview origins are temporary. Always hand out the stable site URL.
  link.value = `https://regula-rustica.netlify.app/calendar/${token}.ics`;
  linkLabel.classList.remove('hidden');
  copy.classList.remove('hidden');
}
function clearLink() {
  link.value = '';
  linkLabel.classList.add('hidden');
  copy.classList.add('hidden');
}
function render() {
  controls.classList.toggle('hidden', !canManage());
  if (!context()?.session) setStatus('Sign in under Settings → Account & Storage to share a calendar.');
  else if (!context()?.homesteadId) setStatus('Join a Homestead before sharing its Calendar.');
  else if (!premiumSyncAvailable(context())) setStatus('An active Premium Homestead is required for Cloud Sync and calendar subscriptions.');
  else if (!context()?.canManageHomestead) setStatus('Only a Homestead Steward can manage its private subscription link.');
  create.textContent = active ? 'Replace private link' : 'Create private link';
  revoke.classList.toggle('hidden', !active);
}
async function refresh() {
  render();
  if (!canManage()) return;
  const result = await context().client.rpc('calendar_subscription_status');
  if (result.error) {
    const code = result.error.code ? ` (${result.error.code})` : '';
    setStatus(`Could not check calendar sharing${code}. Refresh and try again.`, true);
    controls.classList.add('hidden');
    return;
  }
  active = Boolean(result.data);
  render();
  setStatus(active ? 'A private subscription is active. Replace it to receive a new copyable link.' : 'No private subscription link is active.');
}

document.querySelector('#calendarSubscribe').addEventListener('click', () => {
  dialog.showModal();
  refresh().catch(() => setStatus('Calendar sharing could not be checked. Try again later.', true));
});
document.querySelector('#calendarSubscriptionClose').addEventListener('click', () => dialog.close());

create.addEventListener('click', async () => {
  if (!canManage()) return;
  if (active && !window.confirm('Replace the private calendar link? Existing subscriptions will stop updating until the new link is added.')) return;
  create.disabled = true;
  try {
    const result = await context().client.rpc('rotate_calendar_subscription');
    if (result.error) throw result.error;
    active = true;
    shownForHomestead = context().homesteadId;
    showLink(result.data);
    render();
    setStatus('Private link ready. Copy it into your calendar app’s Subscribe by URL option. It is shown only now.');
  } catch (error) { setStatus(error.message || 'The private link could not be created.', true); }
  finally { create.disabled = false; }
});

revoke.addEventListener('click', async () => {
  if (!canManage() || !window.confirm('Stop sharing this calendar? Every app using the current link will lose access.')) return;
  revoke.disabled = true;
  try {
    const result = await context().client.rpc('revoke_calendar_subscription');
    if (result.error) throw result.error;
    active = false;
    clearLink();
    render();
    setStatus('Calendar sharing stopped. The old subscription link no longer works.');
  } catch (error) { setStatus(error.message || 'Sharing could not be stopped.', true); }
  finally { revoke.disabled = false; }
});

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    setStatus('Private subscription link copied.');
  } catch { link.select(); setStatus('Copy is unavailable. Select and copy the link manually.', true); }
});

window.addEventListener('regula-rustica:cloud-context', () => {
  if (shownForHomestead && shownForHomestead !== context()?.homesteadId) {
    clearLink();
    shownForHomestead = null;
    active = false;
  }
  if (dialog.open) refresh().catch(() => setStatus('Calendar sharing could not be checked.', true));
});
