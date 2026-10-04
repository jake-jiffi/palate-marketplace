/**
 * taste-local.mjs - the SigLIP appearance head, run on the customer's machine.
 *
 * The public grader embeds a hero still with frozen SigLIP and percentile-ranks it against the
 * library corpus. That is the single best predictor of the judgement we are trying to reproduce
 * (0.738 concordance against held-out founder labels, against 0.716 for the pairwise ladder and
 * 0.578 for absolute VLM scoring), and it was previously listed as one of the two things the
 * plugin could not do. It can: the model is public, transformers.js loads it, and the inference
 * is about half a second.
 *
 * WHAT RUNS WHERE, AND WHY.
 *
 *   local   the 356MB vision tower, the image decode, every quality gate, the embedding
 *   remote  one dot product against 768 learned weights, and the percentile lookup
 *
 * The learned head is the distilled output of the founder-label work and this repo is public,
 * so it stays on our server and the vector travels to it (see mcp-server/lib/taste.ts). The
 * expensive half is the half that runs here, which is the half that actually mattered.
 *
 * PORTED FROM apps/grader/worker/src/taste.mjs, with the same thresholds, the same refusal
 * contract, and one deliberate difference: no `sharp`.
 *
 *   The worker measures pixel statistics with sharp, which is a ~30MB native dependency and an
 *   install failure waiting to happen on a customer's machine. transformers.js already decodes
 *   the PNG for the embedding, so the same pixels are measured straight off RawImage. Verified
 *   equal to sharp on the corpus heroes to four decimal places: linear 35.0131 vs 35.013, aesop
 *   89.8337 vs 89.834, gitbook 50.8354 vs 50.835. The gates below are therefore calibrated
 *   numbers that still mean exactly what they meant when they were calibrated.
 *
 * THE REFUSAL CONTRACT IS THE POINT. A score we cannot stand behind comes back as
 * `applicable: false` with a reason, never as a number with a caveat attached, because callers
 * read numbers. 33 of the 2,194 library heroes are mathematically single-colour (they never
 * rendered) and this head scores them at a MEDIAN percentile of 86.7 - an ungated head reports
 * a blank capture as top-13% taste.
 */
import { readFileSync } from 'node:fs';

const MODEL_ID = 'Xenova/siglip-base-patch16-384';

/* ---------------------------------------------------------------------------
 * Degradedness gates. Every number was measured against all 2,194 cached
 * library heroes, not guessed. Do not retune without re-measuring.
 * ------------------------------------------------------------------------- */

// Below this per-channel stdev the image is a flat colour and there is nothing to measure.
// 36 of 2,194 library heroes fall here and every one inspected is a single flat fill; the
// lowest-stdev hero that is unambiguously a rendered page sits at 7.30, so this carries a
// wide margin.
const REFUSE_MAX_STDEV = 1.0;

// Between the floor and here, global statistics cannot separate "broken capture" from
// "legitimately minimal dark hero", so we score and FLAG rather than refuse. The corpus's
// single highest-scoring reference has a stdev of 7.30, while confirmed preloader frames sit
// at 1.5, 2.17 and 4.48. low-texture is a "check this by hand" signal, never evidence of poor
// taste.
const LOW_TEXTURE_MAX_STDEV = 8.0;

// The head is a DESKTOP viewport model: all 2,194 corpus heroes are exactly 1440x900. The
// SigLIP processor resizes to a 384x384 square WITHOUT preserving aspect, so a full-page
// composite (aspect ~5) or a 390x844 mobile still (aspect 2.17) is squashed into something the
// head never saw - and it will still return a confident-looking number.
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 1.5;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 400;

// A hero is ~1.3MP. Two orders of magnitude larger is a decode bomb, not a screenshot.
const MAX_PIXELS = 30e6;

/** The viewport the corpus was captured at. Capture the hero at exactly this. */
export const HERO_VIEWPORT = { width: 1440, height: 900 };

/* ---------------------------------------------------------------------------
 * Model residency
 * ------------------------------------------------------------------------- */

let modelPromise = null;

