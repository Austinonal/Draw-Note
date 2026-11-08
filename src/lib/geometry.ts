// Geometry shared by notes and painting: bounds, hit tests, lasso, QuickShape recognition and
// partial ink erasing.
import type { Obj, Pt } from "./model";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function ptsBounds(pts: { x: number; y: number }[], pad = 0): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function objBounds(o: Obj): Box {
  switch (o.type) {
    case "ink":
      return ptsBounds(o.pts, o.width / 2 + 1);
    case "shape": {
      const x = Math.min(o.x, o.x + o.w),
        y = Math.min(o.y, o.y + o.h);
      return { x: x - o.width, y: y - o.width, w: Math.abs(o.w) + o.width * 2, h: Math.abs(o.h) + o.width * 2 };
    }
    case "text": {
      const lines = Math.max(1, o.text.split("\n").length);
      return { x: o.x, y: o.y, w: o.w, h: lines * o.size * 1.3 + 4 };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inBox(b: Box, x: number, y: number, pad = 0): boolean {
  return x >= b.x - pad && y >= b.y - pad && x <= b.x + b.w + pad && y <= b.y + b.h + pad;
}

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether an eraser circle at (x, y) touches the object. */
export function hitObj(o: Obj, x: number, y: number, r: number): boolean {
  if (o.type === "ink") {
    const rr = r + o.width / 2;
    if (o.pts.length === 1) return Math.hypot(o.pts[0].x - x, o.pts[0].y - y) <= rr;
    for (let i = 1; i < o.pts.length; i++) if (distToSeg(x, y, o.pts[i - 1].x, o.pts[i - 1].y, o.pts[i].x, o.pts[i].y) <= rr) return true;
    return false;
  }
  if (o.type === "shape" && (o.shape === "line" || o.shape === "arrow")) return distToSeg(x, y, o.x, o.y, o.x + o.w, o.y + o.h) <= r + o.width;
  return inBox(objBounds(o), x, y, r);
}

/** Splits ink at an eraser circle: returns the pieces that remain (stroke-part erasing). */
export function splitInk(pts: Pt[], x: number, y: number, r: number): Pt[][] {
  // Resample so no segment is longer than the eraser radius; otherwise a fast stroke with
  // widely spaced points could be crossed without any point falling inside the eraser.
  const dense: Pt[] = [];
  const step = Math.max(0.5, r / 2);
  pts.forEach((p, i) => {
    if (i > 0) {
      const a = pts[i - 1];
      const n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step);
      for (let k = 1; k < n; k++) dense.push({ x: a.x + ((p.x - a.x) * k) / n, y: a.y + ((p.y - a.y) * k) / n, p: a.p + ((p.p - a.p) * k) / n });
    }
    dense.push(p);
  });
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of dense) {
    if (Math.hypot(p.x - x, p.y - y) <= r) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/** Whether a lasso polygon selects the object (its centre, or most of its ink points, inside). */
export function lassoSelects(o: Obj, poly: { x: number; y: number }[]): boolean {
  if (o.type === "ink") {
    let n = 0;
    for (const p of o.pts) if (pointInPoly(p.x, p.y, poly)) n++;
    return n >= Math.max(1, o.pts.length * 0.5);
  }
  const b = objBounds(o);
  return pointInPoly(b.x + b.w / 2, b.y + b.h / 2, poly);
}

export function translateObj(o: Obj, dx: number, dy: number): void {
  if (o.type === "ink") for (const p of o.pts) {
    p.x += dx;
    p.y += dy;
  }
  else {
    o.x += dx;
    o.y += dy;
  }
}

/** Scales an object about an origin. */
export function scaleObj(o: Obj, ox: number, oy: number, sx: number, sy: number): void {
  if (o.type === "ink") {
    for (const p of o.pts) {
      p.x = ox + (p.x - ox) * sx;
      p.y = oy + (p.y - oy) * sy;
    }
    o.width = Math.max(0.5, o.width * Math.sqrt(Math.abs(sx * sy)));
    return;
  }
  o.x = ox + (o.x - ox) * sx;
  o.y = oy + (o.y - oy) * sy;
  o.w *= sx;
  if (o.type !== "text") o.h *= sy;
  else o.size = Math.max(6, o.size * Math.sqrt(Math.abs(sx * sy)));
}

export function rotatePts(pts: Pt[], cx: number, cy: number, a: number): void {
  const c = Math.cos(a),
    s = Math.sin(a);
  for (const p of pts) {
    const x = p.x - cx,
      y = p.y - cy;
    p.x = cx + x * c - y * s;
    p.y = cy + x * s + y * c;
  }
}

// ---------- QuickShape ----------
export type QuickShape = { kind: "line"; a: Pt; b: Pt } | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number } | { kind: "rect"; x: number; y: number; w: number; h: number } | { kind: "triangle"; pts: Pt[] };

/** Recognises a held stroke as a clean shape (ProCraft's QuickShape). */
export function recognize(pts: { x: number; y: number }[]): QuickShape | null {
  if (pts.length < 4) return null;
  const a = pts[0],
    z = pts[pts.length - 1];
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (len < 12) return null;
  const chord = Math.hypot(z.x - a.x, z.y - a.y);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, distToSeg(p.x, p.y, a.x, a.y, z.x, z.y));
  const avgP = 0.6;
  if (chord > len * 0.85 && maxDev < Math.max(6, chord * 0.08)) return { kind: "line", a: { x: a.x, y: a.y, p: avgP }, b: { x: z.x, y: z.y, p: avgP } };
  const b = ptsBounds(pts);
  const closed = chord < Math.max(24, len * 0.18);
  if (!closed || b.w < 8 || b.h < 8) return null;
  // Corners: points where direction turns sharply.
  const simp = simplify(pts, Math.max(b.w, b.h) * 0.08);
  const corners = simp.length - 1;
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  let ellErr = 0;
  for (const p of pts) {
    const nx = (p.x - cx) / (b.w / 2),
      ny = (p.y - cy) / (b.h / 2);
    ellErr += Math.abs(Math.hypot(nx, ny) - 1);
  }
  ellErr /= pts.length;
  if (corners === 3) return { kind: "triangle", pts: simp.slice(0, 3).map((p) => ({ x: p.x, y: p.y, p: avgP })) };
  if (corners === 4 || (corners === 5 && ellErr > 0.12)) return { kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h };
  if (ellErr < 0.2) {
    const ratio = b.w / b.h;
    if (ratio > 0.85 && ratio < 1.18) {
      const r = (b.w + b.h) / 4;
      return { kind: "ellipse", cx, cy, rx: r, ry: r };
    }
    return { kind: "ellipse", cx, cy, rx: b.w / 2, ry: b.h / 2 };
  }
  return null;
}

function simplify<T extends { x: number; y: number }>(pts: T[], eps: number): T[] {
  if (pts.length < 3) return pts;
  let idx = 0,
    max = 0;
  const a = pts[0],
    z = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i].x, pts[i].y, a.x, a.y, z.x, z.y);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max > eps) {
    const l = simplify(pts.slice(0, idx + 1), eps),
      r = simplify(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, z];
}

/** Points along a recognised shape, for redrawing it with the current brush or pen. */
export function shapePoints(s: QuickShape, p = 0.6): Pt[] {
  const out: Pt[] = [];
  if (s.kind === "line") {
    const n = Math.max(2, Math.ceil(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / 4));
    for (let i = 0; i <= n; i++) out.push({ x: s.a.x + ((s.b.x - s.a.x) * i) / n, y: s.a.y + ((s.b.y - s.a.y) * i) / n, p });
  } else if (s.kind === "ellipse") {
    const n = Math.max(24, Math.ceil(((s.rx + s.ry) * Math.PI) / 4));
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: s.cx + Math.cos(a) * s.rx, y: s.cy + Math.sin(a) * s.ry, p });
    }
  } else {
    const c = s.kind === "rect" ? [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }] : s.pts;
    const loop = [...c, c[0]];
    for (let k = 1; k < loop.length; k++) {
      const A = loop[k - 1],
        B = loop[k];
      const n = Math.max(2, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / 4));
      for (let i = k === 1 ? 0 : 1; i <= n; i++) out.push({ x: A.x + ((B.x - A.x) * i) / n, y: A.y + ((B.y - A.y) * i) / n, p });
    }
  }
  return out;
}
