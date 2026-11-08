// Turning detected text (from a PDF's text layer or from OCR) into editable lines.
import { id, type PdfLine } from "./model";
import { rgbToHex } from "../paint/color";

/** One run of text: its baseline start (x, base) in page units, its size, width along its
 * direction, and the direction's angle (radians, y down). */
export interface Run {
  x: number;
  base: number;
  size: number;
  w: number;
  str: string;
  font: string;
  angle?: number;
}

/** Groups runs into lines: same baseline, close along the text direction. Columns stay separate.
 * Runs at any angle are grouped in their own rotated frame. */
export function groupRuns(runs: Run[]): Run[] {
  const byAngle = new Map<number, Run[]>();
  for (const r of runs) {
    const key = Math.round(((r.angle ?? 0) * 180) / Math.PI); // 1° buckets
    (byAngle.get(key) ?? byAngle.set(key, []).get(key)!).push(r);
  }
  const out: Run[] = [];
  for (const group of byAngle.values()) {
    const a = group[0].angle ?? 0;
    const c = Math.cos(a), s = Math.sin(a);
    // into the text's own frame: u along the text, v across (baseline)
    const local = group.map((r) => ({ ...r, x: r.x * c + r.base * s, base: -r.x * s + r.base * c }));
    for (const l of groupFlat(local)) out.push({ ...l, x: l.x * c - l.base * s, base: l.x * s + l.base * c, angle: a });
  }
  return out;
}

function groupFlat(runs: Run[]): Run[] {
  // rows: runs whose baselines are within a third of the text size (sub-pixel jitter is common)
  const rows: Run[][] = [];
  for (const r of [...runs].sort((a, b) => a.base - b.base)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(r.base - row[0].base) < Math.max(r.size, row[0].size) * 0.35) row.push(r);
    else rows.push([r]);
  }
  const lines: Run[] = [];
  for (const row of rows) {
    let cur: Run | null = null;
    for (const r of row.sort((a, b) => a.x - b.x)) {
      const gap = cur ? r.x - (cur.x + cur.w) : Infinity;
      if (cur && gap < cur.size * 1.2) {
        cur.str += (gap > cur.size * 0.15 && !cur.str.endsWith(" ") && !r.str.startsWith(" ") ? " " : "") + r.str;
        cur.w = Math.max(cur.w, r.x + r.w - cur.x);
        cur.size = Math.max(cur.size, r.size);
      } else lines.push((cur = { ...r }));
    }
  }
  return lines.filter((l) => l.str.trim());
}

/** Ink and background colours inside a box of an image (k = image pixels per page unit). */
export function sampleColors(img: ImageData, k: number, x: number, y: number, w: number, h: number): { color: string; bg: string } {
  const x0 = Math.max(0, Math.floor(x * k)), y0 = Math.max(0, Math.floor(y * k));
  const x1 = Math.min(img.width - 1, Math.ceil((x + w) * k)), y1 = Math.min(img.height - 1, Math.ceil((y + h) * k));
  if (x1 <= x0 || y1 <= y0) return { color: "#000000", bg: "#ffffff" };
  const px = (xx: number, yy: number) => {
    const i = (yy * img.width + xx) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const ring: number[][] = [];
  for (let xx = x0; xx <= x1; xx++) ring.push(px(xx, y0), px(xx, y1));
  for (let yy = y0; yy <= y1; yy++) ring.push(px(x0, yy), px(x1, yy));
  const med = (c: number) => ring.map((p) => p[c]).sort((a, b) => a - b)[ring.length >> 1] ?? 255;
  const bg = [med(0), med(1), med(2)];
  let best = bg, far = -1;
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const p = px(xx, yy);
      const d = (p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2;
      if (d > far) {
        far = d;
        best = p;
      }
    }
  return { bg: rgbToHex(bg[0], bg[1], bg[2]), color: rgbToHex(best[0], best[1], best[2]) };
}

/** The four corners of a line's box in page units (rotated about its baseline start). */
export function lineCorners(l: Pick<PdfLine, "x" | "y" | "w" | "h" | "base" | "dx" | "dy" | "angle">): { x: number; y: number }[] {
  const a = l.angle ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  const ox = l.x + l.dx, oy = l.base + l.dy;
  const top = l.y - l.base;
  return [
    [0, top],
    [l.w, top],
    [l.w, top + l.h],
    [0, top + l.h],
  ].map(([u, v]) => ({ x: ox + u * c - v * s, y: oy + u * s + v * c }));
}

/** Whether page point (x, y) is on a line (in the line's own rotated frame). */
export function hitLine(l: PdfLine, x: number, y: number, pad = 2): boolean {
  const a = l.angle ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = x - (l.x + l.dx), dy = y - (l.base + l.dy);
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  const top = l.y - l.base;
  return u >= -pad && u <= l.w + pad && v >= top - pad && v <= top + l.h + pad;
}

/** Runs → editable lines, with colours sampled from the rendered page. */
export function linesFromRuns(runs: Run[], pix: ImageData, k: number): PdfLine[] {
  return groupRuns(runs).map((r) => {
    const y = r.base - r.size * 0.92;
    const h = r.size * 1.2;
    const line: PdfLine = { id: id(), x: r.x, y, w: r.w, h, base: r.base, size: r.size, font: r.font, color: "#000000", bg: "#ffffff", orig: r.str, text: r.str, dx: 0, dy: 0, angle: r.angle ?? 0 };
    // sample colours over the (possibly rotated) box's bounds
    const cs = lineCorners(line);
    const bx = Math.min(...cs.map((p) => p.x)), by = Math.min(...cs.map((p) => p.y));
    Object.assign(line, sampleColors(pix, k, bx, by, Math.max(...cs.map((p) => p.x)) - bx, Math.max(...cs.map((p) => p.y)) - by));
    return line;
  });
}
