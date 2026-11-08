// DrawNote document model. A document is either a paged notebook (Goodnotes-style) or a single
// painting canvas (ProCraft-style). Every page carries BOTH systems: raster paint layers (pixels
// stored separately, see storage.ts) under a vector notes layer of ink, shapes, text and media.

export type Paper =
  | "blank"
  | "ruled"
  | "narrow"
  | "grid"
  | "dotted"
  | "isometric"
  | "cornell"
  | "todo"
  | "music"
  | "planner";

export const PAPERS: { id: Paper; name: string }[] = [
  { id: "blank", name: "Blank" },
  { id: "ruled", name: "Ruled" },
  { id: "narrow", name: "Narrow ruled" },
  { id: "grid", name: "Grid" },
  { id: "dotted", name: "Dotted" },
  { id: "isometric", name: "Isometric" },
  { id: "cornell", name: "Cornell" },
  { id: "todo", name: "To-do" },
  { id: "music", name: "Music staff" },
  { id: "planner", name: "Weekly planner" },
];

export type DocKind = "notebook" | "canvas";

export interface Pt {
  x: number;
  y: number;
  p: number; // pressure 0..1
}

export type PenKind = "pen" | "pencil" | "highlighter" | "fountain";

export interface InkObj {
  id: string;
  type: "ink";
  pen: PenKind;
  pts: Pt[];
  color: string;
  width: number;
  opacity: number;
}
export type ShapeKind = "rect" | "ellipse" | "line" | "arrow" | "triangle";
export interface ShapeObj {
  id: string;
  type: "shape";
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  fill: string | null;
}
export interface TextObj {
  id: string;
  type: "text";
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  color: string;
}
export interface ImageObj {
  id: string;
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}
export interface StickyObj {
  id: string;
  type: "sticky";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}
export interface TapeObj {
  id: string;
  type: "tape";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  hidden: boolean;
}
export type Obj = InkObj | ShapeObj | TextObj | ImageObj | StickyObj | TapeObj;

export type Blend =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "lighter";

export const BLENDS: { id: Blend; name: string; short: string }[] = [
  { id: "source-over", name: "Normal", short: "N" },
  { id: "multiply", name: "Multiply", short: "M" },
  { id: "darken", name: "Darken", short: "D" },
  { id: "color-burn", name: "Color Burn", short: "CB" },
  { id: "screen", name: "Screen", short: "S" },
  { id: "lighten", name: "Lighten", short: "L" },
  { id: "color-dodge", name: "Color Dodge", short: "CD" },
  { id: "lighter", name: "Add", short: "A" },
  { id: "overlay", name: "Overlay", short: "O" },
  { id: "soft-light", name: "Soft Light", short: "SL" },
  { id: "hard-light", name: "Hard Light", short: "HL" },
  { id: "difference", name: "Difference", short: "Di" },
  { id: "exclusion", name: "Exclusion", short: "E" },
  { id: "hue", name: "Hue", short: "H" },
  { id: "saturation", name: "Saturation", short: "Sa" },
  { id: "color", name: "Color", short: "C" },
  { id: "luminosity", name: "Luminosity", short: "Lu" },
];

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: Blend;
  alphaLock: boolean;
  clip: boolean; // clipping mask onto the layer below
  locked: boolean;
}

/** A line of text detected in an imported PDF page (document units). It draws nothing while
 * unchanged — the page background shows the original — and is redrawn over a cover once edited
 * or moved. */
export interface PdfLine {
  id: string;
  x: number;
  y: number; // top of the original box
  w: number;
  h: number;
  base: number; // baseline
  size: number;
  font: string;
  color: string; // sampled ink colour
  bg: string; // sampled background colour, used to cover the original
  orig: string;
  text: string;
  dx: number;
  dy: number;
  angle?: number; // text direction in radians (y down); rotated / skewed text
}
export const pdfLineEdited = (l: PdfLine) => l.text !== l.orig || l.dx !== 0 || l.dy !== 0;

