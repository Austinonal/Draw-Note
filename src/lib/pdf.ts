// PDF import (pages become annotatable page backgrounds with searchable text) and export.
import { PDFDocument } from "pdf-lib";
import type { Doc, Page } from "./model";
import { id, newPage, type PdfLine } from "./model";
import { rgbToHex } from "../paint/color";

export interface Run {
  x: number;
  base: number;
  size: number;
  w: number;
  str: string;
  font: string;
}
/** Groups text runs into lines: same baseline, close horizontally. Columns stay separate. */
export function groupRuns(runs: Run[]): Run[] {
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

/** Ink and background colours of a box on the rendered page (k = canvas pixels per unit). */
function sampleColors(img: ImageData, k: number, x: number, y: number, w: number, h: number): { color: string; bg: string } {
  const x0 = Math.max(0, Math.floor(x * k)), y0 = Math.max(0, Math.floor(y * k));
  const x1 = Math.min(img.width - 1, Math.ceil((x + w) * k)), y1 = Math.min(img.height - 1, Math.ceil((y + h) * k));
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
import { pageToCanvas, type LayerSource } from "./render";

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

/** Reads a PDF into pages. Each page is rasterised (crisp at 2x) as the page background. */
export async function importPdf(file: Blob, onProgress?: (done: number, total: number) => void): Promise<Page[]> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: Page[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const vp1 = pg.getViewport({ scale: 96 / 72 });
    const w = Math.round(vp1.width),
      h = Math.round(vp1.height);
    const quality = Math.min(2, 2400 / Math.max(w, h));
    const vp = pg.getViewport({ scale: (96 / 72) * quality });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    const text = await pg.getTextContent();
    const runs: Run[] = [];
    for (const it of text.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const t = lib.Util.transform(vp1.transform, it.transform);
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue; // shortcut: rotated text is not editable, it stays in the background
      const size = Math.abs(t[3]) || Math.abs(t[0]);
      runs.push({ x: t[4], base: t[5], size, w: it.width * (96 / 72), str: it.str, font: text.styles[it.fontName]?.fontFamily ?? "sans-serif" });
    }
    const pix = ctx.getImageData(0, 0, c.width, c.height);
    const pdfLines: PdfLine[] = groupRuns(runs).map((r) => {
      const y = r.base - r.size * 0.92;
      const hgt = r.size * 1.2;
      return { id: id(), x: r.x, y, w: r.w, h: hgt, base: r.base, size: r.size, font: r.font, ...sampleColors(pix, quality, r.x, y, r.w, hgt), orig: r.str, text: r.str, dx: 0, dy: 0 };
    });
    const page = newPage({ w, h, scale: 1.5, paper: "blank", paperColor: "#ffffff" });
    page.pdfLines = pdfLines;
    page.bg = c.toDataURL("image/jpeg", 0.88);
    page.bgText = text.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    pages.push(page);
    onProgress?.(i, pdf.numPages);
  }
  return pages;
}

/** Writes every page (paper, paint layers, notes) into a PDF at its page size. */
export async function exportPdf(doc: Doc, src: (page: Page) => LayerSource, pages?: Page[]): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator("DrawNote");
  for (const p of pages ?? doc.pages) {
    const px = Math.min(2400, Math.max(p.w * 2, 1200));
    const c = pageToCanvas(p, src(p), px);
    const bytes = await new Promise<ArrayBuffer>((res) => c.toBlob((b) => b!.arrayBuffer().then(res), "image/jpeg", 0.92));
    const img = await pdf.embedJpg(bytes);
    const ptW = doc.kind === "canvas" ? p.w * 0.75 * Math.min(1, 1200 / p.w) : p.w * 0.75;
    const ptH = ptW * (p.h / p.w);
    const page = pdf.addPage([ptW, ptH]);
    page.drawImage(img, { x: 0, y: 0, width: ptW, height: ptH });
  }
  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}
