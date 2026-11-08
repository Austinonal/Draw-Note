// The painting engine: a stamping brush renderer on Canvas 2D, modelled on ProCraft's stroke
// pipeline (streamline → spacing → pressure/taper/jitter → shape stamp → grain → glaze onto the
// layer). Strokes render into a buffer so a whole stroke has one opacity, can be re-rendered on
// release (for the end taper) and is composited onto the layer in one step.
import type { Brush, Grain, TipShape } from "./brushes";
import { hexToRgb, rgbToHsv, hsvToRgb, rgbToHex } from "./color";

export interface InPt {
  x: number;
  y: number;
  p: number;
  t: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type StrokeMode = "paint" | "erase" | "smudge";
export type Symmetry = "off" | "vertical" | "horizontal" | "quadrant" | "radial";

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export function ctx2d(c: HTMLCanvasElement, readFrequently = false): CanvasRenderingContext2D {
  return c.getContext("2d", readFrequently ? { willReadFrequently: true } : undefined)!;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x)),
    y = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)),
    y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x || y1 <= y) return null;
  return { x, y, w: x1 - x, h: y1 - y };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- tip shapes ----------
const MASK = 128;
const maskCache = new Map<string, HTMLCanvasElement>();
function tipMask(shape: TipShape, hardness: number): HTMLCanvasElement {
  const hq = Math.round(hardness * 20) / 20;
  const key = shape + hq;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(MASK, MASK);
  const g = ctx2d(c);
  const r = MASK / 2;
  g.fillStyle = "#fff";
  if (shape === "round" || shape === "flat") {
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    const inner = Math.min(0.98, hq);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(inner, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    if (hq < 0.05) {
      grad.addColorStop(0, "rgba(255,255,255,1)");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
  } else if (shape === "square") {
    const blur = (1 - hq) * 18;
    g.filter = blur > 0.5 ? `blur(${blur}px)` : "none";
    g.fillRect(r * 0.35, r * 0.35, r * 1.3, r * 1.3);
    g.filter = "none";
  } else if (shape === "spray" || shape === "splatter") {
    const R = rng(shape === "spray" ? 7 : 11);
    const n = shape === "spray" ? 260 : 26;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R()) * r * 0.92;
      const s = shape === "spray" ? 0.8 + R() * 1.6 : 2 + R() * 11;
      g.globalAlpha = shape === "spray" ? 0.5 + R() * 0.5 : 1;
      g.beginPath();
      g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  } else if (shape === "leaf") {
    g.beginPath();
    g.moveTo(r, 6);
    g.quadraticCurveTo(MASK - 10, r, r, MASK - 6);
    g.quadraticCurveTo(10, r, r, 6);
    g.fill();
  } else if (shape === "star") {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const d = i % 2 ? r * 0.42 : r * 0.95;
      g.lineTo(r + Math.cos(a) * d, r + Math.sin(a) * d);
    }
    g.closePath();
    g.fill();
  }
  maskCache.set(key, c);
  return c;
}

const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(shape: TipShape, hardness: number, color: string): HTMLCanvasElement {
  const key = shape + Math.round(hardness * 20) + color;
  const hit = tintCache.get(key);
  if (hit) return hit;
  if (tintCache.size > 400) tintCache.clear();
  const c = makeCanvas(MASK, MASK);
  const g = ctx2d(c);
  g.drawImage(tipMask(shape, hardness), 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, MASK, MASK);
  tintCache.set(key, c);
  return c;
}

