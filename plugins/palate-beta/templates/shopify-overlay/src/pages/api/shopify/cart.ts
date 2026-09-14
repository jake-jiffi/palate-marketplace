import { services, COOKIE, postBody, buyerIp } from '../../../lib/shopify/server';
export const prerender = false;
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function POST(context: any) {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'same-origin' };
  let body;
  try { body = await postBody(context); } catch { return new Response('Invalid shopping request. Reload the page.', { status: 403, headers }); }
  try {
    const { commerce } = await services();
    const receipt = await commerce.execute(context.cookies.get(COOKIE)?.value, body.token, body, buyerIp(context));
    if (receipt.status === 303) return new Response(null, { status: 303, headers: { ...headers, Location: receipt.location } });
    if (context.request.headers.get('accept')?.includes('application/json')) return Response.json(receipt, { status: receipt.status, headers });
    const restore = receipt.code === 'context-conflict' ? `<form method="post" action="/api/shopify/session"><input type="hidden" name="restore" value="${escape(body.token)}"><input type="hidden" name="returnTo" value="/cart"><button>Continue with this tab’s cart</button></form>` : '';
    return new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shopping update</title></head><body><main><h1>Shopping update</h1><p role="status">${escape(receipt.message)}</p>${restore}<p><a href="/cart">Review your cart</a></p><p><a href="/collections">Continue shopping</a></p></main></body></html>`, { status: receipt.status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  } catch { return new Response('Shopping storage is unavailable. No further action has been attempted. Review your cart before trying again.', { status: 503, headers }); }
}
