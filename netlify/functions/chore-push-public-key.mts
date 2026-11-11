export default async (request: Request) => {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const key = Netlify.env.get('VAPID_PUBLIC_KEY');
  if (!key) return Response.json({ error: 'Chore reminders are not configured.' }, { status: 503 });
  return Response.json({ publicKey: key }, { headers: { 'Cache-Control': 'no-store' } });
};
