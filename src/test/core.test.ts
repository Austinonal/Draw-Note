import { describe, expect, it } from "vitest";
import { recognize, shapePoints, splitInk, lassoSelects, hitObj } from "../lib/geometry";
import { floodFill } from "../paint/fill";
import { applyAdjust, blurData } from "../paint/adjust";
import { hexToHsv, hsvToHex, harmony } from "../paint/color";
import { newNotebook, newCanvasDoc, docSearchText, type InkObj } from "../lib/model";

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (typeof a === "number") {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? a.length / 4 / b;
    }
  }
}
(globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
const img = (w: number, h: number) => new FakeImageData(w, h) as unknown as ImageData;

describe("geometry", () => {
  it("recognises a straight line and a circle (QuickShape)", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: i * 0.3 }));
    expect(recognize(line)?.kind).toBe("line");
    const circle = Array.from({ length: 60 }, (_, i) => ({ x: 100 + Math.cos((i / 59) * Math.PI * 2) * 50, y: 100 + Math.sin((i / 59) * Math.PI * 2) * 50 }));
    expect(recognize(circle)?.kind).toBe("ellipse");
    expect(shapePoints({ kind: "line", a: { x: 0, y: 0, p: 1 }, b: { x: 40, y: 0, p: 1 } }).length).toBeGreaterThan(2);
  });
  it("splits ink even when points are far apart (partial eraser)", () => {
    const pts = [{ x: 0, y: 0, p: 1 }, { x: 200, y: 0, p: 1 }];
    const pieces = splitInk(pts, 100, 0, 5);
    expect(pieces.length).toBe(2);
  });
  it("lasso selects ink inside the polygon", () => {
    const ink: InkObj = { id: "a", type: "ink", pen: "pen", pts: [{ x: 10, y: 10, p: 1 }, { x: 20, y: 10, p: 1 }], color: "#000", width: 2, opacity: 1 };
    expect(lassoSelects(ink, [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }])).toBe(true);
    expect(hitObj(ink, 15, 10, 1)).toBe(true);
  });
});

describe("fill", () => {
  it("fills inside a closed outline and not outside", () => {
    const w = 60, h = 60;
    const s = img(w, h);
    for (let i = 0; i < s.data.length; i += 4) s.data.set([255, 255, 255, 255], i);
    for (let k = 10; k < 50; k++)
      for (const [x, y] of [[k, 10], [k, 49], [10, k], [49, k]]) s.data.set([0, 0, 0, 255], (y * w + x) * 4);
    const t = img(w, h);
    floodFill(s, t, 30, 30, "#ff0000", 0.2, null);
    expect(t.data[(30 * w + 30) * 4 + 3]).toBe(255);
    expect(t.data[(5 * w + 5) * 4 + 3]).toBe(0);
  });
});

describe("adjust & colour", () => {
  it("inverts and blurs", () => {
    const a = img(4, 4);
    a.data.fill(255);
    const inv = applyAdjust(a, "invert", {});
    expect(inv.data[0]).toBe(0);
    expect(blurData(a, 2).data[3]).toBeGreaterThan(200);
  });
  it("round-trips HSV and builds harmonies", () => {
    expect(hsvToHex(hexToHsv("#3d6fb6"))).toBe("#3d6fb6");
    expect(harmony(hexToHsv("#ff0000"), "triadic")).toHaveLength(3);
  });
});

describe("model", () => {
  it("creates notebooks and canvases with a paint layer each", () => {
    const n = newNotebook("Math", { paper: "grid", paperColor: "#fff", size: "a4", landscape: false, cover: "#000", folderId: null });
    expect(n.pages[0].layers).toHaveLength(1);
    const c = newCanvasDoc("Art", 9000, 100, "#fff", null);
    expect(c.pages[0].w).toBe(4096);
    n.pages[0].objects.push({ id: "t", type: "text", x: 0, y: 0, w: 100, text: "สวัสดี", size: 12, color: "#000" });
    expect(docSearchText(n)).toContain("สวัสดี");
  });
});
