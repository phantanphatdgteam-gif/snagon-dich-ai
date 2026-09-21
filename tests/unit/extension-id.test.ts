import { describe, expect, it } from 'vitest';
// @ts-expect-error scripts/*.mjs ships no declarations and tsconfig keeps allowJs off, so TS7016.
import { extensionIdFromDer as untypedExtensionIdFromDer } from '../../scripts/extension-id.mjs';

const extensionIdFromDer: (der: Uint8Array) => string = untypedExtensionIdFromDer;

// Same base64 SPKI DER as `EXTENSION_PUBLIC_KEY` in wxt.config.ts, pasted rather than read from
// .output/chrome-mv3/manifest.json: that file is gitignored and only exists after `pnpm build`,
// while CI runs `pnpm test` before `pnpm build`. A pasted constant keeps this a hermetic
// known-answer vector.
const PUBLIC_KEY_BASE64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3YL/z6V7tvv3Q1L8WQFeLsun35wpahccXeEMLrARLxJ1pdr8H10z0xFjz/x45GGM84b4oFELdpX4KuYDdbzjJzzQDuWXQ0RbH7Q8N+tRb2lStM3hBOaqNCTIqF47Z6anYJ5acz0cRULi8LZxXOQjEt0lN81EUA6L7Bbj2iOOrzj4b4nxaUjMErlxkUSFxAXTFsVnXVTyFCdPNmrGiEI/biZftFATQadCEtp9/WF74wj/rg5fOu+Ng8IgIQWYVNXMo3sbLzp6Fl4Kz4qS5VanI039wfJf6PUOf8J2jCDQllQcxAUL6kITn0MVEDVoB8z7aGVh5wdEvS3hnnvbsaA3VQIDAQAB';

/** The ID whitelisted in OLLAMA_ORIGINS; a wrong ID means a silent 403 from Ollama. */
const EXPECTED_ID = 'afdehlbopanflojemfiplepnfccgafge';

const DER = Buffer.from(PUBLIC_KEY_BASE64, 'base64');

describe('extensionIdFromDer', () => {
  it('derives the committed extension ID from the committed public key', () => {
    expect(extensionIdFromDer(DER)).toBe(EXPECTED_ID);
  });

  it('always returns 32 characters from the a-p alphabet', () => {
    const inputs = [DER, Buffer.alloc(0), ...Array.from({ length: 32 }, (_, i) => Buffer.of(i))];
    for (const input of inputs) {
      const id = extensionIdFromDer(input);
      expect(id).toHaveLength(32);
      expect(id).toMatch(/^[a-p]{32}$/);
    }
  });

  it('changes the ID when a single DER byte changes', () => {
    for (const index of [0, DER.length - 1]) {
      const mutated = Buffer.from(DER);
      mutated[index] = (mutated[index] ?? 0) ^ 0x01;
      expect(extensionIdFromDer(mutated)).not.toBe(EXPECTED_ID);
    }
  });
});
