export const API_VERSION = '2026-07';
const MONEY = 'amount currencyCode';
const VARIANT = `id title availableForSale requiresShipping price{${MONEY}} compareAtPrice{${MONEY}} selectedOptions{name value} image{url altText width height} product{id handle title requiresSellingPlan}`;
const CARD = `id handle title description availableForSale requiresSellingPlan featuredImage{url altText width height} priceRange{minVariantPrice{${MONEY}} maxVariantPrice{${MONEY}}}`;
const CART = `id checkoutUrl totalQuantity buyerIdentity{countryCode} discountCodes{code applicable} cost{subtotalAmount{${MONEY}} totalAmount{${MONEY}}} lines(first:100){pageInfo{hasNextPage endCursor} nodes{id quantity cost{totalAmount{${MONEY}}} merchandise{... on ProductVariant{${VARIANT}}}}}`;
const RESULT = `cart{${CART}} userErrors{code field message} warnings{code message target}`;

export class StorefrontError extends Error {
  constructor(code, message = 'The shop is unavailable. Please try again.') { super(message); this.code = code; }
}
export const money = (m) => m && Number.isFinite(Number(m.amount))
  ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: m.currencyCode }).format(Number(m.amount)) : 'Price unavailable';
export function summary(cart) {
  if (!cart) return null;
  return { country: cart.buyerIdentity?.countryCode, currency: cart.cost?.totalAmount?.currencyCode,
    totalQuantity: cart.totalQuantity, cost: cart.cost, discountCodes: cart.discountCodes ?? [],
    lines: cart.lines.nodes.map((l) => ({ id: l.id, quantity: l.quantity, cost: l.cost, merchandise: l.merchandise })) };
}

