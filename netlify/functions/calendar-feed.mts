import { serializeCalendarFeed } from '../../calendar-subscription.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export default async function handler(req: Request, context: { params: { token?: string } }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: noStore });
  const token = String(context.params.token || '').replace(/\.ics$/i, '');
  if (!UUID.test(token)) return new Response('Calendar not found', { status: 404, headers: noStore });
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) return new Response('Calendar unavailable', { status: 503, headers: noStore });
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/read_calendar_subscription`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_token: token })
    });
    if (!response.ok) return new Response('Calendar unavailable', { status: 502, headers: noStore });
    const feed = await response.json();
    if (!feed) return new Response('Calendar not found', { status: 404, headers: noStore });
    const body = serializeCalendarFeed(feed);
    const headers = {
      ...noStore,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="regula-rustica.ics"'
    };
    return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
  } catch {
    return new Response('Calendar unavailable', { status: 502, headers: noStore });
  }
}

export const config = {
  path: '/calendar/:token',
  method: ['GET', 'HEAD'],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
