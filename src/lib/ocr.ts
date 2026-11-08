// OCR for page backgrounds (scanned PDFs, photos, PDFs imported before text detection) with
// tesseract.js, self-hosted under ./tesseract (see scripts/copy-ocr.mjs). Thai + English.
import type { PdfLine } from "./model";
import { loadImage } from "./render";
import { linesFromRuns, type Run } from "./pdftext";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let worker: Promise<TWorker> | null = null;
let progress: ((p: number) => void) | null = null;

function getWorker(): Promise<TWorker> {
  if (!worker) {
    const base = new URL("./tesseract/", document.baseURI).href;
    worker = import("tesseract.js").then(({ createWorker }) =>
      createWorker(["tha", "eng"], 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "core",
        langPath: base + "lang",
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") progress?.(m.progress);
        },
      }),
    );
    worker.catch(() => (worker = null)); // allow a retry after a failed download
  }
  return worker;
}

/** Recognises the text in a page background image; lines come back in page units. Skewed scans
 * keep their angle (from each line's baseline). */
export async function ocrImage(src: string, pageW: number, onProgress?: (p: number) => void): Promise<PdfLine[]> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const k = c.width / pageW; // image pixels per page unit
  const w = await getWorker();
  progress = onProgress ?? null;
  const { data } = await w.recognize(c, {}, { blocks: true });
  progress = null;
  const runs: Run[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const text = l.text.replace(/\s+$/, "");
        if (!text.trim() || l.confidence < 30) continue;
        const bl = l.baseline;
        const angle = Math.atan2(bl.y1 - bl.y0, bl.x1 - bl.x0);
        // baseline at the line's left edge; size from the ascent above it
        const baseY = bl.y0 + (l.bbox.x0 - bl.x0) * Math.tan(angle);
        const size = Math.max(6, (baseY - l.bbox.y0) / Math.cos(angle) / 0.8);
        runs.push({ x: l.bbox.x0 / k, base: baseY / k, size: size / k, w: Math.hypot(l.bbox.x1 - l.bbox.x0, (l.bbox.x1 - l.bbox.x0) * Math.tan(angle)) / k, str: text, font: "sans-serif", angle: Math.abs(angle) < 0.004 ? 0 : angle });
      }
  return linesFromRuns(runs, g.getImageData(0, 0, c.width, c.height), k);
}
