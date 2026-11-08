// Adjustments (ProCraft's Adjustments menu), as pure ImageData filters so they run anywhere,
// including mobile Safari which lacks canvas `filter`.
import { hexToRgb, rgbToHsl, hslToRgb } from "./color";

export type AdjustId =
  | "hsb"
  | "brightness"
  | "colorBalance"
  | "curves"
  | "gradientMap"
  | "blur"
  | "motionBlur"
  | "sharpen"
  | "noise"
  | "bloom"
  | "glitch"
  | "halftone"
  | "chromatic"
  | "posterize"
  | "invert"
  | "grayscale"
  | "threshold";

export interface AdjustParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}
export interface AdjustDef {
  id: AdjustId;
  name: string;
  params: AdjustParam[];
}

const P = (key: string, label: string, min: number, max: number, value: number, step = 1): AdjustParam => ({ key, label, min, max, value, step });

export const ADJUSTMENTS: AdjustDef[] = [
  { id: "hsb", name: "Hue, Saturation, Brightness", params: [P("hue", "Hue", -180, 180, 0), P("sat", "Saturation", -100, 100, 0), P("bri", "Brightness", -100, 100, 0)] },
  { id: "brightness", name: "Brightness / Contrast", params: [P("bri", "Brightness", -100, 100, 0), P("con", "Contrast", -100, 100, 0)] },
  { id: "colorBalance", name: "Color Balance", params: [P("r", "Cyan ↔ Red", -100, 100, 0), P("g", "Magenta ↔ Green", -100, 100, 0), P("b", "Yellow ↔ Blue", -100, 100, 0)] },
  { id: "curves", name: "Curves", params: [P("shadows", "Shadows", -100, 100, 0), P("mids", "Midtones", -100, 100, 0), P("highs", "Highlights", -100, 100, 0)] },
  { id: "gradientMap", name: "Gradient Map", params: [P("preset", "Preset", 0, 4, 0), P("mix", "Strength", 0, 100, 100)] },
  { id: "blur", name: "Gaussian Blur", params: [P("radius", "Radius", 0, 60, 6)] },
  { id: "motionBlur", name: "Motion Blur", params: [P("dist", "Distance", 0, 80, 16), P("angle", "Angle", 0, 180, 0)] },
  { id: "sharpen", name: "Sharpen", params: [P("amount", "Amount", 0, 200, 60)] },
  { id: "noise", name: "Noise", params: [P("amount", "Amount", 0, 100, 20), P("mono", "Monochrome", 0, 1, 1)] },
  { id: "bloom", name: "Bloom", params: [P("threshold", "Threshold", 0, 255, 170), P("radius", "Radius", 1, 60, 16), P("strength", "Strength", 0, 200, 80)] },
  { id: "glitch", name: "Glitch", params: [P("amount", "Amount", 0, 100, 40), P("seed", "Seed", 1, 99, 7)] },
  { id: "halftone", name: "Halftone", params: [P("size", "Dot size", 3, 40, 8)] },
  { id: "chromatic", name: "Chromatic Aberration", params: [P("shift", "Shift", 0, 30, 6)] },
  { id: "posterize", name: "Posterize", params: [P("levels", "Levels", 2, 16, 5)] },
  { id: "threshold", name: "Threshold", params: [P("level", "Level", 0, 255, 128)] },
  { id: "invert", name: "Invert", params: [] },
  { id: "grayscale", name: "Grayscale", params: [] },
];

