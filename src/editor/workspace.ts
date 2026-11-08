// The editing surface: owns the display canvas, the current page's raster layers, the view
// (zoom / pan / rotate), input (pen, touch, mouse, gestures), every tool's interaction, history and
// saving. React (Editor.tsx) drives it through ToolState and reads its state for the UI.
import type { Cover, Doc, InkObj, Layer, Obj, Page, PdfLine, Pt, ShapeObj } from "../lib/model";
import { cloneObj, id, newLayer, siblingPage } from "../lib/model";
import { drawPaper } from "../lib/paper";
import { compositeLayers, drawObj, drawInk, drawPdfEdits, getImage, setImageLoadListener, loadImage } from "../lib/render";
import { hitObj, lassoSelects, objBounds, recognize, scaleObj, shapePoints, splitInk, translateObj, unionBox, type Box, type QuickShape } from "../lib/geometry";
import { StrokeEngine, ctx2d, makeCanvas, clampRect, unionRect, type Rect } from "../paint/engine";
import { findBrush, type Brush } from "../paint/brushes";
import { floodFill } from "../paint/fill";
import { blurData } from "../paint/adjust";
import { rgbToHex } from "../paint/color";
import { getBlob, putBlob, putDoc, layerKey, deleteBlob } from "../lib/storage";
import { hitLine, lineCorners } from "../lib/pdftext";
import type { PaintSlot, ToolState, WorkspaceEvents } from "./types";

type Hist =
  | { kind: "raster"; page: string; layer: string; x: number; y: number; before: ImageData; after: ImageData }
  | { kind: "objects"; page: string; before: Obj[]; after: Obj[] }
  | { kind: "layers"; page: string; before: LayerSnap; after: LayerSnap }
  | { kind: "pdf"; page: string; before: PdfSnap; after: PdfSnap };

interface PdfSnap {
  lines: PdfLine[];
  covers: Cover[];
  objects: Obj[];
}

interface LayerSnap {
  layers: Layer[];
  active: string;
  canvases: Map<string, HTMLCanvasElement>;
}

interface PointerInfo {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  type: string;
}

interface View {
  zoom: number;
  x: number;
  y: number;
  rot: number;
}

interface Floating {
  canvas: HTMLCanvasElement; // lifted pixels (raster coords, full-size)
  base: HTMLCanvasElement; // the layer with the lifted pixels removed
  before: HTMLCanvasElement; // the layer as it was
  box: Rect; // lifted bounds in raster coords
  m: DOMMatrix; // transform applied to the floating pixels (raster coords)
  layer: string;
}

type Action =
  | { kind: "none" }
  | { kind: "paint"; slot: PaintSlot; holdTimer: number; lastMove: number; quick: boolean }
  | { kind: "ink"; obj: InkObj; holdTimer: number; quick: boolean }
  | { kind: "erase"; before: Obj[]; changed: boolean; last: { x: number; y: number } | null }
  | { kind: "lasso"; poly: { x: number; y: number }[] }
  | { kind: "moveSel"; before: Obj[]; lx: number; ly: number }
  | { kind: "scaleSel"; before: Obj[]; box: Box; ax: number; ay: number }
  | { kind: "shape"; obj: ShapeObj }
  | { kind: "tape"; obj: Obj }
  | { kind: "select"; poly: { x: number; y: number }[]; x0: number; y0: number }
  | { kind: "transform"; lx: number; ly: number; corner: boolean; start: DOMMatrix; cx: number; cy: number; d0: number }
  | { kind: "laser" }
  | { kind: "pdfLine"; line: PdfLine; before: PdfSnap; sx: number; sy: number; dx0: number; dy0: number; moved: boolean }
  | { kind: "lift"; poly: { x: number; y: number }[]; x0: number; y0: number }
  | { kind: "pan"; lx: number; ly: number }
  | { kind: "gesture"; start: View; a: PointerInfo; b: PointerInfo; t: number; moved: boolean; fingers: number };

const HIST_LIMIT = 60;
const HIST_BYTES = 160 * 1024 * 1024;

