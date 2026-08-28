import { createHash } from "node:crypto";

export function stableId(prefix: string, ...parts: Array<string | number>): string {
  const hash = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

export function documentIdFor(buffer: Uint8Array): string {
  return `doc_${createHash("sha256").update(buffer).digest("hex").slice(0, 24)}`;
}

export function canonicalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

