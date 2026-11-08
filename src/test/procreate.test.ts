import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readZip } from "../lib/zip";
import { parseBplist, unarchiveRoot } from "../lib/bplist";
import { brushFromFields, paletteFromSwatchesJson } from "../lib/procreate";

const fixture = (n: string) => {
  const b = readFileSync(new URL("./fixtures/" + n, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe("Procreate import", () => {
  it("reads a .swatches palette (HSB, empty slots, trailing commas)", async () => {
    const zip = await readZip(fixture("test.swatches"));
    const p = paletteFromSwatchesJson(new TextDecoder().decode(zip.get("Swatches.json")));
    expect(p.name).toBe("Sunset Test");
    expect(p.colors).toEqual(["#ff0000", "#000080"]);
  });

  it("reads every brush in a .brushset with its settings and images", async () => {
    const zip = await readZip(fixture("test.brushset"));
    expect(zip.has("A/Shape.png") && zip.has("B/Grain.png")).toBe(true);
    const a = brushFromFields(unarchiveRoot(parseBplist(zip.get("A/Brush.archive")!)), "a", "Test");
    expect(a.name).toBe("Star Stamp");
    expect(a.spacing).toBeCloseTo(0.6);
    expect(a.maxSize).toBeCloseTo(64);
    expect(a.pressureSize).toBeCloseTo(0.8);
    const b = brushFromFields(unarchiveRoot(parseBplist(zip.get("B/Brush.archive")!)), "b", "Test");
    expect(b.name).toBe("Lined Grain");
    expect(b.grainDepth).toBeCloseTo(0.9);
    expect(b.taperStart).toBeCloseTo(2);
  });

  it("rejects files that are not ZIPs", async () => {
    await expect(readZip(new TextEncoder().encode("hello").buffer)).rejects.toThrow("Not a ZIP");
  });
});
