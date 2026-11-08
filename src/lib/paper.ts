// Draws page paper (templates) onto a 2D context in document units.
import type { Paper } from "./model";
import { isDark } from "./model";

export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper, w: number, h: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const dark = isDark(color);
  const line = dark ? "rgba(255,255,255,0.13)" : "rgba(60,90,130,0.22)";
  const accent = dark ? "rgba(255,120,120,0.35)" : "rgba(220,80,80,0.45)";
  const ink = dark ? "rgba(255,255,255,0.55)" : "rgba(40,55,75,0.65)";
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = 1;
  const hline = (y: number, x0 = 0, x1 = w) => {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  };
  const vline = (x: number, y0 = 0, y1 = h) => {
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  };
  switch (paper) {
    case "ruled":
    case "narrow": {
      const gap = paper === "ruled" ? 32 : 24;
      for (let y = 96; y < h - 24; y += gap) hline(y);
      ctx.strokeStyle = accent;
      vline(72);
      break;
    }
    case "grid": {
      for (let y = 24; y < h; y += 24) hline(y);
      for (let x = 24; x < w; x += 24) vline(x);
      break;
    }
    case "dotted": {
      for (let y = 24; y < h; y += 24) for (let x = 24; x < w; x += 24) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "isometric": {
      const s = 28;
      const dy = s * Math.tan(Math.PI / 6);
      for (let x = 0; x <= w; x += s) vline(x);
      for (let k = -Math.ceil(w / s) * 2; k < Math.ceil(h / dy) + 4; k++) {
        ctx.beginPath();
        ctx.moveTo(0, k * dy * 2);
        ctx.lineTo(w, k * dy * 2 + w * Math.tan(Math.PI / 6));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, k * dy * 2);
        ctx.lineTo(w, k * dy * 2 - w * Math.tan(Math.PI / 6));
        ctx.stroke();
      }
      break;
    }
    case "cornell": {
      for (let y = 128; y < h * 0.78; y += 30) hline(y, w * 0.3);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      hline(96);
      vline(w * 0.3, 96, h * 0.8);
      hline(h * 0.8);
      ctx.fillStyle = ink;
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText("CUES", 24, 120);
      ctx.fillText("NOTES", w * 0.3 + 16, 120);
      ctx.fillText("SUMMARY", 24, h * 0.8 + 26);
      ctx.fillText("TOPIC", 24, 40);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      hline(64, 80, w - 24);
      break;
    }
    case "todo": {
      ctx.fillStyle = ink;
      ctx.font = "700 26px system-ui, sans-serif";
      ctx.fillText("To-do", 48, 70);
      for (let y = 120, i = 0; y < h - 40; y += 40, i++) {
        hline(y + 12, 84, w - 48);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(52, y - 10, 18, 18);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
      }
      break;
    }
    case "music": {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      for (let y = 90; y + 48 < h - 30; y += 96) for (let i = 0; i < 5; i++) hline(y + i * 10, 40, w - 40);
      break;
    }
    case "planner": {
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Notes"];
      const top = 80;
      const cols = w > h ? 4 : 2;
      const rows = Math.ceil(days.length / cols);
      const cw = (w - 48) / cols;
      const rh = (h - top - 24) / rows;
      ctx.fillStyle = ink;
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.fillText("This week", 24, 50);
      ctx.font = "600 13px system-ui, sans-serif";
      days.forEach((d, i) => {
        const x = 24 + (i % cols) * cw;
        const y = top + Math.floor(i / cols) * rh;
        ctx.strokeStyle = ink;
        ctx.strokeRect(x + 4, y + 4, cw - 8, rh - 8);
        ctx.fillText(d.toUpperCase(), x + 14, y + 24);
        ctx.strokeStyle = line;
        for (let ly = y + 52; ly < y + rh - 12; ly += 26) hline(ly, x + 14, x + cw - 14);
      });
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
