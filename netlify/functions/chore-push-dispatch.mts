import webPush from 'web-push';
import { openWindowChoreCount, reminderText } from '../../chore-push-core.mjs';

type Claim = {
  delivery_id: string; lease_token: string; endpoint: string;
  p256dh: string; auth_secret: string; chore_window_id: string;
  window_name: string; work_date: string; task_context: unknown[];
};

const allowedHosts = new Set([
  'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'
]);

function safeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export default async () => {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  const senderToken = Netlify.env.get('CHORE_PUSH_SENDER_TOKEN');
  const publicKey = Netlify.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Netlify.env.get('VAPID_PRIVATE_KEY');
  if (!url || !key || !senderToken || !publicKey || !privateKey) {
    console.error('Chore push sender is not configured.');
    return;
  }
  webPush.setVapidDetails('https://regula-rustica.netlify.app', publicKey, privateKey);
  const rpc = async (name: string, body: object) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`${name} returned ${response.status}`);
    return response.json();
  };
  const claims = await rpc('claim_due_chore_push', { sender_token: senderToken }) as Claim[];
  for (const claim of claims) {
    let outcome = 'retry';
    try {
      if (!safeEndpoint(claim.endpoint)) throw new Error('Untrusted push endpoint');
      const count = openWindowChoreCount(claim.task_context, claim.chore_window_id, claim.work_date);
      if (!count) outcome = 'no_work';
      else {
        const message = reminderText(claim.window_name, count);
        await webPush.sendNotification({
          endpoint: claim.endpoint,
          keys: { p256dh: claim.p256dh, auth: claim.auth_secret }
        }, JSON.stringify({ ...message, windowId: claim.chore_window_id,
          workDate: claim.work_date, url: '/?view=today' }), { TTL: 3600, urgency: 'normal' });
        outcome = 'sent';
      }
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) outcome = 'expired';
      else console.error('Chore reminder delivery failed:', error?.statusCode || error?.message || error);
    }
    await rpc('finish_chore_push', { sender_token: senderToken,
      delivery_id: claim.delivery_id, lease_token: claim.lease_token, outcome });
  }
};

export const config = { schedule: '*/5 * * * *' };
