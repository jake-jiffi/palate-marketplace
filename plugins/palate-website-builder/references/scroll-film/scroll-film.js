/* scroll-film.js - scroll drives a pre-rendered camera through a chain of clips.
 *
 * The mechanism only, adapted from scroll-world by cyw (MIT, see LICENSE-scroll-world.txt):
 * blob-loaded clips (always seekable, no byte-range dependency), seam crossfades, a per-scene
 * linger ease, seek coalescing, poster-until-painted and first-touch priming for iOS, and
 * height-only resize immunity on touch. It builds no navigation, copy, route rail or chrome:
 * the direction composes those itself and reads progress from `onFrame` or the attributes below.
 *
 *   <section data-film>                      page composes copy, actions and fallback inside
 *     <div data-film-stage></div>            the engine adds one layer per clip here
 *   </section>
 *
 *   mountScrollFilm(section, {
 *     scenes: [{ clip, clipMobile, still, stillMobile, scroll: 1.4, linger: 0.4 }, ...],
 *     connectors: [clip | null, ...],        // length scenes - 1; null crossfades directly
 *     connectorsMobile: [...],               // optional, same length
 *     sceneScroll: 1.3, connectorScroll: 0.9, crossfade: 0.12,  // in viewport heights
 *     onFrame: ({ scene, progress, overall }) => {},
 *   });
 *
 * While mounted: section[data-film="live"], section[data-film-scene="<index>"] and the custom
 * property --film-progress (0..1 across the whole film) on the section. Before it mounts, and
 * without JavaScript, the section is whatever static markup the page wrote: keep every scene's
 * still and copy readable there. Under prefers-reduced-motion no clip is loaded; stills cross-dissolve.
 */
