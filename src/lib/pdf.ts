// PDF import (pages become annotatable page backgrounds with searchable text) and export.
import { PDFDocument } from "pdf-lib";
import type { Doc, Page } from "./model";
import { newPage } from "./model";
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
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    const text = await pg.getTextContent();
    const page = newPage({ w, h, scale: 1.5, paper: "blank", paperColor: "#ffffff" });
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
