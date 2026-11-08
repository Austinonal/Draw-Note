// Brush definitions and the bundled library. The parameters follow ProCraft's brush model
// (spacing, streamline, hardness, flow, pressure → size/opacity, taper, shape, grain, colour
// dynamics) re-implemented for a Canvas 2D stamping engine.

export type TipShape = "round" | "square" | "flat" | "spray" | "splatter" | "leaf" | "star";
export type Grain = "none" | "paper" | "canvas" | "noise" | "charcoal" | "streaks";

export interface Brush {
  id: string;
  name: string;
  set: string;
  minSize: number; // stamp diameter at size slider 0 / 1 (pixels)
  maxSize: number;
  spacing: number; // distance between stamps as a fraction of diameter
  streamline: number; // 0..1 path smoothing
  hardness: number; // 0 soft .. 1 hard edge
  flow: number; // per-stamp opacity 0..1
  pressureSize: number; // 0..1 how much pressure scales size
  pressureOpacity: number; // 0..1 how much pressure scales flow
  taperStart: number; // taper length in diameters
  taperEnd: number;
  jitterSize: number; // 0..1
  jitterOpacity: number;
  scatter: number; // offset in diameters
  rotationJitter: number; // 0..1 of a full turn
  followStroke: boolean; // tip angle follows stroke direction
  angle: number; // degrees
  roundness: number; // 0..1 (1 = circle)
  shape: TipShape;
  grain: Grain;
  grainScale: number;
  grainDepth: number; // 0..1
  hueJitter: number; // 0..1 per-stamp colour dynamics
  briJitter: number;
  wetEdges: number; // 0..1 darkened edges (watercolour)
  velocitySize: number; // -1..1 speed thins (−) or thickens (+) the line
}

const base: Omit<Brush, "id" | "name" | "set"> = {
  minSize: 1,
  maxSize: 40,
  spacing: 0.08,
  streamline: 0.3,
  hardness: 0.9,
  flow: 1,
  pressureSize: 0.7,
  pressureOpacity: 0,
  taperStart: 0,
  taperEnd: 0,
  jitterSize: 0,
  jitterOpacity: 0,
  scatter: 0,
  rotationJitter: 0,
  followStroke: false,
  angle: 0,
  roundness: 1,
  shape: "round",
  grain: "none",
  grainScale: 1,
  grainDepth: 0,
  hueJitter: 0,
  briJitter: 0,
  wetEdges: 0,
  velocitySize: 0,
};

function b(set: string, name: string, p: Partial<Brush>): Brush {
  return { ...base, ...p, set, name, id: (set + "-" + name).toLowerCase().replace(/[^a-z0-9]+/g, "-") };
}

export const BRUSH_SETS = [
  "Sketching",
  "Inking",
  "Drawing",
  "Painting",
  "Watercolour",
  "Calligraphy",
  "Airbrushing",
  "Spray Paint",
  "Charcoals",
  "Textures",
  "Abstract",
  "Erasers",
] as const;

