// Copies the OCR engine and its Thai + English data from node_modules into public/tesseract so
// the app hosts them itself (no third-party CDN; works offline once cached). Runs before dev/build.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
const out = "public/tesseract";
mkdirSync(`${out}/core`, { recursive: true });
mkdirSync(`${out}/lang`, { recursive: true });
cpSync("node_modules/tesseract.js/dist/worker.min.js", `${out}/worker.min.js`);
for (const f of readdirSync("node_modules/tesseract.js-core")) if (/lstm\.(js|wasm|wasm\.js)$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/core/${f}`);
for (const l of ["eng", "tha"]) cpSync(`node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `${out}/lang/${l}.traineddata.gz`);
console.log("OCR files ready in", out);
