import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works on GitHub Pages, any static host and inside Capacitor.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2020", chunkSizeWarningLimit: 2000 },
});