export class Workspace {
  doc: Doc;
  pageIndex = 0;
  ts: ToolState;
  customBrushes: Brush[] = [];
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ev: WorkspaceEvents;
  layers = new Map<string, HTMLCanvasElement>();
  view: View = { zoom: 1, x: 0, y: 0, rot: 0 };
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private engine: StrokeEngine | null = null;
  private snap: HTMLCanvasElement | null = null; // active layer before the current raster edit
  private paperCache: HTMLCanvasElement | null = null;
  private paperKey = "";
  private notesCache: HTMLCanvasElement | null = null;
  private notesDirty = true;
  private hist = new Map<string, { undo: Hist[]; redo: Hist[] }>();
  private pointers = new Map<number, PointerInfo>();
  private action: Action = { kind: "none" };
  private raf = 0;
  private needs = false;
  private dirtyLayers = new Set<string>();
  private saveTimer = 0;
  private docDirty = false;
  private laser: { x: number; y: number; t: number }[] = [];
  private penSeen = false;
  loading = false;
  // Notes selection (lasso) and raster selection
  selected = new Set<string>();
  selection: { mask: HTMLCanvasElement; outline: { x: number; y: number }[][]; box: Rect } | null = null;
  floating: Floating | null = null;
  // Animation assist
  playing = false;
  private playTimer = 0;
  fps = 8;
  private lapseTimer = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, doc: Doc, ts: ToolState, ev: WorkspaceEvents) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.doc = doc;
    this.ts = ts;
    this.ev = ev;
    setImageLoadListener(() => {
      this.notesDirty = true;
      this.paperKey = "";
      this.request();
    });
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.playTimer);
    setImageLoadListener(null);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  get page(): Page {
    return this.doc.pages[this.pageIndex];
  }
  get rw(): number {
    return Math.round(this.page.w * this.page.scale);
  }
  get rh(): number {
    return Math.round(this.page.h * this.page.scale);
  }
  get activeLayer(): Layer | undefined {
    return this.page.layers.find((l) => l.id === this.page.activeLayer);
  }
  activeCanvas(): HTMLCanvasElement | null {
    return this.layers.get(this.page.activeLayer) ?? null;
  }

  // ---------------------------------------------------------------- pages & loading
  async loadPage(index: number): Promise<void> {
    await this.flush();
    this.cancelFloating();
    this.selection = null;
    this.selected.clear();
    this.pageIndex = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    const page = this.page;
    this.loading = true;
    const next = new Map<string, HTMLCanvasElement>();
    for (const l of page.layers) {
      const c = makeCanvas(this.rw, this.rh);
      const blob = await getBlob(layerKey(page.id, l.id)).catch(() => undefined);
      if (blob) {
        try {
          const url = URL.createObjectURL(blob);
          const img = await loadImage(url);
          ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
        } catch {
          /* unreadable layer: start blank */
        }
      }
      next.set(l.id, c);
    }
    if (this.destroyed) return;
    this.layers = next;
    this.engine = new StrokeEngine(this.rw, this.rh);
    this.snap = makeCanvas(this.rw, this.rh);
    this.paperKey = "";
    this.notesDirty = true;
    this.loading = false;
    this.fit();
    this.ev.changed();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1); // 3x phones: 2x looks the same and fills 2.25x fewer pixels
    this.desk = getComputedStyle(this.canvas).getPropertyValue("--desk").trim();
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.request();
  }

  fit(): void {
    const p = this.page;
    if (!this.vw) this.resize();
    const pad = this.vw < 600 ? 12 : 40;
    const z = Math.min((this.vw - pad * 2) / p.w, (this.vh - pad * 2) / p.h);
    this.view = { zoom: z, rot: 0, x: (this.vw - p.w * z) / 2, y: (this.vh - p.h * z) / 2 };
    this.request();
  }

  zoomBy(f: number, cx = this.vw / 2, cy = this.vh / 2): void {
    const v = this.view;
    const nz = Math.max(0.05, Math.min(40, v.zoom * f));
    const k = nz / v.zoom;
    this.view = { ...v, zoom: nz, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    this.request();
  }

  // ---------------------------------------------------------------- coordinates
  private toDoc(cx: number, cy: number): { x: number; y: number } {
    const v = this.view;
    const dx = (cx - v.x) / v.zoom,
      dy = (cy - v.y) / v.zoom;
    const c = Math.cos(-v.rot),
      s = Math.sin(-v.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  toScreen(x: number, y: number): { x: number; y: number } {
    const v = this.view;
    const c = Math.cos(v.rot),
      s = Math.sin(v.rot);
    return { x: v.x + (x * c - y * s) * v.zoom, y: v.y + (x * s + y * c) * v.zoom };
  }
  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------------------------------------------------------------- rendering
  request(): void {
    if (this.needs || this.destroyed) return;
    this.needs = true;
    this.raf = requestAnimationFrame(() => {
      this.needs = false;
      this.draw();
    });
  }
  invalidateNotes(): void {
    this.notesDirty = true;
    this.request();
  }

  private paperCanvas(): HTMLCanvasElement {
    const p = this.page;
    const key = `${p.id}|${p.paper}|${p.paperColor}|${p.bg ? p.bg.length : 0}|${p.w}x${p.h}|${!!(p.bg && getImage(p.bg))}|${this.pdfRev}`;
    if (this.paperCache && this.paperKey === key) return this.paperCache;
    const s = Math.min(2, 2400 / Math.max(p.w, p.h));
    const c = this.paperCache && this.paperCache.width === Math.round(p.w * s) ? this.paperCache : makeCanvas(p.w * s, p.h * s);
    const g = ctx2d(c);
    g.setTransform(s, 0, 0, s, 0, 0);
    drawPaper(g, p.paper, p.w, p.h, p.paperColor);
    if (p.bg) {
      const img = getImage(p.bg);
      if (img) g.drawImage(img, 0, 0, p.w, p.h);
    }
    drawPdfEdits(g, p, this.editingSkip);
    this.paperCache = c;
    this.paperKey = key;
    return c;
  }

  private notesCanvas(skip: Set<string>): HTMLCanvasElement {
    const p = this.page;
    const s = Math.min(2.5, 3000 / Math.max(p.w, p.h));
    if (!this.notesCache || this.notesCache.width !== Math.round(p.w * s) || this.notesCache.height !== Math.round(p.h * s)) {
      this.notesCache = makeCanvas(p.w * s, p.h * s);
      this.notesDirty = true;
    }
    if (this.notesDirty) {
      const g = ctx2d(this.notesCache);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.notesCache.width, this.notesCache.height);
      g.setTransform(s, 0, 0, s, 0, 0);
      for (const o of p.objects) if (!skip.has(o.id)) drawObj(g, o);
      this.notesDirty = false;
    }
    return this.notesCache;
  }

  /** Layer source used for display: the active layer shows the stroke / transform in progress. */
  private displaySource = (l: Layer): HTMLCanvasElement | null => {
    const c = this.layers.get(l.id) ?? null;
    if (!c) return null;
    if (l.id === this.page.activeLayer) {
      if (this.engine?.active) {
        // Only refresh the area the stroke touched since the last frame; copying the whole
        // layer every frame was the main cause of lag on big canvases.
        const t = this.liveCanvas();
        const r = this.liveDirty ? clampRect(this.liveDirty, t.width, t.height) : null;
        this.liveDirty = null;
        if (r) {
          const g = ctx2d(t);
          g.save();
          g.beginPath();
          g.rect(r.x, r.y, r.w, r.h);
          g.clip();
          g.clearRect(r.x, r.y, r.w, r.h);
          this.engine.preview(g, c, l.alphaLock);
          g.restore();
        }
        return t;
      }
      if (this.floating && this.floating.layer === l.id) {
        const t = this.liveCanvas();
        const g = ctx2d(t);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, t.width, t.height);
        g.drawImage(this.floating.base, 0, 0);
        g.setTransform(this.floating.m);
        g.drawImage(this.floating.canvas, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        return t;
      }
      if (this.adjustPreview) return this.adjustPreview;
    }
    return c;
  };
  private live: HTMLCanvasElement | null = null;
  private liveDirty: Rect | null = null;
  private trackLive(r: Rect | null): void {
    if (r) this.liveDirty = unionRect(this.liveDirty, r);
  }
  private desk = "";
  private liveCanvas(): HTMLCanvasElement {
    if (!this.live || this.live.width !== this.rw || this.live.height !== this.rh) this.live = makeCanvas(this.rw, this.rh);
    return this.live;
  }
  adjustPreview: HTMLCanvasElement | null = null;

  /** Layers as displayed, honouring Animation Assist (one frame plus onion skins). */
  private displayLayers(): Layer[] {
    const p = this.page;
    if (!this.ts.animation) return p.layers;
    const idx = p.layers.findIndex((l) => l.id === p.activeLayer);
    return p.layers
      .map((l, i) => {
        if (i === idx) return { ...l, visible: true };
        if (this.ts.onion && !this.playing && Math.abs(i - idx) === 1) return { ...l, visible: true, opacity: 0.25 };
        return { ...l, visible: false };
      });
  }

  draw(): void {
    const g = this.ctx;
    if (!this.doc.pages.length || this.loading) return;
    const p = this.page;
    const v = this.view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.desk || "#2a2d33";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const base = new DOMMatrix().scale(this.dpr).translate(v.x, v.y).rotate((v.rot * 180) / Math.PI).scale(v.zoom);
    g.setTransform(base);
    // cheap page shadow (shadowBlur on a page-sized rect is expensive every frame)
    g.fillStyle = "rgba(0,0,0,.25)";
    g.fillRect(2 / v.zoom, 4 / v.zoom, p.w, p.h);
    g.fillStyle = p.paperColor;
    g.fillRect(0, 0, p.w, p.h);
    g.save();
    g.beginPath();
    g.rect(0, 0, p.w, p.h);
    g.clip();
    // default ("low") smoothing on purpose: "medium"/"high" re-filter every layer each frame and halved the frame rate
    g.drawImage(this.paperCanvas(), 0, 0, p.w, p.h);
    // paint layers
    g.save();
    g.scale(1 / p.scale, 1 / p.scale);
    compositeLayers(g, this.displayLayers(), this.displaySource, this.rw, this.rh);
    g.restore();
    // notes
    if (p.notesVisible) {
      const skip = this.editingSkip;
      const sel = this.action.kind === "moveSel" || this.action.kind === "scaleSel";
      if (sel) {
        // draw unselected from cache, selected live
        for (const o of p.objects) drawObj(g, o);
      } else if (v.zoom * this.dpr > 2.5) {
        for (const o of p.objects) if (!skip.has(o.id)) drawObj(g, o);
      } else g.drawImage(this.notesCanvas(skip), 0, 0, p.w, p.h);
      if (this.action.kind === "ink") drawInk(g, this.action.obj);
      if (this.action.kind === "shape" || this.action.kind === "tape") drawObj(g, this.action.obj);
    }
    if (this.ts.gridGuide) this.drawGrid(g);
    g.restore();
    this.drawOverlays(g);
  }

  editingSkip = new Set<string>();

  private drawGrid(g: CanvasRenderingContext2D): void {
    const p = this.page;
    const step = Math.max(p.w, p.h) / 16;
    g.save();
    g.strokeStyle = "rgba(80,140,255,.35)";
    g.lineWidth = 1 / this.view.zoom;
    g.beginPath();
    for (let x = step; x < p.w; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, p.h);
    }
    for (let y = step; y < p.h; y += step) {
      g.moveTo(0, y);
      g.lineTo(p.w, y);
    }
    g.stroke();
    g.restore();
  }

  private drawOverlays(g: CanvasRenderingContext2D): void {
    const p = this.page;
    const z = this.view.zoom;
    const px = 1 / z;
    // symmetry guide
    if (this.ts.mode === "paint" && this.ts.symmetry !== "off") {
      g.save();
      g.strokeStyle = "rgba(0,170,255,.7)";
      g.lineWidth = 1.5 * px;
      g.setLineDash([6 * px, 6 * px]);
      g.beginPath();
      const s = this.ts.symmetry;
      if (s === "vertical" || s === "quadrant" || s === "radial") {
        g.moveTo(p.w / 2, 0);
        g.lineTo(p.w / 2, p.h);
      }
      if (s === "horizontal" || s === "quadrant" || s === "radial") {
        g.moveTo(0, p.h / 2);
        g.lineTo(p.w, p.h / 2);
      }
      g.stroke();
      g.restore();
    }
    // notes selection
    if (this.selected.size) {
      const box = this.selectionBox();
      if (box) {
        g.save();
        g.strokeStyle = "#3b82f6";
        g.lineWidth = 1.5 * px;
        g.setLineDash([5 * px, 4 * px]);
        g.strokeRect(box.x, box.y, box.w, box.h);
        g.setLineDash([]);
        g.fillStyle = "#fff";
        const hs = 9 * px;
        g.beginPath();
        g.arc(box.x + box.w, box.y + box.h, hs, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
    }
    // lasso / selection path in progress
    // outlines of editable PDF text while the Text tool is active
    if (this.pdfEditable && this.ts.mode === "notes" && (this.ts.noteTool === "text" || this.ts.noteTool === "lift")) {
      g.save();
      g.strokeStyle = "rgba(59,130,246,.45)";
      g.lineWidth = px;
      g.setLineDash([3 * px, 3 * px]);
      for (const l of this.page.pdfLines ?? []) {
        g.beginPath();
        lineCorners(l).forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.stroke();
      }
      g.restore();
    }
    if (this.action.kind === "lasso" || this.action.kind === "select" || this.action.kind === "lift") {
      const poly = this.action.poly;
      g.save();
      g.strokeStyle = "#3b82f6";
      g.fillStyle = "rgba(59,130,246,.08)";
      g.lineWidth = 1.5 * px;
      g.setLineDash([6 * px, 5 * px]);
      g.beginPath();
      poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
    // raster selection outline (marching ants)
    if (this.selection && !this.floating) {
      const off = (performance.now() / 60) % 12;
      g.save();
      g.scale(1 / p.scale, 1 / p.scale);
      g.lineWidth = (1.5 * p.scale) / z;
      for (const [col, dash] of [["#000", 0], ["#fff", 6]] as const) {
        g.strokeStyle = col;
        g.setLineDash([(6 * p.scale) / z, (6 * p.scale) / z]);
        g.lineDashOffset = ((-off + dash) * p.scale) / z;
        g.beginPath();
        for (const poly of this.selection.outline) poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.stroke();
      }
      g.restore();
      this.request(); // animate
    }
    // floating transform box
    if (this.floating) {
      const f = this.floating;
      const corners = [
        [f.box.x, f.box.y],
        [f.box.x + f.box.w, f.box.y],
        [f.box.x + f.box.w, f.box.y + f.box.h],
        [f.box.x, f.box.y + f.box.h],
      ].map(([x, y]) => f.m.transformPoint(new DOMPoint(x, y)));
      g.save();
      g.scale(1 / p.scale, 1 / p.scale);
      g.strokeStyle = "#3b82f6";
      g.lineWidth = (1.5 * p.scale) / z;
      g.beginPath();
      corners.forEach((c, i) => (i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y)));
      g.closePath();
      g.stroke();
      g.fillStyle = "#fff";
      for (const c of corners) {
        g.beginPath();
        g.arc(c.x, c.y, (9 * p.scale) / z, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.restore();
    }
    // laser
    if (this.laser.length) {
      const now = performance.now();
      this.laser = this.laser.filter((q) => now - q.t < 900);
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      for (let i = 1; i < this.laser.length; i++) {
        const a = this.laser[i - 1],
          b = this.laser[i];
        const life = 1 - (now - b.t) / 900;
        g.strokeStyle = `rgba(255,40,40,${life})`;
        g.shadowColor = "rgba(255,0,0,.8)";
        g.shadowBlur = 10;
        g.lineWidth = 4 * px;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
      g.restore();
      if (this.laser.length) this.request();
    }
    // eraser cursor
    if (this.cursor) {
      g.save();
      g.strokeStyle = "rgba(120,120,120,.9)";
      g.lineWidth = px;
      g.beginPath();
      g.arc(this.cursor.x, this.cursor.y, this.cursor.r, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
  private cursor: { x: number; y: number; r: number } | null = null;

  // ---------------------------------------------------------------- history
  private stack() {
    let h = this.hist.get(this.page.id);
    if (!h) {
      h = { undo: [], redo: [] };
      this.hist.set(this.page.id, h);
    }
    return h;
  }
  private push(h: Hist): void {
    const s = this.stack();
    s.undo.push(h);
    s.redo = [];
    let bytes = 0;
    for (const e of s.undo) if (e.kind === "raster") bytes += e.before.data.length * 2;
    while (s.undo.length > HIST_LIMIT || (bytes > HIST_BYTES && s.undo.length > 1)) {
      const e = s.undo.shift()!;
      if (e.kind === "raster") bytes -= e.before.data.length * 2;
    }
    this.afterEdit();
  }
  canUndo(): boolean {
    return !!this.stack().undo.length;
  }
  canRedo(): boolean {
    return !!this.stack().redo.length;
  }
  undo(): void {
    this.commitFloating();
    const s = this.stack();
    const h = s.undo.pop();
    if (!h) return;
    this.apply(h, "before");
    s.redo.push(h);
    this.afterEdit(false);
  }
  redo(): void {
    const s = this.stack();
    const h = s.redo.pop();
    if (!h) return;
    this.apply(h, "after");
    s.undo.push(h);
    this.afterEdit(false);
  }
  private apply(h: Hist, which: "before" | "after"): void {
    if (h.kind === "raster") {
      const c = this.layers.get(h.layer);
      if (c) ctx2d(c).putImageData(h[which], h.x, h.y);
      this.dirtyLayers.add(h.layer);
    } else if (h.kind === "objects") {
      this.page.objects = h[which].map(cloneObj);
      this.selected.clear();
      this.notesDirty = true;
    } else if (h.kind === "pdf") {
      this.restorePdf(h[which]);
    } else {
      const snap = h[which];
      this.page.layers = snap.layers.map((l) => ({ ...l }));
      this.page.activeLayer = snap.active;
      for (const [k, c] of snap.canvases) {
        const copy = makeCanvas(c.width, c.height);
        ctx2d(copy).drawImage(c, 0, 0);
        this.layers.set(k, copy);
        this.dirtyLayers.add(k);
      }
      this.docDirty = true;
    }
  }
  private afterEdit(lapse = true): void {
    this.docDirty = true;
    this.scheduleSave();
    if (lapse) this.scheduleLapse();
    this.request();
    this.ev.changed();
  }

  private layerSnap(): LayerSnap {
    const canvases = new Map<string, HTMLCanvasElement>();
    for (const l of this.page.layers) {
      const c = this.layers.get(l.id);
      if (c) {
        const copy = makeCanvas(c.width, c.height);
        ctx2d(copy).drawImage(c, 0, 0);
        canvases.set(l.id, copy);
      }
    }
    return { layers: this.page.layers.map((l) => ({ ...l })), active: this.page.activeLayer, canvases };
  }
  /** Runs a structural layer change with undo. */
  layerOp(fn: () => void): void {
    this.commitFloating();
    const before = this.layerSnap();
    fn();
    this.push({ kind: "layers", page: this.page.id, before, after: this.layerSnap() });
  }
  objectsOp(fn: () => void): void {
    const before = this.page.objects.map(cloneObj);
    fn();
    this.notesDirty = true;
    this.push({ kind: "objects", page: this.page.id, before, after: this.page.objects.map(cloneObj) });
  }
  /** Records a raster change of the active layer made after beginRaster(). */
  private beginRaster(): void {
    const c = this.activeCanvas();
    if (!c || !this.snap) return;
    const g = ctx2d(this.snap);
    g.clearRect(0, 0, this.snap.width, this.snap.height);
    g.drawImage(c, 0, 0);
  }
  private endRaster(r: Rect | null): void {
    const c = this.activeCanvas();
    if (!c || !this.snap) return;
    const rc = r ? clampRect(r, c.width, c.height) : { x: 0, y: 0, w: c.width, h: c.height };
    if (!rc) return;
    const before = ctx2d(this.snap, true).getImageData(rc.x, rc.y, rc.w, rc.h);
    const after = ctx2d(c, true).getImageData(rc.x, rc.y, rc.w, rc.h);
    this.dirtyLayers.add(this.page.activeLayer);
    this.push({ kind: "raster", page: this.page.id, layer: this.page.activeLayer, x: rc.x, y: rc.y, before, after });
  }
  /** Applies a whole-layer pixel edit with undo. */
  rasterEdit(fn: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => Rect | null | void): void {
    const c = this.activeCanvas();
    if (!c) return;
    this.beginRaster();
    const r = fn(ctx2d(c), c);
    this.endRaster(r ?? null);
  }

  // ---------------------------------------------------------------- saving
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 900);
  }
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const page = this.doc.pages[this.pageIndex];
    if (!page) return;
    const dirty = [...this.dirtyLayers];
    this.dirtyLayers.clear();
    for (const lid of dirty) {
      const c = this.layers.get(lid);
      if (!c || !page.layers.some((l) => l.id === lid)) continue;
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (blob) await putBlob(layerKey(page.id, lid), blob);
    }
    if (this.docDirty || dirty.length) {
      this.docDirty = false;
      this.doc.updatedAt = Date.now();
      if (this.pageIndex === 0) this.doc.thumb = this.thumbnail(320);
      await putDoc(this.doc);
    }
  }
  markDocDirty(): void {
    this.docDirty = true;
    this.scheduleSave();
    this.ev.changed();
  }

  /** The current page flattened, at a given width. */
  flatten(width: number, withPaper = true): HTMLCanvasElement {
    const p = this.page;
    const s = width / p.w;
    const c = makeCanvas(p.w * s, p.h * s);
    const g = ctx2d(c);
    g.save();
    g.scale(s, s);
    if (withPaper) g.drawImage(this.paperCanvas(), 0, 0, p.w, p.h);
    g.restore();
    g.save();
    g.scale(s / p.scale, s / p.scale);
    compositeLayers(g, p.layers, (l) => this.layers.get(l.id) ?? null, this.rw, this.rh);
    g.restore();
    if (p.notesVisible) {
      g.save();
      g.scale(s, s);
      for (const o of p.objects) drawObj(g, o);
      g.restore();
    }
    return c;
  }
  thumbnail(w: number): string {
    return this.flatten(w).toDataURL("image/jpeg", 0.8);
  }
  layerSource = (l: Layer) => this.layers.get(l.id) ?? null;

  private scheduleLapse(): void {
    if (this.doc.kind !== "canvas" && this.ts.mode !== "paint") return;
    clearTimeout(this.lapseTimer);
    this.lapseTimer = window.setTimeout(() => {
      const frames = (this.doc.timelapse ??= []);
      frames.push(this.flatten(Math.min(480, this.page.w)).toDataURL("image/jpeg", 0.7));
      if (frames.length > 400) this.doc.timelapse = frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1);
      this.docDirty = true;
    }, 700);
  }

  // ---------------------------------------------------------------- input
  private isDrawingPointer(e: PointerEvent): boolean {
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return e.button === 0;
    return this.ts.fingerDraws && !this.penSeen;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const q = this.local(e);
    if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01), q.x, q.y);
    else {
      this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY };
      this.request();
    }
  };

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === "pen") this.penSeen = true;
    this.canvas.setPointerCapture(e.pointerId);
    const q = this.local(e);
    const info: PointerInfo = { x: q.x, y: q.y, sx: q.x, sy: q.y, t: performance.now(), type: e.pointerType };
    this.pointers.set(e.pointerId, info);
    const touches = [...this.pointers.values()].filter((p) => p.type === "touch");
    if (e.pointerType === "touch" && touches.length >= 2) {
      // A second finger: cancel a just-started finger stroke and start a gesture.
      this.abortAction();
      const [a, b] = touches;
      this.action = { kind: "gesture", start: { ...this.view }, a: { ...a }, b: { ...b }, t: performance.now(), moved: false, fingers: touches.length };
      return;
    }
    if (this.action.kind === "gesture") return;
    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2)) {
      this.action = { kind: "pan", lx: q.x, ly: q.y };
      return;
    }
    const tool = this.ts.mode === "notes" ? this.ts.noteTool : this.ts.paintTool;
    if (tool === "hand" || !this.isDrawingPointer(e)) {
      this.action = { kind: "pan", lx: q.x, ly: q.y };
      return;
    }
    if (this.ts.readOnly && tool !== "laser") {
      this.action = { kind: "pan", lx: q.x, ly: q.y };
      return;
    }
    this.startTool(e, q);
  };

  private pressure(e: PointerEvent): number {
    if (e.pointerType === "pen") return Math.max(0.05, e.pressure || 0.5);
    return 0.6;
  }

  private onMove = (e: PointerEvent) => {
    const info = this.pointers.get(e.pointerId);
    const q = this.local(e);
    if (!info) {
      // hover cursor for erasers
      this.updateCursor(q);
      return;
    }
    info.x = q.x;
    info.y = q.y;
    const a = this.action;
    if (a.kind === "gesture") {
      this.gesture(a);
      return;
    }
    if (a.kind === "pan") {
      this.view = { ...this.view, x: this.view.x + q.x - a.lx, y: this.view.y + q.y - a.ly };
      a.lx = q.x;
      a.ly = q.y;
      this.request();
      return;
    }
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    for (const ce of list) this.moveTool(ce, this.local(ce));
    this.updateCursor(q);
  };

  private onUp = (e: PointerEvent) => {
    const info = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const a = this.action;
    if (a.kind === "gesture") {
      if (this.pointers.size === 0) {
        const dt = performance.now() - a.t;
        if (!a.moved && dt < 300) {
          if (a.fingers >= 3) this.redo();
          else if (a.fingers === 2) this.undo();
        }
        this.action = { kind: "none" };
      } else {
        const touches = [...this.pointers.values()];
        a.fingers = Math.max(a.fingers, touches.length + 1);
      }
      return;
    }
    if (!info) return;
    this.endTool(e, this.local(e));
    this.cursor = null;
    this.request();
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.action.kind !== "gesture") this.abortAction();
    else if (!this.pointers.size) this.action = { kind: "none" };
  };

  private gesture(a: Extract<Action, { kind: "gesture" }>): void {
    const touches = [...this.pointers.values()];
    if (touches.length > a.fingers) a.fingers = touches.length;
    if (touches.length < 2) return;
    const [p1, p2] = touches;
    const d0 = Math.hypot(a.b.sx - a.a.sx, a.b.sy - a.a.sy) || 1;
    const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const m0 = { x: (a.a.sx + a.b.sx) / 2, y: (a.a.sy + a.b.sy) / 2 };
    const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (Math.abs(d1 - d0) > 8 || Math.hypot(m1.x - m0.x, m1.y - m0.y) > 8) a.moved = true;
    const k = d1 / d0;
    let dr = Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(a.b.sy - a.a.sy, a.b.sx - a.a.sx);
    if (this.doc.kind !== "canvas") dr = 0;
    let rot = a.start.rot + dr;
    const snap = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(rot - snap) < 0.12) rot = snap;
    const zoom = Math.max(0.05, Math.min(40, a.start.zoom * k));
    // keep the doc point under the starting midpoint under the current midpoint
    const sv = a.start;
    const dx = (m0.x - sv.x) / sv.zoom,
      dy = (m0.y - sv.y) / sv.zoom;
    const c0 = Math.cos(-sv.rot),
      s0 = Math.sin(-sv.rot);
    const doc = { x: dx * c0 - dy * s0, y: dx * s0 + dy * c0 };
    const c = Math.cos(rot),
      s = Math.sin(rot);
    this.view = { zoom, rot, x: m1.x - (doc.x * c - doc.y * s) * zoom, y: m1.y - (doc.x * s + doc.y * c) * zoom };
    this.request();
  }

  private updateCursor(q: { x: number; y: number }): void {
    const showEraser = (this.ts.mode === "notes" && this.ts.noteTool === "eraser") || (this.ts.mode === "paint" && (this.ts.paintTool === "erase" || this.ts.paintTool === "brush" || this.ts.paintTool === "smudge"));
    if (!showEraser) {
      if (this.cursor) {
        this.cursor = null;
        this.request();
      }
      return;
    }
    const d = this.toDoc(q.x, q.y);
    let r = this.ts.eraserSize / 2;
    if (this.ts.mode === "paint") {
      const slot = this.slot();
      const b = this.brushFor(slot);
      const t = this.ts.size[slot];
      r = (b.minSize + (b.maxSize - b.minSize) * t * t) / 2 / this.page.scale;
    }
    this.cursor = { x: d.x, y: d.y, r };
    this.request();
  }

  private slot(): PaintSlot {
    return this.ts.paintTool === "erase" ? "erase" : this.ts.paintTool === "smudge" ? "smudge" : "brush";
  }
  brushFor(slot: PaintSlot): Brush {
    return findBrush(this.ts.brushId[slot], this.customBrushes);
  }

  private abortAction(): void {
    const a = this.action;
    if (a.kind === "paint") {
      clearTimeout(a.holdTimer);
      this.engine?.cancel();
    }
    if (a.kind === "ink") clearTimeout(a.holdTimer);
    if (a.kind === "erase" && a.changed) {
      this.page.objects = a.before;
      this.notesDirty = true;
    }
    if ((a.kind === "moveSel" || a.kind === "scaleSel") && a.before) {
      this.page.objects = a.before;
      this.notesDirty = true;
    }
    this.action = { kind: "none" };
    this.request();
  }

  // ---------------------------------------------------------------- tools
  private startTool(e: PointerEvent, q: { x: number; y: number }): void {
    const d = this.toDoc(q.x, q.y);
    const now = performance.now();
    if (this.ts.mode === "notes") {
      const tool = this.ts.noteTool;
      // Tapping an existing selection moves or scales it, whatever the tool.
      if (this.selected.size) {
        const box = this.selectionBox();
        if (box) {
          const hs = 16 / this.view.zoom;
          if (Math.hypot(d.x - (box.x + box.w), d.y - (box.y + box.h)) < hs) {
            this.action = { kind: "scaleSel", before: this.page.objects.map(cloneObj), box, ax: box.x, ay: box.y };
            return;
          }
          if (d.x >= box.x && d.y >= box.y && d.x <= box.x + box.w && d.y <= box.y + box.h) {
            this.action = { kind: "moveSel", before: this.page.objects.map(cloneObj), lx: d.x, ly: d.y };
            return;
          }
        }
        this.selected.clear();
        this.ev.changed();
      }
      // Tape hides and reveals on tap with any notes tool.
      const tape = [...this.page.objects].reverse().find((o) => o.type === "tape" && d.x >= o.x && d.y >= o.y && d.x <= o.x + o.w && d.y <= o.y + o.h);
      if (tape && tape.type === "tape" && tool !== "eraser" && tool !== "lasso") {
        this.objectsOp(() => {
          tape.hidden = !tape.hidden;
        });
        return;
      }
      switch (tool) {
        case "pen":
        case "pencil":
        case "highlighter":
        case "fountain": {
          const obj: InkObj = {
            id: id(),
            type: "ink",
            pen: tool,
            pts: [{ x: d.x, y: d.y, p: this.pressure(e) }],
            color: this.ts.color,
            width: this.ts.penWidth[tool],
            opacity: tool === "highlighter" ? this.ts.highlighterOpacity : 1,
          };
          this.action = { kind: "ink", obj, holdTimer: 0, quick: false };
          this.armQuickShape();
          break;
        }
        case "eraser":
          this.action = { kind: "erase", before: this.page.objects.map(cloneObj), changed: false, last: null };
          this.eraseAt(d.x, d.y);
          break;
        case "lasso":
          this.action = { kind: "lasso", poly: [d] };
          break;
        case "lift":
          if (this.pdfEditable) this.action = { kind: "lift", poly: [d], x0: d.x, y0: d.y };
          break;
        case "shape": {
          const obj: ShapeObj = { id: id(), type: "shape", shape: this.ts.shapeKind, x: d.x, y: d.y, w: 0, h: 0, color: this.ts.color, width: this.ts.penWidth.pen, fill: this.ts.shapeFill ? this.ts.color + "55" : null };
          this.action = { kind: "shape", obj };
          break;
        }
        case "tape":
          this.action = { kind: "tape", obj: { id: id(), type: "tape", x: d.x, y: d.y - 14, w: 0, h: 28, color: this.ts.tapeColor, hidden: true } };
          break;
        case "text":
        case "sticky": {
          const line = tool === "text" ? this.pdfLineAt(d.x, d.y) : undefined;
          if (line) this.action = { kind: "pdfLine", line, before: this.pdfSnap(), sx: d.x, sy: d.y, dx0: line.dx, dy0: line.dy, moved: false };
          else this.placeText(tool, d.x, d.y);
          break;
        }
        case "laser":
          this.laser.push({ x: d.x, y: d.y, t: now });
          this.action = { kind: "laser" };
          this.request();
          break;
        default:
          break;
      }
      return;
    }
    // ---- paint mode
    const layer = this.activeLayer;
    const tool = this.ts.paintTool;
    if (tool === "transform") {
      this.startTransformDrag(d);
      return;
    }
    if (tool === "select") {
      this.action = { kind: "select", poly: [d], x0: d.x, y0: d.y };
      return;
    }
    if (tool === "eyedropper") {
      this.pickColor(d.x, d.y);
      return;
    }
    if (!layer || layer.locked || !layer.visible) {
      this.ev.toast(layer?.locked ? "Layer is locked" : "Layer is hidden");
      return;
    }
    if (this.floating) this.commitFloating();
    if (tool === "fill") {
      this.fillAt(d.x, d.y);
      return;
    }
    const slot = this.slot();
    const c = this.activeCanvas();
    if (!c || !this.engine) return;
    this.beginRaster();
    this.engine.begin(
      {
        brush: this.brushFor(slot),
        size: this.ts.size[slot],
        opacity: this.ts.opacity[slot],
        color: this.ts.color,
        mode: slot === "brush" ? "paint" : slot === "erase" ? "erase" : "smudge",
        pressureFromPen: e.pointerType === "pen",
        symmetry: this.ts.symmetry,
        center: [this.rw / 2, this.rh / 2],
        selectionMask: this.selection?.mask ?? null,
      },
      c,
    );
    const s = this.page.scale;
    // seed the live preview with the whole layer once; later frames update only dirty areas
    const live = this.liveCanvas();
    const lg = ctx2d(live);
    lg.clearRect(0, 0, live.width, live.height);
    lg.drawImage(c, 0, 0);
    this.liveDirty = null;
    this.trackLive(this.engine.add({ x: d.x * s, y: d.y * s, p: this.pressure(e), t: now }));
    this.action = { kind: "paint", slot, holdTimer: 0, lastMove: now, quick: false };
    this.armQuickShape();
    this.request();
  }

  private moveTool(e: PointerEvent, q: { x: number; y: number }): void {
    const a = this.action;
    const d = this.toDoc(q.x, q.y);
    switch (a.kind) {
      case "ink": {
        const last = a.obj.pts[a.obj.pts.length - 1];
        if (Math.hypot(d.x - last.x, d.y - last.y) < 0.6 / this.view.zoom) return;
        if (a.quick) return;
        // light streamline for handwriting
        const k = 0.55;
        a.obj.pts.push({ x: last.x + (d.x - last.x) * k + (d.x - last.x) * (1 - k) * 0.5, y: last.y + (d.y - last.y) * k + (d.y - last.y) * (1 - k) * 0.5, p: this.pressure(e) });
        this.armQuickShape();
        this.request();
        break;
      }
      case "paint": {
        if (a.quick || !this.engine) return;
        const s = this.page.scale;
        this.trackLive(this.engine.add({ x: d.x * s, y: d.y * s, p: this.pressure(e), t: performance.now() }));
        this.armQuickShape();
        this.request();
        break;
      }
      case "erase":
        this.eraseAt(d.x, d.y);
        break;
      case "pdfLine":
        if (!a.moved && Math.hypot(d.x - a.sx, d.y - a.sy) * this.view.zoom < 6) return;
        a.moved = true;
        a.line.dx = a.dx0 + d.x - a.sx;
        a.line.dy = a.dy0 + d.y - a.sy;
        this.pdfRev++;
        this.request();
        break;
      case "lift":
        a.poly = this.shapePoly(a.x0, a.y0, d.x, d.y, "rect");
        this.request();
        break;
      case "lasso":
      case "select":
        a.poly.push(d);
        if (a.kind === "select" && this.ts.selectMode !== "free") a.poly = this.shapePoly(a.x0, a.y0, d.x, d.y, this.ts.selectMode);
        this.request();
        break;
      case "moveSel": {
        const dx = d.x - a.lx,
          dy = d.y - a.ly;
        for (const o of this.page.objects) if (this.selected.has(o.id)) translateObj(o, dx, dy);
        a.lx = d.x;
        a.ly = d.y;
        this.notesDirty = true;
        this.request();
        break;
      }
      case "scaleSel": {
        const sx = Math.max(0.05, (d.x - a.ax) / Math.max(1, a.box.w));
        const sy = Math.max(0.05, (d.y - a.ay) / Math.max(1, a.box.h));
        const k = Math.min(sx, sy);
        const objs = a.before.map(cloneObj);
        for (const o of objs) if (this.selected.has(o.id)) scaleObj(o, a.ax, a.ay, k, k);
        this.page.objects = objs;
        this.notesDirty = true;
        this.request();
        break;
      }
      case "shape": {
        const o = a.obj;
        o.w = d.x - o.x;
        o.h = d.y - o.y;
        if (e.shiftKey && o.shape !== "line" && o.shape !== "arrow") {
          const m = Math.max(Math.abs(o.w), Math.abs(o.h));
          o.w = Math.sign(o.w || 1) * m;
          o.h = Math.sign(o.h || 1) * m;
        }
        this.request();
        break;
      }
      case "tape": {
        const o = a.obj as Extract<Obj, { type: "tape" }>;
        o.w = d.x - o.x;
        this.request();
        break;
      }
      case "transform":
        this.moveTransformDrag(d);
        break;
      case "laser":
        this.laser.push({ x: d.x, y: d.y, t: performance.now() });
        this.request();
        break;
      default:
        break;
    }
  }

  private endTool(_e: PointerEvent, q: { x: number; y: number }): void {
    const a = this.action;
    this.action = { kind: "none" };
    switch (a.kind) {
      case "ink": {
        clearTimeout(a.holdTimer);
        const obj = a.obj;
        const end = this.toDoc(q.x, q.y);
        const last = obj.pts[obj.pts.length - 1];
        if (!a.quick && last && Math.hypot(end.x - last.x, end.y - last.y) > 0.5) obj.pts.push({ x: end.x, y: end.y, p: last.p });
        this.objectsOp(() => this.page.objects.push(obj));
        break;
      }
      case "paint": {
        clearTimeout(a.holdTimer);
        if (!this.engine) return;
        const r = this.engine.end();
        const c = this.activeCanvas();
        if (c) this.engine.commit(ctx2d(c), !!this.activeLayer?.alphaLock && a.slot !== "erase");
        this.endRaster(r);
        break;
      }
      case "erase":
        if (a.changed) this.push({ kind: "objects", page: this.page.id, before: a.before, after: this.page.objects.map(cloneObj) });
        break;
      case "pdfLine":
        if (a.moved) this.pushPdf(a.before);
        else this.editPdfLine(a.line);
        break;
      case "lift":
        this.liftArea(a.poly);
        break;
      case "lasso": {
        this.selected = new Set(this.page.objects.filter((o) => lassoSelects(o, a.poly)).map((o) => o.id));
        if (!this.selected.size) {
          // a tap on an object selects it
          const d = this.toDoc(q.x, q.y);
          const hit = [...this.page.objects].reverse().find((o) => hitObj(o, d.x, d.y, 6 / this.view.zoom));
          if (hit) this.selected.add(hit.id);
        }
        this.ev.changed();
        break;
      }
      case "moveSel":
      case "scaleSel": {
        const moved = JSON.stringify(a.before) !== JSON.stringify(this.page.objects);
        if (moved) this.push({ kind: "objects", page: this.page.id, before: a.before, after: this.page.objects.map(cloneObj) });
        else {
          // tap inside selection on a text/sticky edits it
          const only = this.selected.size === 1 ? this.page.objects.find((o) => this.selected.has(o.id)) : undefined;
          if (only && (only.type === "text" || only.type === "sticky")) this.editText(only.id);
        }
        this.notesDirty = true;
        break;
      }
      case "shape": {
        const o = a.obj;
        if (Math.abs(o.w) < 3 && Math.abs(o.h) < 3) break;
        if (o.shape !== "line" && o.shape !== "arrow") {
          if (o.w < 0) {
            o.x += o.w;
            o.w = -o.w;
          }
          if (o.h < 0) {
            o.y += o.h;
            o.h = -o.h;
          }
        }
        this.objectsOp(() => this.page.objects.push(o));
        break;
      }
      case "tape": {
        const o = a.obj as Extract<Obj, { type: "tape" }>;
        if (o.w < 0) {
          o.x += o.w;
          o.w = -o.w;
        }
        if (o.w < 8) o.w = 140;
        this.objectsOp(() => this.page.objects.push(o));
        break;
      }
      case "select":
        this.finishSelection(a.poly);
        break;
      case "transform":
        this.ev.changed();
        break;
      default:
        break;
    }
    this.request();
  }

  // QuickShape: hold the pen still at the end of a line to snap it into a clean shape.
  private armQuickShape(): void {
    if (!this.ts.quickShape) return;
    const a = this.action;
    if (a.kind !== "ink" && a.kind !== "paint") return;
    clearTimeout(a.holdTimer);
    a.holdTimer = window.setTimeout(() => this.quickShape(), 550);
  }
  private quickShape(): void {
    const a = this.action;
    if (a.kind === "ink") {
      const shape = recognize(a.obj.pts);
      if (!shape) return;
      a.quick = true;
      const avg = a.obj.pts.reduce((s, p) => s + p.p, 0) / a.obj.pts.length;
      a.obj.pts = shapePoints(shape, avg);
      this.ev.toast(this.shapeName(shape));
      this.request();
    } else if (a.kind === "paint" && this.engine && a.slot !== "smudge") {
      const pts = this.engine.points();
      const shape = recognize(pts);
      if (!shape) return;
      a.quick = true;
      const avg = pts.reduce((s, p) => s + p.p, 0) / pts.length;
      this.trackLive(this.engine.replacePath(shapePoints(shape, avg).map((p, i) => ({ ...p, t: i * 4 }))));
      this.ev.toast(this.shapeName(shape));
      this.request();
    }
  }
  private shapeName(s: QuickShape): string {
    return s.kind === "line" ? "Line" : s.kind === "ellipse" ? (s.rx === s.ry ? "Circle" : "Ellipse") : s.kind === "rect" ? "Rectangle" : "Triangle";
  }

  private eraseAt(x1: number, y1: number): void {
    const a = this.action;
    if (a.kind !== "erase") return;
    const r = this.ts.eraserSize / 2;
    // erase along the whole path since the last event, not just at the event points
    const from = a.last ?? { x: x1, y: y1 };
    a.last = { x: x1, y: y1 };
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - from.x, y1 - from.y) / Math.max(1, r * 0.75)));
    for (let i = 1; i <= n; i++) this.eraseOne(from.x + ((x1 - from.x) * i) / n, from.y + ((y1 - from.y) * i) / n, r);
  }
  private eraseOne(x: number, y: number, r: number): void {
    const a = this.action;
    if (a.kind !== "erase") return;
    const out: Obj[] = [];
    let changed = false;
    for (const o of this.page.objects) {
      if (!hitObj(o, x, y, r)) {
        out.push(o);
        continue;
      }
      changed = true;
      if (this.ts.eraserMode === "partial" && o.type === "ink") {
        for (const piece of splitInk(o.pts, x, y, r + o.width / 2)) out.push({ ...o, id: id(), pts: piece });
      }
    }
    if (changed) {
      this.page.objects = out;
      a.changed = true;
      this.notesDirty = true;
      this.request();
    }
  }

  selectionBox(): Box | null {
    return unionBox(this.page.objects.filter((o) => this.selected.has(o.id)).map(objBounds));
  }

  private placeText(kind: "text" | "sticky", x: number, y: number): void {
    const hit = [...this.page.objects].reverse().find((o) => (o.type === "text" || o.type === "sticky") && hitObj(o, x, y, 4));
    if (hit) {
      this.editText(hit.id);
      return;
    }
    const obj: Obj =
      kind === "text"
        ? { id: id(), type: "text", x, y, w: Math.min(360, this.page.w - x - 10), text: "", size: this.ts.textSize, color: this.ts.color }
        : { id: id(), type: "sticky", x: x - 80, y: y - 80, w: 180, h: 180, text: "", color: this.ts.stickyColor };
    this.page.objects.push(obj);
    this.editText(obj.id, true);
  }
  // ---------------------------------------------------------------- imported PDF editing
  pdfRev = 0;
  get pdfEditable(): boolean {
    return !!this.doc.pdfEditable && !this.ts.readOnly;
  }
  private pdfLineAt(x: number, y: number): PdfLine | undefined {
    if (!this.pdfEditable) return undefined;
    return (this.page.pdfLines ?? []).find((l) => hitLine(l, x, y));
  }
  private pdfSnap(): PdfSnap {
    return { lines: (this.page.pdfLines ?? []).map((l) => ({ ...l })), covers: (this.page.covers ?? []).map((c) => ({ ...c })), objects: this.page.objects.map(cloneObj) };
  }
  private restorePdf(s: PdfSnap): void {
    this.page.pdfLines = s.lines.map((l) => ({ ...l }));
    this.page.covers = s.covers.map((c) => ({ ...c }));
    this.page.objects = s.objects.map(cloneObj);
    this.selected.clear();
    this.pdfRev++;
    this.notesDirty = true;
  }
  private pushPdf(before: PdfSnap): void {
    this.pdfRev++;
    this.push({ kind: "pdf", page: this.page.id, before, after: this.pdfSnap() });
  }
  private pdfBefore: PdfSnap | null = null;
  private editPdfLine(l: PdfLine): void {
    this.pdfBefore = this.pdfSnap();
    this.editingSkip = new Set([l.id]);
    this.pdfRev++;
    const tl = this.toScreen(l.x + l.dx, l.y + l.dy);
    const z = this.view.zoom;
    this.ev.editText({ id: l.id, kind: "text", left: tl.x, top: tl.y, width: Math.max(l.w, 60) * z, height: l.h * z, fontSize: l.size * z, color: l.color, font: l.font });
    this.request();
  }
  /** Finds text in page backgrounds with OCR. Lines already edited are kept; unedited ones are
   * replaced by what OCR reads. Returns how many lines were found. */
  async ocrPages(all: boolean, onProgress: (msg: string) => void): Promise<number> {
    const { ocrImage } = await import("../lib/ocr");
    const targets = (all ? this.doc.pages : [this.page]).filter((p) => p.bg);
    let found = 0;
    for (const [i, p] of targets.entries()) {
      const label = targets.length > 1 ? ` page ${i + 1}/${targets.length}` : "";
      onProgress(`Reading text${label}…`);
      const lines = await ocrImage(p.bg!, p.w, (f) => onProgress(`Reading text${label}… ${Math.round(f * 100)}%`));
      found += lines.length;
      const apply = () => (p.pdfLines = [...(p.pdfLines ?? []).filter((l) => l.text !== l.orig || l.dx || l.dy), ...lines]);
      if (p === this.page) {
        const before = this.pdfSnap();
        apply();
        this.pushPdf(before);
      } else apply();
    }
    this.doc.pdfEditable = true;
    this.markDocDirty();
    this.request();
    return found;
  }

  /** Lifts a rectangle of the imported page off into a movable image (any element: picture,
   * table, diagram), covering where it was. */
  private liftArea(poly: { x: number; y: number }[]): void {
    const p = this.page;
    const img = p.bg ? getImage(p.bg) : null;
    if (!img || poly.length < 4) return;
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    const w = Math.min(p.w, Math.max(...xs)) - x, h = Math.min(p.h, Math.max(...ys)) - y;
    if (w < 4 || h < 4) return;
    // crop from the page as currently shown (background + earlier PDF edits)
    const k = Math.min(3, img.width / p.w);
    const crop = makeCanvas(w * k, h * k);
    const cg = ctx2d(crop, true);
    cg.setTransform(k, 0, 0, k, -x * k, -y * k);
    cg.drawImage(img, 0, 0, p.w, p.h);
    // only text lines fully inside travel with the picture; others stay editable lines (not baked in)
    const inside = (l: PdfLine) => lineCorners(l).every((q) => q.x >= x - 2 && q.y >= y - 2 && q.x <= x + w + 2 && q.y <= y + h + 2);
    drawPdfEdits(cg, p, new Set((p.pdfLines ?? []).filter((l) => !inside(l)).map((l) => l.id)));
    // cover colour: median of the crop's border
    const d = cg.getImageData(0, 0, crop.width, crop.height).data;
    const ring: number[][] = [];
    for (let i = 0; i < crop.width; i++) for (const j of [0, crop.height - 1]) ring.push(Array.from(d.subarray((j * crop.width + i) * 4, (j * crop.width + i) * 4 + 3)));
    const med = (c: number) => ring.map((r) => r[c]).sort((a, b) => a - b)[ring.length >> 1] ?? 255;
    const before = this.pdfSnap();
    const obj: Obj = { id: id(), type: "image", x, y, w, h, src: crop.toDataURL("image/png") };
    p.covers = [...(p.covers ?? []), { x, y, w, h, color: rgbToHex(med(0), med(1), med(2)) }];
    // text lines inside the lifted area now travel with the picture
    p.pdfLines = (p.pdfLines ?? []).filter((l) => !inside(l));
    p.objects.push(obj);
    this.notesDirty = true;
    this.pushPdf(before);
    this.selected = new Set([obj.id]);
    this.ev.toast("Lifted — drag it with the lasso to move");
    this.ev.changed();
  }

  editText(objId: string, isNew = false): void {
    const o = this.page.objects.find((x) => x.id === objId);
    if (!o || (o.type !== "text" && o.type !== "sticky")) return;
    this.textBefore = this.page.objects.map(cloneObj).filter((x) => !(isNew && x.id === objId));
    this.editingSkip = new Set([objId]);
    this.notesDirty = true;
    const tl = this.toScreen(o.x, o.y);
    const z = this.view.zoom;
    this.ev.editText({
      id: objId,
      kind: o.type,
      left: tl.x,
      top: tl.y,
      width: o.w * z,
      height: (o.type === "sticky" ? o.h : Math.max(o.size * 1.4, o.text.split("\n").length * o.size * 1.3 + 8)) * z,
      fontSize: (o.type === "text" ? o.size : 16) * z,
    });
    this.request();
  }
  private textBefore: Obj[] = [];
  finishText(objId: string, text: string): void {
    const line = this.page.pdfLines?.find((l) => l.id === objId);
    if (line && this.pdfBefore) {
      this.editingSkip = new Set();
      line.text = text.replace(/\n/g, " ");
      const before = this.pdfBefore;
      this.pdfBefore = null;
      if (JSON.stringify(before.lines) !== JSON.stringify(this.page.pdfLines)) this.pushPdf(before);
      else this.pdfRev++;
      this.ev.editText(null);
      this.request();
      return;
    }
    const o = this.page.objects.find((x) => x.id === objId);
    this.editingSkip = new Set();
    if (o && (o.type === "text" || o.type === "sticky")) {
      if (!text.trim() && o.type === "text") this.page.objects = this.page.objects.filter((x) => x.id !== objId);
      else o.text = text;
      const after = this.page.objects.map(cloneObj);
      if (JSON.stringify(after) !== JSON.stringify(this.textBefore)) this.push({ kind: "objects", page: this.page.id, before: this.textBefore, after });
    }
    this.notesDirty = true;
    this.ev.editText(null);
    this.request();
  }

  // Notes selection actions
  deleteSelected(): void {
    if (!this.selected.size) return;
    this.objectsOp(() => {
      this.page.objects = this.page.objects.filter((o) => !this.selected.has(o.id));
    });
    this.selected.clear();
    this.ev.changed();
  }
  duplicateSelected(): void {
    const copies: Obj[] = [];
    this.objectsOp(() => {
      for (const o of this.page.objects)
        if (this.selected.has(o.id)) {
          const c = cloneObj(o);
          c.id = id();
          translateObj(c, 20, 20);
          copies.push(c);
        }
      this.page.objects.push(...copies);
    });
    this.selected = new Set(copies.map((c) => c.id));
    this.ev.changed();
  }
  recolorSelected(color: string): void {
    this.objectsOp(() => {
      for (const o of this.page.objects)
        if (this.selected.has(o.id) && "color" in o && o.type !== "sticky" && o.type !== "tape") (o as { color: string }).color = color;
    });
  }
  bringSelectedToFront(): void {
    this.objectsOp(() => {
      const sel = this.page.objects.filter((o) => this.selected.has(o.id));
      this.page.objects = this.page.objects.filter((o) => !this.selected.has(o.id)).concat(sel);
    });
  }
  /** Bridge: flattens the selected notes into the active paint layer. */
  rasterizeSelected(): void {
    const layer = this.activeLayer;
    const c = this.activeCanvas();
    if (!layer || !c || !this.selected.size) return;
    const sel = this.page.objects.filter((o) => this.selected.has(o.id));
    this.rasterEdit((g) => {
      g.save();
      g.scale(this.page.scale, this.page.scale);
      for (const o of sel) drawObj(g, o);
      g.restore();
    });
    this.objectsOp(() => {
      this.page.objects = this.page.objects.filter((o) => !this.selected.has(o.id));
    });
    this.selected.clear();
    this.ev.toast("Moved to paint layer");
    this.ev.changed();
  }

  insertImageObject(src: string, w: number, h: number): void {
    const p = this.page;
    const k = Math.min(1, (p.w * 0.6) / w, (p.h * 0.6) / h);
    const center = this.toDoc(this.vw / 2, this.vh / 2);
    const o: Obj = { id: id(), type: "image", src, x: Math.max(0, center.x - (w * k) / 2), y: Math.max(0, center.y - (h * k) / 2), w: w * k, h: h * k };
    this.objectsOp(() => p.objects.push(o));
    this.selected = new Set([o.id]);
    this.ev.changed();
  }

  // ---------------------------------------------------------------- paint helpers
  pickColor(x: number, y: number): void {
    const c = this.flatten(this.page.w * Math.min(1, 1));
    const g = ctx2d(c, true);
    const s = c.width / this.page.w;
    const px = g.getImageData(Math.max(0, Math.min(c.width - 1, Math.floor(x * s))), Math.max(0, Math.min(c.height - 1, Math.floor(y * s))), 1, 1).data;
    this.ev.colorPicked(rgbToHex(px[0], px[1], px[2]));
  }

  private fillAt(x: number, y: number): void {
    const c = this.activeCanvas();
    if (!c) return;
    const s = this.page.scale;
    const g = ctx2d(c, true);
    const target = g.getImageData(0, 0, c.width, c.height);
    // Sample over the plain paper colour (not the ruled template, which would act as walls) so
    // ink is compared with what is visible rather than with transparency.
    const t = makeCanvas(c.width, c.height);
    const tg = ctx2d(t, true);
    tg.fillStyle = this.page.paperColor;
    tg.fillRect(0, 0, c.width, c.height);
    if (this.ts.fillSampleAll) {
      compositeLayers(tg, this.page.layers, this.layerSource, c.width, c.height);
      tg.save();
      tg.scale(s, s);
      for (const o of this.page.objects) drawObj(tg, o);
      tg.restore();
    } else tg.drawImage(c, 0, 0);
    const sample = tg.getImageData(0, 0, c.width, c.height);
    const mask = this.selection ? ctx2d(this.selection.mask, true).getImageData(0, 0, c.width, c.height) : null;
    this.beginRaster();
    const r = floodFill(sample, target, x * s, y * s, this.ts.color, this.ts.fillThreshold, mask);
    if (!r) return;
    g.putImageData(target, 0, 0);
    this.endRaster(r);
  }

  // ---------------------------------------------------------------- raster selection
  private shapePoly(x0: number, y0: number, x1: number, y1: number, mode: "rect" | "ellipse"): { x: number; y: number }[] {
    if (mode === "rect") return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      rx = Math.abs(x1 - x0) / 2,
      ry = Math.abs(y1 - y0) / 2;
    return Array.from({ length: 64 }, (_, i) => ({ x: cx + Math.cos((i / 64) * Math.PI * 2) * rx, y: cy + Math.sin((i / 64) * Math.PI * 2) * ry }));
  }
  private finishSelection(poly: { x: number; y: number }[]): void {
    if (poly.length < 3) {
      this.selection = null;
      this.ev.changed();
      return;
    }
    const s = this.page.scale;
    const pts = poly.map((p) => ({ x: p.x * s, y: p.y * s }));
    const mask = makeCanvas(this.rw, this.rh);
    const g = ctx2d(mask, true);
    g.fillStyle = "#fff";
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fill();
    if (this.ts.feather > 0) {
      const img = blurData(g.getImageData(0, 0, mask.width, mask.height), this.ts.feather * s);
      g.putImageData(img, 0, 0);
    }
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
    this.selection = { mask, outline: [pts], box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    this.ev.changed();
    this.request();
  }
  selectAll(): void {
    this.finishSelection([{ x: 0, y: 0 }, { x: this.page.w, y: 0 }, { x: this.page.w, y: this.page.h }, { x: 0, y: this.page.h }]);
  }
  clearSelection(): void {
    this.selection = null;
    this.ev.changed();
    this.request();
  }
  invertSelection(): void {
    if (!this.selection) return;
    const m = makeCanvas(this.rw, this.rh);
    const g = ctx2d(m);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, m.width, m.height);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(this.selection.mask, 0, 0);
    this.selection = { mask: m, outline: [...this.selection.outline, [{ x: 0, y: 0 }, { x: m.width, y: 0 }, { x: m.width, y: m.height }, { x: 0, y: m.height }]], box: { x: 0, y: 0, w: m.width, h: m.height } };
    this.ev.changed();
    this.request();
  }
  clearSelected(): void {
    const sel = this.selection;
    this.rasterEdit((g, c) => {
      g.save();
      g.globalCompositeOperation = "destination-out";
      if (sel) g.drawImage(sel.mask, 0, 0);
      else g.fillRect(0, 0, c.width, c.height);
      g.restore();
    });
  }
  fillSelected(): void {
    const sel = this.selection;
    this.rasterEdit((g, c) => {
      const t = makeCanvas(c.width, c.height);
      const tg = ctx2d(t);
      tg.fillStyle = this.ts.color;
      tg.fillRect(0, 0, c.width, c.height);
      if (sel) {
        tg.globalCompositeOperation = "destination-in";
        tg.drawImage(sel.mask, 0, 0);
      }
      g.save();
      if (this.activeLayer?.alphaLock) g.globalCompositeOperation = "source-atop";
      g.drawImage(t, 0, 0);
      g.restore();
    });
  }
  /** Copies the selection (or the layer) to a new layer above. `cut` removes it from the source. */
  copyToNewLayer(cut: boolean): void {
    const src = this.activeCanvas();
    const active = this.activeLayer;
    if (!src || !active) return;
    const sel = this.selection;
    this.layerOp(() => {
      const c = makeCanvas(src.width, src.height);
      const g = ctx2d(c);
      g.drawImage(src, 0, 0);
      if (sel) {
        g.globalCompositeOperation = "destination-in";
        g.drawImage(sel.mask, 0, 0);
      }
      if (cut) {
        const sg = ctx2d(src);
        sg.save();
        sg.globalCompositeOperation = "destination-out";
        if (sel) sg.drawImage(sel.mask, 0, 0);
        else sg.fillRect(0, 0, src.width, src.height);
        sg.restore();
        this.dirtyLayers.add(active.id);
      }
      const l = newLayer(cut ? "Cut" : "Copy");
      const idx = this.page.layers.findIndex((x) => x.id === active.id);
      this.page.layers.splice(idx + 1, 0, l);
      this.layers.set(l.id, c);
      this.page.activeLayer = l.id;
      this.dirtyLayers.add(l.id);
    });
  }

  // ---------------------------------------------------------------- transform
  beginTransform(): boolean {
    if (this.floating) return true;
    const c = this.activeCanvas();
    const layer = this.activeLayer;
    if (!c || !layer || layer.locked) return false;
    const before = makeCanvas(c.width, c.height);
    ctx2d(before).drawImage(c, 0, 0);
    const lifted = makeCanvas(c.width, c.height);
    const lg = ctx2d(lifted);
    lg.drawImage(c, 0, 0);
    const base = makeCanvas(c.width, c.height);
    const bg = ctx2d(base);
    if (this.selection) {
      lg.globalCompositeOperation = "destination-in";
      lg.drawImage(this.selection.mask, 0, 0);
      bg.drawImage(c, 0, 0);
      bg.globalCompositeOperation = "destination-out";
      bg.drawImage(this.selection.mask, 0, 0);
    }
    const box = this.selection ? { ...this.selection.box } : this.contentBox(c) ?? { x: 0, y: 0, w: c.width, h: c.height };
    this.floating = { canvas: lifted, base, before, box, m: new DOMMatrix(), layer: layer.id };
    this.selection = null;
    this.ev.changed();
    this.request();
    return true;
  }
  private contentBox(c: HTMLCanvasElement): Rect | null {
    const step = Math.max(1, Math.floor(Math.max(c.width, c.height) / 512));
    const w = Math.ceil(c.width / step),
      h = Math.ceil(c.height / step);
    const t = makeCanvas(w, h);
    const g = ctx2d(t, true);
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    return { x: x0 * step - step, y: y0 * step - step, w: (x1 - x0 + 3) * step, h: (y1 - y0 + 3) * step };
  }
  private startTransformDrag(d: { x: number; y: number }): void {
    if (!this.floating && !this.beginTransform()) return;
    const f = this.floating!;
    const s = this.page.scale;
    const rx = d.x * s,
      ry = d.y * s;
    const ctr = f.m.transformPoint(new DOMPoint(f.box.x + f.box.w / 2, f.box.y + f.box.h / 2));
    const corners = [
      [f.box.x, f.box.y],
      [f.box.x + f.box.w, f.box.y],
      [f.box.x + f.box.w, f.box.y + f.box.h],
      [f.box.x, f.box.y + f.box.h],
    ].map(([x, y]) => f.m.transformPoint(new DOMPoint(x, y)));
    const near = corners.some((c) => Math.hypot(c.x - rx, c.y - ry) < (22 * s) / this.view.zoom);
    this.action = { kind: "transform", lx: rx, ly: ry, corner: near, start: DOMMatrix.fromMatrix(f.m), cx: ctr.x, cy: ctr.y, d0: Math.hypot(rx - ctr.x, ry - ctr.y) || 1 };
  }
  private moveTransformDrag(d: { x: number; y: number }): void {
    const a = this.action;
    const f = this.floating;
    if (a.kind !== "transform" || !f) return;
    const s = this.page.scale;
    const rx = d.x * s,
      ry = d.y * s;
    if (a.corner) {
      // corner drag: uniform scale + rotate about the centre
      const k = Math.hypot(rx - a.cx, ry - a.cy) / a.d0;
      const ang = Math.atan2(ry - a.cy, rx - a.cx) - Math.atan2(a.ly - a.cy, a.lx - a.cx);
      let deg = (ang * 180) / Math.PI;
      const snap = Math.round(deg / 45) * 45;
      if (Math.abs(deg - snap) < 3) deg = snap;
      f.m = new DOMMatrix().translate(a.cx, a.cy).rotate(deg).scale(k).translate(-a.cx, -a.cy).multiply(a.start);
    } else {
      f.m = new DOMMatrix().translate(rx - a.lx, ry - a.ly).multiply(a.start);
    }
    this.request();
  }
  transformOp(kind: "flipH" | "flipV" | "rot45" | "fit" | "reset"): void {
    if (!this.floating && !this.beginTransform()) return;
    const f = this.floating!;
    const c = f.m.transformPoint(new DOMPoint(f.box.x + f.box.w / 2, f.box.y + f.box.h / 2));
    const about = (m: DOMMatrix) => new DOMMatrix().translate(c.x, c.y).multiply(m).translate(-c.x, -c.y).multiply(f.m);
    if (kind === "flipH") f.m = about(new DOMMatrix().scale(-1, 1));
    else if (kind === "flipV") f.m = about(new DOMMatrix().scale(1, -1));
    else if (kind === "rot45") f.m = about(new DOMMatrix().rotate(45));
    else if (kind === "reset") f.m = new DOMMatrix();
    else {
      const k = Math.min(this.rw / f.box.w, this.rh / f.box.h);
      f.m = new DOMMatrix().translate(this.rw / 2, this.rh / 2).scale(k).translate(-(f.box.x + f.box.w / 2), -(f.box.y + f.box.h / 2));
    }
    this.request();
  }
  commitFloating(): void {
    const f = this.floating;
    if (!f) return;
    const c = this.layers.get(f.layer);
    this.floating = null;
    if (!c) return;
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(f.base, 0, 0);
    g.imageSmoothingQuality = "high";
    g.setTransform(f.m);
    g.drawImage(f.canvas, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const before = ctx2d(f.before, true).getImageData(0, 0, c.width, c.height);
    const after = g.getImageData(0, 0, c.width, c.height);
    this.dirtyLayers.add(f.layer);
    this.push({ kind: "raster", page: this.page.id, layer: f.layer, x: 0, y: 0, before, after });
  }
  cancelFloating(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    const c = this.layers.get(f.layer);
    if (c) {
      const g = ctx2d(c);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(f.before, 0, 0);
    }
    this.ev.changed();
    this.request();
  }

  /** Places an image as a new paint layer and starts transforming it (Insert a photo). */
  async insertImageLayer(src: string, name = "Photo"): Promise<void> {
    const img = await loadImage(src);
    this.layerOp(() => {
      const c = makeCanvas(this.rw, this.rh);
      const k = Math.min(1, (this.rw * 0.8) / img.width, (this.rh * 0.8) / img.height);
      const w = img.width * k,
        h = img.height * k;
      ctx2d(c).drawImage(img, (this.rw - w) / 2, (this.rh - h) / 2, w, h);
      const l = newLayer(name);
      const idx = this.page.layers.findIndex((x) => x.id === this.page.activeLayer);
      this.page.layers.splice(idx + 1, 0, l);
      this.layers.set(l.id, c);
      this.page.activeLayer = l.id;
      this.dirtyLayers.add(l.id);
    });
    this.beginTransform();
  }

  // ---------------------------------------------------------------- layers
  addLayer(): void {
    this.layerOp(() => {
      const l = newLayer(`Layer ${this.page.layers.length + 1}`);
      const idx = this.page.layers.findIndex((x) => x.id === this.page.activeLayer);
      this.page.layers.splice(idx + 1, 0, l);
      this.layers.set(l.id, makeCanvas(this.rw, this.rh));
      this.page.activeLayer = l.id;
    });
  }
  deleteLayer(lid: string): void {
    if (this.page.layers.length <= 1) {
      this.ev.toast("A page keeps at least one paint layer");
      return;
    }
    this.layerOp(() => {
      const idx = this.page.layers.findIndex((x) => x.id === lid);
      this.page.layers.splice(idx, 1);
      if (this.page.activeLayer === lid) this.page.activeLayer = this.page.layers[Math.max(0, idx - 1)].id;
    });
    void deleteBlob(layerKey(this.page.id, lid)).catch(() => undefined);
  }
  duplicateLayer(lid: string): void {
    const src = this.layers.get(lid);
    const l0 = this.page.layers.find((x) => x.id === lid);
    if (!src || !l0) return;
    this.layerOp(() => {
      const c = makeCanvas(src.width, src.height);
      ctx2d(c).drawImage(src, 0, 0);
      const l = { ...l0, id: id(), name: l0.name + " copy" };
      const idx = this.page.layers.findIndex((x) => x.id === lid);
      this.page.layers.splice(idx + 1, 0, l);
      this.layers.set(l.id, c);
      this.page.activeLayer = l.id;
      this.dirtyLayers.add(l.id);
    });
  }
  mergeDown(lid: string): void {
    const idx = this.page.layers.findIndex((x) => x.id === lid);
    if (idx <= 0) return;
    const top = this.page.layers[idx],
      below = this.page.layers[idx - 1];
    this.layerOp(() => {
      const bc = this.layers.get(below.id)!;
      const merged = makeCanvas(bc.width, bc.height);
      const g = ctx2d(merged);
      g.globalAlpha = below.opacity;
      g.drawImage(bc, 0, 0);
      let tc = this.layers.get(top.id)!;
      if (top.clip) {
        const t = makeCanvas(tc.width, tc.height);
        const tg = ctx2d(t);
        tg.drawImage(tc, 0, 0);
        tg.globalCompositeOperation = "destination-in";
        tg.drawImage(bc, 0, 0);
        tc = t;
      }
      if (top.visible) {
        g.globalAlpha = top.opacity;
        g.globalCompositeOperation = top.blend;
        g.drawImage(tc, 0, 0);
      }
      this.layers.set(below.id, merged);
      below.opacity = 1;
      this.page.layers.splice(idx, 1);
      this.page.activeLayer = below.id;
      this.dirtyLayers.add(below.id);
    });
  }
  moveLayer(lid: string, dir: -1 | 1): void {
    const idx = this.page.layers.findIndex((x) => x.id === lid);
    const j = idx + dir;
    if (j < 0 || j >= this.page.layers.length) return;
    this.layerOp(() => {
      const ls = this.page.layers;
      [ls[idx], ls[j]] = [ls[j], ls[idx]];
    });
  }
  setLayer(lid: string, patch: Partial<Layer>, undoable = true): void {
    const l = this.page.layers.find((x) => x.id === lid);
    if (!l) return;
    if (undoable) this.layerOp(() => Object.assign(l, patch));
    else {
      Object.assign(l, patch);
      this.markDocDirty();
      this.request();
    }
  }
  selectLayer(lid: string): void {
    this.commitFloating();
    this.page.activeLayer = lid;
    this.markDocDirty();
    this.request();
  }
  layerThumb(lid: string, w = 64): string {
    const c = this.layers.get(lid);
    if (!c) return "";
    const t = makeCanvas(w, (w * c.height) / c.width);
    ctx2d(t).drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL();
  }
  flipCanvas(axis: "h" | "v"): void {
    this.layerOp(() => {
      for (const [k, c] of this.layers) {
        const t = makeCanvas(c.width, c.height);
        const g = ctx2d(t);
        g.translate(axis === "h" ? c.width : 0, axis === "v" ? c.height : 0);
        g.scale(axis === "h" ? -1 : 1, axis === "v" ? -1 : 1);
        g.drawImage(c, 0, 0);
        this.layers.set(k, t);
        this.dirtyLayers.add(k);
      }
    });
  }

  /** Applies an adjustment to the active layer (masked by the selection). */
  applyAdjustment(fn: (img: ImageData) => ImageData): void {
    const sel = this.selection;
    this.adjustPreview = null;
    this.rasterEdit((g, c) => {
      const box = sel ? clampRect(sel.box, c.width, c.height) : { x: 0, y: 0, w: c.width, h: c.height };
      if (!box) return null;
      const src = g.getImageData(box.x, box.y, box.w, box.h);
      const out = fn(src);
      if (sel) {
        const t = makeCanvas(box.w, box.h);
        const tg = ctx2d(t);
        tg.putImageData(out, 0, 0);
        tg.globalCompositeOperation = "destination-in";
        tg.drawImage(sel.mask, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        g.save();
        g.globalCompositeOperation = "destination-out";
        g.drawImage(sel.mask, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
        g.restore();
        g.drawImage(t, box.x, box.y);
      } else g.putImageData(out, box.x, box.y);
      return box;
    });
  }
  /** Shows an adjustment live (on a downscaled copy when the layer is large). */
  previewAdjustment(fn: ((img: ImageData) => ImageData) | null): void {
    if (!fn) {
      this.adjustPreview = null;
      this.request();
      return;
    }
    const c = this.activeCanvas();
    if (!c) return;
    const k = Math.min(1, 1100 / Math.max(c.width, c.height));
    const w = Math.round(c.width * k),
      h = Math.round(c.height * k);
    const small = makeCanvas(w, h);
    const sg = ctx2d(small, true);
    sg.drawImage(c, 0, 0, w, h);
    const out = fn(sg.getImageData(0, 0, w, h));
    sg.putImageData(out, 0, 0);
    const full = this.adjustPreview && this.adjustPreview.width === c.width ? this.adjustPreview : makeCanvas(c.width, c.height);
    const fg = ctx2d(full);
    fg.clearRect(0, 0, full.width, full.height);
    fg.imageSmoothingQuality = "high";
    fg.drawImage(small, 0, 0, c.width, c.height);
    if (this.selection) {
      fg.globalCompositeOperation = "destination-in";
      fg.drawImage(this.selection.mask, 0, 0);
      fg.globalCompositeOperation = "destination-over";
      const t = makeCanvas(c.width, c.height);
      const tg = ctx2d(t);
      tg.drawImage(c, 0, 0);
      tg.globalCompositeOperation = "destination-out";
      tg.drawImage(this.selection.mask, 0, 0);
      fg.drawImage(t, 0, 0);
      fg.globalCompositeOperation = "source-over";
    }
    this.adjustPreview = full;
    this.request();
  }

  // ---------------------------------------------------------------- pages
  async addPage(after = this.pageIndex): Promise<void> {
    await this.flush();
    this.doc.pages.splice(after + 1, 0, siblingPage(this.page));
    this.markDocDirty();
    await this.loadPage(after + 1);
  }
  async duplicatePage(): Promise<void> {
    await this.flush();
    const p = this.page;
    const copy: Page = JSON.parse(JSON.stringify(p));
    copy.id = id();
    copy.objects.forEach((o) => (o.id = id()));
    for (const l of copy.layers) {
      const c = this.layers.get(l.id);
      if (c) {
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
        if (blob) await putBlob(layerKey(copy.id, l.id), blob);
      }
    }
    this.doc.pages.splice(this.pageIndex + 1, 0, copy);
    this.markDocDirty();
    await this.loadPage(this.pageIndex + 1);
  }
  async deletePage(): Promise<void> {
    if (this.doc.pages.length <= 1) {
      this.ev.toast("A document keeps at least one page");
      return;
    }
    const p = this.page;
    this.dirtyLayers.clear();
    this.doc.pages.splice(this.pageIndex, 1);
    for (const l of p.layers) void deleteBlob(layerKey(p.id, l.id)).catch(() => undefined);
    this.hist.delete(p.id);
    this.docDirty = true;
    await this.loadPage(Math.min(this.pageIndex, this.doc.pages.length - 1));
  }
  async movePage(dir: -1 | 1): Promise<void> {
    const i = this.pageIndex,
      j = i + dir;
    if (j < 0 || j >= this.doc.pages.length) return;
    const ps = this.doc.pages;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    this.pageIndex = j;
    this.markDocDirty();
  }
  async insertPages(pages: Page[]): Promise<void> {
    await this.flush();
    this.doc.pages.splice(this.pageIndex + 1, 0, ...pages);
    this.markDocDirty();
    await this.loadPage(this.pageIndex + 1);
  }
  clearPage(): void {
    this.objectsOp(() => (this.page.objects = []));
    this.layerOp(() => {
      for (const l of this.page.layers) {
        this.layers.set(l.id, makeCanvas(this.rw, this.rh));
        this.dirtyLayers.add(l.id);
      }
    });
  }

  /** Raster sources for any page (used by PDF export): the current page from memory, others from storage. */
  async sourcesFor(page: Page): Promise<(l: Layer) => HTMLCanvasElement | null> {
    if (page.id === this.page.id) return this.layerSource;
    const map = new Map<string, HTMLCanvasElement>();
    for (const l of page.layers) {
      const blob = await getBlob(layerKey(page.id, l.id)).catch(() => undefined);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      try {
        const img = await loadImage(url);
        const c = makeCanvas(img.width, img.height);
        ctx2d(c).drawImage(img, 0, 0);
        map.set(l.id, c);
      } catch {
        /* skip */
      }
      URL.revokeObjectURL(url);
    }
    return (l) => map.get(l.id) ?? null;
  }

  // ---------------------------------------------------------------- animation assist
  play(on: boolean): void {
    clearInterval(this.playTimer);
    this.playing = on;
    if (on) {
      this.playTimer = window.setInterval(() => {
        const ls = this.page.layers;
        const i = ls.findIndex((l) => l.id === this.page.activeLayer);
        this.page.activeLayer = ls[(i + 1) % ls.length].id;
        this.request();
        this.ev.changed();
      }, 1000 / this.fps);
    }
    this.ev.changed();
  }
}

export type { Pt };
