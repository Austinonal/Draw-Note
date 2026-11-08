// Draws pages: paper, imported background, raster paint layers (blend modes, opacity, clipping
// masks) and the vector notes layer.
import type { InkObj, Layer, Obj, Page } from "./model";
import { drawPaper } from "./paper";
import { objBounds } from "./geometry";
import { makeCanvas, ctx2d } from "../paint/engine";

const images = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;
export function setImageLoadListener(fn: (() => void) | null): void {
  onImageLoad = fn;
}
export function getImage(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad?.();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Image failed to load"));
    img.src = src;
  });
}

export function drawInk(ctx: CanvasRenderingContext2D, o: InkObj): void {
  const pts = o.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (o.pen === "highlighter") {
    ctx.globalAlpha = o.opacity;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineCap = "square";
    ctx.lineWidth = o.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.globalAlpha = o.pen === "pencil" ? o.opacity * 0.8 : o.opacity;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (o.width * (0.4 + pts[0].p * 0.6)) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (o.pen === "pencil") {
    // A textured, constant-ish line: many thin offset passes.
    ctx.lineWidth = Math.max(0.6, o.width * 0.45);
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * o.width * 0.18;
      ctx.globalAlpha = o.opacity * (k === 1 ? 0.75 : 0.35);
      ctx.beginPath();
      ctx.moveTo(pts[0].x + off, pts[0].y - off);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + off, pts[i].y - off);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // Pressure-sensitive pen: variable-width segments with smoothed midpoints.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    let wdt = o.width * (0.35 + 0.65 * ((a.p + b.p) / 2));
    if (o.pen === "fountain") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      wdt = o.width * (0.25 + 0.75 * Math.abs(Math.sin(ang - Math.PI / 4))) * (0.5 + 0.5 * b.p);
    }
    ctx.lineWidth = Math.max(0.5, wdt);
    ctx.beginPath();
    if (i === 1) ctx.moveTo(a.x, a.y);
    else ctx.moveTo((pts[i - 2].x + a.x) / 2, (pts[i - 2].y + a.y) / 2);
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    if (i === pts.length - 1) ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    // Thai and other scripts without spaces fall back to per-character wrapping.
    const words = para.includes(" ") ? para.split(/(\s+)/) : Array.from(para);
    let line = "";
    for (const w of words) {
      const t = line + w;
      if (ctx.measureText(t).width > width && line) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function drawObj(ctx: CanvasRenderingContext2D, o: Obj): void {
  switch (o.type) {
    case "ink":
      drawInk(ctx, o);
      return;
    case "shape": {
      ctx.save();
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      if (o.shape === "rect") ctx.rect(o.x, o.y, o.w, o.h);
      else if (o.shape === "ellipse") ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
      else if (o.shape === "triangle") {
        ctx.moveTo(o.x + o.w / 2, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.lineTo(o.x, o.y + o.h);
        ctx.closePath();
      } else {
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        if (o.shape === "arrow") {
          const a = Math.atan2(o.h, o.w);
          const L = Math.max(10, o.width * 4);
          ctx.moveTo(o.x + o.w, o.y + o.h);
          ctx.lineTo(o.x + o.w - L * Math.cos(a - 0.45), o.y + o.h - L * Math.sin(a - 0.45));
          ctx.moveTo(o.x + o.w, o.y + o.h);
          ctx.lineTo(o.x + o.w - L * Math.cos(a + 0.45), o.y + o.h - L * Math.sin(a + 0.45));
        }
      }
      if (o.fill && o.shape !== "line" && o.shape !== "arrow") {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "text": {
      ctx.save();
      ctx.fillStyle = o.color;
      ctx.font = `${o.size}px system-ui, -apple-system, "Noto Sans Thai", sans-serif`;
      ctx.textBaseline = "top";
      wrapLines(ctx, o.text, o.w).forEach((l, i) => ctx.fillText(l, o.x, o.y + i * o.size * 1.3));
      ctx.restore();
      return;
    }
    case "image": {
      const img = getImage(o.src);
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
      else {
        ctx.save();
        ctx.fillStyle = "rgba(128,128,128,.2)";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.restore();
      }
      return;
    }
    case "sticky": {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.18)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#2a2a2a";
      ctx.font = `16px system-ui, -apple-system, "Noto Sans Thai", sans-serif`;
      ctx.textBaseline = "top";
      wrapLines(ctx, o.text, o.w - 20).forEach((l, i) => {
        if (14 + (i + 1) * 21 < o.h) ctx.fillText(l, o.x + 10, o.y + 12 + i * 21);
      });
      ctx.restore();
      return;
    }
    case "tape": {
      ctx.save();
      ctx.globalAlpha = o.hidden ? 0.95 : 0.25;
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.globalAlpha = o.hidden ? 0.25 : 0.12;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      for (let x = o.x - o.h; x < o.x + o.w; x += 10) {
        ctx.beginPath();
        ctx.moveTo(Math.max(o.x, x), Math.max(o.y, o.y + (o.x - x)));
        ctx.lineTo(Math.min(o.x + o.w, x + o.h), Math.min(o.y + o.h, o.y + o.h - (x + o.h - (o.x + o.w))));
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
  }
}

export type LayerSource = (l: Layer) => HTMLCanvasElement | null;

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = makeCanvas(w, h);
  return scratch;
}

/** Composites the paint layers (in raster pixels) onto ctx. Clipping-mask layers are drawn only
 * where the nearest non-clipping layer below has paint. */
export function compositeLayers(ctx: CanvasRenderingContext2D, layers: Layer[], src: LayerSource, w: number, h: number): void {
  let base: HTMLCanvasElement | null = null;
  for (const l of layers) {
    const c = src(l);
    if (!l.clip) base = l.visible ? c : null;
    if (!l.visible || !c || l.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    if (l.clip) {
      if (!base) {
        ctx.restore();
        continue;
      }
      const t = scratchCanvas(w, h);
      const g = ctx2d(t);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, w, h);
      g.drawImage(c, 0, 0);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(base, 0, 0);
      ctx.drawImage(t, 0, 0);
    } else ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
}

export interface RenderOpts {
  paper?: boolean;
  objects?: boolean;
  skip?: Set<string>; // object ids not to draw (e.g. being edited)
}

/** Renders a whole page at `scale` device pixels per document unit. */
export function renderPage(ctx: CanvasRenderingContext2D, page: Page, src: LayerSource, scale: number, opts: RenderOpts = {}): void {
  ctx.save();
  ctx.scale(scale, scale);
  if (opts.paper !== false) drawPaper(ctx, page.paper, page.w, page.h, page.paperColor);
  if (page.bg) {
    const img = getImage(page.bg);
    if (img) ctx.drawImage(img, 0, 0, page.w, page.h);
  }
  ctx.restore();
  ctx.save();
  ctx.scale(scale / page.scale, scale / page.scale);
  compositeLayers(ctx, page.layers, src, Math.round(page.w * page.scale), Math.round(page.h * page.scale));
  ctx.restore();
  if (opts.objects !== false && page.notesVisible) {
    ctx.save();
    ctx.scale(scale, scale);
    for (const o of page.objects) if (!opts.skip?.has(o.id)) drawObj(ctx, o);
    ctx.restore();
  }
}

/** Renders a page to a new canvas at a given pixel width. */
export function pageToCanvas(page: Page, src: LayerSource, width: number): HTMLCanvasElement {
  const s = width / page.w;
  const c = makeCanvas(page.w * s, page.h * s);
  renderPage(ctx2d(c), page, src, s);
  return c;
}

export { objBounds };
