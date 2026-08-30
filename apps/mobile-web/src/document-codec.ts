import {
  MAX_WORKSPACE_BYTES,
  parseLabelDocument,
  serializeLabelDocument,
} from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";

import { base64ToBytes, bytesToBase64 } from "./base64.js";

const GZIP_FORMAT = "gzip";

export async function encodeWorkspace(
  document: LabelDocument,
): Promise<string> {
  const yaml = serializeLabelDocument(document);
  const input = new TextEncoder().encode(yaml);
  const compressed = await collectStream(
    new Blob([input]).stream().pipeThrough(new CompressionStream(GZIP_FORMAT)),
  );
  if (compressed.byteLength > MAX_WORKSPACE_BYTES) {
    throw new Error("The workspace is too large to save.");
  }
  return bytesToBase64(compressed);
}

export async function decodeWorkspace(
  gzipBase64: string,
): Promise<LabelDocument> {
  let compressed: Uint8Array;
  try {
    compressed = base64ToBytes(gzipBase64);
  } catch {
    throw new Error("Workspace file data is not valid base64.");
  }
  if (compressed.byteLength > MAX_WORKSPACE_BYTES) {
    throw new Error("The workspace file is too large.");
  }
  let decompressed: Uint8Array;
  try {
    const compressedCopy = new Uint8Array(compressed);
    decompressed = await collectStream(
      new Blob([compressedCopy.buffer])
        .stream()
        .pipeThrough(new DecompressionStream(GZIP_FORMAT)),
      MAX_WORKSPACE_BYTES,
    );
  } catch {
    throw new Error("Workspace file is not valid gzip data.");
  }
  return parseLabelDocument(
    new TextDecoder("utf-8", { fatal: true }).decode(decompressed),
  );
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error("The workspace file expands beyond the size limit.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
