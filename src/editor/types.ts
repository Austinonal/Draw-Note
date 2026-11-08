import type { PenKind, ShapeKind } from "../lib/model";
import type { Symmetry } from "../paint/engine";

export type Mode = "notes" | "paint";
export type NoteTool = "pen" | "pencil" | "highlighter" | "fountain" | "eraser" | "lasso" | "text" | "shape" | "sticky" | "tape" | "laser" | "hand" | "lift";
export type PaintTool = "brush" | "smudge" | "erase" | "fill" | "eyedropper" | "select" | "transform" | "hand";
export type Tool = NoteTool | PaintTool;
export type PaintSlot = "brush" | "smudge" | "erase";

export interface ToolState {
  mode: Mode;
  noteTool: NoteTool;
  paintTool: PaintTool;
  color: string;
  penWidth: Record<PenKind, number>;
  highlighterOpacity: number;
  eraserMode: "object" | "partial";
  eraserSize: number;
  shapeKind: ShapeKind;
  shapeFill: boolean;
  textSize: number;
  stickyColor: string;
  tapeColor: string;
  quickShape: boolean;
  brushId: Record<PaintSlot, string>;
  size: Record<PaintSlot, number>;
  opacity: Record<PaintSlot, number>;
  fillThreshold: number;
  fillSampleAll: boolean;
  selectMode: "rect" | "ellipse" | "free";
  feather: number;
  symmetry: Symmetry;
  gridGuide: boolean;
  fingerDraws: boolean;
  readOnly: boolean;
  onion: boolean;
  animation: boolean;
}

export const defaultToolState = (): ToolState => ({
  mode: "notes",
  noteTool: "pen",
  paintTool: "brush",
  color: "#1b1f27",
  penWidth: { pen: 3, pencil: 3, highlighter: 18, fountain: 5 },
  highlighterOpacity: 0.35,
  eraserMode: "partial",
  eraserSize: 14,
  shapeKind: "rect",
  shapeFill: false,
  textSize: 20,
  stickyColor: "#fff59d",
  tapeColor: "#f48fb1",
  quickShape: true,
  brushId: { brush: "inking-studio-pen", smudge: "painting-round-brush", erase: "erasers-soft-eraser" },
  size: { brush: 0.35, smudge: 0.45, erase: 0.4 },
  opacity: { brush: 1, smudge: 0.8, erase: 1 },
  fillThreshold: 0.18,
  fillSampleAll: true,
  selectMode: "free",
  feather: 0,
  symmetry: "off",
  gridGuide: false,
  fingerDraws: true,
  readOnly: false,
  onion: true,
  animation: false,
});

export interface TextEditRequest {
  id: string;
  kind: "text" | "sticky";
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  color?: string; // set for imported PDF text lines
  font?: string;
}

export interface WorkspaceEvents {
  changed(): void; // history / selection / layers changed: re-render UI
  colorPicked(color: string): void;
  editText(req: TextEditRequest | null): void;
  toast(msg: string): void;
}