export const BRUSHES: Brush[] = [
  b("Sketching", "HB Pencil", { maxSize: 10, hardness: 0.7, flow: 0.55, pressureOpacity: 0.8, pressureSize: 0.3, grain: "paper", grainDepth: 0.6, streamline: 0.1, spacing: 0.12 }),
  b("Sketching", "6B Pencil", { maxSize: 22, hardness: 0.5, flow: 0.45, pressureOpacity: 0.9, pressureSize: 0.4, grain: "paper", grainDepth: 0.75, grainScale: 1.4, spacing: 0.12 }),
  b("Sketching", "Technical Pencil", { maxSize: 6, hardness: 0.95, flow: 0.8, pressureOpacity: 0.5, pressureSize: 0.1, grain: "paper", grainDepth: 0.3 }),
  b("Inking", "Studio Pen", { maxSize: 24, streamline: 0.55, pressureSize: 0.9, taperStart: 2, taperEnd: 3 }),
  b("Inking", "Technical Pen", { maxSize: 14, streamline: 0.4, pressureSize: 0.05 }),
  b("Inking", "Dry Ink", { maxSize: 26, hardness: 0.8, pressureSize: 0.8, grain: "canvas", grainDepth: 0.45, taperStart: 1, taperEnd: 1 }),
  b("Inking", "Gel Pen", { maxSize: 10, streamline: 0.5, pressureSize: 0.35, velocitySize: -0.3 }),
  b("Drawing", "Marker", { maxSize: 36, hardness: 0.75, flow: 0.35, pressureSize: 0.2, spacing: 0.05 }),
  b("Drawing", "Felt Tip", { maxSize: 18, hardness: 0.85, flow: 0.6, pressureOpacity: 0.3, grain: "paper", grainDepth: 0.15 }),
  b("Drawing", "Crayon", { maxSize: 28, hardness: 0.6, flow: 0.8, grain: "canvas", grainDepth: 0.85, grainScale: 0.8, pressureOpacity: 0.5 }),
  b("Painting", "Round Brush", { maxSize: 60, hardness: 0.55, flow: 0.7, pressureSize: 0.75, pressureOpacity: 0.3, taperStart: 1, taperEnd: 2 }),
  b("Painting", "Flat Brush", { maxSize: 70, shape: "flat", roundness: 0.3, followStroke: true, hardness: 0.7, flow: 0.65, pressureSize: 0.5, grain: "streaks", grainDepth: 0.4 }),
  b("Painting", "Oil Paint", { maxSize: 80, hardness: 0.8, flow: 0.85, grain: "canvas", grainDepth: 0.5, pressureSize: 0.6, briJitter: 0.04, spacing: 0.05 }),
  b("Painting", "Gouache", { maxSize: 70, hardness: 0.5, flow: 0.5, grain: "paper", grainDepth: 0.35, pressureOpacity: 0.4 }),
  b("Watercolour", "Wet Wash", { maxSize: 120, hardness: 0.1, flow: 0.12, pressureOpacity: 0.6, pressureSize: 0.4, wetEdges: 0.6, grain: "paper", grainDepth: 0.3, spacing: 0.06 }),
  b("Watercolour", "Watercolour Round", { maxSize: 60, hardness: 0.25, flow: 0.2, pressureSize: 0.7, wetEdges: 0.45, grain: "paper", grainDepth: 0.35 }),
  b("Watercolour", "Bleed", { maxSize: 90, hardness: 0.05, flow: 0.1, jitterSize: 0.3, scatter: 0.15, wetEdges: 0.3 }),
  b("Calligraphy", "Chisel", { maxSize: 30, shape: "flat", roundness: 0.18, angle: 45, hardness: 0.95, pressureSize: 0.4, spacing: 0.04 }),
  b("Calligraphy", "Brush Pen", { maxSize: 32, pressureSize: 1, taperStart: 3, taperEnd: 4, streamline: 0.5, velocitySize: -0.4 }),
  b("Calligraphy", "Monoline", { maxSize: 16, pressureSize: 0, streamline: 0.7 }),
  b("Airbrushing", "Soft Airbrush", { maxSize: 200, minSize: 4, hardness: 0, flow: 0.08, pressureOpacity: 0.8, pressureSize: 0.2, spacing: 0.05, streamline: 0.1 }),
  b("Airbrushing", "Medium Airbrush", { maxSize: 120, hardness: 0.35, flow: 0.15, pressureOpacity: 0.7, pressureSize: 0.2 }),
  b("Airbrushing", "Hard Airbrush", { maxSize: 100, hardness: 0.85, flow: 0.25, pressureOpacity: 0.6, pressureSize: 0.2 }),
  b("Spray Paint", "Spray Can", { maxSize: 120, shape: "spray", flow: 0.5, spacing: 0.15, scatter: 0.05, rotationJitter: 1 }),
  b("Spray Paint", "Splatter", { maxSize: 140, shape: "splatter", flow: 0.9, spacing: 0.9, jitterSize: 0.6, scatter: 0.4, rotationJitter: 1 }),
  b("Spray Paint", "Drips", { maxSize: 40, hardness: 0.9, flow: 0.9, jitterSize: 0.5, spacing: 0.4, scatter: 0.6 }),
  b("Charcoals", "Vine Charcoal", { maxSize: 40, hardness: 0.4, flow: 0.5, grain: "charcoal", grainDepth: 0.85, pressureOpacity: 0.7, jitterOpacity: 0.2 }),
  b("Charcoals", "Compressed", { maxSize: 50, shape: "square", roundness: 0.6, followStroke: true, hardness: 0.6, flow: 0.7, grain: "charcoal", grainDepth: 0.7 }),
  b("Textures", "Stipple", { maxSize: 50, shape: "spray", spacing: 0.5, flow: 1, scatter: 0.3, rotationJitter: 1 }),
  b("Textures", "Grunge", { maxSize: 90, hardness: 0.6, flow: 0.6, grain: "noise", grainDepth: 0.9, grainScale: 2, rotationJitter: 1, jitterSize: 0.3 }),
  b("Textures", "Canvas Texture", { maxSize: 120, hardness: 0.3, flow: 0.4, grain: "canvas", grainDepth: 0.95, grainScale: 1.6 }),
  b("Abstract", "Leaves", { maxSize: 70, shape: "leaf", spacing: 0.7, jitterSize: 0.5, scatter: 0.5, rotationJitter: 1, hueJitter: 0.08, briJitter: 0.15 }),
  b("Abstract", "Stars", { maxSize: 60, shape: "star", spacing: 1.2, jitterSize: 0.7, scatter: 0.8, rotationJitter: 1, hueJitter: 0.15 }),
  b("Abstract", "Rainbow", { maxSize: 40, hardness: 0.8, hueJitter: 1, spacing: 0.05 }),
  b("Erasers", "Hard Eraser", { maxSize: 60, hardness: 1, pressureSize: 0.2 }),
  b("Erasers", "Soft Eraser", { maxSize: 120, hardness: 0.1, flow: 0.3, pressureOpacity: 0.6 }),
];

