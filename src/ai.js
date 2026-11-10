import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@xenova/transformers';
env.allowLocalModels = false;
const ID = 'Xenova/clip-vit-base-patch32';
let proc, model;

// Turns an image into a 512-number "fingerprint" of how it looks
export async function embed(blob, onProgress) {
  if (!model) {
    proc = await AutoProcessor.from_pretrained(ID);
    model = await CLIPVisionModelWithProjection.from_pretrained(ID, { progress_callback: onProgress });
  }
  const url = URL.createObjectURL(blob);
  const img = await RawImage.fromURL(url);
  URL.revokeObjectURL(url);
  const { image_embeds } = await model(await proc(img));
  const v = Array.from(image_embeds.data);
  const n = Math.hypot(...v);
  return v.map(x => +(x / n).toFixed(3));
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Learns from YOUR folders: compares a new image to the average look of each folder
export function suggest(vec, known, minSim = 0.78) {
  const g = {};
  known.forEach(k => { if (k.folder_id && k.embedding) (g[k.folder_id] ??= []).push(k.embedding); });
  let best = null, bs = 0;
  for (const [fid, vs] of Object.entries(g)) {
    if (vs.length < 2) continue;
    const c = vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
    const n = Math.hypot(...c);
    const sim = dot(vec, c.map(x => x / n));
    if (sim > bs) { bs = sim; best = fid; }
  }
  return bs >= minSim ? best : null;
}
