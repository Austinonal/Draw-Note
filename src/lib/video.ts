// Turns image frames into a video with MediaRecorder (WebM on Chrome/Android, MP4 on Safari).
import { loadImage } from "./render";

export async function framesToVideo(frames: string[], fps: number): Promise<{ blob: Blob; ext: string }> {
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder unavailable");
  const first = await loadImage(frames[0]);
  const c = document.createElement("canvas");
  c.width = first.width - (first.width % 2);
  c.height = first.height - (first.height % 2);
  const g = c.getContext("2d")!;
  g.drawImage(first, 0, 0, c.width, c.height);
  const stream = c.captureStream(fps);
  const types = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  const type = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start();
  for (const f of frames) {
    const img = await loadImage(f);
    g.drawImage(img, 0, 0, c.width, c.height);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  // hold the last frame for a second
  await new Promise((r) => setTimeout(r, 1000));
  rec.stop();
  await done;
  const mime = rec.mimeType || type || "video/webm";
  return { blob: new Blob(chunks, { type: mime }), ext: mime.includes("mp4") ? "mp4" : "webm" };
}

/** Records the canvas drawn by `draw(i)` for each animation frame. */
export async function animationToVideo(count: number, w: number, h: number, fps: number, draw: (g: CanvasRenderingContext2D, i: number) => void, loops = 2): Promise<{ blob: Blob; ext: string }> {
  const frames: string[] = [];
  const c = document.createElement("canvas");
  c.width = w - (w % 2);
  c.height = h - (h % 2);
  const g = c.getContext("2d")!;
  for (let l = 0; l < loops; l++)
    for (let i = 0; i < count; i++) {
      g.clearRect(0, 0, c.width, c.height);
      draw(g, i);
      frames.push(c.toDataURL("image/jpeg", 0.9));
    }
  return framesToVideo(frames, fps);
}