export const GRADIENT_PRESETS: { name: string; stops: string[] }[] = [
  { name: "Sunset", stops: ["#1d1a4a", "#c13f7a", "#f6c453"] },
  { name: "Noir", stops: ["#000000", "#ffffff"] },
  { name: "Ocean", stops: ["#03122b", "#1e88e5", "#b2ebf2"] },
  { name: "Forest", stops: ["#0b1f12", "#2f8a5f", "#e9f5c9"] },
  { name: "Neon", stops: ["#12002b", "#ff2e93", "#00f0ff"] },
];

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let ti = y * w,
        li = ti,
        ri = ti + r;
      const fv = src[ti * 4 + c],
        lv = src[(ti + w - 1) * 4 + c];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[(ti + Math.min(j, w - 1)) * 4 + c];
      for (let j = 0; j <= r; j++) {
        val += (ri < y * w + w ? src[ri * 4 + c] : lv) - fv;
        dst[ti * 4 + c] = val * iarr;
        ri++;
        ti++;
      }
      for (let j = r + 1; j < w - r; j++) {
        val += src[ri * 4 + c] - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        ri++;
        li++;
        ti++;
      }
      for (let j = Math.max(w - r, r + 1); j < w; j++) {
        val += lv - src[li * 4 + c];
        dst[ti * 4 + c] = val * iarr;
        li++;
        ti++;
      }
    }
  }
}
function transpose(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = (y * w + x) * 4,
        b = (x * h + y) * 4;
      out[b] = src[a];
      out[b + 1] = src[a + 1];
      out[b + 2] = src[a + 2];
      out[b + 3] = src[a + 3];
    }
  return out;
}
/** Approximate gaussian blur (3 box passes), premultiplied to avoid dark fringes. */
export function blurData(img: ImageData, radius: number): ImageData {
  const { width: w, height: h } = img;
  const r = Math.round(radius / 2);
  if (r < 1 || w < 2 || h < 2) return img;
  let a: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(img.data);
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3] / 255;
    a[i] *= al;
    a[i + 1] *= al;
    a[i + 2] *= al;
  }
  let b: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(a.length);
  const rr = Math.min(r, Math.floor((Math.min(w, h) - 1) / 2));
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(a, b, w, h, Math.min(rr, Math.floor((w - 1) / 2)));
    [a, b] = [b, a];
  }
  let t = transpose(a, w, h);
  let t2 = new Uint8ClampedArray(t.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(t, t2, h, w, Math.min(rr, Math.floor((h - 1) / 2)));
    [t, t2] = [t2, t];
  }
  const out = transpose(t, h, w);
  for (let i = 0; i < out.length; i += 4) {
    const al = out[i + 3] / 255;
    if (al > 0) {
      out[i] /= al;
      out[i + 1] /= al;
      out[i + 2] /= al;
    }
  }
  return new ImageData(out, w, h);
}

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function applyAdjust(src: ImageData, id: AdjustId, v: Record<string, number>): ImageData {
  const w = src.width,
    h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const d = out.data;
  const s = src.data;
  switch (id) {
    case "hsb":
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        hh = (hh + v.hue / 360 + 1) % 1;
        ss = Math.max(0, Math.min(1, ss * (1 + v.sat / 100)));
        ll = Math.max(0, Math.min(1, ll + (v.bri / 100) * (v.bri > 0 ? 1 - ll : ll)));
        const [r, g, b] = hslToRgb(hh, ss, ll);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
      break;
    case "brightness": {
      const c = (v.con / 100) * 255;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      for (let i = 0; i < d.length; i += 4)
        for (let k = 0; k < 3; k++) d[i + k] = f * (d[i + k] + v.bri * 1.5 - 128) + 128;
      break;
    }
    case "colorBalance":
      for (let i = 0; i < d.length; i += 4) {
        d[i] += v.r * 0.6;
        d[i + 1] += v.g * 0.6;
        d[i + 2] += v.b * 0.6;
      }
      break;
    case "curves": {
      const lut = new Uint8ClampedArray(256);
      for (let x = 0; x < 256; x++) {
        const t = x / 255;
        const sh = (1 - t) * (1 - t) * t * 3,
          md = t * (1 - t) * 4,
          hi = t * t * (1 - t) * 3;
        lut[x] = 255 * (t + (sh * v.shadows + md * v.mids * 0.6 + hi * v.highs) / 250);
      }
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = lut[d[i + k]];
      break;
    }
    case "gradientMap": {
      const preset = GRADIENT_PRESETS[Math.round(v.preset)] ?? GRADIENT_PRESETS[0];
      const stops = preset.stops.map(hexToRgb);
      const mix = v.mix / 100;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const pos = l * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(pos));
        const f = pos - k;
        for (let c = 0; c < 3; c++) {
          const g = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
          d[i + c] = d[i + c] + (g - d[i + c]) * mix;
        }
      }
      break;
    }
    case "blur":
      return blurData(src, v.radius);
    case "motionBlur": {
      const n = Math.max(1, Math.round(v.dist / 2));
      const a = (v.angle * Math.PI) / 180;
      const dx = Math.cos(a),
        dy = Math.sin(a);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let r = 0,
            g = 0,
            b = 0,
            al = 0,
            c = 0;
          for (let k = -n; k <= n; k++) {
            const sx = Math.round(x + dx * k),
              sy = Math.round(y + dy * k);
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const j = (sy * w + sx) * 4;
            const aa = s[j + 3];
            r += s[j] * aa;
            g += s[j + 1] * aa;
            b += s[j + 2] * aa;
            al += aa;
            c++;
          }
          const o = (y * w + x) * 4;
          if (al) {
            d[o] = r / al;
            d[o + 1] = g / al;
            d[o + 2] = b / al;
          }
          d[o + 3] = al / c;
        }
      break;
    }
    case "sharpen": {
      const bl = blurData(src, 3).data;
      const k = v.amount / 100;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + (s[i + c] - bl[i + c]) * k;
      break;
    }
    case "noise": {
      const R = rng(3);
      for (let i = 0; i < d.length; i += 4) {
        const n = (R() - 0.5) * v.amount * 2.55;
        for (let c = 0; c < 3; c++) d[i + c] += v.mono ? n : (R() - 0.5) * v.amount * 2.55;
      }
      break;
    }
    case "bloom": {
      const bright = new ImageData(w, h);
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
        if (l >= v.threshold) {
          bright.data[i] = s[i];
          bright.data[i + 1] = s[i + 1];
          bright.data[i + 2] = s[i + 2];
          bright.data[i + 3] = s[i + 3];
        }
      }
      const glow = blurData(bright, v.radius).data;
      const k = v.strength / 100;
      for (let i = 0; i < d.length; i += 4) {
        const ga = (glow[i + 3] / 255) * k;
        for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + glow[i + c] * ga;
        d[i + 3] = Math.max(s[i + 3], glow[i + 3] * k);
      }
      break;
    }
    case "glitch": {
      const R = rng(v.seed);
      const bands = Math.round(4 + v.amount / 5);
      for (let k = 0; k < bands; k++) {
        const y0 = Math.floor(R() * h),
          bh = Math.floor(2 + R() * h * 0.05);
        const shift = Math.round((R() - 0.5) * w * 0.1 * (v.amount / 50));
        for (let y = y0; y < Math.min(h, y0 + bh); y++)
          for (let x = 0; x < w; x++) {
            const sx = Math.min(w - 1, Math.max(0, x - shift));
            const o = (y * w + x) * 4,
              j = (y * w + sx) * 4;
            d[o] = s[j];
            d[o + 1] = s[j + 1];
            d[o + 2] = s[j + 2];
            d[o + 3] = s[j + 3];
          }
      }
      break;
    }
    case "halftone": {
      const cell = Math.round(v.size);
      d.fill(0);
      for (let cy = 0; cy < h; cy += cell)
        for (let cx = 0; cx < w; cx += cell) {
          let r = 0,
            g = 0,
            b = 0,
            a = 0,
            n = 0;
          for (let y = cy; y < Math.min(h, cy + cell); y++)
            for (let x = cx; x < Math.min(w, cx + cell); x++) {
              const j = (y * w + x) * 4;
              r += s[j];
              g += s[j + 1];
              b += s[j + 2];
              a += s[j + 3];
              n++;
            }
          r /= n;
          g /= n;
          b /= n;
          a /= n;
          const l = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const rad = (cell / 2) * Math.sqrt(Math.max(l, 0.04)) * 1.2;
          for (let y = cy; y < Math.min(h, cy + cell); y++)
            for (let x = cx; x < Math.min(w, cx + cell); x++) {
              const dist = Math.hypot(x - cx - cell / 2, y - cy - cell / 2);
              const o = (y * w + x) * 4;
              d[o] = r;
              d[o + 1] = g;
              d[o + 2] = b;
              d[o + 3] = dist <= rad ? a : 0;
            }
        }
      break;
    }
    case "chromatic": {
      const sh = Math.round(v.shift);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const rx = Math.min(w - 1, x + sh),
            bx = Math.max(0, x - sh);
          d[o] = s[(y * w + rx) * 4];
          d[o + 2] = s[(y * w + bx) * 4 + 2];
          d[o + 3] = Math.max(s[o + 3], s[(y * w + rx) * 4 + 3], s[(y * w + bx) * 4 + 3]);
        }
      break;
    }
    case "posterize": {
      const n = Math.max(2, Math.round(v.levels)) - 1;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] / 255) * n) * (255 / n);
      break;
    }
    case "threshold":
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l >= v.level ? 255 : 0;
      }
      break;
    case "invert":
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      break;
    case "grayscale":
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      break;
  }
  return out;
}

export function defaults(def: AdjustDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.value]));
}
