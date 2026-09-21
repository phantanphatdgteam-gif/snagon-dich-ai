// Prints the manifest `key` (base64 SPKI DER) and the Chrome extension ID for an RSA private key.
// Usage: node scripts/extension-id.mjs ~/.config/snagon-dich-ai/snagon-dich-ai.pem
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Chrome ID = first 32 hex chars of sha256(SPKI DER), each mapped 0-9a-f → a-p. */
export function extensionIdFromDer(derBuffer) {
  const hex = createHash('sha256').update(derBuffer).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** Reads an RSA private key (PEM) and returns the manifest key (base64 SPKI DER) and the extension ID. */
export function keyAndIdFromPem(pemPath) {
  const der = createPublicKey(readFileSync(pemPath)).export({ type: 'spki', format: 'der' });
  return { key: der.toString('base64'), id: extensionIdFromDer(der) };
}

// CLI only when executed directly (check-manifest.mjs imports this module without side effects).
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const pemPath = process.argv[2];
  if (!pemPath) {
    console.error('usage: node scripts/extension-id.mjs <private-key.pem>');
    process.exit(2);
  }
  const { key, id } = keyAndIdFromPem(pemPath);
  console.log(`key=${key}`);
  console.log(`id=${id}`);
}