// ---------- grain ----------
const grainCache = new Map<string, HTMLCanvasElement>();
function valueNoise(size: number, cell: number, R: () => number): Float32Array {
  const gw = Math.ceil(size / cell) + 1;
  const grid = new Float32Array(gw * gw).map(() => R());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = x / cell,
        gy = y / cell;
      const x0 = Math.floor(gx),
        y0 = Math.floor(gy);
      const fx = gx - x0,
        fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx),
        sy = fy * fy * (3 - 2 * fy);
      const i = (xx: number, yy: number) => grid[(yy % (gw - 1)) * gw + (xx % (gw - 1))];
      const a = i(x0, y0) + (i(x0 + 1, y0) - i(x0, y0)) * sx;
      const b = i(x0, y0 + 1) + (i(x0 + 1, y0 + 1) - i(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  return out;
}
export function grainTexture(kind: Grain, depth: number): HTMLCanvasElement | null {
  if (kind === "none" || depth <= 0.01) return null;
  const dq = Math.round(depth * 20) / 20;
  const key = kind + dq;
  const hit = grainCache.get(key);
  if (hit) return hit;
  const S = 256;
  const R = rng(kind.length * 97);
  const v = new Float32Array(S * S);
  if (kind === "paper" || kind === "charcoal") {
    const o1 = valueNoise(S, 4, R),
      o2 = valueNoise(S, 16, R),
      o3 = valueNoise(S, 2, R);
    for (let i = 0; i < v.length; i++) v[i] = o1[i] * 0.45 + o2[i] * 0.25 + o3[i] * 0.3;
    if (kind === "charcoal") {
      const st = valueNoise(S, 32, R);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) v[y * S + x] = v[y * S + x] * 0.6 + st[(y >> 3) * S + x] * 0.4;
    }
  } else if (kind === "canvas") {
    const n = valueNoise(S, 2, R);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const wx = Math.sin((x / S) * Math.PI * 64) * 0.5 + 0.5;
        const wy = Math.sin((y / S) * Math.PI * 64) * 0.5 + 0.5;
        v[y * S + x] = (wx * wy) * 0.35 + n[y * S + x] * 0.65;
      }
  } else if (kind === "noise") {
    for (let i = 0; i < v.length; i++) v[i] = R();
  } else if (kind === "streaks") {
    const n = valueNoise(S, 3, R);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) v[y * S + x] = n[y * S + ((x * 7) % S)] * 0.5 + n[(y % S) * S] * 0.5;
  }
  let lo = 1,
    hi = 0;
  for (const x of v) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  const c = makeCanvas(S, S);
  const g = ctx2d(c);
  const img = g.createImageData(S, S);
  for (let i = 0; i < v.length; i++) {
    const n = (v[i] - lo) / (hi - lo || 1);
    const a = 1 - dq * (1 - n);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
  }
  g.putImageData(img, 0, 0);
  grainCache.set(key, c);
  return c;
}

// ---------- symmetry ----------
export function symmetryTransforms(kind: Symmetry, cx: number, cy: number): ((x: number, y: number) => [number, number])[] {
  const id = (x: number, y: number): [number, number] => [x, y];
  if (kind === "vertical") return [id, (x, y) => [2 * cx - x, y]];
  if (kind === "horizontal") return [id, (x, y) => [x, 2 * cy - y]];
  if (kind === "quadrant") return [id, (x, y) => [2 * cx - x, y], (x, y) => [x, 2 * cy - y], (x, y) => [2 * cx - x, 2 * cy - y]];
  if (kind === "radial") {
    const n = 6;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      return (x: number, y: number): [number, number] => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
    });
  }
  return [id];
}

// ---------- stroke ----------
export interface StrokeSettings {
  brush: Brush;
  size: number; // 0..1 slider
  opacity: number; // 0..1 slider
  color: string;
  mode: StrokeMode;
  pressureFromPen: boolean;
  symmetry: Symmetry;
  center: [number, number];
  selectionMask: HTMLCanvasElement | null;
}

interface Track {
  last: { x: number; y: number } | null;
  carry: number;
  dist: number;
}

