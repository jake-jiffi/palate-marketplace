import { services, COOKIE, postBody, safeReturn, setSession } from '../../../lib/shopify/server';
export const prerender = false;
export async function POST(context: any) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const body = await postBody(context); const { store, api } = await services();
    // Only the caller's own cookie selects a session. A form token is a bearer value and never does.
    let sid = context.cookies.get(COOKIE)?.value; const state = await store.read(sid);
    if (!state) { const market = await api.localisation(); const session = await store.create(market.country, market.currency); sid = session.sid; }
    // Only this explicit establishment endpoint writes the opaque cookie.
    setSession(context, sid);
    if (context.request.headers.get('accept')?.includes('application/json')) return Response.json({ established: true }, { headers });
    return new Response(null, { status: 303, headers: { ...headers, Location: safeReturn(body.returnTo) } });
  } catch { return new Response('Your shopping session could not be established. Please retry.', { status: 503, headers }); }
}