/**
 * Load the processor and vision tower, once.
 *
 * FIRST RUN DOWNLOADS ~356MB, AND IT ASKS FIRST. Announcing is not consenting: this runs inside
 * a build, on someone else's machine, possibly on a metered connection or a small disk, and a
 * third of a gigabyte arriving unasked is the kind of thing that loses you a customer over a
 * feature they did not know they had opted into.
 *
 * It cannot PROMPT, because it runs in an agent's tool call where there is usually nobody to
 * answer and a question with no answer is a hang. So the contract is the same one this codebase
 * uses everywhere else: REFUSE, LOUDLY, WITH THE REMEDY. The first run returns
 * `applicable: false` naming the download and the one command that authorises it, the grade
 * continues without the appearance half and says what it lost, and the fetch happens at SETUP
 * time where a 356MB download belongs rather than mid-build.
 *
 * PALATE_TASTE=1 authorises it, and setup.sh --with-taste both sets it and pre-fetches. Once the
 * model is cached the gate is moot and never fires again.
 *
 * The cache is transformers.js's own directory unless PALATE_MODEL_CACHE says otherwise.
 * Note it does NOT read TRANSFORMERS_CACHE by itself and its default lives inside node_modules,
 * so a dependency bump silently re-downloads unless the cache is pinned somewhere stable.
 */
export function warmTaste({ onFirstDownload = null, cacheDir = null } = {}) {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    let tf;
    try {
      tf = await import('@huggingface/transformers');
    } catch (e) {
      const err = new Error(
        '@huggingface/transformers is not installed, so the appearance head cannot run. ' +
          'Run scripts/reference-capture/setup.sh. (Original: ' + (e?.message ?? e) + ')',
      );
      err.code = 'TASTE_DEPENDENCY_MISSING';
      throw err;
    }
    const { env, AutoProcessor, SiglipVisionModel, RawImage } = tf;

    const dir = cacheDir ?? process.env.PALATE_MODEL_CACHE ?? process.env.TRANSFORMERS_CACHE ?? null;
    if (dir) env.cacheDir = dir.endsWith('/') ? dir : `${dir}/`;
    if (process.env.PALATE_MODEL_OFFLINE === '1') env.allowRemoteModels = false;

    // THE CONSENT GATE. Only ever fires on a genuine first run: a cached model is already paid
    // for, so asking again would be theatre.
    if (!(await modelIsCached(env, dir))) {
      if (process.env.PALATE_TASTE !== '1') {
        const err = new Error(
          'the appearance head needs a one-off ~356MB model download and has not been authorised. ' +
            'Run `scripts/reference-capture/setup.sh --with-taste` to fetch it now, or set PALATE_TASTE=1 ' +
            'to allow it during this build. The grade continues without it and reports what that cost.',
        );
        err.code = 'TASTE_NOT_AUTHORISED';
        throw err;
      }
      if (onFirstDownload) onFirstDownload();
    }

    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    // SiglipVisionModel, not the Auto class: the Auto class resolves this repo to the full
    // SiglipModel and loads an 814MB graph with the text tower included, where the vision tower
    // alone is 356MB. The output is BIT-IDENTICAL (max elementwise difference 0.000e+0 over the
    // normalised 768-d vector), so the corpus scale is untouched.
    //
    // fp32 matches how the corpus was embedded. Quantising would shift every embedding relative
    // to the cached corpus and drift every percentile silently. Do not "optimise" the dtype.
    const model = await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: 'fp32' });
    return { processor, model, RawImage };
  })();
  return modelPromise;
}