export class Storefront {
  constructor({ domain, token, country = 'AU', fetcher = fetch, timeoutMs = 8000 }) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain ?? '')) throw new Error('Use the stable myshopify.com domain');
    if (!token) throw new Error('Shopify Storefront token is required');
    if (!/^[A-Z]{2}$/.test(country)) throw new Error('Invalid country');
    this.domain = domain; this.token = token; this.country = country; this.fetcher = fetcher; this.timeoutMs = timeoutMs;
  }
  async query(query, variables = {}, buyerIp) {
    const headers = { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': this.token };
    if (buyerIp) headers['Shopify-Storefront-Buyer-IP'] = buyerIp;
    let res;
    try { res = await this.fetcher(`https://${this.domain}/api/${API_VERSION}/graphql.json`, {
      method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(this.timeoutMs),
    }); } catch { throw new StorefrontError('network'); }
    if (!res.ok) throw new StorefrontError(res.status === 429 ? 'throttled' : 'http');
    const version = res.headers.get('x-shopify-api-version');
    if (version && version !== API_VERSION) throw new StorefrontError('api-version-changed');
    let body;
    try { body = await res.json(); } catch { throw new StorefrontError('malformed'); }
    if (body.errors?.length || !body.data || typeof body.data !== 'object') throw new StorefrontError('graphql');
    return body.data;
  }
  async localisation() {
    const d = await this.query('query($country:CountryCode!) @inContext(country:$country){localization{country{isoCode currency{isoCode}}}}', { country: this.country });
    if (d.localization?.country?.isoCode !== this.country) throw new StorefrontError('country-unavailable');
    return { country: this.country, currency: d.localization.country.currency.isoCode };
  }
  /** @param {string|null} cursor @param {number} first */
  async collections(cursor = null, first = 24) {
    return (await this.query(`query($cursor:String,$first:Int!,$country:CountryCode!) @inContext(country:$country){collections(first:$first,after:$cursor){pageInfo{hasNextPage endCursor} nodes{handle title description image{url altText width height}}}}`, { cursor, first, country: this.country })).collections;
  }
  /** @param {string} handle @param {any} options */
  async collection(handle, { cursor = null, first = 24, sort = 'COLLECTION_DEFAULT', reverse = false, filters = [] } = {}) {
    const d = await this.query(`query($handle:String!,$cursor:String,$first:Int!,$sort:ProductCollectionSortKeys!,$reverse:Boolean!,$filters:[ProductFilter!],$country:CountryCode!) @inContext(country:$country){collection(handle:$handle){handle title description products(first:$first,after:$cursor,sortKey:$sort,reverse:$reverse,filters:$filters){pageInfo{hasNextPage endCursor} filters{id label type values{id label count input}} nodes{${CARD}}}}}`, { handle, cursor, first, sort, reverse, filters, country: this.country });
    return d.collection;
  }
  /** @param {string} q @param {any} options */
  async search(q, { cursor = null, first = 24, sort = 'RELEVANCE', reverse = false, filters = [] } = {}) {
    return (await this.query(`query($q:String!,$cursor:String,$first:Int!,$sort:SearchSortKeys!,$reverse:Boolean!,$filters:[ProductFilter!],$country:CountryCode!) @inContext(country:$country){search(query:$q,types:[PRODUCT],first:$first,after:$cursor,sortKey:$sort,reverse:$reverse,productFilters:$filters){pageInfo{hasNextPage endCursor} productFilters{id label type values{id label count input}} nodes{... on Product{${CARD}}}}}`, { q, cursor, first, sort, reverse, filters, country: this.country })).search;
  }
  async product(handle, { variantId, options, buyerIp } = {}) {
    const d = await this.query(`query($h:String!,$options:[SelectedOptionInput!]!,$country:CountryCode!) @inContext(country:$country){product(handle:$h){${CARD} options{name values} images(first:20){nodes{url altText width height}} selectedOrFirstAvailableVariant{${VARIANT}} variantBySelectedOptions(selectedOptions:$options,ignoreUnknownOptions:false){${VARIANT}}}}`, { h: handle, options: options ?? [], country: this.country }, buyerIp);
    const product = d.product;
    if (!product) return null;
    const exactOptions = !options?.length || (options.length === product.options.length && new Set(options.map(o => o.name)).size === options.length && options.every(o => product.options.some(p => p.name === o.name && p.values.includes(o.value))));
    let variant = options?.length ? exactOptions ? product.variantBySelectedOptions : null : product.selectedOrFirstAvailableVariant;
    if (variantId !== undefined && variantId !== null) {
      const id = variantId.startsWith('gid://') ? variantId : `gid://shopify/ProductVariant/${variantId}`;
      variant = await this.variant(id, buyerIp);
      if (variant?.product?.handle !== handle) variant = null;
    }
    return { ...product, selectedVariant: variant };
  }
  async variant(id, buyerIp) {
    if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id)) return null;
    return (await this.query(`query($id:ID!,$country:CountryCode!) @inContext(country:$country){node(id:$id){... on ProductVariant{${VARIANT}}}}`, { id, country: this.country }, buyerIp)).node;
  }
  async cart(id, buyerIp) {
    const cart = (await this.query(`query($id:ID!){cart(id:$id){${CART}}}`, { id }, buyerIp)).cart;
    // The same cart page must never hide lines beyond its first connection page.
    if (cart) while (cart.lines.pageInfo.hasNextPage) {
      const next = (await this.query(`query($id:ID!,$cursor:String!){cart(id:$id){lines(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id quantity cost{totalAmount{${MONEY}}} merchandise{... on ProductVariant{${VARIANT}}}}}}}`, { id, cursor: cart.lines.pageInfo.endCursor }, buyerIp)).cart;
      if (!next?.lines || next.lines.pageInfo.endCursor === cart.lines.pageInfo.endCursor) throw new StorefrontError('incomplete-cart');
      cart.lines.nodes.push(...next.lines.nodes); cart.lines.pageInfo = next.lines.pageInfo;
    }
    return cart;
  }
  async mutate(kind, id, payload, buyerIp) {
    const definitions = {
      create: [`mutation($input:CartInput!){cartCreate(input:$input){${RESULT}}}`, { input: { lines: payload.lines, buyerIdentity: { countryCode: this.country }, discountCodes: payload.codes ?? [] } }, 'cartCreate'],
      add: [`mutation($id:ID!,$lines:[CartLineInput!]!){cartLinesAdd(cartId:$id,lines:$lines){${RESULT}}}`, { id, lines: payload.lines }, 'cartLinesAdd'],
      update: [`mutation($id:ID!,$lines:[CartLineUpdateInput!]!){cartLinesUpdate(cartId:$id,lines:$lines){${RESULT}}}`, { id, lines: payload.lines }, 'cartLinesUpdate'],
      remove: [`mutation($id:ID!,$ids:[ID!]!){cartLinesRemove(cartId:$id,lineIds:$ids){${RESULT}}}`, { id, ids: payload.ids }, 'cartLinesRemove'],
      discount: [`mutation($id:ID!,$codes:[String!]!){cartDiscountCodesUpdate(cartId:$id,discountCodes:$codes){${RESULT}}}`, { id, codes: payload.codes }, 'cartDiscountCodesUpdate'],
    };
    const [q, variables, field] = definitions[kind] ?? [];
    if (!q) throw new Error('Unsupported cart operation');
    const result = (await this.query(q, variables, buyerIp))[field];
    if (!result || !Array.isArray(result.userErrors) || !Array.isArray(result.warnings)) throw new StorefrontError('malformed-mutation');
    // A follow-up read can fail after a mutation succeeded. The journal deliberately treats that
    // as unknown, rather than issuing the mutation again or inventing an empty/successful cart.
    if (result.cart?.id && result.cart.lines?.pageInfo?.hasNextPage) result.cart = await this.cart(result.cart.id, buyerIp);
    return result;
  }
}
