// Binary property list (bplist00) reader and NSKeyedArchiver flattening, enough for Procreate's
// Brush.archive.

export type PValue = null | boolean | number | string | Uint8Array | Date | PValue[] | { [k: string]: PValue } | { uid: number };

export function parseBplist(bytes: Uint8Array): PValue {
  const dec = new TextDecoder();
  if (dec.decode(bytes.subarray(0, 8)) !== "bplist00") throw new Error("Not a binary plist");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = bytes.length - 32;
  const offSize = bytes[t + 6];
  const refSize = bytes[t + 7];
  const num = Number(v.getBigUint64(t + 8));
  const top = Number(v.getBigUint64(t + 16));
  const table = Number(v.getBigUint64(t + 24));
  const uint = (at: number, n: number) => {
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + bytes[at + i];
    return x;
  };
  const offsets = Array.from({ length: num }, (_, i) => uint(table + i * offSize, offSize));
  const seen = new Set<number>();
  const obj = (ref: number): PValue => {
    if (seen.has(ref)) throw new Error("Cyclic plist");
    seen.add(ref);
    try {
      return read(offsets[ref]);
    } finally {
      seen.delete(ref);
    }
  };
  const len = (at: number): [number, number] => {
    const n = bytes[at] & 0xf;
    if (n !== 0xf) return [n, at + 1];
    const k = 1 << (bytes[at + 1] & 0xf);
    return [uint(at + 2, k), at + 2 + k];
  };
  const read = (at: number): PValue => {
    const m = bytes[at];
    const hi = m >> 4;
    switch (hi) {
      case 0x0:
        return m === 0x08 ? false : m === 0x09 ? true : null;
      case 0x1: {
        const n = 1 << (m & 0xf);
        return n === 8 ? Number(v.getBigInt64(at + 1)) : uint(at + 1, n);
      }
      case 0x2:
        return (m & 0xf) === 2 ? v.getFloat32(at + 1) : v.getFloat64(at + 1);
      case 0x3:
        return new Date(Date.UTC(2001, 0, 1) + v.getFloat64(at + 1) * 1000);
      case 0x4: {
        const [n, s] = len(at);
        return bytes.slice(s, s + n);
      }
      case 0x5: {
        const [n, s] = len(at);
        return dec.decode(bytes.subarray(s, s + n));
      }
      case 0x6: {
        const [n, s] = len(at);
        let str = "";
        for (let i = 0; i < n; i++) str += String.fromCharCode(v.getUint16(s + i * 2));
        return str;
      }
      case 0x8:
        return { uid: uint(at + 1, (m & 0xf) + 1) };
      case 0xa: {
        const [n, s] = len(at);
        return Array.from({ length: n }, (_, i) => obj(uint(s + i * refSize, refSize)));
      }
      case 0xd: {
        const [n, s] = len(at);
        const d: { [k: string]: PValue } = {};
        for (let i = 0; i < n; i++) d[String(obj(uint(s + i * refSize, refSize)))] = obj(uint(s + (n + i) * refSize, refSize));
        return d;
      }
      default:
        throw new Error("Unsupported plist object 0x" + m.toString(16));
    }
  };
  return obj(top);
}

const isUid = (x: PValue): x is { uid: number } => !!x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Uint8Array) && !(x instanceof Date) && "uid" in x;

/** The root object of an NSKeyedArchiver plist with its fields' references followed one level:
 * strings and numbers come out as plain values. */
export function unarchiveRoot(archive: PValue): Record<string, PValue> {
  const a = archive as { $objects?: PValue[]; $top?: Record<string, PValue> };
  if (!a || !Array.isArray(a.$objects) || !a.$top) throw new Error("Not a keyed archive");
  const objects = a.$objects;
  const at = (x: PValue): PValue => (isUid(x) ? objects[x.uid] ?? null : x);
  const rootRef = a.$top.root ?? Object.values(a.$top)[0];
  const root = at(rootRef) as Record<string, PValue>;
  const out: Record<string, PValue> = {};
  for (const [k, val] of Object.entries(root ?? {})) {
    let r = at(val);
    // NSString / NSMutableString objects wrap their text in NS.string
    if (r && typeof r === "object" && !Array.isArray(r) && !(r instanceof Uint8Array) && "NS.string" in r) r = (r as Record<string, PValue>)["NS.string"];
    out[k] = r;
  }
  return out;
}
