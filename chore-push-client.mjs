import { premiumSyncAvailable } from './sync/premium-access.mjs';

const status = document.querySelector('#choreReminderStatus');
const toggle = document.querySelector('#choreReminderToggle');
const toggleState = document.querySelector('#choreReminderToggleState');
const testButton = document.querySelector('#choreReminderTest');
const deviceKey = 'regulaRusticaChorePushDeviceId';
let busy = false;

function setSwitch(enabled) {
  toggle.setAttribute('aria-checked', String(enabled));
  toggleState.textContent = enabled ? 'On' : 'Off';
}

function supported() {
  return Boolean(window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window);
}
function context() { return window.REGULA_RUSTICA_CLOUD_CONTEXT; }
function deviceId() {
  let id = localStorage.getItem(deviceKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(deviceKey, id); }
  return id;
}
function bytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}
async function registration() { return navigator.serviceWorker.ready; }
async function ownRow(client) {
  const { data, error } = await client.from('chore_push_subscriptions')
    .select('id,endpoint,enabled').eq('device_id', deviceId()).maybeSingle();
  if (error) throw error;
  return data;
}
async function disable(client) {
  const row = await ownRow(client);
  if (row) {
    const { error } = await client.from('chore_push_subscriptions').delete().eq('id', row.id);
    if (error) throw error;
  }
  const existing = await (await registration()).pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
}
window.RegulaRusticaChorePushDisable = async () => {
  if (!supported() || !context()?.session || !localStorage.getItem(deviceKey)) return;
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  try {
    const row = await ownRow(context().client);
    if (row) {
      const { error } = await context().client.from('chore_push_subscriptions').delete().eq('id', row.id);
      if (error) throw error;
    }
  } catch (error) {
    // Signing out must remain possible offline. A stale endpoint is disabled
    // on the sender's first 404/410 response.
    console.warn('Could not remove reminder enrollment during sign-out.', error);
  }
};
async function refresh() {
  if (busy) return;
  toggle.disabled = true;
  testButton.classList.add('hidden');
  if (!supported()) {
    setSwitch(false);
    status.textContent = 'Push reminders are unavailable in this browser. On iPhone, add the app to your Home Screen first.';
    return;
  }
  if (!premiumSyncAvailable(context())) {
    setSwitch(false);
    status.textContent = 'Connect a Premium Homestead to enable reminders on this device.';
    return;
  }
  try {
    const keyCheck = await fetch('/.netlify/functions/chore-push-public-key', { cache: 'no-store' });
    if (!keyCheck.ok) {
      setSwitch(false);
      status.textContent = 'Reminders are not configured on this site yet.';
      return;
    }
    const row = await ownRow(context().client);
    const subscription = await (await registration()).pushManager.getSubscription();
    const enabled = Boolean(row?.enabled && subscription?.endpoint === row.endpoint);
    status.textContent = enabled
      ? 'Reminders are on for this device. You can turn them off at any time.'
      : 'Reminders are off on this device.';
    setSwitch(enabled);
    toggle.disabled = false;
    testButton.classList.toggle('hidden', !enabled);
  } catch (error) {
    setSwitch(false);
    status.textContent = 'Could not check reminder settings. Please try again.';
    console.warn('Chore reminder status failed.', error);
  }
}

toggle.addEventListener('click', async () => {
  if (busy || !premiumSyncAvailable(context())) return;
  busy = true;
  toggle.disabled = true;
  let failureMessage = '';
  try {
    const current = await ownRow(context().client);
    const worker = await registration();
    const existing = await worker.pushManager.getSubscription();
    if (current?.enabled && existing?.endpoint === current.endpoint) {
      await disable(context().client);
      status.textContent = 'Reminders are off on this device.';
    } else {
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked in this browser’s settings.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const keyResponse = await fetch('/.netlify/functions/chore-push-public-key', { cache: 'no-store' });
      if (!keyResponse.ok) throw new Error('Reminders are not configured yet.');
      const { publicKey } = await keyResponse.json();
      const subscription = existing || await worker.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes(publicKey)
      });
      const json = subscription.toJSON();
      const { error } = await context().client.rpc('register_chore_push_subscription', {
        device_id: deviceId(), endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh, auth_secret: json.keys?.auth
      });
      if (error) throw error;
      status.textContent = 'Reminders are on for this device.';
    }
  } catch (error) {
    failureMessage = error.message || 'Could not change reminders. Please try again.';
  } finally {
    busy = false;
    await refresh();
    if (failureMessage) status.textContent = failureMessage;
  }
});

testButton.addEventListener('click', async () => {
  try {
    const worker = await registration();
    await worker.showNotification('A gentle reminder', {
      body: 'Your Farm Book can remind you when a Chore Window ends with work still open.',
      icon: './icons/icon-192.png', tag: 'chore-reminder-test',
      data: { url: './?view=today' }
    });
  } catch (error) { status.textContent = error.message || 'Test reminder could not be shown.'; }
});

window.addEventListener('regula-rustica:cloud-context', refresh);
window.addEventListener('focus', refresh);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'chore-window-reminder-open') {
    document.querySelector('[data-view="today"]')?.click();
  }
});
refresh();
