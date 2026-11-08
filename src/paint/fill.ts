// ColorDrop: flood fill with a threshold, reading either the layer or the whole composite.
import { hexToRgb } from "./color";

/** Fills the region connected to (sx, sy) whose colour is within `threshold` (0..1) of the
 * seed's. `sample` is what the region is found on; the fill is written into `target`. Returns the
 * filled bounding box or null. */
export function floodFill(
  sample: ImageData,
  target: ImageData,
  sx: number,
  sy: number,
  color: string,
  threshold: number,
  mask: ImageData | null,
): { x: number; y: number; w: number; h: number } | null {
  const w = sample.width,
    h = sample.height;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const s = sample.data;
  const t = target.data;
  const i0 = (sy * w + sx) * 4;
  const r0 = s[i0],
    g0 = s[i0 + 1],
    b0 = s[i0 + 2],
    a0 = s[i0 + 3];
  const lim = threshold * threshold * 4 * 255 * 255;
  const near = (i: number) => {
    const dr = s[i] - r0,
      dg = s[i + 1] - g0,
      db = s[i + 2] - b0,
      da = s[i + 3] - a0;
    return dr * dr + dg * dg + db * db + da * da <= lim;
  };
  const [r, g, b] = hexToRgb(color);
  // Gap closing: pixels within `GAP` of a non-matching pixel act as walls, so small breaks in
  // line art (tapered ends, anti-aliasing) do not leak. The fill is grown back afterwards.
  const GAP = Math.max(2, Math.round(Math.min(w, h) / 600));
  const wall = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (near((y * w + x) * 4)) continue;
      for (let dy = -GAP; dy <= GAP; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -GAP; dx <= GAP; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && dx * dx + dy * dy <= GAP * GAP) wall[yy * w + xx] = 1;
        }
      }
    }
  if (wall[sy * w + sx]) {
    // seed sits inside a thin gap: fall back to plain matching
    wall.fill(0);
    for (let k = 0; k < w * h; k++) if (!near(k * 4)) wall[k] = 1;
  }
  const open = (k: number) => !wall[k];
  const seen = new Uint8Array(w * h);
  const stack = [sx, sy];
  let minx = sx,
    maxx = sx,
    miny = sy,
    maxy = sy;
  const fill = new Uint8Array(w * h);
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && !seen[y * w + x] && open(y * w + x)) x--;
    x++;
    let up = false,
      down = false;
    while (x < w && !seen[y * w + x] && open(y * w + x)) {
      const k = y * w + x;
      seen[k] = 1;
      fill[k] = 1;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (y > 0) {
        const n = k - w;
        if (!seen[n] && open(n)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const n = k + w;
        if (!seen[n] && open(n)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
    }
  }
  // Grow back by the gap plus one pixel so the fill meets the (anti-aliased) lines.
  let grown = fill;
  for (let pass = 0; pass <= GAP; pass++) {
    const next = new Uint8Array(grown);
    for (let y = Math.max(0, miny - 1); y <= Math.min(h - 1, maxy + 1); y++)
      for (let x = Math.max(0, minx - 1); x <= Math.min(w - 1, maxx + 1); x++) {
        const k = y * w + x;
        if (grown[k]) continue;
        if ((x > 0 && grown[k - 1]) || (x < w - 1 && grown[k + 1]) || (y > 0 && grown[k - w]) || (y < h - 1 && grown[k + w])) next[k] = 1;
      }
    grown = next;
    minx = Math.max(0, minx - 1);
    miny = Math.max(0, miny - 1);
    maxx = Math.min(w - 1, maxx + 1);
    maxy = Math.min(h - 1, maxy + 1);
  }
  for (let k = 0; k < grown.length; k++) {
    if (!grown[k]) continue;
    const m = mask ? mask.data[k * 4 + 3] / 255 : 1;
    if (m <= 0) continue;
    const i = k * 4;
    const a = t[i + 3] / 255;
    const na = m + a * (1 - m);
    t[i] = (r * m + t[i] * a * (1 - m)) / (na || 1);
    t[i + 1] = (g * m + t[i + 1] * a * (1 - m)) / (na || 1);
    t[i + 2] = (b * m + t[i + 2] * a * (1 - m)) / (na || 1);
    t[i + 3] = na * 255;
  }
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}
