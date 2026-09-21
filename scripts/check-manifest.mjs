// Asserts .output/chrome-mv3/manifest.json matches spec §4 and prints the extension ID.
// Usage: pnpm build && pnpm check:manifest
import { readFileSync } from 'node:fs';
import { extensionIdFromDer } from './extension-id.mjs';

const EXPECTED = {
  manifest_version: 3,
  minimum_chrome_version: '144',
  permissions: ['activeTab', 'scripting', 'storage', 'contextMenus', 'unlimitedStorage'],
  host_permissions: ['http://127.0.0.1:11434/*', 'http://localhost:11434/*'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  commands: ['translate-page', 'toggle-original', 'translate-selection'],
};

const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
const problems = [];
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

if (manifest.manifest_version !== EXPECTED.manifest_version) problems.push('manifest_version');
if (manifest.minimum_chrome_version !== EXPECTED.minimum_chrome_version) problems.push('minimum_chrome_version');
if (!same(manifest.permissions ?? [], EXPECTED.permissions)) problems.push(`permissions: ${JSON.stringify(manifest.permissions)}`);
if (!same(manifest.host_permissions ?? [], EXPECTED.host_permissions)) problems.push(`host_permissions: ${JSON.stringify(manifest.host_permissions)}`);
if (!same(manifest.optional_host_permissions ?? [], EXPECTED.optional_host_permissions)) problems.push('optional_host_permissions');
if (!same(Object.keys(manifest.commands ?? {}), EXPECTED.commands)) problems.push('commands');
if (manifest.content_scripts) problems.push('content_scripts must not exist in M0');
if (typeof manifest.key !== 'string' || manifest.key.length < 300) problems.push('key missing');

if (problems.length > 0) {
  console.error('manifest differs from spec §4:\n - ' + problems.join('\n - '));
  process.exit(1);
}
const id = extensionIdFromDer(Buffer.from(manifest.key, 'base64'));
console.log(`manifest OK · extension id = ${id}`);
