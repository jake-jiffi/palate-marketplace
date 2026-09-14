import { digest } from './session.mjs';
import { summary } from './storefront.mjs';

const response = (status, code, message, extra = {}) => ({ status, code, message, ...extra });
const conflict = (code, message) => response(409, code, message);
const arr = (value) => Array.isArray(value) ? value : [];
export const variantQuote = (v, country) => ({ merchandiseId: v.id, price: v.price, country });
export const cartQuote = (cart) => ({ country: cart?.buyerIdentity?.countryCode,
  currency: cart?.cost?.totalAmount?.currencyCode, cost: cart?.cost,
  lines: arr(cart?.lines?.nodes).map(l => ({ merchandiseId: l.merchandise.id, quantity: l.quantity, price: l.merchandise.price })),
  codes: arr(cart?.discountCodes).map(d => ({ code: d.code, applicable: d.applicable })) });
const decimal = value => { const [whole, fraction = ''] = value.split('.'); return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`; };
const priceEqual = (a, b) => validMoney(a) && validMoney(b) && a.currencyCode === b.currencyCode && decimal(a.amount) === decimal(b.amount);
const quantity = value => /^\d{1,2}$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 99 ? Number(value) : null;
const validMoney = value => typeof value?.amount === 'string' && /^\d{1,13}(?:\.\d{1,4})?$/.test(value.amount) && Number.isFinite(Number(value.amount)) && /^[A-Z]{3}$/.test(value.currencyCode);
export function validCart(cart) {
  const lines = cart?.lines?.nodes;
  return Array.isArray(lines) && validMoney(cart.cost?.subtotalAmount) && validMoney(cart.cost?.totalAmount)
    && cart.cost.subtotalAmount.currencyCode === cart.cost.totalAmount.currencyCode
    && Number.isSafeInteger(cart.totalQuantity) && cart.totalQuantity === lines.reduce((n, line) => n + line.quantity, 0)
    && lines.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99
      && validMoney(line.cost?.totalAmount) && validMoney(line.merchandise?.price)
      && line.cost.totalAmount.currencyCode === cart.cost.totalAmount.currencyCode && line.merchandise.price.currencyCode === cart.cost.totalAmount.currencyCode);
}
export function checkoutLocation(value, domain, allowedHosts = []) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port
    && [domain, ...allowedHosts].includes(u.hostname) && (/^\/cart\/c\/[^/]+\/?$/.test(u.pathname) || /^\/(?:\d+\/)?checkouts\//.test(u.pathname)) ? u.href : null; } catch { return null; }
}

/** HTTP-independent coordinator. Every upstream write happens after a durable atomic claim. */
export class Commerce {
  /** @param {any} store @param {any} api @param {{checkoutHosts?: string[]}} options */
  constructor(store, api, { checkoutHosts = [] } = {}) { this.store = store; this.api = api; this.checkoutHosts = checkoutHosts; }
  async execute(sid, token, input = {}, buyerIp) {
    const form = await this.store.readForm(token);
    if (!form) return conflict('form-expired', 'This form has expired. Reload the page to continue.');
    if (form.sid !== sid) return conflict('context-conflict', 'This tab belongs to a different cart. Continue with this tab’s cart before submitting again.', { });
    const state = await this.store.read(sid);
    if (!state) return conflict('session-expired', 'Your shopping session has expired. Establish a new session to continue.');
    if (state.country !== this.api.country) return conflict('market-conflict', 'The market has changed. Restore the original market before continuing.');
    const kind = form.kind;
    const payload = { kind, quote: form.quote };
    if (['add', 'update'].includes(kind)) {
      payload.quantity = quantity(input.quantity);
      if (payload.quantity === null) return response(422, 'quantity', 'Enter a whole quantity from 1 to 99.');
    }
    if (kind === 'discount') {
      if (typeof input.codes !== 'string' || input.codes.length > 200) return response(422, 'discount', 'Enter up to five discount codes.');
      payload.codes = [...new Set(input.codes.split(',').map(s => s.trim()).filter(Boolean))];
      if (payload.codes.length > 5 || payload.codes.some(s => !/^[\w -]{1,40}$/.test(s))) return response(422, 'discount', 'Use valid discount codes, separated by commas.');
    }
    if (['recover', 'ack'].includes(kind) && input.confirm !== 'yes') return response(422, 'confirmation', 'Confirm the displayed items, market, prices and discount codes to continue.');
    if (kind === 'recover' && input.recovery === 'selection') {
      payload.quote = { ...form.quote, lines: arr(form.quote?.lines).filter((_line, index) => input[`keep.${index}`] === 'yes') };
    }
    if (!['add', 'update', 'remove', 'discount', 'recover', 'ack', 'checkout'].includes(kind)) return response(422, 'operation', 'This shopping action is unavailable.');
    const claim = await this.store.claim(sid, form, payload);
    if (claim.code === 'replay') return claim.receipt;
    if (claim.code !== 'claimed') return conflict(claim.code, ['unknown', 'pending'].includes(claim.code)
      ? 'Another cart action is pending or its outcome is unknown. Review your cart before recovering it. The action has not been repeated.'
      : 'Your cart changed in another tab. Reload this page before continuing.');
    const current = claim.session;
    const finish = async (receipt, updates = {}) => {
      if (kind === 'checkout' && receipt.status !== 303) updates.needsAcknowledgement = true;
      const done = await this.store.complete(sid, form, claim, { receipt, ...updates });
      return done.code === 'completed' ? receipt : conflict('owner-conflict', 'Another cart action superseded this request. Reload your cart.');
    };
    let dispatched = false;
    try {
      // Recovery claims a new generation before touching Shopify. Its exact, server-held quote
      // is revalidated below; a known rejection leaves an empty generation for explicit retry.
      let cart = kind !== 'recover' && current.cartId ? await this.api.cart(current.cartId, buyerIp) : null;
      if (cart && !validCart(cart)) return await finish(response(502, 'invalid-cart', 'The current cart contains invalid prices or quantities. Checkout is paused until the shop returns valid totals.'));
      if (kind !== 'recover' && current.cartId && !cart) return await finish(conflict('cart-expired', 'This Shopify cart expired. Review and explicitly create a new cart.'));
      if (cart && (cart.buyerIdentity?.countryCode !== current.country || cart.cost?.totalAmount?.currencyCode !== current.currency))
        return await finish(conflict('market-conflict', 'Cart market or currency changed. Review and recover the cart before continuing.'));
      if (kind === 'checkout' || kind === 'ack') {
        if (!cart?.lines?.nodes?.length) return await finish(conflict('empty-cart', 'Add an available item before checkout.'));
        if (digest(cartQuote(cart)) !== digest(form.quote)) return await finish(conflict('cart-changed', 'Prices, items or discounts changed. Review the current cart and confirm its totals.'), { summary: summary(cart), needsAcknowledgement: true });
        if (kind === 'ack') return await finish(response(200, 'acknowledged', 'The current cart totals are confirmed.'), { summary: summary(cart), needsAcknowledgement: false });
        if (current.needsAcknowledgement) return await finish(conflict('confirmation-required', 'Confirm the current cart totals before checkout.'));
        if (cart.lines.nodes.some(l => !l.merchandise.availableForSale || l.merchandise.product.requiresSellingPlan))
          return await finish(conflict('unavailable', 'An item is unavailable or requires a selling plan. Update the cart before checkout.'));
        const location = checkoutLocation(cart.checkoutUrl, this.api.domain, this.checkoutHosts);
        if (!location) return await finish(response(502, 'checkout-host', 'Shopify returned an unrecognised checkout address. Please contact the shop.'));
        return await finish(response(303, 'checkout', 'Continue to secure Shopify checkout.', { location }));
      }
      let mutation, variables;
      if (kind === 'add') {
        const v = await this.api.variant(form.quote?.merchandiseId, buyerIp);
        if (!v || !v.availableForSale || v.product.requiresSellingPlan) return await finish(conflict('unavailable', 'This exact variant cannot be purchased. Choose an available one.'));
        if (form.quote.country !== current.country || !priceEqual(v.price, form.quote.price) || v.price.currencyCode !== current.currency)
          return await finish(conflict('price-changed', 'This variant’s price or market changed. Reload the product and confirm its current price.'));
        const existing = cart?.lines.nodes.find(l => l.merchandise.id === v.id);
        if ((existing?.quantity ?? 0) + payload.quantity > 99) return await finish(response(422, 'quantity', 'A cart line cannot exceed 99 items.'));
        mutation = cart ? 'add' : 'create'; variables = { lines: [{ merchandiseId: v.id, quantity: payload.quantity }], codes: arr(current.discountCodes) };
      } else if (kind === 'update' || kind === 'remove') {
        const line = cart?.lines.nodes.find(l => l.id === form.quote?.lineId);
        if (!line) return await finish(conflict('line-changed', 'This line is no longer in your cart. Reload before continuing.'));
        if (kind === 'update' && (!line.merchandise.availableForSale || !priceEqual(line.merchandise.price, form.quote.price)))
          return await finish(conflict('price-changed', 'This item’s availability or price changed. Review the current cart.'));
        mutation = kind; variables = kind === 'update' ? { lines: [{ id: line.id, quantity: payload.quantity }] } : { ids: [line.id] };
      } else if (kind === 'discount') {
        if (!cart) return await finish(conflict('empty-cart', 'Add an item before applying a discount.'));
        mutation = 'discount'; variables = { codes: payload.codes };
      } else if (kind === 'recover') {
        const q = payload.quote;
        if (!q || q.country !== current.country || q.currency !== current.currency || !Array.isArray(q.lines) || q.lines.length > 100)
          return await finish(conflict('recovery-empty', 'Review available items and the original market before creating a new cart.'));
        for (const line of q.lines) {
          const v = await this.api.variant(line.merchandiseId, buyerIp);
          if (!v?.availableForSale || v.product.requiresSellingPlan || !quantity(line.quantity) || !priceEqual(v.price, line.price))
            return await finish(conflict('recovery-changed', 'An item or price changed. Review a fresh recovery quote before confirming again.'));
        }
        mutation = 'create'; variables = { lines: q.lines.map(l => ({ merchandiseId: l.merchandiseId, quantity: l.quantity })), codes: arr(q.codes).map(d => typeof d === 'string' ? d : d.code) };
      }
      dispatched = true;
      const result = await this.api.mutate(mutation, cart?.id, variables, buyerIp);
      if (!result.cart && !result.userErrors.length) throw new Error('Ambiguous cart response');
      const newCart = result.cart;
      if (newCart && !validCart(newCart)) throw new Error('Invalid cart after mutation');
      const rejected = arr(newCart?.discountCodes).filter(d => !d.applicable);
      const messages = [...result.userErrors.map(e => e.message), ...result.warnings.map(w => w.message), ...rejected.map(d => `Discount ${d.code} was not applied.`)];
      // Warnings (including stock adjustment) are visible and never reported as an exact success.
      const receipt = response(messages.length ? 409 : 200, messages.length ? 'cart-adjusted' : 'cart-updated', messages.join(' ') || 'Your cart is updated.');
      return await finish(receipt, newCart ? { cartId: newCart.id, summary: summary(newCart),
        codes: arr(newCart.discountCodes).map(d => d.code), needsAcknowledgement: messages.length > 0 || kind === 'recover' } : {});
    } catch {
      if (dispatched || kind === 'recover') {
        await this.store.unknown(sid, form, claim).catch(() => {});
        return response(503, 'unknown', 'The cart action may have reached Shopify. It will not be repeated. Review the cart and explicitly recover if needed.');
      }
      // Reads can safely be retried with a fresh form. The known failure still has a receipt.
      return await finish(response(503, 'shop-unavailable', 'The shop could not be reached. Reload and try again.'));
    }
  }

  async recoveryQuote(state, buyerIp) {
    const cart = state.cartId ? await this.api.cart(state.cartId, buyerIp) : null;
    const original = cart ? cartQuote(cart) : state.recoveryIntent?.lines ? state.recoveryIntent : state.pending?.payload?.quote?.lines ? state.pending.payload.quote
      : state.summary ? { lines: arr(state.summary.lines).map(l => ({ merchandiseId: l.merchandise.id, quantity: l.quantity })) } : { lines: [] };
    // A first cartCreate whose response was lost has no returned capability. Present its stored
    // purchase intent explicitly; never infer that Shopify did or did not apply it.
    if (!original.lines.length && state.pending?.payload?.kind === 'add') original.lines = [{ merchandiseId: state.pending.payload.quote.merchandiseId, quantity: state.pending.payload.quantity }];
    const lines = [];
    for (const line of arr(original.lines)) {
      const v = await this.api.variant(line.merchandiseId, buyerIp);
      lines.push({ ...line, price: v?.price ?? line.price, title: v?.product?.title ?? 'Unavailable item', available: Boolean(v?.availableForSale && !v.product.requiresSellingPlan) });
    }
    const codes = state.pending?.payload?.kind === 'discount' ? state.pending.payload.codes : cart?.discountCodes ?? state.recoveryIntent?.codes ?? state.discountCodes;
    return { country: state.country, currency: state.currency, lines, codes: arr(codes).map(d => typeof d === 'string' ? { code: d, applicable: null } : d) };
  }
}