/** Best-effort: is the ONNX graph already on disk? Only used to decide whether to warn. */
async function modelIsCached(env, dir) {
  try {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const base = dir ?? env.cacheDir;
    if (!base) return false;
    return existsSync(join(base, MODEL_ID, 'onnx', 'vision_model.onnx'));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Pixel statistics, straight off the decoded image (see the sharp note above)
 * ------------------------------------------------------------------------- */

/**
 * Per-channel standard deviation over RGB, plus a luminance entropy.
 *
 * ALPHA IS IGNORED, not composited, which is what the worker's `removeAlpha()` does. It matters:
 * a varying alpha channel over a flat RGB fill measures a stdev of 127.5, so a blank hero
 * carrying a mask would sail through the uniform gate.
 *
 * `entropyLuma` is deliberately NOT the same quantity as the worker's `entropy` (sharp computes
 * its own histogram entropy over all channels). It is reported as provenance only and nothing
 * is gated on it, exactly as in the worker - the corpus's #2 and #3 references sit below any
 * plausible entropy threshold, so gating on it would refuse the best sites we have. The name
 * differs so nobody lines the two numbers up and concludes they disagree.
 */
function imageStats(raw) {
  const { data, width, height, channels } = raw;
  const n = width * height;
  const rgb = Math.min(channels, 3);
  let maxStdev = 0;
  for (let c = 0; c < rgb; c++) {
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const v = data[i * channels + c];
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    const variance = Math.max(0, s2 / n - mean * mean);
    const sd = Math.sqrt(variance);
    if (sd > maxStdev) maxStdev = sd;
  }
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    // Rec. 601 luma, rounded into 256 bins.
    const y = channels >= 3 ? 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] : data[o];
    hist[Math.min(255, Math.max(0, Math.round(y)))]++;
  }
  let entropy = 0;
  for (const count of hist) {
    if (!count) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return { maxStdev, entropyLuma: entropy };
}

function inapplicable(reason, detail, extra = {}) {
  return { raw: null, percentile: null, model: MODEL_ID, applicable: false, reason, detail, flags: [], ...extra };
}

/**
 * Embed a desktop hero still and hand back the vector plus what we measured about the image.
 *
 * Returns `{ applicable: false, reason, detail }` for anything it will not stand behind. The
 * caller then sends `embedding` to `palate_taste_score`; this module never scores, because the
 * head that turns a vector into a percentile is not on this machine.
 *
 * @param {string|Buffer|Uint8Array} heroPathOrBuffer a 1440x900-class DESKTOP viewport still.
 *   Not a full-page composite and not the mobile still: both are refused.
 */
export async function embedHero(heroPathOrBuffer, opts = {}) {
  const t0 = Date.now();

  // DECODE AND GATE BEFORE LOADING THE MODEL, in that order deliberately.
  //
  // RawImage is a plain image decoder and costs nothing; the vision tower is 356MB and on a
  // customer's first run it is a download. Loading it first meant someone could wait out that
  // download and then be told their hero was a flat fill. Every refusal below is now free.
  let RawImage;
  try {
    ({ RawImage } = await import('@huggingface/transformers'));
  } catch (e) {
    const err = new Error(
      '@huggingface/transformers is not installed, so the appearance head cannot run. ' +
        'Run scripts/reference-capture/setup.sh. (Original: ' + (e?.message ?? e) + ')',
    );
    err.code = 'TASTE_DEPENDENCY_MISSING';
    throw err;
  }

  let buf;
  try {
    buf = typeof heroPathOrBuffer === 'string' ? readFileSync(heroPathOrBuffer) : Buffer.from(heroPathOrBuffer);
  } catch (e) {
    return inapplicable('unreadable-image', String(e?.message ?? e).slice(0, 200));
  }

  let raw;
  try {
    // A Blob so a path and a buffer take the identical decode path and cannot diverge.
    raw = await RawImage.read(new Blob([buf]));
  } catch (e) {
    return inapplicable('unreadable-image', String(e?.message ?? e).slice(0, 200));
  }

  const { width, height } = raw;
  if (!width || !height) return inapplicable('unreadable-image', 'no dimensions reported');

  const { maxStdev, entropyLuma } = imageStats(raw);
  const image = {
    width,
    height,
    aspect: Math.round((height / width) * 1000) / 1000,
    maxStdev: Math.round(maxStdev * 1000) / 1000,
    entropyLuma: Math.round(entropyLuma * 1000) / 1000,
  };

  // Aspect BEFORE size, so a mobile still is diagnosed as the wrong viewport rather than as
  // "too small", which would send someone hunting for a resolution problem.
  if (image.aspect < MIN_ASPECT || image.aspect > MAX_ASPECT)
    return inapplicable(
      'not-a-desktop-viewport-still',
      `aspect ${image.aspect} outside [${MIN_ASPECT}, ${MAX_ASPECT}]; the head is trained only on 1440x900 desktop ` +
        'stills, and the processor squashes to 384x384 without preserving aspect. Capture the hero at ' +
        `${HERO_VIEWPORT.width}x${HERO_VIEWPORT.height} with fullPage disabled.`,
      { image },
    );
  if (width < MIN_WIDTH || height < MIN_HEIGHT)
    return inapplicable('image-too-small', `${width}x${height} is below the ${MIN_WIDTH}x${MIN_HEIGHT} floor`, { image });
  if (width * height > MAX_PIXELS)
    return inapplicable('image-too-large', `${width}x${height} exceeds the ${MAX_PIXELS / 1e6}MP decode ceiling`, { image });
  if (maxStdev < REFUSE_MAX_STDEV)
    return inapplicable(
      'uniform-image',
      `max channel stdev ${image.maxStdev} < ${REFUSE_MAX_STDEV}: a flat fill, so the hero did not render. ` +
        'Scoring it anyway would report it as roughly p87 taste, which is what 33 blank library captures score.',
      { image },
    );

  // Only now, with a still we are prepared to stand behind, is the model worth loading.
  let vec;
  try {
    const { processor, model } = await warmTaste(opts);
    const inputs = await processor(raw);
    const out = await model(inputs);
    if (out.pooler_output?.data) vec = Array.from(out.pooler_output.data);
    else {
      const [, seq, dim] = out.last_hidden_state.dims;
      vec = meanPool(Array.from(out.last_hidden_state.data), seq, dim);
    }
    // Release the native ONNX tensors. Skipping this is what OOM'd the library seed at 650/2169
    // (~15k undisposed tensors); a self-heal loop embedding on every iteration has the same shape.
    for (const t of Object.values(inputs)) t?.dispose?.();
    for (const t of Object.values(out)) t?.dispose?.();
  } catch (e) {
    return inapplicable('embed-failed', String(e?.message ?? e).slice(0, 200), { image });
  }

  const embedding = l2normalise(vec);
  if (!embedding.every(Number.isFinite)) return inapplicable('embed-failed', 'the embedding contains a non-finite value', { image });

  const flags = [];
  if (maxStdev < LOW_TEXTURE_MAX_STDEV) flags.push('low-texture');

  return { applicable: true, reason: null, embedding, model: MODEL_ID, image, flags, ms: Date.now() - t0 };
}

/**
 * Release the ONNX session before the process ends.
 *
 * NOT housekeeping. Without it the runtime tears itself down during exit and aborts:
 *
 *   libc++abi: terminating due to uncaught exception of type std::__1::system_error:
 *   mutex lock failed: Invalid argument
 *
 * which lands AFTER every line of output has been written and a grade has been computed, and
 * turns exit code 0 into 134. Anything reading the exit status - a git hook, the stop gate, a
 * self-heal loop - would read a successful grade as a crash and act on it. Found by running the
 * thing rather than by reading it.
 */
export async function disposeTaste() {
  if (!modelPromise) return;
  try {
    const { model } = await modelPromise;
    await model?.dispose?.();
  } catch {
    // Disposal is best-effort: a failure here must not turn a completed grade into an error.
  } finally {
    modelPromise = null;
  }
}

function l2normalise(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function meanPool(data, seq, dim) {
  const o = new Array(dim).fill(0);
  for (let s = 0; s < seq; s++) for (let d = 0; d < dim; d++) o[d] += data[s * dim + d];
  return o.map((x) => x / seq);
}

export { MODEL_ID, REFUSE_MAX_STDEV, LOW_TEXTURE_MAX_STDEV, MIN_ASPECT, MAX_ASPECT, imageStats as __imageStatsForTest };
