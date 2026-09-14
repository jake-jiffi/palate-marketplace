import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readStatus } from '../.palate/runtime/live/project.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
/**
 * @typedef {{id:string, label:string, rationale:string, entry:string,
 * status:'pending'|'ready'|'failed', stale:boolean,
 * thumbnail?:{path:string,sha256:string}}} GalleryDirection
 */
/** @returns {{state:any, directions:GalleryDirection[], error:string|null}} */
export function galleryState() {
  try {
    const { state, validity } = readStatus(projectRoot);
    return { state, directions: state.directions.map(direction => ({
      ...direction,
      stale: direction.status === 'ready' && !validity.directions.find(item => item.id === direction.id)?.current,
    })), error: null };
  } catch {
    return { state: null, directions: [], error: 'Project state could not be read. Run the project status command to see the issue, then refresh.' };
  }
}

// Thumbnails are an allowlist of recorded images, never an arbitrary file URL.
/** @param {GalleryDirection | undefined} direction */
export function thumbnailFile(direction) {
  const thumbnail = direction?.thumbnail;
  if (!thumbnail || typeof thumbnail.path !== 'string' || !/^[a-f0-9]{64}$/.test(thumbnail.sha256 ?? '')) return null;
  if (!thumbnail.path.startsWith('.palate/previews/') || thumbnail.path.includes('\\') || thumbnail.path.split('/').some(part => !part || part === '.' || part === '..')) return null;
  const file = resolve(projectRoot, thumbnail.path);
  const root = realpathSync(projectRoot);
  if (relative(root, file).startsWith(`..${sep}`) || file === root) return null;
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const type = types[extname(file).toLowerCase()];
  if (!type) return null;
  try {
    let cursor = root;
    for (const part of relative(root, file).split(sep)) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 12 * 1024 * 1024) return null;
    const bytes = readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== thumbnail.sha256) return null;
    return { bytes, type };
  } catch { return null; }
}
