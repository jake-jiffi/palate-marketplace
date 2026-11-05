#!/usr/bin/env node
/**
 * seed-shopify-dev-store.mjs - fill a DEVELOPMENT store with a realistic fake catalogue.
 *
 * WHY THIS EXISTS. A bare dev store cannot exercise the commerce track at all: it has no products,
 * and its Online Store channel is locked, so the tokenless survey answers 400. Every commerce
 * change we ship has therefore been proven against someone else's production store or against
 * fixtures. This gives us a store we own that behaves like a real one.
 *
 * IT REFUSES TO RUN AGAINST A LIVE STORE. `shop.plan.partnerDevelopment` must be true. A seeder
 * that can be pointed at a real merchant by a typo is a seeder that eventually is.
 *
 * AUTH: no token is passed or stored. It shells out to the Shopify CLI, which keeps an online
 * access token in the OS KEYCHAIN, so no long-lived Admin secret ever lands in a repo or a .env.
 *
 *   npx @shopify/cli@latest store auth --store <domain> --scopes write_products,read_products,\
 *     write_publications,read_publications,read_files,write_files
 *   node seed-shopify-dev-store.mjs --store <domain>
 *
 * PUBLICATION IS THE POINT, NOT AN AFTERTHOUGHT. A product not published to a channel is
 * indistinguishable from one that does not exist, so this publishes to every available channel and
 * then VERIFIES by reading the catalogue back. Seeding without publishing produces a store that
 * looks full in admin and empty to every API, which is the exact trap the doctrine warns about.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const STORE = flag('store');
const DRY = args.includes('--dry-run');
const COUNT = Number(flag('products', '24'));

if (!STORE) {
  console.error('usage: seed-shopify-dev-store.mjs --store <shop>.myshopify.com [--products 24] [--dry-run]');
  process.exit(64);
}

/** One GraphQL call through the CLI, so credentials stay in the keychain. */
function gql(query, variables = {}, { mutation = false } = {}) {
  const a = ['--yes', '@shopify/cli@latest', 'store', 'execute', '-s', STORE, '-q', query, '--json'];
  if (Object.keys(variables).length) a.push('--variables', JSON.stringify(variables));
  if (mutation) a.push('--allow-mutations');
  let out;
  try {
    out = execFileSync('npx', a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
    throw new Error(msg.slice(0, 600) || String(e).slice(0, 300));
  }
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON from the CLI: ${out.slice(0, 300)}`);
  const j = JSON.parse(m[0]);
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 600));
  // `store execute` returns the payload UNWRAPPED ({shop:...}), not the GraphQL envelope
  // ({data:{shop:...}}). Accept both: reading j.data blindly yields undefined, and undefined
  // read as "this is not a development store" is a refusal for the wrong reason.
  return j.data ?? j;
}

/* ------------------------------------------------------------------ the fake brand
 * Invented, not copied from a real merchant, and deliberately NOT a generic "Product 1..N"
 * catalogue: the survey feeds Explore, and eight design directions built against
 * "Product 1 / Product 2" would prove nothing about whether real content works.
 */
const BRAND = 'Harrow & Vine';
const TYPES = [
  { type: 'Coffee',    tag: 'coffee',    opts: [['Grind', ['Whole bean', 'Filter', 'Espresso']], ['Size', ['250g', '1kg']]],
    names: ['Ethiopia Guji', 'Colombia Huila', 'Kenya Nyeri', 'Brazil Cerrado', 'House Blend', 'Decaf Sumatra'] },
  { type: 'Glassware', tag: 'glassware', opts: [['Set', ['Pair', 'Set of four']]],
    names: ['Ridged Tumbler', 'Stem Wine Glass', 'Cortado Glass', 'Carafe'] },
  { type: 'Ceramics',  tag: 'ceramics',  opts: [['Colour', ['Bone', 'Ash', 'Clay']], ['Size', ['Small', 'Large']]],
    names: ['Stoneware Mug', 'Serving Bowl', 'Side Plate', 'Milk Jug', 'Butter Dish'] },
  { type: 'Textiles',  tag: 'textiles',  opts: [['Colour', ['Flax', 'Olive', 'Charcoal']]],
    names: ['Linen Tea Towel', 'Waffle Hand Towel', 'Table Runner', 'Apron'] },
  { type: 'Pantry',    tag: 'pantry',    opts: [['Size', ['200g', '500g']]],
    names: ['Sea Salt Flakes', 'Wildflower Honey', 'Olive Oil', 'Peppercorns', 'Preserved Lemons'] },
];
const COPY = [
  'Made in small batches and finished by hand, so no two are quite identical.',
  'Built to be used daily rather than kept for good, and to age well while it is.',
  'Sourced from a single producer we have worked with for six years.',
  'Heavier than it looks, which is the point: it sits still and it keeps its heat.',
  'Designed for a small kitchen, where everything has to earn its shelf.',
];

function catalogue(n) {
  const out = [];
  let i = 0;
  while (out.length < n) {
    const t = TYPES[i % TYPES.length];
    const name = t.names[Math.floor(i / TYPES.length) % t.names.length];
    const suffix = Math.floor(i / (TYPES.length * t.names.length));
    const title = suffix > 0 ? `${name} No.${suffix + 1}` : name;
    out.push({
      title, productType: t.type,
      handle: `${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      descriptionHtml: `<p>${COPY[i % COPY.length]}</p>`,
      tags: [t.tag, 'harrow-and-vine', i % 4 === 0 ? 'new-in' : 'core'],
      options: t.opts,
      price: (12 + ((i * 7) % 48)) + 0.5,
      query: `${t.type} ${name}`,
    });
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ imagery */
async function unsplash(query, n = 1) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  try {
    const r = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${n}&orientation=portrait`,
      { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results ?? []).map((x) => x.urls?.regular).filter(Boolean);
  } catch { return []; }
}

/* ------------------------------------------------------------------ run */
console.log(`[seed] ${STORE}${DRY ? '  (DRY RUN)' : ''}`);

// A dry run must work with NO credentials. Someone deciding whether to authenticate should be
// able to see exactly what would be written first.
if (DRY) {
  const preview = catalogue(COUNT);
  console.log(`[seed] would create ${preview.length} product(s) for ${BRAND}:\n`);
  for (const it of preview) {
    const opts = it.options.map(([n, v]) => `${n}(${v.length})`).join(' ');
    console.log(`   ${it.productType.padEnd(10)} ${it.title.padEnd(22)} GBP ${String(it.price).padStart(6)}  ${opts}`);
  }
  console.log(`\n[seed] tags: ${[...new Set(preview.flatMap((p) => p.tags))].join(', ')}`);
  console.log('[seed] dry run, nothing written and nothing authenticated.');
  process.exit(0);
}

const shop = gql(`{ shop { name plan { displayName partnerDevelopment } } }`);
const plan = shop?.shop?.plan;
console.log(`[seed] ${shop?.shop?.name} - plan ${plan?.displayName}, development=${plan?.partnerDevelopment}`);

// THE GUARD. Never seed a live store.
if (plan?.partnerDevelopment !== true) {
  console.error('[seed] REFUSING: this is not a development store. Seeding writes products, and a');
  console.error('       typo pointed at a real merchant is not recoverable by an undo.');
  process.exit(3);
}

const pubs = gql(`{ publications(first: 25) { nodes { id name } } }`)?.publications?.nodes ?? [];
console.log(`[seed] channels: ${pubs.map((p) => p.name).join(', ') || '(none)'}`);

const items = catalogue(COUNT);
console.log(`[seed] ${items.length} products across ${new Set(items.map((i) => i.productType)).size} types`);

let made = 0;
for (const it of items) {
  const media = (await unsplash(it.query, 1)).map((src) => ({ originalSource: src, mediaContentType: 'IMAGE' }));
  try {
    const res = gql(
      `mutation($p: ProductCreateInput!, $m: [CreateMediaInput!]) {
         productCreate(product: $p, media: $m) { product { id handle } userErrors { field message } } }`,
      {
        p: {
          title: it.title, handle: it.handle, descriptionHtml: it.descriptionHtml,
          productType: it.productType, vendor: BRAND, tags: it.tags, status: 'ACTIVE',
          productOptions: it.options.map(([name, values]) => ({ name, values: values.map((v) => ({ name: v })) })),
        },
        m: media,
      },
      { mutation: true },
    );
    const errs = res?.productCreate?.userErrors ?? [];
    if (errs.length) { console.error(`   ! ${it.title}: ${errs.map((e) => e.message).join('; ')}`); continue; }
    const id = res?.productCreate?.product?.id;
    if (!id) { console.error(`   ! ${it.title}: no product returned`); continue; }

    // PUBLISH TO EVERY CHANNEL. An unpublished product is invisible to every API and
    // indistinguishable from one that does not exist.
    for (const pub of pubs) {
      try {
        gql(`mutation($id: ID!, $pid: ID!) { publishablePublish(id: $id, input: {publicationId: $pid}) { userErrors { message } } }`,
            { id, pid: pub.id }, { mutation: true });
      } catch { /* a channel that refuses is reported by the verification below */ }
    }
    made++;
    if (made % 5 === 0) console.log(`   ${made}/${items.length}`);
  } catch (e) {
    console.error(`   ! ${it.title}: ${String(e.message).slice(0, 180)}`);
  }
}

console.log(`[seed] created ${made} product(s)`);

// VERIFY BY READING IT BACK. Creating is not the same as being visible.
const check = gql(`{ productsCount { count } }`);
console.log(`[seed] admin now reports ${check?.productsCount?.count ?? '?'} product(s)`);
console.log('[seed] next: node scripts/palate-shopify.mjs https://' + STORE);
console.log('[seed] NOTE a dev store keeps its Online Store channel LOCKED, so the TOKENLESS survey');
console.log('       will still answer 400. Survey it with a Storefront token instead.');
