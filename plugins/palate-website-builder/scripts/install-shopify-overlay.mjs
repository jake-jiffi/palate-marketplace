#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, resolveProject, LEGACY_MARKERS } from './live/project.mjs';
import { invokedDirectly } from './lib/invoked-directly.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function installShopifyOverlay(project, { confirmShopify = false } = {}) {
  if (!confirmShopify) throw new Error('Identify Shopify commerce in the source profile or obtain an explicit Shopify choice, then pass --confirm-shopify.');
  const root = await fs.realpath(project);
  const has = async relative => fs.lstat(path.join(root, relative)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  for (let ancestor = path.dirname(root); ; ancestor = path.dirname(ancestor)) {
    for (const marker of ['palate.project.json', ...LEGACY_MARKERS]) {
      const exists = await fs.lstat(path.join(ancestor, marker)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (exists) throw new Error('This target is nested inside another workflow project. Install only at an unambiguous new project root.');
    }
    if (ancestor === path.dirname(ancestor)) break;
  }
  if (await has('palate.project.json')) readState(resolveProject(root));
  else for (const marker of LEGACY_MARKERS) if (await has(marker)) throw new Error('Existing legacy projects retain their installed workflow. The optional overlay only installs into a new Astro project.');
  const lockPath = path.join(root, '.palate-shopify-install.lock');
  const lock = await fs.open(lockPath, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('Another Shopify installation owns this project. Wait for it to finish; inspect an abandoned lock before removing it.'); throw error; });
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await installOwnedOverlay(root); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}
async function installOwnedOverlay(root) {
  const packagePath = path.join(root, 'package.json');
  for (const file of [packagePath, path.join(root, 'astro.config.mjs')]) if (!(await fs.lstat(file)).isFile()) throw new Error('Project package and Astro configuration must be regular files.');
  const packageText = await fs.readFile(packagePath, 'utf8'); const pkg = JSON.parse(packageText);
  if (!pkg.dependencies?.astro) throw new Error('The Shopify overlay requires an existing Astro project.');
  const configPath = path.join(root, 'astro.config.mjs'); const config = await fs.readFile(configPath, 'utf8');
  if (!/integrations\s*:\s*\[/.test(config) || /adapter\s*:/.test(config) || config.includes('shopify-runtime')) throw new Error('Use the new Palate Astro starter with an integrations array and no existing adapter. Existing runtimes and Shopify installations are not overwritten.');
  await fs.access(path.join(root, 'src/layouts/BaseLayout.astro'));
  const source = path.resolve(here, '../templates/shopify-overlay');
  const files = [];
  async function walk(folder, relative = '') { for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(path.join(folder, entry.name), rel); else if (entry.isFile()) files.push(rel); else throw new Error('Unexpected overlay entry');
  } }
  await walk(source);
  // Check every destination and its ancestors before writing anything. Symlinks cannot redirect
  // an overlay write outside this new project, and an existing route is never replaced.
  for (const rel of files) {
    const segments = rel.split(path.sep); let current = root;
    for (const [i, segment] of segments.entries()) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (stat?.isSymbolicLink() || (stat && (i === segments.length - 1 || !stat.isDirectory()))) throw new Error(`Overlay destination already exists or is unsafe: ${rel}`);
    }
  }
  const written = [];
  try {
    for (const rel of files) { const target = path.join(root, rel); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(source, rel), target, 1); written.push(target); }
    pkg.dependencies.redis = '6.2.1'; pkg.dependencies['@astrojs/vercel'] = '11.0.10';
    pkg.overrides = { ...pkg.overrides, '@vercel/routing-utils': { ...pkg.overrides?.['@vercel/routing-utils'], 'path-to-regexp': '6.3.0' } };
    await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    const updated = "import shopifyRuntime from './scripts/shopify-runtime.mjs';\n" + config.replace(/integrations\s*:\s*\[/, 'adapter: shopifyRuntime(),\n  integrations: [');
    await fs.writeFile(configPath, updated);
  } catch (error) {
    await fs.writeFile(packagePath, packageText); await fs.writeFile(configPath, config);
    await Promise.all(written.map(file => fs.unlink(file))); throw error;
  }
  return { installed: true, files: files.length, dependencies: { redis: '6.2.1', '@astrojs/vercel': '11.0.10' }, next: 'Run npm install, configure server-only Shopify and Redis environment values, then style CommerceLayout using the selected design.' };
}
if (invokedDirectly(import.meta.url)) {
  try { const project = process.argv.slice(2).find(arg => !arg.startsWith('--')); if (!project) throw new Error('Usage: install-shopify-overlay.mjs <project> --confirm-shopify'); console.log(JSON.stringify(await installShopifyOverlay(project, { confirmShopify: process.argv.includes('--confirm-shopify') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