export class StrokeEngine {
  readonly w: number;
  readonly h: number;
  readonly raw: HTMLCanvasElement; // stamps
  readonly out: HTMLCanvasElement; // stamps × grain × selection (what is shown and committed)
  readonly work: HTMLCanvasElement; // smudge works on a copy of the layer
  private rawCtx: CanvasRenderingContext2D;
  private outCtx: CanvasRenderingContext2D;
  private workCtx: CanvasRenderingContext2D;
  private tmp = makeCanvas(MASK * 4, MASK * 4);
  private tmpCtx = ctx2d(this.tmp);
  s: StrokeSettings | null = null;
  private pts: InPt[] = [];
  private smooth: InPt | null = null;
  private tracks: Track[] = [];
  private transforms: ((x: number, y: number) => [number, number])[] = [];
  private R: () => number = Math.random;
  private seed = 1;
  private hsv = { h: 0, s: 0, v: 0 };
  private rgb: [number, number, number] = [0, 0, 0];
  dirty: Rect | null = null;
  active = false;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.raw = makeCanvas(w, h);
    this.out = makeCanvas(w, h);
    this.work = makeCanvas(w, h);
    this.rawCtx = ctx2d(this.raw);
    this.outCtx = ctx2d(this.out);
    this.workCtx = ctx2d(this.work);
  }

  /** Size of a stamp in pixels for the size slider. */
  diameter(): number {
    const b = this.s!.brush;
    const t = this.s!.size;
    return b.minSize + (b.maxSize - b.minSize) * t * t;
  }

  begin(s: StrokeSettings, layer: HTMLCanvasElement): void {
    this.s = s;
    this.pts = [];
    this.smooth = null;
    this.lastRaw = null;
    this.rawCtx.clearRect(0, 0, this.w, this.h);
    this.outCtx.clearRect(0, 0, this.w, this.h);
    this.transforms = symmetryTransforms(s.symmetry, s.center[0], s.center[1]);
    this.tracks = this.transforms.map(() => ({ last: null, carry: 0, dist: 0 }));
    this.seed = (Math.random() * 1e9) | 0;
    this.R = rng(this.seed);
    this.rgb = hexToRgb(s.color);
    this.hsv = rgbToHsv(...this.rgb);
    this.dirty = null;
    this.active = true;
    if (s.mode === "smudge") {
      this.workCtx.clearRect(0, 0, this.w, this.h);
      this.workCtx.drawImage(layer, 0, 0);
    }
  }

  /** Feeds one input point; returns the area that changed. */
  private lastRaw: InPt | null = null;

  add(pt: InPt): Rect | null {
    if (!this.s) return null;
    this.lastRaw = { ...pt };
    const b = this.s.brush;
    const k = 1 - b.streamline * 0.92;
    if (!this.smooth) this.smooth = { ...pt };
    else {
      this.smooth = {
        x: this.smooth.x + (pt.x - this.smooth.x) * k,
        y: this.smooth.y + (pt.y - this.smooth.y) * k,
        p: this.smooth.p + (pt.p - this.smooth.p) * Math.min(1, k * 1.5),
        t: pt.t,
      };
    }
    this.pts.push({ ...this.smooth });
    return this.renderTail(this.pts.length - 1, Infinity);
  }

  /** Ends the stroke. Re-renders it whole so the end taper can be applied, and returns the
   * changed area. */
  end(): Rect | null {
    if (!this.s) return null;
    // StreamLine lags behind the pen: finish the stroke where the pen actually lifted.
    const raw = this.lastRaw;
    const last = this.pts[this.pts.length - 1];
    if (raw && last && Math.hypot(raw.x - last.x, raw.y - last.y) > 0.5) {
      this.pts.push({ ...raw, p: last.p });
      this.renderTail(this.pts.length - 1, Infinity);
    }
    if (this.s.brush.taperEnd > 0 || this.s.brush.wetEdges > 0 || this.pts.length === 1) this.rerender();
    if (this.s.brush.wetEdges > 0 && this.dirty) this.applyWetEdges(this.s.brush.wetEdges);
    return this.dirty;
  }

  /** Replace the path (QuickShape) and render it again. */
  replacePath(pts: InPt[]): Rect | null {
    this.pts = pts;
    this.rerender();
    return this.dirty;
  }

  points(): InPt[] {
    return this.pts;
  }

  private rerender(): void {
    if (!this.s) return;
    const old = this.dirty;
    this.rawCtx.clearRect(0, 0, this.w, this.h);
    if (this.s.mode === "smudge") return; // smudge cannot be replayed; keep what was smeared
    this.tracks = this.transforms.map(() => ({ last: null, carry: 0, dist: 0 }));
    this.R = rng(this.seed);
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) total += Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].y - this.pts[i - 1].y);
    this.dirty = null;
    for (let i = 0; i < this.pts.length; i++) this.renderTail(i, total, true);
    if (old) this.dirty = unionRect(this.dirty, old);
    if (this.dirty) this.refreshOut(this.dirty);
  }

  private renderTail(i: number, totalLen: number, skipOut = false): Rect | null {
    const s = this.s!;
    const b = s.brush;
    const pt = this.pts[i];
    const D = this.diameter();
    let rect: Rect | null = null;
    this.transforms.forEach((tf, ti) => {
      const tr = this.tracks[ti];
      const [x, y] = tf(pt.x, pt.y);
      if (!tr.last) {
        tr.last = { x, y };
        rect = unionRect(rect, this.stamp(x, y, pt, 0, totalLen, this.sizeAt(D, pt.p, 0, totalLen, 0), 0, tr.last));
        return;
      }
      const dx = x - tr.last.x,
        dy = y - tr.last.y;
      const seg = Math.hypot(dx, dy);
      if (seg < 0.01) return;
      const dir = Math.atan2(dy, dx);
      const prevPt = i > 0 ? this.pts[i - 1] : pt;
      const speed = seg / Math.max(1, pt.t - prevPt.t);
      let pos = tr.carry;
      const startX = tr.last.x,
        startY = tr.last.y;
      while (pos <= seg) {
        const f = pos / seg;
        const sx = startX + dx * f,
          sy = startY + dy * f;
        const p = prevPt.p + (pt.p - prevPt.p) * f;
        const along = tr.dist + pos;
        const d = this.sizeAt(D, p, along, totalLen, speed);
        const step = Math.max(0.5, d * b.spacing);
        rect = unionRect(rect, this.stamp(sx, sy, { x: sx, y: sy, p, t: pt.t }, along, totalLen, d, dir, { x: sx - Math.cos(dir) * step, y: sy - Math.sin(dir) * step }));
        pos += step;
      }
      tr.carry = pos - seg;
      tr.dist += seg;
      tr.last = { x, y };
    });
    if (rect) {
      this.dirty = unionRect(this.dirty, rect);
      if (!skipOut) this.refreshOut(rect);
    }
    return rect;
  }

  private sizeAt(D: number, p: number, along: number, total: number, speed: number): number {
    const b = this.s!.brush;
    const pressure = this.s!.pressureFromPen ? p : 1;
    let d = D * (1 - b.pressureSize + b.pressureSize * pressure);
    if (b.taperStart > 0) d *= Math.min(1, 0.3 + (0.7 * along) / (b.taperStart * D));
    if (b.taperEnd > 0 && isFinite(total)) d *= Math.min(1, 0.3 + (0.7 * (total - along)) / (b.taperEnd * D));
    if (b.velocitySize) d *= Math.max(0.2, 1 + b.velocitySize * Math.min(1, Math.max(-0.5, speed / 2 - 0.25)));
    return Math.max(0.6, d);
  }

  private stamp(x: number, y: number, pt: InPt, _along: number, _total: number, d: number, dir: number, prev: { x: number; y: number }): Rect {
    const s = this.s!;
    const b = s.brush;
    const R = this.R;
    const pressure = s.pressureFromPen ? pt.p : 1;
    let size = d * (1 - b.jitterSize * R());
    let alpha = b.flow * (1 - b.pressureOpacity + b.pressureOpacity * pressure) * (1 - b.jitterOpacity * R());
    if (size < 1) {
      alpha *= size;
      size = 1;
    }
    if (b.scatter > 0) {
      const a = R() * Math.PI * 2,
        r = R() * b.scatter * d;
      x += Math.cos(a) * r;
      y += Math.sin(a) * r;
    }
    let rot = (b.angle * Math.PI) / 180;
    if (b.followStroke) rot += dir;
    if (b.rotationJitter) rot += (R() - 0.5) * Math.PI * 2 * b.rotationJitter;
    const r = size / 2;
    const ext = r * 1.05 + 2;
    const rect = { x: x - ext, y: y - ext, w: ext * 2, h: ext * 2 };

    if (s.mode === "smudge") {
      const sz = Math.min(this.tmp.width, Math.ceil(size));
      const t = this.tmpCtx;
      t.globalCompositeOperation = "source-over";
      t.clearRect(0, 0, sz + 2, sz + 2);
      t.drawImage(this.work, prev.x - sz / 2, prev.y - sz / 2, sz, sz, 0, 0, sz, sz);
      t.globalCompositeOperation = "destination-in";
      t.drawImage(tipMask(b.shape === "round" ? "round" : b.shape, Math.min(b.hardness, 0.6)), 0, 0, sz, sz);
      const g = this.workCtx;
      g.globalAlpha = Math.min(1, 0.25 + s.opacity * 0.75) * Math.max(0.3, alpha);
      g.drawImage(this.tmp, 0, 0, sz, sz, x - sz / 2, y - sz / 2, sz, sz);
      g.globalAlpha = 1;
      return rect;
    }

    let color = s.color;
    if (b.hueJitter || b.briJitter) {
      const h = (this.hsv.h + (R() - 0.5) * 360 * b.hueJitter + 360) % 360;
      const v = Math.max(0, Math.min(1, this.hsv.v + (R() - 0.5) * b.briJitter));
      const q = (n: number, steps: number) => Math.round(n * steps) / steps;
      color = rgbToHex(...hsvToRgb({ h: q(h / 360, 36) * 360, s: this.hsv.s, v: q(v, 20) }));
    }
    const g = this.rawCtx;
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (b.roundness < 1) g.scale(1, b.roundness);
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.drawImage(tinted(b.shape, b.hardness, s.mode === "erase" ? "#000000" : color), -r, -r, size, size);
    g.restore();
    return rect;
  }

  /** out = raw × grain × selection, for one area. */
  refreshOut(r0: Rect): void {
    const s = this.s;
    if (!s || s.mode === "smudge") return;
    const r = clampRect(r0, this.w, this.h);
    if (!r) return;
    const g = this.outCtx;
    g.save();
    // Clip: destination-in is "unbounded" in browsers and would clear the rest of the stroke.
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.clearRect(r.x, r.y, r.w, r.h);
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.raw, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    const grain = grainTexture(s.brush.grain, s.brush.grainDepth);
    if (grain) {
      const pat = g.createPattern(grain, "repeat");
      if (pat) {
        const sc = s.brush.grainScale;
        pat.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0]));
        g.globalCompositeOperation = "destination-in";
        g.fillStyle = pat;
        g.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    if (s.selectionMask) {
      g.globalCompositeOperation = "destination-in";
      g.drawImage(s.selectionMask, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    g.restore();
  }

  private applyWetEdges(amount: number): void {
    const r = clampRect(this.dirty!, this.w, this.h);
    if (!r || r.w * r.h > 4096 * 2048) return;
    const img = this.outCtx.getImageData(r.x, r.y, r.w, r.h);
    const d = img.data;
    const a = new Float32Array(r.w * r.h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    for (let y = 1; y < r.h - 1; y++)
      for (let x = 1; x < r.w - 1; x++) {
        const i = y * r.w + x;
        if (a[i] <= 0) continue;
        const gx = a[i + 1] - a[i - 1],
          gy = a[i + r.w] - a[i - r.w];
        const edge = Math.min(1, Math.hypot(gx, gy) * 6);
        d[i * 4 + 3] = Math.min(255, d[i * 4 + 3] * (1 + amount * edge * 2.5));
      }
    this.outCtx.putImageData(img, r.x, r.y);
  }

  /** Draws the active layer as it will look after this stroke (for live display). */
  preview(target: CanvasRenderingContext2D, layer: HTMLCanvasElement, alphaLock: boolean): void {
    const s = this.s!;
    if (s.mode === "smudge") {
      target.drawImage(this.work, 0, 0);
      return;
    }
    target.drawImage(layer, 0, 0);
    target.save();
    target.globalAlpha = s.opacity;
    target.globalCompositeOperation = s.mode === "erase" ? "destination-out" : alphaLock ? "source-atop" : "source-over";
    target.drawImage(this.out, 0, 0);
    target.restore();
  }

  /** Puts the stroke onto the layer. */
  commit(layerCtx: CanvasRenderingContext2D, alphaLock: boolean): void {
    const s = this.s!;
    if (s.mode === "smudge") {
      if (s.selectionMask) {
        const t = makeCanvas(this.w, this.h);
        const tg = ctx2d(t);
        tg.drawImage(this.work, 0, 0);
        tg.globalCompositeOperation = "destination-in";
        tg.drawImage(s.selectionMask, 0, 0);
        layerCtx.save();
        layerCtx.globalCompositeOperation = "destination-out";
        layerCtx.drawImage(s.selectionMask, 0, 0);
        layerCtx.restore();
        layerCtx.drawImage(t, 0, 0);
      } else {
        layerCtx.clearRect(0, 0, this.w, this.h);
        layerCtx.drawImage(this.work, 0, 0);
      }
    } else {
      layerCtx.save();
      layerCtx.globalAlpha = s.opacity;
      layerCtx.globalCompositeOperation = s.mode === "erase" ? "destination-out" : alphaLock ? "source-atop" : "source-over";
      layerCtx.drawImage(this.out, 0, 0);
      layerCtx.restore();
    }
    this.active = false;
    this.s = null;
  }

  cancel(): void {
    this.active = false;
    this.s = null;
  }
}

/** A small preview stroke for the brush library. */
export function brushPreview(brush: Brush, w: number, h: number, color: string): HTMLCanvasElement {
  const eng = new StrokeEngine(w, h);
  const layer = makeCanvas(w, h);
  const preview = { ...brush, maxSize: Math.min(brush.maxSize, h * 0.6), minSize: Math.min(brush.minSize, 2) };
  eng.begin({ brush: preview, size: 0.75, opacity: 1, color, mode: "paint", pressureFromPen: true, symmetry: "off", center: [0, 0], selectionMask: null }, layer);
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    eng.add({ x: 10 + f * (w - 20), y: h / 2 + Math.sin(f * Math.PI * 2) * h * 0.18, p: Math.sin(f * Math.PI) * 0.9 + 0.1, t: i * 16 });
  }
  eng.end();
  const g = ctx2d(layer);
  eng.commit(g, false);
  return layer;
}
