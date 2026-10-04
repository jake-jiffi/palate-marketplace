import { fileURLToPath } from 'node:url';

export default function liveDesignPreview() {
  let development = false;
  return {
    name: 'palate-live-design-preview',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        development = command === 'dev';
        if (!development) return;
        injectRoute({ pattern: '/_palate', entrypoint: fileURLToPath(new URL('./gallery.astro', import.meta.url)), prerender: false });
        injectRoute({ pattern: '/_palate/style-guide', entrypoint: fileURLToPath(new URL('./style-guide.astro', import.meta.url)), prerender: false });
        injectRoute({ pattern: '/_palate/directions/[id]', entrypoint: fileURLToPath(new URL('./direction.astro', import.meta.url)), prerender: false });
      },
      'astro:server:setup': async ({ server }) => {
        if (!development) return;
        const { galleryState, thumbnailFile } = await import('./state.mjs');
        server.middlewares.use((req, res, next) => {
          const path = new URL(req.url || '/', 'http://localhost').pathname;
          if (path === '/_palate/health') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ service: 'palate-live-preview', instance: process.env.PALATE_PREVIEW_INSTANCE || null }));
            return;
          }
          const thumbnail = /^\/_palate\/thumbnails\/([a-z0-9][a-z0-9-]*)$/.exec(path);
          if (thumbnail) {
            const direction = galleryState().directions.find(item => item.id === thumbnail[1]);
            const file = thumbnailFile(direction);
            res.writeHead(file ? 200 : 404, { 'Content-Type': file?.type || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(file?.bytes || 'Thumbnail unavailable');
            return;
          }
          let decoded;
          try { decoded = decodeURIComponent(path); } catch { res.writeHead(400); res.end(); return; }
          if (/(?:^|\/)(?:\.palate|\.env[^/]*|palate\.project\.json)(?:\/|$)/.test(decoded)) {
            res.writeHead(404); res.end(); return;
          }
          if (path.startsWith('/_palate')) res.setHeader('Cache-Control', 'no-store');
          next();
        });
      },
    },
  };
}
