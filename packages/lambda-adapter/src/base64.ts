// Web-API base64 helpers, so the package runs with or without nodejs_compat.

// Bytes per String.fromCharCode call; keeps argument lists well under engine limits.
const CHUNK_SIZE = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Decodes standard or URL-safe base64; whitespace and missing padding are tolerated. */
export function decodeBase64(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