/** A patch of background colour over an imported page (where an element was lifted off it). */
export interface Cover {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface Page {
  id: string;
  w: number; // page size in document units
  h: number;
  scale: number; // raster pixels per document unit
  paper: Paper;
  paperColor: string;
  objects: Obj[];
  layers: Layer[]; // bottom → top
  activeLayer: string;
  notesVisible: boolean;
  bookmarked: boolean;
  bg?: string; // imported PDF / image page background (data URL)
  bgText?: string; // text extracted from an imported PDF page, for search
  pdfLines?: PdfLine[];
  covers?: Cover[];
}

export interface Doc {
  id: string;
  title: string;
  kind: DocKind;
  cover: string;
  folderId: string | null;
  favorite: boolean;
  trashed: boolean;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
  thumb?: string;
  timelapse?: string[]; // small JPEG frames (painting replay)
  pdfEditable?: boolean; // imported PDF text and elements can be edited / moved (switchable any time)
}

export interface Folder {
  id: string;
  name: string;
  color: string;
}

export const COVERS = ["#3d6fb6", "#c2453d", "#2f8a5f", "#d48a1f", "#6d4bb3", "#2b2f36", "#d9628f", "#1f8f9a"];
export const PAPER_COLORS = ["#ffffff", "#fbf7ec", "#f2f4f7", "#fdf3d6", "#22252b", "#13161b"];

export function id(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newLayer(name = "Layer 1"): Layer {
  return { id: id(), name, visible: true, opacity: 1, blend: "source-over", alphaLock: false, clip: false, locked: false };
}

export const PAGE_SIZES = {
  a4: { w: 794, h: 1123, name: "A4" },
  letter: { w: 816, h: 1056, name: "Letter" },
  phone: { w: 540, h: 960, name: "Phone" },
};
export type PageSize = keyof typeof PAGE_SIZES;

export function newPage(opts: { w: number; h: number; scale: number; paper: Paper; paperColor: string }): Page {
  const layer = newLayer("Paint 1");
  return {
    id: id(),
    w: opts.w,
    h: opts.h,
    scale: opts.scale,
    paper: opts.paper,
    paperColor: opts.paperColor,
    objects: [],
    layers: [layer],
    activeLayer: layer.id,
    notesVisible: true,
    bookmarked: false,
  };
}

export function newNotebook(title: string, opts: { paper: Paper; paperColor: string; size: PageSize; landscape: boolean; cover: string; folderId: string | null }): Doc {
  const s = PAGE_SIZES[opts.size];
  const w = opts.landscape ? s.h : s.w;
  const h = opts.landscape ? s.w : s.h;
  const now = Date.now();
  return {
    id: id(),
    title,
    kind: "notebook",
    cover: opts.cover,
    folderId: opts.folderId,
    favorite: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
    pages: [newPage({ w, h, scale: 1.5, paper: opts.paper, paperColor: opts.paperColor })],
  };
}

export const CANVAS_PRESETS = [
  { name: "Square", w: 2048, h: 2048 },
  { name: "Screen size", w: 0, h: 0 },
  { name: "A4 150dpi", w: 1240, h: 1754 },
  { name: "Wide 16:9", w: 2560, h: 1440 },
  { name: "Poster 2:3", w: 2000, h: 3000 },
  { name: "Comic page", w: 1988, h: 3056 },
];

export const MAX_CANVAS = 4096;

export function newCanvasDoc(title: string, w: number, h: number, background: string, folderId: string | null): Doc {
  const cw = Math.max(64, Math.min(MAX_CANVAS, Math.round(w)));
  const ch = Math.max(64, Math.min(MAX_CANVAS, Math.round(h)));
  const now = Date.now();
  const page = newPage({ w: cw, h: ch, scale: 1, paper: "blank", paperColor: background });
  return {
    id: id(),
    title,
    kind: "canvas",
    cover: "#2b2f36",
    folderId,
    favorite: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
    pages: [page],
  };
}

/** A blank page that matches an existing page's size and paper. */
export function siblingPage(p: Page): Page {
  return newPage({ w: p.w, h: p.h, scale: p.scale, paper: p.paper, paperColor: p.paperColor });
}

export function cloneObj<T extends Obj>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Everything searchable on a document: title, typed text, sticky notes and imported PDF text. */
export function docSearchText(d: Doc): string {
  const parts = [d.title];
  for (const p of d.pages) {
    if (p.bgText) parts.push(p.bgText);
    for (const l of p.pdfLines ?? []) if (l.text !== l.orig) parts.push(l.text);
    for (const o of p.objects) if (o.type === "text" || o.type === "sticky") parts.push(o.text);
  }
  return parts.join(" \n").toLowerCase();
}

export function isDark(hex: string): boolean {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}
