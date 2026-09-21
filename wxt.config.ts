import { defineConfig } from 'wxt';

// Public key (base64 SPKI DER). It pins the extension ID so OLLAMA_ORIGINS can be scoped to one ID.
// The private key lives outside the repo at ~/.config/snagon-dich-ai/snagon-dich-ai.pem (never commit *.pem).
const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3YL/z6V7tvv3Q1L8WQFeLsun35wpahccXeEMLrARLxJ1pdr8H10z0xFjz/x45GGM84b4oFELdpX4KuYDdbzjJzzQDuWXQ0RbH7Q8N+tRb2lStM3hBOaqNCTIqF47Z6anYJ5acz0cRULi8LZxXOQjEt0lN81EUA6L7Bbj2iOOrzj4b4nxaUjMErlxkUSFxAXTFsVnXVTyFCdPNmrGiEI/biZftFATQadCEtp9/WF74wj/rg5fOu+Ng8IgIQWYVNXMo3sbLzp6Fl4Kz4qS5VanI039wfJf6PUOf8J2jCDQllQcxAUL6kITn0MVEDVoB8z7aGVh5wdEvS3hnnvbsaA3VQIDAQAB';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Snagon - Dịch AI',
    short_name: 'Snagon Dịch',
    minimum_chrome_version: '144',
    key: EXTENSION_PUBLIC_KEY,
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus', 'unlimitedStorage'],
    host_permissions: ['http://127.0.0.1:11434/*', 'http://localhost:11434/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'translate-page': {
        suggested_key: { default: 'Alt+T' },
        description: 'Dịch / khôi phục trang',
      },
      'toggle-original': {
        suggested_key: { default: 'Alt+H' },
        description: 'Đảo gốc / dịch',
      },
      'translate-selection': {
        suggested_key: { default: 'Alt+S' },
        description: 'Dịch vùng chọn',
      },
    },
  },
});
