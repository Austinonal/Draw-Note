// Procreate imports: palettes (.swatches) and brushes (.brush / .brushset). Key names and value
// scales follow ProCraft's reader (crates/engine/src/brushfile.rs, palette.rs).
import { readZip } from "./zip";
import { parseBplist, unarchiveRoot, type PValue } from "./bplist";
import { hsvToHex } from "../paint/color";
import type { Brush } from "../paint/brushes";

export interface Palette {
  name: string;
  colors: string[];
}

/** Swatches.json → palette (Procreate keeps colours as HSB 0..1; empty slots are null). */
export function paletteFromSwatchesJson(text: string, fallbackName = "Imported palette"): Palette {
  const clean = text.replace(/,(\s*[}\]])/g, "$1"); // some writers leave trailing commas
  let root = JSON.parse(clean);
  if (Array.isArray(root)) root = root[0];
  if (!root || !Array.isArray(root.swatches)) throw new Error("No swatches in this file");
  const colors = (root.swatches as ({ hue?: number; saturation?: number; brightness?: number } | null)[])
    .filter((s): s is { hue?: number; saturation?: number; brightness?: number } => !!s && typeof s === "object")
    .map((s) => hsvToHex({ h: ((s.hue ?? 0) % 1) * 360, s: s.saturation ?? 0, v: s.brightness ?? 0 }));
  return { name: (typeof root.name === "string" && root.name.trim()) || fallbackName, colors };
}

export async function importSwatches(file: File): Promise<Palette> {
  const zip = await readZip(await file.arrayBuffer());
  const entry = [...zip.keys()].find((k) => k.split("/").pop() === "Swatches.json");
  if (!entry) throw new Error("Not a Procreate .swatches file");
  return paletteFromSwatchesJson(new TextDecoder().decode(zip.get(entry)), file.name.replace(/\.[^.]+$/, ""));
}

const num = (f: Record<string, PValue>, k: string): number | undefined => (typeof f[k] === "number" && isFinite(f[k] as number) ? (f[k] as number) : undefined);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Maps a Brush.archive's fields onto DrawNote's brush model. */
export function brushFromFields(f: Record<string, PValue>, id: string, set: string): Brush {
  const n = (k: string, d: number) => num(f, k) ?? d;
  const hasGrain = f.textureApplication !== undefined || num(f, "grainDepth") !== undefined;
  // shortcut: Procreate's pressure/size curves, wet mix, dual brushes and rendering modes are not mapped; upgrade with the engine
  const maxSize = clamp(n("maxSize", 0.3) * 256, 2, 400);
  return {
    id,
    set,
    name: typeof f.name === "string" && f.name.trim() ? f.name.trim() : "Imported brush",
    maxSize,
    minSize: clamp(n("minSize", 0) * 256, 0.5, maxSize),
    spacing: clamp(n("plotSpacing", 0.1), 0.02, 2),
    streamline: clamp(n("plotSmoothing", 0.2), 0, 0.95),
    hardness: 0.9,
    flow: clamp(n("dynamicsGlazedFlow", 1) * n("maxOpacity", 1), 0.01, 1),
    pressureSize: clamp(n("dynamicsPressureSize", 0.5), 0, 1),
    pressureOpacity: clamp(n("dynamicsPressureOpacity", 0), 0, 1),
    taperStart: clamp(n("taperStartLength", 0) * 8, 0, 8),
    taperEnd: clamp(n("taperEndLength", 0) * 8, 0, 8),
    jitterSize: clamp(n("dynamicsJitterSize", 0), 0, 1),
    jitterOpacity: clamp(n("dynamicsJitterOpacity", 0), 0, 1),
    scatter: clamp(n("plotJitter", 0), 0, 2),
    rotationJitter: clamp(n("shapeScatter", 0), 0, 1),
    followStroke: n("shapeRotation", 0) > 0.5,
    angle: 0,
    roundness: clamp(n("shapeRoundness", 1), 0.05, 1),
    shape: "round",
    grain: hasGrain ? "paper" : "none",
    grainScale: clamp(Math.sqrt(Math.max(0, n("textureScale", 1))) * 1.2, 0.3, 4),
    grainDepth: hasGrain ? clamp(n("grainDepth", 1), 0, 1) : 0,
    hueJitter: clamp(n("dynamicsJitterHue", 0), 0, 1),
    briJitter: clamp(Math.max(n("dynamicsJitterLightness", 0), n("dynamicsJitterDarkness", 0)), 0, 1),
    wetEdges: 0,
    velocitySize: clamp(n("dynamicsSpeedSize", 0), -1, 1),
  };
}

/** PNG bytes → white-on-transparent mask (shape) or greyscale (grain) data URL, downscaled. */
async function textureUrl(png: Uint8Array, max: number, kind: "shape" | "grain", inverted: boolean): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      // luminance × alpha: Procreate draws white as paint, black as none
      let l = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 255;
      if (inverted) l = 255 - l;
      if (kind === "shape") {
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = l;
      } else {
        d[i] = d[i + 1] = d[i + 2] = l;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

/** Reads every brush in a .brush or .brushset file. */
export async function importBrushes(file: File): Promise<Brush[]> {
  const zip = await readZip(await file.arrayBuffer());
  const archives = [...zip.keys()].filter((k) => k.split("/").pop() === "Brush.archive" && !k.includes("/Secondary/"));
  if (!archives.length) throw new Error("No Procreate brushes in this file");
  const setName = file.name.replace(/\.[^.]+$/, "");
  const stamp = Date.now().toString(36);
  const out: Brush[] = [];
  for (const [i, path] of archives.entries()) {
    const prefix = path.slice(0, -"Brush.archive".length);
    let fields: Record<string, PValue>;
    try {
      fields = unarchiveRoot(parseBplist(zip.get(path)!));
    } catch {
      continue; // skip a damaged brush, keep the rest of the set
    }
    const b = brushFromFields(fields, `procreate-${stamp}-${i}`, archives.length > 1 ? setName : "My Brushes");
    const shape = zip.get(prefix + "Shape.png");
    const grain = zip.get(prefix + "Grain.png");
    if (shape) b.shapeSrc = await textureUrl(shape, 256, "shape", fields.shapeInverted === true);
    if (grain) {
      b.grainSrc = await textureUrl(grain, 512, "grain", fields.textureInverted === true);
      if (b.grainSrc && b.grainDepth <= 0.01) b.grainDepth = 1;
    }
    out.push(b);
  }
  if (!out.length) throw new Error("Could not read the brushes in this file");
  return out;
}