export function mountScrollFilm(root, config) {
  const stage = root.querySelector('[data-film-stage]');
  const scenes = config.scenes || [];
  if (!stage || !scenes.length) return { destroy() {} };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const small = matchMedia('(max-width: 860px)');
  const mobile = () => coarse || small.matches;
  const fadeWidth = config.crossfade ?? 0.12;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  // Settles mid-scene and hurries near the seams; f(0) = 0 and f(1) = 1, so seam frames are untouched.
  const lingerEase = (x, l) => { l = clamp(l); const c = x - 0.5; return (1 - l) * x + l * (4 * c * c * c + 0.5); };

  const segments = [];
  scenes.forEach((scene, i) => {
    segments.push({ scene: i, clip: scene.clip, clipM: scene.clipMobile, still: scene.still, stillM: scene.stillMobile, w: scene.scroll || config.sceneScroll || 1.3, linger: scene.linger || 0 });
    const connector = config.connectors?.[i];
    if (i < scenes.length - 1 && connector) {
      segments.push({ scene: i, connector: true, clip: connector, clipM: config.connectorsMobile?.[i], still: scenes[i + 1].still, stillM: scenes[i + 1].stillMobile, w: config.connectorScroll || 0.9, linger: 0 });
    }
  });

  if (!document.getElementById('scroll-film-css')) {
    const style = document.createElement('style');
    style.id = 'scroll-film-css';
    style.textContent = '@layer scroll-film{[data-film-stage]{position:relative;overflow:hidden}[data-film=live]>[data-film-stage]{position:sticky;top:0;height:100vh;height:100svh}}';
    document.head.appendChild(style);
  }
  // Layer geometry is inline: a page's own global `img, video { height: auto }` would otherwise win
  // over any stylesheet rule here and leave the frame short of the viewport.
  const cover = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;';
  for (const s of segments) {
    s.el = document.createElement('div'); s.el.className = 'film-layer';
    s.el.style.cssText = 'position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;';
    s.img = document.createElement('img'); s.img.alt = ''; s.img.decoding = 'async'; s.img.style.cssText = cover;
    const poster = mobile() && s.stillM ? s.stillM : s.still;
    if (poster) s.img.src = poster;
    s.el.append(s.img); stage.append(s.el);
    Object.assign(s, { video: null, loading: false, ready: false, cur: 0, target: 0, visible: false });
  }

  let vh = innerHeight, top = 0, total = 0, laidOutWidth = innerWidth, ticking = false, active = -1, frame = 0, userReady = false;
  const layout = () => {
    vh = innerHeight; laidOutWidth = innerWidth;
    let offset = 0;
    for (const s of segments) { s.start = offset * vh; offset += s.w; s.end = offset * vh; }
    total = offset;
    root.style.height = `${(total + 1) * vh}px`; // one extra viewport so the last flight completes
    top = root.getBoundingClientRect().top + scrollY;
    read();
  };
  const prime = video => {
    if (!mobile() || !video) return;
    try { video.play()?.then(() => video.pause()).catch(() => {}); } catch {}
  };
  const load = s => {
    if (reduce || s.loading || !s.clip) return;
    s.loading = true;
    fetch(mobile() && s.clipM ? s.clipM : s.clip)
      .then(response => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
      .then(blob => {
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
        video.style.cssText = cover + 'z-index:1;';
        video.src = URL.createObjectURL(blob);
        video.addEventListener('loadedmetadata', () => { s.ready = true; read(); });
        // Hide the poster only once a real frame has painted: iOS leaves a seeked, never-played video blank.
        video.addEventListener('seeked', () => { s.el.classList.add('is-painted'); s.img.style.opacity = '0'; }, { once: true });
        video.addEventListener('loadeddata', () => { try { video.pause(); } catch {} if (userReady) prime(video); });
        s.el.append(video); s.video = video;
      })
      .catch(() => { s.loading = false; });
  };
  function read() {
    ticking = false;
    top = root.getBoundingClientRect().top + scrollY; // content above can change height after load
    const y = scrollY - top, fade = Math.max(1, fadeWidth * vh);
    let current = 0;
    segments.forEach((s, i) => { if (y >= s.start) current = i; });
    segments.forEach((s, i) => {
      if (y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) load(s);
      const local = clamp((y - s.start) / (s.end - s.start));
      s.target = s.linger ? lingerEase(local, s.linger) : local;
      const outside = y < s.start ? s.start - y : y > s.end ? y - s.end : 0;
      const opacity = smooth(1 - outside / fade);
      s.el.style.opacity = opacity; s.visible = opacity > 0.001;
      s.el.style.zIndex = i === current ? '3' : '2';
      if (!s.ready) s.img.style.transform = reduce ? '' : `scale(${(1.02 + local * 0.1).toFixed(3)})`;
    });
    const seg = segments[current];
    const progress = clamp((y - seg.start) / (seg.end - seg.start));
    const scene = seg.connector && progress > 0.5 ? seg.scene + 1 : seg.scene;
    const overall = clamp(y / (total * vh));
    root.style.setProperty('--film-progress', overall.toFixed(4));
    if (scene !== active) { active = scene; root.dataset.filmScene = String(scene); }
    config.onFrame?.({ scene, progress: seg.connector ? 1 : progress, overall });
  }
  function tick() {
    const step = mobile() ? 0.02 : 0.008; // a coarser seek step on phones means fewer decodes
    for (const s of segments) {
      const video = s.video;
      // Never queue a seek while the decoder is resolving the last one; fast flicks otherwise freeze it.
      if (!video || !s.ready || video.seeking) continue;
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * 0.18;
      const time = clamp(s.cur, 0, 0.999) * (video.duration || 1);
      if (Math.abs(video.currentTime - time) > step) { try { video.currentTime = time; } catch {} }
    }
    frame = requestAnimationFrame(tick);
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(read); } };
  // Phones fire resize whenever the URL bar moves; relaying out then yanks the scroll position.
  const onResize = () => { if (!(coarse && innerWidth === laidOutWidth)) layout(); };
  const onGesture = () => { if (userReady) return; userReady = true; segments.forEach(s => prime(s.video)); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  addEventListener('orientationchange', layout);
  addEventListener('load', layout);
  addEventListener('pointerdown', onGesture, { once: true, passive: true });
  addEventListener('touchstart', onGesture, { once: true, passive: true });
  root.dataset.film = 'live';
  layout();
  frame = requestAnimationFrame(tick);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll); removeEventListener('resize', onResize);
      removeEventListener('orientationchange', layout); removeEventListener('load', layout);
      for (const s of segments) { if (s.video) URL.revokeObjectURL(s.video.src); s.el.remove(); }
      root.style.height = ''; delete root.dataset.film; delete root.dataset.filmScene;
    },
  };
}
