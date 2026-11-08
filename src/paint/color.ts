// Colour conversions and harmonies (after ProCraft's disc / classic / harmony / value pickers).

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hexToHsv = (hex: string) => rgbToHsv(...hexToRgb(hex));
export const hsvToHex = (c: HSV) => rgbToHex(...hsvToRgb(c));

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

export type Harmony = "complementary" | "split" | "analogous" | "triadic" | "tetradic";
export const HARMONIES: Harmony[] = ["complementary", "split", "analogous", "triadic", "tetradic"];

export function harmony(c: HSV, kind: Harmony): HSV[] {
  const at = (d: number): HSV => ({ ...c, h: (c.h + d + 360) % 360 });
  switch (kind) {
    case "complementary":
      return [c, at(180)];
    case "split":
      return [c, at(150), at(210)];
    case "analogous":
      return [at(-30), c, at(30)];
    case "triadic":
      return [c, at(120), at(240)];
    case "tetradic":
      return [c, at(90), at(180), at(270)];
  }
}

export const DEFAULT_PALETTES: { name: string; colors: string[] }[] = [
  { name: "Basics", colors: ["#000000", "#ffffff", "#7f7f7f", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#3949ab", "#8e24aa", "#d81b60", "#6d4c41"] },
  { name: "Ink", colors: ["#1b1f27", "#293648", "#3d6fb6", "#c2453d", "#2f8a5f", "#6d4bb3"] },
  { name: "Highlighters", colors: ["#fff176", "#a5d6a7", "#90caf9", "#f48fb1", "#ffcc80", "#ce93d8"] },
  { name: "Dusk", colors: ["#1d1a4a", "#3b2a78", "#7b2e8a", "#c13f7a", "#ef7b45", "#f6c453", "#2a1b3d", "#5b3a6b"] },
  { name: "Skin tones", colors: ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a1e"] },
  { name: "Pastel", colors: ["#ffd1dc", "#ffe5b4", "#fffacd", "#d0f0c0", "#b0e0e6", "#e6e6fa"] },
];