export const DEFAULT_BRUSH = "inking-studio-pen";
export const DEFAULT_ERASER = "erasers-soft-eraser";
export const DEFAULT_SMUDGE = "painting-round-brush";

export function findBrush(id: string, custom: Brush[] = []): Brush {
  return custom.find((x) => x.id === id) ?? BRUSHES.find((x) => x.id === id) ?? BRUSHES[0];
}

export interface StudioField {
  key: keyof Brush;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
}

/** The Brush Studio's sliders, grouped like ProCraft's studio tabs. */
export const STUDIO_FIELDS: StudioField[] = [
  { key: "spacing", label: "Spacing", min: 0.02, max: 2, step: 0.01, group: "Stroke path" },
  { key: "scatter", label: "Scatter", min: 0, max: 2, step: 0.01, group: "Stroke path" },
  { key: "streamline", label: "StreamLine", min: 0, max: 0.95, step: 0.01, group: "Stabilization" },
  { key: "taperStart", label: "Taper start", min: 0, max: 8, step: 0.1, group: "Taper" },
  { key: "taperEnd", label: "Taper end", min: 0, max: 8, step: 0.1, group: "Taper" },
  { key: "hardness", label: "Hardness", min: 0, max: 1, step: 0.01, group: "Shape" },
  { key: "roundness", label: "Roundness", min: 0.05, max: 1, step: 0.01, group: "Shape" },
  { key: "angle", label: "Angle", min: 0, max: 180, step: 1, group: "Shape" },
  { key: "rotationJitter", label: "Rotation jitter", min: 0, max: 1, step: 0.01, group: "Shape" },
  { key: "grainDepth", label: "Grain depth", min: 0, max: 1, step: 0.01, group: "Grain" },
  { key: "grainScale", label: "Grain scale", min: 0.3, max: 4, step: 0.05, group: "Grain" },
  { key: "flow", label: "Flow", min: 0.01, max: 1, step: 0.01, group: "Rendering" },
  { key: "wetEdges", label: "Wet edges", min: 0, max: 1, step: 0.01, group: "Wet mix" },
  { key: "hueJitter", label: "Hue jitter", min: 0, max: 1, step: 0.01, group: "Colour dynamics" },
  { key: "briJitter", label: "Brightness jitter", min: 0, max: 1, step: 0.01, group: "Colour dynamics" },
  { key: "jitterSize", label: "Size jitter", min: 0, max: 1, step: 0.01, group: "Dynamics" },
  { key: "jitterOpacity", label: "Opacity jitter", min: 0, max: 1, step: 0.01, group: "Dynamics" },
  { key: "velocitySize", label: "Speed → size", min: -1, max: 1, step: 0.01, group: "Dynamics" },
  { key: "pressureSize", label: "Pressure → size", min: 0, max: 1, step: 0.01, group: "Apple Pencil / Stylus" },
  { key: "pressureOpacity", label: "Pressure → opacity", min: 0, max: 1, step: 0.01, group: "Apple Pencil / Stylus" },
  { key: "minSize", label: "Minimum size", min: 0.5, max: 50, step: 0.5, group: "Properties" },
  { key: "maxSize", label: "Maximum size", min: 2, max: 400, step: 1, group: "Properties" },
];
