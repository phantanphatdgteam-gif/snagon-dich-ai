# M0 Connection Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the MV3 extension ↔ Ollama path end to end (service worker → `POST /api/chat` stream, both prompt profiles) and replace the spec's estimated numbers and open assumptions with measurements.

**Architecture:** WXT (MV3) project. `src/lib` is pure TypeScript — provider (the only place with `fetch`), prompt builders, error codes, message types — unit-tested in Node with a stubbed `fetch`. The service worker is the only Ollama client and streams `seg.*` messages over a long-lived Port; the popup is the M0 client and speaks the real job protocol that the M1 content script will reuse. `bench/measure.ts` imports the same provider, so measured numbers are the extension's real requests.

**Tech Stack:** TypeScript 5.x (`strict`, `erasableSyntaxOnly`), WXT 0.21, Vitest 5, ESLint 10 + typescript-eslint + eslint-plugin-no-unsanitized, Prettier, pnpm 11.22 via corepack, Node 24 (runs `.ts` directly), Ollama 0.34.2.

**Spec:** `docs/superpowers/specs/2026-09-21-m0-connection-spike-design.md` (approved 2026-09-21), which argues from `docs/spec/snagon-dich-ai-spec.md` §4, §6, §7, §8, §13. Read both before starting a task; when they disagree, the design wins for M0 and the disagreement is already listed in design §8.

## Global Constraints

- Work only in the worktree `.worktrees/feat/m0-connection-spike` on branch `feat/m0-connection-spike`. Never commit to `main`. Stop at the PR — Phát reviews and merges.
- `fetch` exists only in `src/lib/provider/**` (ESLint enforces it). No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function` anywhere. No `console.*` outside `src/lib/log.ts`, `bench/`, `scripts/`, `tests/`.
- Every `/api/chat` translate request: `stream: true`, `keep_alive: "10m"`, `options.seed: 42`, `options.num_ctx: 8192`, `options.num_predict = min(2048, 3 × tokensEst + 64)` (profile A) or `min(2048, 3 × Σ tokensEst + 128)` (profile B). Profile A = exactly one user message per spec §6.1 with two blank lines before the text, no `system`/`think`/`format`. Profile B = `system` §6.2 + user JSON, `think: false`, `format` = translations schema.
- Profile is picked by model name: `/^translategemma(?::|$)/i` → `translategemma`, otherwise `instruct-json`.
- Timeouts: TTFT 60 s, idle between chunks 20 s, total 150 s → `E_TIMEOUT`. Caller abort ends the stream silently. No retries in M0.
- Error codes (exactly these): `E_DOWN E_CORS E_MODEL E_BUSY E_OOM E_TIMEOUT E_TRUNC E_BADREQ E_PERM E_OUTPUT`.
- devDependencies allowed in M0: `wxt`, `typescript@5`, `vitest`, `eslint`, `typescript-eslint`, `eslint-plugin-no-unsanitized`, `prettier`, `@types/node`. Nothing else without asking Phát.
- Manifest = spec §4 verbatim: `permissions: ["activeTab","scripting","storage","contextMenus","unlimitedStorage"]`, `host_permissions: ["http://127.0.0.1:11434/*","http://localhost:11434/*"]`, `optional_host_permissions: ["http://*/*","https://*/*"]`, `minimum_chrome_version: "144"`, `key`, three `commands`. Do not add or remove anything.
- Identifiers, comments, commit messages in English. Vietnamese UI strings only in `src/locales/vi.ts`.
- Relative imports inside the repo carry the `.ts` extension. Types are imported with `import type`. No enums, namespaces, parameter properties, or `const enum` (`erasableSyntaxOnly`).
- pnpm only. First install creates the lockfile; afterwards `pnpm install --frozen-lockfile`. Never edit `pnpm-lock.yaml` by hand.
- Never run `ollama pull`, `launchctl`, or touch `~/.ollama`; print the command for Phát instead. Never run the live bench (`SNAGON_LIVE=1`) without Phát's explicit go-ahead in the conversation.
- Commits: Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`), small, one per task or per TDD step group. Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gate for every task: `pnpm typecheck && pnpm lint && pnpm test` green (single file: `pnpm test -- tests/unit/<name>.test.ts`). Tasks that touch entrypoints also need `pnpm build`.

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json`, `.nvmrc`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore` | Toolchain (Task 1) |
| `wxt.config.ts` | Manifest §4 + `srcDir` (Task 1, completed in Task 2) |
| `scripts/extension-id.mjs`, `scripts/check-manifest.mjs` | Derive `key`/ID from the private key; assert the built manifest equals §4 (Task 2) |
| `src/lib/lang/codes.ts` | `SourceLang`, names used in prompts (Task 3) |
| `src/lib/tokens.ts` | `tokensEst`, `numPredict` (Task 3) |
| `src/lib/errors.ts` | `ErrorCode`, `SnagonError`, HTTP/fetch error mapping (Task 4) |
| `src/lib/provider/ndjson.ts` | NDJSON line parser over a `ReadableStream` (Task 5) |
| `src/lib/prompt/profile.ts`, `translategemma.ts`, `instruct-json.ts`, `index.ts` | Profile pick, template A, system prompt/schema B, `buildChatRequest` (Task 6) |
| `src/lib/provider/types.ts`, `src/lib/provider/ollama.ts` | `TranslateProvider` interface and the only `fetch` (Tasks 7, 8) |
| `src/lib/messages.ts` | Message types + type guards for Port and popup channels (Task 9) |
| `src/lib/log.ts`, `src/lib/samples.ts`, `src/locales/vi.ts` | Logger, fixed sample texts, Vietnamese strings (Task 9) |
| `src/entrypoints/background.ts` | Service worker: popup requests, job Port, provider calls (Task 10) |
| `src/entrypoints/popup/index.html`, `main.ts`, `style.css` | Popup UI, M0 client (Task 11) |
| `bench/lib.ts`, `bench/measure.ts`, `bench/results/` | Bench helpers (tested), live measurement + probes (Task 12) |
| `.github/workflows/ci.yml`, `README.md` | CI, load/verify instructions (Task 13) |
| `tests/unit/*.test.ts` | One test file per lib module (Tasks 3–9, 12) |

Dependency direction: `lang/codes` ← `tokens` ← `prompt/*` ← `provider/ollama` ← `background` / `bench`. `errors` and `provider/ndjson` are leaves. `messages` depends on `lang/codes`, `errors`, `prompt/profile`, `provider/types` (types only).

---

### Task 1: Scaffold WXT project and toolchain

**Files:**
- Create: `package.json`, `.nvmrc`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `wxt.config.ts`
- Create: `src/entrypoints/background.ts`, `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`, `src/entrypoints/popup/style.css`

**Interfaces:**
- Produces: scripts `pnpm dev|build|zip|typecheck|lint|format|test|bench`; tsconfig rules every later task relies on (`.ts` import extensions, `erasableSyntaxOnly`, `verbatimModuleSyntax`); ESLint rules that fail the build if `fetch` appears outside `src/lib/provider/`.

- [ ] **Step 1: Write `package.json`, `.nvmrc`, `.prettierrc`, `.prettierignore`**

`package.json`:

```json
{
  "name": "snagon-dich-ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Chrome MV3 extension: dịch trang EN/RU/ZH/TH → VI bằng Ollama local",
  "packageManager": "pnpm@11.22.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "bench": "node bench/measure.ts",
    "check:manifest": "node scripts/check-manifest.mjs"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  }
}
```

`.nvmrc`:

```
24
```

`.prettierrc`:

```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`.prettierignore`:

```
node_modules
.output
.wxt
.worktrees
pnpm-lock.yaml
bench/results
```

- [ ] **Step 2: Write `wxt.config.ts` (minimal; Task 2 completes the manifest)**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Snagon - Dịch AI',
    short_name: 'Snagon Dịch',
  },
});
```

- [ ] **Step 3: Write minimal entrypoints so `wxt prepare`/`wxt build` have something to build**

`src/entrypoints/background.ts`:

```ts
import { defineBackground } from '#imports';

export default defineBackground({
  type: 'module',
  main() {
    // Filled in Task 10.
  },
});
```

`src/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>Snagon - Dịch AI</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.ts`:

```ts
// Filled in Task 11.
export {};
```

`src/entrypoints/popup/style.css`:

```css
body {
  margin: 0;
  min-width: 360px;
  font: 13px/1.4 system-ui, sans-serif;
}
```

- [ ] **Step 4: Install dependencies**

Run (from the worktree root):

```bash
pnpm add -D wxt typescript@5 vitest eslint typescript-eslint eslint-plugin-no-unsanitized prettier @types/node
```

Expected: `pnpm-lock.yaml` created, `postinstall` runs `wxt prepare` and creates `.wxt/` (gitignored). If pnpm prints `Ignored build scripts:` naming a package other than `esbuild`, add that package to `pnpm.onlyBuiltDependencies` in `package.json` and run `pnpm install` again. Check `pnpm ls --depth 0` shows `typescript 5.x` (not 7).

- [ ] **Step 5: Write `tsconfig.json` and `vitest.config.ts`**

`tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true
  },
  "include": [
    ".wxt/wxt.d.ts",
    "src/**/*",
    "bench/**/*",
    "tests/**/*",
    "wxt.config.ts",
    "vitest.config.ts"
  ]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 6: Write `eslint.config.js`**

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const FETCH_MESSAGE = 'fetch is only allowed in src/lib/provider/ (CLAUDE.md §4)';

export default defineConfig([
  globalIgnores(['node_modules/', '.output/', '.wxt/', '.worktrees/', 'bench/results/']),
  tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    plugins: { nounsanitized },
    rules: {
      'nounsanitized/method': 'error',
      'nounsanitized/property': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': 'error',
      'no-restricted-globals': ['error', { name: 'fetch', message: FETCH_MESSAGE }],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'fetch', message: FETCH_MESSAGE },
        { object: 'window', property: 'fetch', message: FETCH_MESSAGE },
        { object: 'self', property: 'fetch', message: FETCH_MESSAGE },
      ],
    },
  },
  {
    files: ['src/lib/provider/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/lib/log.ts', 'bench/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
]);
```

- [ ] **Step 7: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected:
- `typecheck`: no output (exit 0).
- `lint`: no output (exit 0).
- `test`: `No test files found` … `passWithNoTests` → exit 0.
- `build`: `✔ Built extension` and `.output/chrome-mv3/manifest.json` exists with `"name": "Snagon - Dịch AI"`, `"background": { "service_worker": …, "type": "module" }`, `"action": { "default_popup": "popup.html" }`.

If `#imports` cannot be resolved by `tsc`, confirm `.wxt/tsconfig.json` exists (run `pnpm wxt prepare`), then re-run. Do not switch to global auto-imports. If a later task's `pnpm typecheck` reports `Cannot find name 'process'` (bench/scripts), add `"types": ["node"]` to `compilerOptions`; if that in turn hides the `chrome` types behind `wxt/browser`, use `"types": ["node", "chrome"]`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .nvmrc .prettierrc .prettierignore wxt.config.ts tsconfig.json vitest.config.ts eslint.config.js src/entrypoints
git commit -m "chore: scaffold WXT project with TypeScript, Vitest and ESLint gates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Fixed extension ID and manifest §4

**Files:**
- Create: `scripts/extension-id.mjs`, `scripts/check-manifest.mjs`
- Modify: `wxt.config.ts`

**Interfaces:**
- Produces: `manifest.key` (public key) committed in `wxt.config.ts`; the extension ID printed by `pnpm check:manifest`; the §4 permission surface frozen for every later milestone.

- [ ] **Step 1: Write `scripts/extension-id.mjs`**

```js
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
```

- [ ] **Step 2: Generate the private key once (outside the repo) and print key + ID**

```bash
mkdir -p ~/.config/snagon-dich-ai
[ -f ~/.config/snagon-dich-ai/snagon-dich-ai.pem ] || openssl genrsa -out ~/.config/snagon-dich-ai/snagon-dich-ai.pem 2048
node scripts/extension-id.mjs ~/.config/snagon-dich-ai/snagon-dich-ai.pem
```

Expected: two lines, `key=MIIBIjANBg…` (≈ 392 chars) and `id=` followed by 32 lowercase letters a–p. Copy both; the ID goes into the completion report so Phát can set `OLLAMA_ORIGINS`.

- [ ] **Step 3: Complete `wxt.config.ts` with manifest §4**

Replace the file with (paste the printed `key=` value into `EXTENSION_PUBLIC_KEY`):

```ts
import { defineConfig } from 'wxt';

// Public key (base64 SPKI DER). It pins the extension ID so OLLAMA_ORIGINS can be scoped to one ID.
// The private key lives outside the repo at ~/.config/snagon-dich-ai/snagon-dich-ai.pem (never commit *.pem).
const EXTENSION_PUBLIC_KEY = 'PASTE_KEY_HERE';

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
```

(Command descriptions are manifest metadata, not UI code, so they stay here rather than in `src/locales/vi.ts`.)

- [ ] **Step 4: Write `scripts/check-manifest.mjs` (the Output-Gate helper from spec §10)**

```js
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
```

- [ ] **Step 5: Build and check**

Run: `pnpm build && pnpm check:manifest`

Expected: `manifest OK · extension id = <32 letters>` and the ID equals the one printed in Step 2. Then run `git status --short` and confirm no `.pem` file is listed (the `.gitignore` rule `*.pem` covers it).

- [ ] **Step 6: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0.

```bash
git add wxt.config.ts scripts/extension-id.mjs scripts/check-manifest.mjs
git commit -m "feat: pin extension id with manifest key and freeze spec §4 manifest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Language codes and token estimates

**Files:**
- Create: `src/lib/lang/codes.ts`, `src/lib/tokens.ts`
- Test: `tests/unit/lang.test.ts`, `tests/unit/tokens.test.ts`

**Interfaces:**
- Produces: `type SourceLang = 'en' | 'ru' | 'zh-Hans' | 'zh-Hant' | 'th'`, `SOURCE_LANGS`, `SOURCE_LANG_NAME: Record<SourceLang, string>`, `isSourceLang(v: unknown): v is SourceLang`, `TARGET_LANG = 'vi'`; `tokensEst(text: string, lang: SourceLang): number`, `numPredict(tokensIn: number, extra: number): number`, `NUM_PREDICT_CAP = 2048`, `CHARS_PER_TOKEN`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lang.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SOURCE_LANGS, SOURCE_LANG_NAME, TARGET_LANG, isSourceLang } from '../../src/lib/lang/codes.ts';

describe('lang/codes', () => {
  it('lists the five source languages of spec §6.1 and targets vi', () => {
    expect([...SOURCE_LANGS]).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'th']);
    expect(TARGET_LANG).toBe('vi');
  });

  it('maps codes to the names used verbatim in the TranslateGemma template', () => {
    expect(SOURCE_LANG_NAME).toEqual({
      en: 'English',
      ru: 'Russian',
      'zh-Hans': 'Chinese',
      'zh-Hant': 'Chinese',
      th: 'Thai',
    });
  });

  it('guards unknown values', () => {
    expect(isSourceLang('ru')).toBe(true);
    expect(isSourceLang('zh')).toBe(false);
    expect(isSourceLang(42)).toBe(false);
  });
});
```

`tests/unit/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NUM_PREDICT_CAP, numPredict, tokensEst } from '../../src/lib/tokens.ts';

describe('tokensEst', () => {
  it('uses chars/3.5 for English, rounding up', () => {
    expect(tokensEst('a'.repeat(35), 'en')).toBe(10);
    expect(tokensEst('a'.repeat(36), 'en')).toBe(11);
  });

  it('uses chars/2.5 for Russian and Thai', () => {
    expect(tokensEst('б'.repeat(25), 'ru')).toBe(10);
    expect(tokensEst('ก'.repeat(25), 'th')).toBe(10);
  });

  it('uses chars/1.3 for both Chinese scripts', () => {
    expect(tokensEst('中'.repeat(4), 'zh-Hans')).toBe(4); // 3.08 → 4
    expect(tokensEst('中'.repeat(3), 'zh-Hant')).toBe(3); // 2.31 → 3
  });

  it('never returns less than 1', () => {
    expect(tokensEst('', 'en')).toBe(1);
  });
});

describe('numPredict', () => {
  it('is 3 × input tokens + the profile constant', () => {
    expect(numPredict(100, 64)).toBe(364);
    expect(numPredict(100, 128)).toBe(428);
  });

  it('caps at 2048 (spec §7.3)', () => {
    expect(NUM_PREDICT_CAP).toBe(2048);
    expect(numPredict(1000, 128)).toBe(2048);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/lang.test.ts tests/unit/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/lang/codes.ts"` (module not found).

- [ ] **Step 3: Write the implementation**

`src/lib/lang/codes.ts`:

```ts
export const SOURCE_LANGS = ['en', 'ru', 'zh-Hans', 'zh-Hant', 'th'] as const;
export type SourceLang = (typeof SOURCE_LANGS)[number];

export const TARGET_LANG = 'vi';
export type TargetLang = typeof TARGET_LANG;

/** Language names used verbatim in the prompt templates (spec §6.1). */
export const SOURCE_LANG_NAME: Record<SourceLang, string> = {
  en: 'English',
  ru: 'Russian',
  'zh-Hans': 'Chinese',
  'zh-Hant': 'Chinese',
  th: 'Thai',
};

export function isSourceLang(value: unknown): value is SourceLang {
  return typeof value === 'string' && (SOURCE_LANGS as readonly string[]).includes(value);
}
```

`src/lib/tokens.ts`:

```ts
import type { SourceLang } from './lang/codes.ts';

/** Static chars-per-token ratios from spec §5.4. `th` is an assumption until the M0 bench calibrates it (LEDGER). */
export const CHARS_PER_TOKEN: Record<SourceLang, number> = {
  en: 3.5,
  ru: 2.5,
  'zh-Hans': 1.3,
  'zh-Hant': 1.3,
  th: 2.5,
};

/** Hard ceiling for `num_predict` on every request (spec §7.3), so no request can approach the 5-minute SW limit. */
export const NUM_PREDICT_CAP = 2048;

export function tokensEst(text: string, lang: SourceLang): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN[lang]));
}

/** Output budget per request: 3 × input tokens + a per-profile constant, capped (spec §6.1/§6.2/§7.3). */
export function numPredict(tokensIn: number, extra: number): number {
  return Math.min(NUM_PREDICT_CAP, 3 * tokensIn + extra);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/lang.test.ts tests/unit/tokens.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/lang/codes.ts src/lib/tokens.ts tests/unit/lang.test.ts tests/unit/tokens.test.ts
git commit -m "feat: add source language codes and token estimates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Error codes and HTTP/fetch error mapping

**Files:**
- Create: `src/lib/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces: `ERROR_CODES`, `type ErrorCode`, `isErrorCode(v)`, `class SnagonError extends Error { code: ErrorCode; detail: string | undefined }`, `isSnagonError(v)`, `isAbortError(v): boolean`, `mapHttpError(status: number, body: string): SnagonError`, `mapFetchError(error: unknown): Error`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  SnagonError,
  isAbortError,
  isErrorCode,
  isSnagonError,
  mapFetchError,
  mapHttpError,
} from '../../src/lib/errors.ts';

describe('error codes', () => {
  it('has exactly the nine codes of spec §7.5 plus E_OUTPUT', () => {
    expect([...ERROR_CODES]).toEqual([
      'E_DOWN',
      'E_CORS',
      'E_MODEL',
      'E_BUSY',
      'E_OOM',
      'E_TIMEOUT',
      'E_TRUNC',
      'E_BADREQ',
      'E_PERM',
      'E_OUTPUT',
    ]);
    expect(isErrorCode('E_CORS')).toBe(true);
    expect(isErrorCode('E_NOPE')).toBe(false);
  });

  it('SnagonError carries code, message and detail', () => {
    const err = new SnagonError('E_TRUNC', 'cut by num_predict', 'done_reason=length');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SnagonError');
    expect(err.code).toBe('E_TRUNC');
    expect(err.message).toBe('cut by num_predict');
    expect(err.detail).toBe('done_reason=length');
    expect(new SnagonError('E_DOWN').message).toBe('E_DOWN');
    expect(isSnagonError(err)).toBe(true);
    expect(isSnagonError(new Error('x'))).toBe(false);
  });
});

describe('mapHttpError (spec §7.5)', () => {
  it.each([
    [403, '', 'E_CORS'],
    [404, '{"error":"model \'x\' not found"}', 'E_MODEL'],
    [503, '', 'E_BUSY'],
    [500, '{"error":"model requires more system memory"}', 'E_OOM'],
    [500, '{"error":"boom"}', 'E_BADREQ'],
    [400, '{"error":"does not support thinking"}', 'E_BADREQ'],
    [418, '', 'E_BADREQ'],
  ])('maps HTTP %i with body %j to %s', (status, body, code) => {
    const err = mapHttpError(status, body);
    expect(err).toBeInstanceOf(SnagonError);
    expect(err.code).toBe(code);
    expect(err.detail).toBe(body);
  });

  it('truncates detail to 500 chars', () => {
    expect(mapHttpError(503, 'x'.repeat(900)).detail).toHaveLength(500);
  });
});

describe('mapFetchError', () => {
  it('maps a fetch TypeError (connection refused) to E_DOWN', () => {
    const err = mapFetchError(new TypeError('fetch failed'));
    expect(isSnagonError(err) && err.code).toBe('E_DOWN');
  });

  it('passes AbortError and SnagonError through unchanged', () => {
    const abort = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(mapFetchError(abort)).toBe(abort);
    const own = new SnagonError('E_TRUNC');
    expect(mapFetchError(own)).toBe(own);
  });

  it('wraps non-Error values', () => {
    expect(mapFetchError('boom')).toBeInstanceOf(Error);
    expect(mapFetchError('boom').message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/errors.test.ts`
Expected: FAIL — module `../../src/lib/errors.ts` not found.

- [ ] **Step 3: Write the implementation**

`src/lib/errors.ts`:

```ts
export const ERROR_CODES = [
  'E_DOWN',
  'E_CORS',
  'E_MODEL',
  'E_BUSY',
  'E_OOM',
  'E_TIMEOUT',
  'E_TRUNC',
  'E_BADREQ',
  'E_PERM',
  'E_OUTPUT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Every provider/protocol failure is one of these. `message` is for logs (English);
 * `detail` is raw context (HTTP body, timeout kind); user-facing text lives in src/locales/vi.ts.
 */
export class SnagonError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? code);
    this.name = 'SnagonError';
    this.code = code;
    this.detail = detail;
  }
}

export function isSnagonError(value: unknown): value is SnagonError {
  return value instanceof SnagonError;
}

/** fetch() rejects with a DOMException named AbortError when its signal aborts (browser and Node). */
export function isAbortError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'AbortError';
}

/** Spec §7.5: HTTP status → error code. `body` is the response text; its first 500 chars become `detail`. */
export function mapHttpError(status: number, body: string): SnagonError {
  const detail = body.slice(0, 500);
  if (status === 403) return new SnagonError('E_CORS', 'Ollama rejected the extension origin (HTTP 403)', detail);
  if (status === 404) return new SnagonError('E_MODEL', 'model not found (HTTP 404)', detail);
  if (status === 503) return new SnagonError('E_BUSY', 'Ollama is busy (HTTP 503)', detail);
  if (status === 500 && /memory/i.test(body)) {
    return new SnagonError('E_OOM', 'Ollama ran out of memory (HTTP 500)', detail);
  }
  if (status === 400) return new SnagonError('E_BADREQ', 'Ollama rejected the request (HTTP 400)', detail);
  return new SnagonError('E_BADREQ', `unexpected HTTP ${status}`, detail);
}

/** Network-level failures: a TypeError from fetch means connection refused → E_DOWN. Abort and SnagonError pass through. */
export function mapFetchError(error: unknown): Error {
  if (error instanceof SnagonError) return error;
  if (isAbortError(error)) return error as Error;
  if (error instanceof TypeError) {
    return new SnagonError('E_DOWN', 'cannot reach Ollama (connection refused)', error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/errors.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/errors.ts tests/unit/errors.test.ts
git commit -m "feat: add E_* error codes and HTTP/fetch error mapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: NDJSON stream parser

**Files:**
- Create: `src/lib/provider/ndjson.ts`
- Test: `tests/unit/ndjson.test.ts`

**Interfaces:**
- Consumes: `SnagonError` (Task 4).
- Produces: `parseNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void, undefined>` — one parsed JSON value per non-empty line; malformed line → `SnagonError('E_OUTPUT')`; releases the reader (and cancels the stream) when the consumer stops early.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ndjson.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import { parseNdjson } from '../../src/lib/provider/ndjson.ts';

function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const value of parseNdjson(stream)) out.push(value);
  return out;
}

describe('parseNdjson', () => {
  it('yields one value per line', async () => {
    expect(await collect(streamOf(['{"a":1}\n{"a":2}\n']))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('joins a line split across chunks', async () => {
    const chunks = ['{"mess', 'age":{"content":"xin"}}\n', '{"done":true}\n'];
    expect(await collect(streamOf(chunks))).toEqual([{ message: { content: 'xin' } }, { done: true }]);
  });

  it('accepts CRLF, blank lines and a last line without a newline', async () => {
    expect(await collect(streamOf(['{"a":1}\r\n\r\n{"a":2}']))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('does not break a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"t":"chào"}\n');
    const cut = 9; // between the two bytes of "à"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ t: 'chào' }]);
  });

  it('throws E_OUTPUT on a malformed line', async () => {
    await expect(collect(streamOf(['{"a":1}\nnot json\n']))).rejects.toMatchObject({ code: 'E_OUTPUT' });
    await expect(collect(streamOf(['{oops']))).rejects.toBeInstanceOf(SnagonError);
  });

  it('releases the stream when the consumer stops early', async () => {
    const stream = streamOf(['{"a":1}\n{"a":2}\n{"a":3}\n']);
    for await (const value of parseNdjson(stream)) {
      expect(value).toEqual({ a: 1 });
      break;
    }
    expect(stream.locked).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/ndjson.test.ts`
Expected: FAIL — module `../../src/lib/provider/ndjson.ts` not found.

- [ ] **Step 3: Write the implementation**

`src/lib/provider/ndjson.ts`:

```ts
import { SnagonError } from '../errors.ts';

/**
 * Parses an NDJSON byte stream (Ollama's `application/x-ndjson`) line by line.
 * Tolerates chunks that split a line or a multi-byte character, CRLF, blank lines,
 * and a final line without a trailing newline. A non-JSON line → SnagonError('E_OUTPUT').
 */
export async function* parseNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield parseLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) yield parseLine(rest);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new SnagonError('E_OUTPUT', 'malformed NDJSON line', line.slice(0, 200));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/ndjson.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/provider/ndjson.ts tests/unit/ndjson.test.ts
git commit -m "feat: add NDJSON stream parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Prompt profiles and `/api/chat` request builder

**Files:**
- Create: `src/lib/prompt/profile.ts`, `src/lib/prompt/translategemma.ts`, `src/lib/prompt/instruct-json.ts`, `src/lib/prompt/index.ts`
- Test: `tests/unit/prompt.test.ts`

**Interfaces:**
- Consumes: `SourceLang`, `SOURCE_LANG_NAME` (Task 3), `numPredict` (Task 3), `SnagonError` (Task 4).
- Produces:
  - `type Profile = 'translategemma' | 'instruct-json'`, `PROFILES`, `isProfile(v)`, `pickProfile(modelName: string): Profile`
  - `buildTranslateGemmaPrompt(src: SourceLang, text: string): string`
  - `buildInstructJsonSystem(src: SourceLang, glossaryLines?: readonly string[]): string`, `buildInstructJsonUser(src, context, segments): string`, `TRANSLATIONS_SCHEMA`, `parseTranslations(content: string): Translation[]` (throws `SnagonError('E_OUTPUT')`)
  - `PROMPT_VERSION = 1`, `NUM_CTX = 8192`, `KEEP_ALIVE = '10m'`, `SEED = 42`
  - `interface PromptSegment { id: string; text: string; tokensEst: number }`, `interface PromptBatch { model: string; profile: Profile; src: SourceLang; segments: readonly PromptSegment[]; context: { title: string; domain: string } }`
  - `interface ChatRequest { model; messages; stream: true; keep_alive; think?: false; format?; options: ChatOptions }`, `buildChatRequest(batch: PromptBatch): ChatRequest`

- [ ] **Step 1: Write the failing tests**

`tests/unit/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import {
  KEEP_ALIVE,
  NUM_CTX,
  PROMPT_VERSION,
  buildChatRequest,
  type PromptBatch,
} from '../../src/lib/prompt/index.ts';
import {
  TRANSLATIONS_SCHEMA,
  buildInstructJsonSystem,
  parseTranslations,
} from '../../src/lib/prompt/instruct-json.ts';
import { isProfile, pickProfile } from '../../src/lib/prompt/profile.ts';
import { buildTranslateGemmaPrompt } from '../../src/lib/prompt/translategemma.ts';

const EXPECTED_A_RU =
  'You are a professional Russian (ru) to Vietnamese (vi) translator. Your goal is to accurately convey the meaning and nuances of the original Russian text while adhering to Vietnamese grammar, vocabulary, and cultural sensitivities.\n' +
  'Produce only the Vietnamese translation, without any additional explanations or commentary. Please translate the following Russian text into Vietnamese:\n' +
  '\n' +
  '\n' +
  'Привет';

function batch(overrides: Partial<PromptBatch> = {}): PromptBatch {
  return {
    model: 'translategemma:12b',
    profile: 'translategemma',
    src: 'en',
    segments: [{ id: 's1', text: 'Hello <1>world</1>', tokensEst: 6 }],
    context: { title: 'Snagon test', domain: 'example.com' },
    ...overrides,
  };
}

function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof SnagonError ? error.code : `not a SnagonError: ${String(error)}`;
  }
}

describe('pickProfile (by model name — /api/show template is not distinctive)', () => {
  it.each([
    ['translategemma:12b', 'translategemma'],
    ['translategemma', 'translategemma'],
    ['TranslateGemma:27b', 'translategemma'],
    ['gemma4:26b', 'instruct-json'],
    ['qwen3.5:27b', 'instruct-json'],
    ['translategemma-custom:1b', 'instruct-json'],
  ])('%s → %s', (name, profile) => {
    expect(pickProfile(name)).toBe(profile);
  });

  it('guards profile values', () => {
    expect(isProfile('instruct-json')).toBe(true);
    expect(isProfile('A')).toBe(false);
  });
});

describe('profile A template (spec §6.1)', () => {
  it('is byte-exact, with two blank lines before the text', () => {
    expect(buildTranslateGemmaPrompt('ru', 'Привет')).toBe(EXPECTED_A_RU);
  });

  it.each([
    ['en', 'English (en)'],
    ['zh-Hans', 'Chinese (zh-Hans)'],
    ['zh-Hant', 'Chinese (zh-Hant)'],
    ['th', 'Thai (th)'],
  ] as const)('names %s as %s', (src, label) => {
    expect(buildTranslateGemmaPrompt(src, 'x')).toContain(
      `You are a professional ${label} to Vietnamese (vi) translator.`,
    );
  });
});

describe('buildChatRequest — profile A', () => {
  it('sends one user message, no system/think/format, and the §6.1 options', () => {
    const req = buildChatRequest(batch());
    expect(req.model).toBe('translategemma:12b');
    expect(req.messages).toEqual([
      { role: 'user', content: buildTranslateGemmaPrompt('en', 'Hello <1>world</1>') },
    ]);
    expect(req).not.toHaveProperty('think');
    expect(req).not.toHaveProperty('format');
    expect(req.stream).toBe(true);
    expect(req.keep_alive).toBe('10m');
    expect(req.options).toEqual({
      temperature: 0.2,
      top_p: 0.9,
      seed: 42,
      num_ctx: 8192,
      num_predict: 3 * 6 + 64,
    });
  });

  it('refuses more than one segment', () => {
    const two = [
      { id: 'a', text: 'a', tokensEst: 1 },
      { id: 'b', text: 'b', tokensEst: 1 },
    ];
    expect(() => buildChatRequest(batch({ segments: two }))).toThrow(/exactly one segment/);
  });
});

describe('buildChatRequest — profile B', () => {
  const two = batch({
    model: 'gemma4:26b',
    profile: 'instruct-json',
    src: 'ru',
    segments: [
      { id: 's1', text: 'Привет <1>мир</1>', tokensEst: 5 },
      { id: 's2', text: 'Пока', tokensEst: 2 },
    ],
  });

  it('sends system §6.2 + JSON user message, think:false, format schema and the §6.2 options', () => {
    const req = buildChatRequest(two);
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]).toEqual({ role: 'system', content: buildInstructJsonSystem('ru') });
    expect(req.messages[1]?.role).toBe('user');
    expect(JSON.parse(req.messages[1]?.content ?? '')).toEqual({
      source_lang: 'ru',
      context: { title: 'Snagon test', domain: 'example.com' },
      segments: [
        { id: 's1', text: 'Привет <1>мир</1>' },
        { id: 's2', text: 'Пока' },
      ],
    });
    expect(req.think).toBe(false);
    expect(req.format).toBe(TRANSLATIONS_SCHEMA);
    expect(req.stream).toBe(true);
    expect(req.keep_alive).toBe('10m');
    expect(req.options).toEqual({
      temperature: 0.3,
      top_p: 0.95,
      top_k: 64,
      seed: 42,
      num_ctx: 8192,
      num_predict: 3 * 7 + 128,
    });
  });

  it('system prompt names the source language and carries the six rules verbatim', () => {
    const system = buildInstructJsonSystem('zh-Hans');
    expect(
      system.startsWith(
        'You translate web page text from Chinese into natural, fluent Vietnamese for a Vietnamese professional reader.\nRules:\n1. Translate meaning, not word by word.',
      ),
    ).toBe(true);
    expect(system).toContain(
      '3. Keep every placeholder tag exactly as given (<1>...</1>, <2/>). Never add, drop, reorder or re-nest them.',
    );
    expect(
      system.endsWith(
        '6. Return ONLY JSON matching the schema {"translations":[{"id":"...","text":"..."}]}: one item per input id, same ids, same order.',
      ),
    ).toBe(true);
    expect(buildInstructJsonSystem('en', ['Glossary: foo = bar'])).toMatch(/\nGlossary: foo = bar$/);
  });

  it('caps num_predict at 2048 and always pins num_ctx 8192', () => {
    const req = buildChatRequest(
      batch({ profile: 'instruct-json', segments: [{ id: 's1', text: 'x', tokensEst: 900 }] }),
    );
    expect(req.options.num_predict).toBe(2048);
    expect(req.options.num_ctx).toBe(NUM_CTX);
    expect(NUM_CTX).toBe(8192);
    expect(KEEP_ALIVE).toBe('10m');
    expect(PROMPT_VERSION).toBe(1);
  });

  it('schema requires id and text and forbids extra properties', () => {
    expect(TRANSLATIONS_SCHEMA.required).toEqual(['translations']);
    expect(TRANSLATIONS_SCHEMA.properties.translations.items.required).toEqual(['id', 'text']);
    expect(TRANSLATIONS_SCHEMA.properties.translations.items.additionalProperties).toBe(false);
  });
});

describe('parseTranslations', () => {
  it('returns id/text pairs in order', () => {
    expect(
      parseTranslations('{"translations":[{"id":"s2","text":"Tạm biệt"},{"id":"s1","text":"Xin chào"}]}'),
    ).toEqual([
      { id: 's2', text: 'Tạm biệt' },
      { id: 's1', text: 'Xin chào' },
    ]);
  });

  it.each([
    'not json',
    '{"foo":1}',
    '{"translations":[{"id":1,"text":"x"}]}',
    '{"translations":[{"id":"s1"}]}',
  ])('rejects %s with E_OUTPUT', (content) => {
    expect(thrownCode(() => parseTranslations(content))).toBe('E_OUTPUT');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/prompt.test.ts`
Expected: FAIL — module `../../src/lib/prompt/index.ts` not found.

- [ ] **Step 3: Write `src/lib/prompt/profile.ts`**

```ts
export const PROFILES = ['translategemma', 'instruct-json'] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return typeof value === 'string' && (PROFILES as readonly string[]).includes(value);
}

/**
 * Spec §7.1 wanted to read the template from /api/show, but translategemma ships the plain
 * Gemma-3 chat template and gemma4 returns "{{ .Prompt }}" (checked 2026-09-21), so the model
 * name decides: translategemma* → profile A, everything else → profile B.
 */
export function pickProfile(modelName: string): Profile {
  return /^translategemma(?::|$)/i.test(modelName.trim()) ? 'translategemma' : 'instruct-json';
}
```

- [ ] **Step 4: Write `src/lib/prompt/translategemma.ts`**

```ts
import { SOURCE_LANG_NAME, type SourceLang } from '../lang/codes.ts';

/** Sampling options for profile A (spec §6.1). */
export const TRANSLATEGEMMA_OPTIONS = { temperature: 0.2, top_p: 0.9 } as const;
export const TRANSLATEGEMMA_NUM_PREDICT_EXTRA = 64;

/**
 * Template copied verbatim from spec §6.1 (the Ollama model card). The two blank lines
 * before the text are part of the contract — a wrong template degrades quality silently.
 */
export function buildTranslateGemmaPrompt(src: SourceLang, text: string): string {
  const name = SOURCE_LANG_NAME[src];
  return [
    `You are a professional ${name} (${src}) to Vietnamese (vi) translator. Your goal is to accurately convey the meaning and nuances of the original ${name} text while adhering to Vietnamese grammar, vocabulary, and cultural sensitivities.`,
    `Produce only the Vietnamese translation, without any additional explanations or commentary. Please translate the following ${name} text into Vietnamese:`,
    '',
    '',
    text,
  ].join('\n');
}
```

- [ ] **Step 5: Write `src/lib/prompt/instruct-json.ts`**

```ts
import { SnagonError } from '../errors.ts';
import { SOURCE_LANG_NAME, type SourceLang } from '../lang/codes.ts';

/** Sampling options for profile B (spec §6.2): deliberately below Gemma 4's general-purpose defaults. */
export const INSTRUCT_JSON_OPTIONS = { temperature: 0.3, top_p: 0.95, top_k: 64 } as const;
export const INSTRUCT_JSON_NUM_PREDICT_EXTRA = 128;

/** JSON schema sent as `format` (spec §7.3). Constrained decoding enforces the shape; ids are still checked by the caller. */
export const TRANSLATIONS_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
} as const;

/** System prompt from spec §6.2, verbatim. `glossaryLines` is the empty hook the spec keeps for later (no glossary in v1). */
export function buildInstructJsonSystem(src: SourceLang, glossaryLines: readonly string[] = []): string {
  const name = SOURCE_LANG_NAME[src];
  return [
    `You translate web page text from ${name} into natural, fluent Vietnamese for a Vietnamese professional reader.`,
    'Rules:',
    '1. Translate meaning, not word by word. Restructure sentences when Vietnamese grammar requires it: subject-verb-object order, active voice where natural, no dangling passive constructions.',
    '2. Translate everything, including technical, financial and e-commerce terminology, into the Vietnamese term a professional would use. Do not leave source-language words untranslated unless they are proper nouns, brand names, or code identifiers.',
    '3. Keep every placeholder tag exactly as given (<1>...</1>, <2/>). Never add, drop, reorder or re-nest them.',
    '4. Keep numbers, units, percentages, currency codes, URLs, emails, product codes and code identifiers unchanged.',
    '5. Register: neutral-formal, impersonal; never "bạn/mình". No explanations, notes, transliterations in brackets, or quotation marks around the output.',
    '6. Return ONLY JSON matching the schema {"translations":[{"id":"...","text":"..."}]}: one item per input id, same ids, same order.',
    ...glossaryLines,
  ].join('\n');
}

export interface InstructJsonContext {
  title: string;
  domain: string;
}

export interface InstructJsonSegment {
  id: string;
  text: string;
}

/** User message: JSON with the page context and the batch segments (spec §6.2). Page text is data, never instructions. */
export function buildInstructJsonUser(
  src: SourceLang,
  context: InstructJsonContext,
  segments: readonly InstructJsonSegment[],
): string {
  return JSON.stringify({
    source_lang: src,
    context: { title: context.title, domain: context.domain },
    segments: segments.map((segment) => ({ id: segment.id, text: segment.text })),
  });
}

export interface Translation {
  id: string;
  text: string;
}

/** Parses the model's JSON output. Anything that is not `{translations:[{id,text}]}` → E_OUTPUT. */
export function parseTranslations(content: string): Translation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SnagonError('E_OUTPUT', 'model output is not valid JSON', content.slice(0, 200));
  }
  const list = (parsed as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(list)) {
    throw new SnagonError('E_OUTPUT', 'model output has no translations array', content.slice(0, 200));
  }
  const translations: Translation[] = [];
  for (const item of list as unknown[]) {
    const id = (item as { id?: unknown } | null)?.id;
    const text = (item as { text?: unknown } | null)?.text;
    if (typeof id !== 'string' || typeof text !== 'string') {
      throw new SnagonError(
        'E_OUTPUT',
        'translation item must have string id and text',
        JSON.stringify(item).slice(0, 200),
      );
    }
    translations.push({ id, text });
  }
  return translations;
}
```

- [ ] **Step 6: Write `src/lib/prompt/index.ts`**

```ts
import type { SourceLang } from '../lang/codes.ts';
import { numPredict } from '../tokens.ts';
import {
  INSTRUCT_JSON_NUM_PREDICT_EXTRA,
  INSTRUCT_JSON_OPTIONS,
  TRANSLATIONS_SCHEMA,
  buildInstructJsonSystem,
  buildInstructJsonUser,
} from './instruct-json.ts';
import type { Profile } from './profile.ts';
import {
  TRANSLATEGEMMA_NUM_PREDICT_EXTRA,
  TRANSLATEGEMMA_OPTIONS,
  buildTranslateGemmaPrompt,
} from './translategemma.ts';

/** Part of the cache key from M1. Bump it whenever a template changes — and ask Phát first. */
export const PROMPT_VERSION = 1;
/** Fixed for every request of every model: changing it makes Ollama reload the model (spec §7.3). */
export const NUM_CTX = 8192;
export const KEEP_ALIVE = '10m';
export const SEED = 42;

export interface PromptSegment {
  id: string;
  text: string;
  tokensEst: number;
}

export interface PromptBatch {
  model: string;
  profile: Profile;
  src: SourceLang;
  segments: readonly PromptSegment[];
  context: { title: string; domain: string };
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatOptions {
  temperature: number;
  top_p: number;
  top_k?: number;
  seed: number;
  num_ctx: number;
  num_predict: number;
}

/** Body of `POST /api/chat` (spec §7.3). */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  keep_alive: string;
  think?: false;
  format?: typeof TRANSLATIONS_SCHEMA;
  options: ChatOptions;
}

/** Builds the exact `/api/chat` body for a batch. Profile A takes exactly one segment per request. */
export function buildChatRequest(batch: PromptBatch): ChatRequest {
  const tokensIn = batch.segments.reduce((sum, segment) => sum + segment.tokensEst, 0);

  if (batch.profile === 'translategemma') {
    const segment = batch.segments[0];
    if (!segment || batch.segments.length !== 1) {
      throw new Error('profile translategemma takes exactly one segment per request');
    }
    return {
      model: batch.model,
      messages: [{ role: 'user', content: buildTranslateGemmaPrompt(batch.src, segment.text) }],
      stream: true,
      keep_alive: KEEP_ALIVE,
      options: {
        ...TRANSLATEGEMMA_OPTIONS,
        seed: SEED,
        num_ctx: NUM_CTX,
        num_predict: numPredict(tokensIn, TRANSLATEGEMMA_NUM_PREDICT_EXTRA),
      },
    };
  }

  return {
    model: batch.model,
    messages: [
      { role: 'system', content: buildInstructJsonSystem(batch.src) },
      { role: 'user', content: buildInstructJsonUser(batch.src, batch.context, batch.segments) },
    ],
    stream: true,
    think: false,
    format: TRANSLATIONS_SCHEMA,
    keep_alive: KEEP_ALIVE,
    options: {
      ...INSTRUCT_JSON_OPTIONS,
      seed: SEED,
      num_ctx: NUM_CTX,
      num_predict: numPredict(tokensIn, INSTRUCT_JSON_NUM_PREDICT_EXTRA),
    },
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/prompt.test.ts`
Expected: PASS (23 tests). If the byte-exact test fails, diff the two strings character by character — the usual culprit is a missing blank line or a trailing space.

- [ ] **Step 8: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/prompt tests/unit/prompt.test.ts
git commit -m "feat: add prompt profiles A/B and /api/chat request builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Provider interface and Ollama status endpoints

**Files:**
- Create: `src/lib/provider/types.ts`, `src/lib/provider/ollama.ts`
- Test: `tests/unit/ollama.test.ts`

**Interfaces:**
- Consumes: `PromptBatch`, `PromptSegment`, `KEEP_ALIVE` (Task 6), `pickProfile`, `Profile` (Task 6), `mapHttpError`, `mapFetchError` (Task 4).
- Produces (`types.ts`): `type Segment = PromptSegment`, `interface TranslateBatch extends PromptBatch { tgt: 'vi' }`, `interface GenStats { ttftMs; totalMs; promptEvalCount; evalCount; evalDurationMs; doneReason }`, `type Chunk = {kind:'progress'; tokens; text?} | {kind:'segment'; id; text} | {kind:'done'; stats}`, `ModelInfo`, `ModelDetails`, `LoadedModel`, `interface TranslateProvider { version(); listModels(); describe(model); loaded(); warmUp(model, signal?); translate(batch, signal) }`.
- Produces (`ollama.ts`): `DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'`, `DEFAULT_TIMEOUTS`, `type FetchLike`, `createOllamaProvider({ baseUrl, fetch?, timeouts? }): TranslateProvider`. `translate` is a stub until Task 8.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ollama.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import {
  DEFAULT_OLLAMA_URL,
  DEFAULT_TIMEOUTS,
  createOllamaProvider,
  type FetchLike,
} from '../../src/lib/provider/ollama.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function providerWith(fetchFn: FetchLike) {
  return createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434/', fetch: fetchFn });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof SnagonError ? error.code : `not a SnagonError: ${String(error)}`;
  }
}

describe('createOllamaProvider — constants', () => {
  it('defaults to 127.0.0.1:11434 and spec §7.3 timeouts', () => {
    expect(DEFAULT_OLLAMA_URL).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_TIMEOUTS).toEqual({ ttftMs: 60_000, idleMs: 20_000, totalMs: 150_000 });
  });
});

describe('createOllamaProvider — status endpoints', () => {
  it('version() GETs /api/version (trailing slash of baseUrl is trimmed)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ version: '0.34.2' }));
    await expect(providerWith(fetchFn).version()).resolves.toBe('0.34.2');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('listModels() maps /api/tags to ModelInfo', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        models: [
          {
            name: 'translategemma:12b',
            model: 'translategemma:12b',
            size: 8_100_000_000,
            modified_at: '2026-09-21T15:49:41+07:00',
            details: { family: 'gemma3', context_length: 131072 },
          },
        ],
      }),
    );
    await expect(providerWith(fetchFn).listModels()).resolves.toEqual([
      {
        name: 'translategemma:12b',
        size: 8_100_000_000,
        family: 'gemma3',
        modifiedAt: '2026-09-21T15:49:41+07:00',
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.anything());
  });

  it('describe() POSTs /api/show and derives context length + profile', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        capabilities: ['completion', 'vision'],
        details: { family: 'gemma3' },
        model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 131072 },
        template: '{{ .Prompt }}',
      }),
    );
    await expect(providerWith(fetchFn).describe('translategemma:12b')).resolves.toEqual({
      name: 'translategemma:12b',
      family: 'gemma3',
      capabilities: ['completion', 'vision'],
      contextLength: 131072,
      profile: 'translategemma',
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:11434/api/show');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'translategemma:12b' });
  });

  it('describe() falls back to null context length and profile B for unknown shapes', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ capabilities: ['completion', 'thinking'] }));
    await expect(providerWith(fetchFn).describe('gemma4:26b')).resolves.toEqual({
      name: 'gemma4:26b',
      family: '',
      capabilities: ['completion', 'thinking'],
      contextLength: null,
      profile: 'instruct-json',
    });
  });

  it('loaded() maps /api/ps', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        models: [{ name: 'gemma4:26b', size_vram: 19_000_000_000, expires_at: '2026-09-21T18:00:00+07:00' }],
      }),
    );
    await expect(providerWith(fetchFn).loaded()).resolves.toEqual([
      { name: 'gemma4:26b', sizeVram: 19_000_000_000, until: '2026-09-21T18:00:00+07:00' },
    ]);
  });

  it('warmUp() POSTs /api/chat without messages, keep_alive 10m, stream false', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ done: true, done_reason: 'load' }));
    const signal = new AbortController().signal;
    await providerWith(fetchFn).warmUp('gemma4:26b', signal);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'gemma4:26b', keep_alive: '10m', stream: false });
    expect(init?.signal).toBe(signal);
  });
});

describe('createOllamaProvider — error mapping', () => {
  it.each([
    [403, { error: 'origin not allowed' }, 'E_CORS'],
    [404, { error: "model 'x' not found" }, 'E_MODEL'],
    [503, { error: 'server busy' }, 'E_BUSY'],
    [500, { error: 'model requires more system memory' }, 'E_OOM'],
    [400, { error: 'invalid' }, 'E_BADREQ'],
  ])('HTTP %i → %s', async (status, body, code) => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(body, status));
    expect(await codeOf(providerWith(fetchFn).version())).toBe(code);
  });

  it('connection refused (fetch TypeError) → E_DOWN', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await codeOf(providerWith(fetchFn).listModels())).toBe('E_DOWN');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/ollama.test.ts`
Expected: FAIL — module `../../src/lib/provider/ollama.ts` not found.

- [ ] **Step 3: Write `src/lib/provider/types.ts`**

```ts
import type { TargetLang } from '../lang/codes.ts';
import type { PromptBatch, PromptSegment } from '../prompt/index.ts';
import type { Profile } from '../prompt/profile.ts';

export type Segment = PromptSegment;

/** One request to the model: one segment (profile A) or up to 8 segments of the same source language (profile B). */
export interface TranslateBatch extends PromptBatch {
  tgt: TargetLang;
}

/** Numbers from Ollama's final `done: true` line plus client-side timings (spec §7.3). */
export interface GenStats {
  ttftMs: number;
  totalMs: number;
  promptEvalCount: number;
  evalCount: number;
  evalDurationMs: number;
  doneReason: string;
}

export type Chunk =
  /** Stream progress. `text` is the accumulated translation for profile A; profile B only counts tokens. */
  | { kind: 'progress'; tokens: number; text?: string }
  /** A finished segment. Never emitted for output cut by `num_predict` (`done_reason: "length"`). */
  | { kind: 'segment'; id: string; text: string }
  | { kind: 'done'; stats: GenStats };

export interface ModelInfo {
  name: string;
  size: number;
  family: string;
  modifiedAt: string;
}

export interface ModelDetails {
  name: string;
  family: string;
  capabilities: string[];
  contextLength: number | null;
  profile: Profile;
}

export interface LoadedModel {
  name: string;
  sizeVram: number;
  until: string;
}

/** Spec §15: the pipeline never knows which provider runs. Ollama is the only implementation in v1. */
export interface TranslateProvider {
  version(): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
  describe(model: string): Promise<ModelDetails>;
  loaded(): Promise<LoadedModel[]>;
  warmUp(model: string, signal?: AbortSignal): Promise<void>;
  translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk>;
}
```

- [ ] **Step 4: Write `src/lib/provider/ollama.ts` (status endpoints; `translate` stubbed)**

```ts
import { SnagonError, mapFetchError, mapHttpError } from '../errors.ts';
import { KEEP_ALIVE } from '../prompt/index.ts';
import { pickProfile } from '../prompt/profile.ts';
import type {
  Chunk,
  LoadedModel,
  ModelDetails,
  ModelInfo,
  TranslateBatch,
  TranslateProvider,
} from './types.ts';

/** The only default endpoint in the codebase (CLAUDE.md §4); the service worker overrides it from config. */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export interface Timeouts {
  ttftMs: number;
  idleMs: number;
  totalMs: number;
}

/** Spec §7.3: cold load + prompt eval may take up to 60 s; a stalled stream is dead after 20 s; nothing runs past 150 s. */
export const DEFAULT_TIMEOUTS: Timeouts = { ttftMs: 60_000, idleMs: 20_000, totalMs: 150_000 };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OllamaProviderOptions {
  baseUrl: string;
  /** Injected in unit tests; defaults to the global fetch. */
  fetch?: FetchLike;
  timeouts?: Partial<Timeouts>;
}

interface RawTag {
  name: string;
  size: number;
  modified_at: string;
  details?: { family?: string };
}

interface RawShow {
  capabilities?: string[];
  details?: { family?: string };
  model_info?: Record<string, unknown>;
}

interface RawPs {
  name: string;
  size_vram: number;
  expires_at: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function createOllamaProvider(options: OllamaProviderOptions): TranslateProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(baseUrl + path, init);
    } catch (error) {
      throw mapFetchError(error);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw mapHttpError(response.status, body);
    }
    return response;
  }

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await request(path, { method: 'GET', signal });
    return (await response.json()) as T;
  }

  async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
    });
    return (await response.json()) as T;
  }

  async function* translateStream(
    batch: TranslateBatch,
    signal: AbortSignal,
  ): AsyncGenerator<Chunk, void, undefined> {
    void batch;
    void signal;
    void timeouts;
    throw new SnagonError('E_OUTPUT', 'translate is implemented in Task 8');
  }

  return {
    async version(): Promise<string> {
      const data = await getJson<{ version: string }>('/api/version');
      return data.version;
    },

    async listModels(): Promise<ModelInfo[]> {
      const data = await getJson<{ models?: RawTag[] }>('/api/tags');
      return (data.models ?? []).map((model) => ({
        name: model.name,
        size: model.size,
        family: model.details?.family ?? '',
        modifiedAt: model.modified_at,
      }));
    },

    async describe(model: string): Promise<ModelDetails> {
      const data = await postJson<RawShow>('/api/show', { model });
      const info = data.model_info ?? {};
      const architecture = info['general.architecture'];
      const contextLength =
        typeof architecture === 'string' ? info[`${architecture}.context_length`] : undefined;
      return {
        name: model,
        family: data.details?.family ?? '',
        capabilities: data.capabilities ?? [],
        contextLength: typeof contextLength === 'number' ? contextLength : null,
        profile: pickProfile(model),
      };
    },

    async loaded(): Promise<LoadedModel[]> {
      const data = await getJson<{ models?: RawPs[] }>('/api/ps');
      return (data.models ?? []).map((model) => ({
        name: model.name,
        sizeVram: model.size_vram,
        until: model.expires_at,
      }));
    },

    async warmUp(model: string, signal?: AbortSignal): Promise<void> {
      // No `messages` → Ollama only loads the model and keeps it resident (spec §7.1).
      await postJson('/api/chat', { model, keep_alive: KEEP_ALIVE, stream: false }, signal);
    },

    translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk> {
      return translateStream(batch, signal);
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/ollama.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/provider/types.ts src/lib/provider/ollama.ts tests/unit/ollama.test.ts
git commit -m "feat: add TranslateProvider interface and Ollama status endpoints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Streaming `translate()` with timeouts and abort

**Files:**
- Modify: `src/lib/provider/ollama.ts` (replace the `translateStream` stub)
- Test: `tests/unit/ollama-translate.test.ts`

**Interfaces:**
- Consumes: `buildChatRequest` (Task 6), `parseTranslations` (Task 6), `parseNdjson` (Task 5), `isAbortError` (Task 4).
- Produces: `translate(batch, signal)` yields `progress*` → `segment*` → `done` exactly as `Chunk` documents; caller abort ends the generator silently; TTFT/idle/total timeouts throw `SnagonError('E_TIMEOUT')` with `detail` = `'ttft' | 'idle' | 'total'`; `done_reason: "length"` yields no `segment`; invalid profile-B JSON throws `E_OUTPUT`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ollama-translate.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import { createOllamaProvider, type FetchLike } from '../../src/lib/provider/ollama.ts';
import type { Chunk, TranslateBatch } from '../../src/lib/provider/types.ts';

interface FakeFetchOptions {
  /** Raw body pieces (may split a line). */
  pieces: string[];
  status?: number;
  /** Enqueue only this many pieces and keep the stream open (simulates a stall). */
  stallAfter?: number;
  /** Never resolve the fetch until the signal aborts (simulates no response at all). */
  hang?: boolean;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

/** A fetch stub that streams `pieces` and errors its body with AbortError when `init.signal` aborts. */
function fakeFetch(options: FakeFetchOptions): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ url, init });
      const signal = init?.signal;
      if (options.hang) {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        return;
      }
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          const limit = options.stallAfter ?? options.pieces.length;
          for (const piece of options.pieces.slice(0, limit)) controller.enqueue(encoder.encode(piece));
          if (limit >= options.pieces.length) controller.close();
        },
      });
      signal?.addEventListener(
        'abort',
        () => {
          try {
            streamController?.error(abortError());
          } catch {
            // stream already closed
          }
        },
        { once: true },
      );
      resolve(
        new Response(stream, {
          status: options.status ?? 200,
          headers: { 'content-type': 'application/x-ndjson' },
        }),
      );
    });
  return { fetch, calls };
}

function lines(objects: unknown[]): string {
  return objects.map((object) => JSON.stringify(object)).join('\n') + '\n';
}

const DONE = {
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 40,
  eval_count: 3,
  eval_duration: 100_000_000, // ns → 100 ms
};

function batchA(): TranslateBatch {
  return {
    model: 'translategemma:12b',
    profile: 'translategemma',
    src: 'en',
    tgt: 'vi',
    segments: [{ id: 's1', text: 'Hello world', tokensEst: 4 }],
    context: { title: 'Snagon test', domain: 'example.com' },
  };
}

function batchB(): TranslateBatch {
  return {
    ...batchA(),
    model: 'gemma4:26b',
    profile: 'instruct-json',
    segments: [
      { id: 's1', text: 'Hello', tokensEst: 2 },
      { id: 's2', text: 'Bye', tokensEst: 1 },
    ],
  };
}

async function collect(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof SnagonError ? `${error.code}:${error.detail ?? ''}` : `not a SnagonError: ${String(error)}`;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('translate — profile A', () => {
  it('streams progress with accumulated text, then the segment, then done with stats', async () => {
    const body = lines([
      { message: { role: 'assistant', content: 'Xin' } },
      { message: { role: 'assistant', content: ' chào' } },
      { message: { role: 'assistant', content: ' thế giới' } },
      { message: { role: 'assistant', content: '' }, ...DONE },
    ]);
    const { fetch, calls } = fakeFetch({ pieces: [body.slice(0, 20), body.slice(20)] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchA(), new AbortController().signal));

    expect(chunks.slice(0, 3)).toEqual([
      { kind: 'progress', tokens: 1, text: 'Xin' },
      { kind: 'progress', tokens: 2, text: 'Xin chào' },
      { kind: 'progress', tokens: 3, text: 'Xin chào thế giới' },
    ]);
    expect(chunks[3]).toEqual({ kind: 'segment', id: 's1', text: 'Xin chào thế giới' });
    const done = chunks[4];
    expect(done?.kind).toBe('done');
    if (done?.kind === 'done') {
      expect(done.stats).toMatchObject({ promptEvalCount: 40, evalCount: 3, evalDurationMs: 100, doneReason: 'stop' });
      expect(done.stats.ttftMs).toBeGreaterThanOrEqual(0);
      expect(done.stats.totalMs).toBeGreaterThanOrEqual(done.stats.ttftMs);
    }
    expect(chunks).toHaveLength(5);

    const request = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(request.model).toBe('translategemma:12b');
    expect(request.stream).toBe(true);
    expect(request.options.num_ctx).toBe(8192);
    expect(request.messages).toHaveLength(1);
  });

  it('yields no segment when the output was cut (done_reason length)', async () => {
    const body = lines([
      { message: { content: 'Xin' } },
      { message: { content: '' }, ...DONE, done_reason: 'length' },
    ]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchA(), new AbortController().signal));

    expect(chunks.map((chunk) => chunk.kind)).toEqual(['progress', 'done']);
    expect(chunks[1]).toMatchObject({ kind: 'done', stats: { doneReason: 'length' } });
  });
});

describe('translate — profile B', () => {
  it('counts tokens without text, then yields one segment per known id from the JSON', async () => {
    const json = '{"translations":[{"id":"s2","text":"Tạm biệt"},{"id":"s1","text":"Xin chào"},{"id":"s9","text":"?"}]}';
    const body = lines([
      { message: { content: json.slice(0, 30) } },
      { message: { content: json.slice(30) } },
      { message: { content: '' }, ...DONE },
    ]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchB(), new AbortController().signal));

    expect(chunks.slice(0, 2)).toEqual([
      { kind: 'progress', tokens: 1 },
      { kind: 'progress', tokens: 2 },
    ]);
    expect(chunks.slice(2, 4)).toEqual([
      { kind: 'segment', id: 's2', text: 'Tạm biệt' },
      { kind: 'segment', id: 's1', text: 'Xin chào' },
    ]);
    expect(chunks[4]?.kind).toBe('done');
    expect(chunks).toHaveLength(5);
  });

  it('rejects with E_OUTPUT when the JSON is malformed', async () => {
    const body = lines([{ message: { content: '{"translations":[' } }, { message: { content: '' }, ...DONE }]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    expect(await codeOf(collect(provider.translate(batchB(), new AbortController().signal)))).toMatch(/^E_OUTPUT:/);
  });
});

describe('translate — failures', () => {
  it('maps HTTP 403 before streaming to E_CORS', async () => {
    const { fetch } = fakeFetch({ pieces: ['{"error":"origin not allowed"}'], status: 403 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(await codeOf(collect(provider.translate(batchA(), new AbortController().signal)))).toBe(
      'E_CORS:{"error":"origin not allowed"}',
    );
  });

  it('maps an in-stream error line to E_OUTPUT', async () => {
    const { fetch } = fakeFetch({ pieces: [lines([{ error: 'something broke' }])] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(await codeOf(collect(provider.translate(batchA(), new AbortController().signal)))).toMatch(/^E_OUTPUT:/);
  });

  it('rejects with E_OUTPUT when the stream ends without a done line', async () => {
    const { fetch } = fakeFetch({ pieces: [lines([{ message: { content: 'Xin' } }])] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(await codeOf(collect(provider.translate(batchA(), new AbortController().signal)))).toMatch(/^E_OUTPUT:/);
  });

  it('ends silently when the caller aborts mid-stream, and aborts the underlying fetch', async () => {
    const body = lines([{ message: { content: 'Xin' } }, { message: { content: ' chào' } }]);
    const { fetch, calls } = fakeFetch({ pieces: [body], stallAfter: 1 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    const controller = new AbortController();

    const chunks: Chunk[] = [];
    for await (const chunk of provider.translate(batchA(), controller.signal)) {
      chunks.push(chunk);
      if (chunks.length === 2) controller.abort();
    }

    expect(chunks).toHaveLength(2);
    expect(calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it('returns nothing when the signal is already aborted', async () => {
    const { fetch, calls } = fakeFetch({ pieces: [] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    const controller = new AbortController();
    controller.abort();
    expect(await collect(provider.translate(batchA(), controller.signal))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('times out with E_TIMEOUT:ttft when no response arrives within 60 s', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ pieces: [], hang: true });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await pending).toBe('E_TIMEOUT:ttft');
  });

  it('times out with E_TIMEOUT:idle when the stream stalls for 20 s after the first chunk', async () => {
    vi.useFakeTimers();
    const body = lines([{ message: { content: 'Xin' } }, { message: { content: ' chào' } }]);
    const { fetch } = fakeFetch({ pieces: [body], stallAfter: 1 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await pending).toBe('E_TIMEOUT:idle');
  });

  it('honours custom timeouts (total)', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ pieces: [], hang: true });
    const provider = createOllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch,
      timeouts: { ttftMs: 5_000, totalMs: 1_000 },
    });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toBe('E_TIMEOUT:total');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/ollama-translate.test.ts`
Expected: FAIL — every test rejects with `E_OUTPUT: translate is implemented in Task 8` (the stub).

- [ ] **Step 3: Replace the `translateStream` stub in `src/lib/provider/ollama.ts`**

Add these imports at the top of the file (keep the existing ones):

```ts
import { isAbortError } from '../errors.ts';
import { buildChatRequest } from '../prompt/index.ts';
import { parseTranslations } from '../prompt/instruct-json.ts';
import { parseNdjson } from './ndjson.ts';
import type { GenStats } from './types.ts';
```

(`isAbortError` and `buildChatRequest` can be merged into the existing import lines from `../errors.ts` and `../prompt/index.ts`.) Add the raw line type next to the other `Raw*` interfaces:

```ts
interface RawChatLine {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

type TimeoutKind = 'ttft' | 'idle' | 'total';
```

Replace the stub with:

```ts
  async function* translateStream(
    batch: TranslateBatch,
    signal: AbortSignal,
  ): AsyncGenerator<Chunk, void, undefined> {
    if (signal.aborted) return;
    const body = buildChatRequest(batch);

    // One internal controller aborts the fetch for both reasons: caller cancel and timeouts.
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal.addEventListener('abort', abortFromCaller, { once: true });

    let timeoutKind: TimeoutKind | null = null;
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, kind: TimeoutKind) => {
      clearTimeout(phaseTimer);
      phaseTimer = setTimeout(() => {
        timeoutKind = kind;
        controller.abort();
      }, ms);
    };
    const totalTimer = setTimeout(() => {
      timeoutKind = 'total';
      controller.abort();
    }, timeouts.totalMs);

    const startedAt = performance.now();
    let ttftMs = -1;
    let content = '';
    let tokens = 0;
    let stats: GenStats | undefined;

    try {
      arm(timeouts.ttftMs, 'ttft');
      const response = await request('/api/chat', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.body) throw new SnagonError('E_OUTPUT', 'empty response body');

      for await (const raw of parseNdjson(response.body)) {
        const line = raw as RawChatLine;
        if (typeof line.error === 'string') {
          throw new SnagonError('E_OUTPUT', 'ollama reported an error mid-stream', line.error);
        }
        if (ttftMs < 0) ttftMs = performance.now() - startedAt;
        arm(timeouts.idleMs, 'idle');

        const piece = line.message?.content ?? '';
        if (piece) {
          content += piece;
          tokens += 1;
          yield batch.profile === 'translategemma'
            ? { kind: 'progress', tokens, text: content }
            : { kind: 'progress', tokens };
        }
        if (line.done) {
          stats = {
            ttftMs,
            totalMs: performance.now() - startedAt,
            promptEvalCount: line.prompt_eval_count ?? 0,
            evalCount: line.eval_count ?? 0,
            evalDurationMs: (line.eval_duration ?? 0) / 1_000_000,
            doneReason: line.done_reason ?? 'unknown',
          };
          break;
        }
      }
    } catch (error) {
      if (signal.aborted) return; // caller cancelled: not an error
      if (timeoutKind !== null) {
        throw new SnagonError('E_TIMEOUT', `no response within the ${timeoutKind} timeout`, timeoutKind);
      }
      if (isAbortError(error)) return; // consumer stopped iterating
      throw mapFetchError(error);
    } finally {
      clearTimeout(phaseTimer);
      clearTimeout(totalTimer);
      signal.removeEventListener('abort', abortFromCaller);
    }

    if (!stats) throw new SnagonError('E_OUTPUT', 'stream ended without a done line');

    // Output cut by num_predict is never a finished segment (spec §7.3); the caller maps it to E_TRUNC.
    if (stats.doneReason !== 'length') {
      if (batch.profile === 'translategemma') {
        const segment = batch.segments[0];
        if (segment) yield { kind: 'segment', id: segment.id, text: content.trim() };
      } else {
        const wanted = new Set(batch.segments.map((segment) => segment.id));
        for (const translation of parseTranslations(content)) {
          if (wanted.has(translation.id)) {
            yield { kind: 'segment', id: translation.id, text: translation.text };
          }
        }
      }
    }
    yield { kind: 'done', stats };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/ollama-translate.test.ts tests/unit/ollama.test.ts`
Expected: PASS (13 + 12 tests). If the fake-timer tests hang, make sure the `pending` promise is created *before* `advanceTimersByTimeAsync` and that `afterEach` restores real timers.

- [ ] **Step 5: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/provider/ollama.ts tests/unit/ollama-translate.test.ts
git commit -m "feat: stream /api/chat translations with timeouts and abort

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Messages, logger, sample texts and Vietnamese strings

**Files:**
- Create: `src/lib/messages.ts`, `src/lib/log.ts`, `src/lib/samples.ts`, `src/locales/vi.ts`
- Test: `tests/unit/messages.test.ts`, `tests/unit/samples.test.ts`

**Interfaces:**
- Consumes: `SourceLang`, `isSourceLang`, `SOURCE_LANGS` (Task 3), `ErrorCode`, `isErrorCode` (Task 4), `Profile`, `isProfile` (Task 6), `Segment`, `GenStats`, `ModelInfo`, `LoadedModel` (Task 7).
- Produces (`messages.ts`): `PORT_NAME = 'snagon-job'`; message types `JobStart`, `BatchTranslate`, `JobCancel` (client → SW), `SegPartial`, `SegDone`, `SegError` (SW → client), `StatusGet`, `ModelDescribe` (popup → SW), `StatusMsg`, `ModelDescribed` (SW → popup); unions `PortMessage`, `PortReply`, `PopupRequest`, `PopupReply`; guards `isPortMessage(v)`, `isPortReply(v)`, `isPopupRequest(v)`, `isPopupReply(v)`; `type OllamaState = 'ok' | 'down' | 'cors' | 'busy' | 'error'`.
- Produces (`log.ts`): `createLog(scope: string): Log` with `debug/info/warn/error`.
- Produces (`samples.ts`): `SAMPLES: Record<SourceLang, Sample>` where `interface Sample { paragraph: string; sentences: [string, string, string] }`.
- Produces (`locales/vi.ts`): `vi` object (popup labels, `errors: Record<ErrorCode, string>`, `corsCommand(id)`, `corsRestart`, `profileLabel(profile)`, `statusLine(...)`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PORT_NAME,
  isPopupReply,
  isPopupRequest,
  isPortMessage,
  isPortReply,
  type BatchTranslate,
  type JobStart,
  type SegDone,
  type StatusMsg,
} from '../../src/lib/messages.ts';

const jobStart: JobStart = {
  type: 'job.start',
  jobId: 'j1',
  tabId: 12,
  frameId: 0,
  src: 'en',
  tgt: 'vi',
  model: 'gemma4:26b',
  profile: 'instruct-json',
  url: 'https://example.com/a',
  title: 'Example',
};

const batch: BatchTranslate = {
  type: 'batch.translate',
  jobId: 'j1',
  batchId: 'b1',
  priority: 0,
  segments: [{ id: 's1', text: 'Hello', tokensEst: 2 }],
};

const segDone: SegDone = {
  type: 'seg.done',
  jobId: 'j1',
  segId: 's1',
  text: 'Xin chào',
  stats: { ttftMs: 1, totalMs: 2, promptEvalCount: 3, evalCount: 4, evalDurationMs: 5, doneReason: 'stop' },
};

const status: StatusMsg = {
  type: 'status',
  ollama: 'ok',
  version: '0.34.2',
  models: [{ name: 'gemma4:26b', size: 1, family: 'gemma4', modifiedAt: 'x' }],
  loaded: [],
};

describe('messages', () => {
  it('names the job port', () => {
    expect(PORT_NAME).toBe('snagon-job');
  });

  it('accepts well-formed port messages', () => {
    expect(isPortMessage(jobStart)).toBe(true);
    expect(isPortMessage(batch)).toBe(true);
    expect(isPortMessage({ type: 'job.cancel', jobId: 'j1' })).toBe(true);
  });

  it('rejects malformed port messages', () => {
    expect(isPortMessage(null)).toBe(false);
    expect(isPortMessage({ type: 'job.start' })).toBe(false);
    expect(isPortMessage({ ...jobStart, src: 'zh' })).toBe(false);
    expect(isPortMessage({ ...jobStart, profile: 'A' })).toBe(false);
    expect(isPortMessage({ ...jobStart, tgt: 'en' })).toBe(false);
    expect(isPortMessage({ ...batch, priority: 3 })).toBe(false);
    expect(isPortMessage({ ...batch, segments: [{ id: 's1', text: 'x' }] })).toBe(false);
    expect(isPortMessage({ type: 'seg.done', jobId: 'j1', segId: 's1', text: 'x' })).toBe(false);
  });

  it('accepts and rejects port replies', () => {
    expect(isPortReply({ type: 'seg.partial', jobId: 'j1', segId: 's1', text: 'Xin', tokens: 1 })).toBe(true);
    expect(isPortReply(segDone)).toBe(true);
    expect(isPortReply({ ...segDone, stats: undefined })).toBe(true);
    expect(isPortReply({ type: 'seg.error', jobId: 'j1', segId: 's1', code: 'E_CORS', message: 'x' })).toBe(true);
    expect(isPortReply({ type: 'seg.error', jobId: 'j1', segId: 's1', code: 'E_NOPE', message: 'x' })).toBe(false);
    expect(isPortReply(jobStart)).toBe(false);
  });

  it('accepts and rejects popup requests and replies', () => {
    expect(isPopupRequest({ type: 'status.get' })).toBe(true);
    expect(isPopupRequest({ type: 'model.describe', model: 'gemma4:26b' })).toBe(true);
    expect(isPopupRequest({ type: 'model.describe' })).toBe(false);
    expect(isPopupRequest(jobStart)).toBe(false);

    expect(isPopupReply(status)).toBe(true);
    expect(isPopupReply({ type: 'status', ollama: 'down', models: [], loaded: [], error: { code: 'E_DOWN', message: 'x' } })).toBe(true);
    expect(isPopupReply({ type: 'status', ollama: 'weird', models: [], loaded: [] })).toBe(false);
    expect(
      isPopupReply({
        type: 'model.described',
        model: 'gemma4:26b',
        profile: 'instruct-json',
        contextLength: 262144,
        capabilities: ['completion'],
      }),
    ).toBe(true);
    expect(isPopupReply({ type: 'model.described', model: 'x', error: { code: 'E_MODEL', message: 'x' } })).toBe(true);
    expect(isPopupReply({ type: 'model.described', model: 'x' })).toBe(false);
  });
});
```

`tests/unit/samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SOURCE_LANGS } from '../../src/lib/lang/codes.ts';
import { SAMPLES } from '../../src/lib/samples.ts';

describe('samples', () => {
  it.each(SOURCE_LANGS)('%s has a paragraph with placeholders and three sentences', (lang) => {
    const sample = SAMPLES[lang];
    expect(sample.paragraph.length).toBeGreaterThan(150);
    expect(sample.paragraph).toContain('<1>');
    expect(sample.paragraph).toContain('</1>');
    expect(sample.paragraph).toContain('<2/>');
    expect(sample.sentences).toHaveLength(3);
    for (const sentence of sample.sentences) expect(sentence.length).toBeGreaterThan(25);
    expect(sample.sentences[1]).toContain('<1>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/messages.test.ts tests/unit/samples.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/lib/messages.ts`**

```ts
import { isErrorCode, type ErrorCode } from './errors.ts';
import { TARGET_LANG, isSourceLang, type SourceLang, type TargetLang } from './lang/codes.ts';
import { isProfile, type Profile } from './prompt/profile.ts';
import type { GenStats, LoadedModel, ModelInfo, Segment } from './provider/types.ts';

/** Long-lived Port between a job client (popup in M0, content script from M1) and the service worker. */
export const PORT_NAME = 'snagon-job';

export type OllamaState = 'ok' | 'down' | 'cors' | 'busy' | 'error';
const OLLAMA_STATES: readonly string[] = ['ok', 'down', 'cors', 'busy', 'error'];

// ---- client → service worker (Port) -------------------------------------------------------

export interface JobStart {
  type: 'job.start';
  jobId: string;
  tabId: number;
  frameId: number;
  src: SourceLang;
  tgt: TargetLang;
  model: string;
  profile: Profile;
  url: string;
  title: string;
}

export interface BatchTranslate {
  type: 'batch.translate';
  jobId: string;
  batchId: string;
  segments: Segment[];
  /** 0 = viewport, 1 = ±1 viewport, 2 = rest (spec §5.4). M0 always sends 0. */
  priority: 0 | 1 | 2;
}

export interface JobCancel {
  type: 'job.cancel';
  jobId: string;
}

export type PortMessage = JobStart | BatchTranslate | JobCancel;

// ---- service worker → client (Port) -------------------------------------------------------

export interface SegPartial {
  type: 'seg.partial';
  jobId: string;
  segId: string;
  /** Accumulated text for profile A; empty string for profile B (only `tokens` moves). */
  text: string;
  tokens: number;
}

export interface SegDone {
  type: 'seg.done';
  jobId: string;
  segId: string;
  text: string;
  stats?: GenStats;
}

export interface SegError {
  type: 'seg.error';
  jobId: string;
  segId: string;
  code: ErrorCode;
  message: string;
}

export type PortReply = SegPartial | SegDone | SegError;

// ---- popup → service worker (sendMessage) -------------------------------------------------

export interface StatusGet {
  type: 'status.get';
}

export interface ModelDescribe {
  type: 'model.describe';
  model: string;
}

export type PopupRequest = StatusGet | ModelDescribe;

// ---- service worker → popup (sendMessage response) ----------------------------------------

export interface StatusMsg {
  type: 'status';
  ollama: OllamaState;
  version?: string;
  models: ModelInfo[];
  loaded: LoadedModel[];
  error?: { code: ErrorCode; message: string };
}

export type ModelDescribed =
  | {
      type: 'model.described';
      model: string;
      profile: Profile;
      contextLength: number | null;
      capabilities: string[];
    }
  | { type: 'model.described'; model: string; error: { code: ErrorCode; message: string } };

export type PopupReply = StatusMsg | ModelDescribed;

// ---- guards --------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null;
}

function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSegment(value: unknown): value is Segment {
  return isRec(value) && isStr(value.id) && isStr(value.text) && isNum(value.tokensEst);
}

function isErrorInfo(value: unknown): value is { code: ErrorCode; message: string } {
  return isRec(value) && isErrorCode(value.code) && isStr(value.message);
}

function isGenStats(value: unknown): value is GenStats {
  return (
    isRec(value) &&
    isNum(value.ttftMs) &&
    isNum(value.totalMs) &&
    isNum(value.promptEvalCount) &&
    isNum(value.evalCount) &&
    isNum(value.evalDurationMs) &&
    isStr(value.doneReason)
  );
}

function isModelInfo(value: unknown): value is ModelInfo {
  return isRec(value) && isStr(value.name) && isNum(value.size) && isStr(value.family) && isStr(value.modifiedAt);
}

function isLoadedModel(value: unknown): value is LoadedModel {
  return isRec(value) && isStr(value.name) && isNum(value.sizeVram) && isStr(value.until);
}

export function isPortMessage(value: unknown): value is PortMessage {
  if (!isRec(value)) return false;
  switch (value.type) {
    case 'job.start':
      return (
        isStr(value.jobId) &&
        isNum(value.tabId) &&
        isNum(value.frameId) &&
        isSourceLang(value.src) &&
        value.tgt === TARGET_LANG &&
        isStr(value.model) &&
        isProfile(value.profile) &&
        isStr(value.url) &&
        isStr(value.title)
      );
    case 'batch.translate':
      return (
        isStr(value.jobId) &&
        isStr(value.batchId) &&
        Array.isArray(value.segments) &&
        value.segments.every(isSegment) &&
        (value.priority === 0 || value.priority === 1 || value.priority === 2)
      );
    case 'job.cancel':
      return isStr(value.jobId);
    default:
      return false;
  }
}

export function isPortReply(value: unknown): value is PortReply {
  if (!isRec(value) || !isStr(value.jobId) || !isStr(value.segId)) return false;
  switch (value.type) {
    case 'seg.partial':
      return isStr(value.text) && isNum(value.tokens);
    case 'seg.done':
      return isStr(value.text) && (value.stats === undefined || isGenStats(value.stats));
    case 'seg.error':
      return isErrorCode(value.code) && isStr(value.message);
    default:
      return false;
  }
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (!isRec(value)) return false;
  if (value.type === 'status.get') return true;
  if (value.type === 'model.describe') return isStr(value.model);
  return false;
}

export function isPopupReply(value: unknown): value is PopupReply {
  if (!isRec(value)) return false;
  if (value.type === 'status') {
    return (
      isStr(value.ollama) &&
      OLLAMA_STATES.includes(value.ollama) &&
      (value.version === undefined || isStr(value.version)) &&
      Array.isArray(value.models) &&
      value.models.every(isModelInfo) &&
      Array.isArray(value.loaded) &&
      value.loaded.every(isLoadedModel) &&
      (value.error === undefined || isErrorInfo(value.error))
    );
  }
  if (value.type === 'model.described') {
    if (!isStr(value.model)) return false;
    if (isErrorInfo(value.error)) return true;
    return (
      isProfile(value.profile) &&
      (value.contextLength === null || isNum(value.contextLength)) &&
      Array.isArray(value.capabilities) &&
      value.capabilities.every(isStr)
    );
  }
  return false;
}
```

- [ ] **Step 4: Write `src/lib/log.ts`**

```ts
/** The only console wrapper in the codebase (CLAUDE.md §4). Prefix keeps SW/popup/content logs searchable. */
export interface Log {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLog(scope: string): Log {
  const prefix = `[snagon:${scope}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
```

- [ ] **Step 5: Write `src/lib/samples.ts`**

```ts
import type { SourceLang } from './lang/codes.ts';

export interface Sample {
  /** 60–100 words (Thai ≈ 250 chars) with placeholders <1>…</1> and <2/> — the popup's default text and the bench's `single` request. */
  paragraph: string;
  /** Three sentences of the same language for the bench's profile-B `batch3` request (spec §5.4: first batch ≤ 3). */
  sentences: [string, string, string];
}

/** Fixed texts shared by the popup and the bench so their numbers are comparable. Neutral technical/financial content. */
export const SAMPLES: Record<SourceLang, Sample> = {
  en: {
    paragraph:
      'Quarterly revenue rose 12% to $4.8 billion, driven by <1>subscription services</1> and a smaller contribution from hardware.<2/> Operating margin expanded to 31.5% as the company cut logistics costs and renegotiated supplier contracts. Management raised full-year guidance but warned that currency headwinds could trim reported growth by two to three points in the fourth quarter. Analysts at three banks kept their buy ratings, citing the recurring nature of the revenue base and a net cash position of $9.1 billion.',
    sentences: [
      'The API returns a paginated list of orders, and each page includes a cursor for fetching the next batch.',
      'Set the <1>timeout</1> to 30 seconds so that slow upstream services do not block the worker pool.',
      'Refunds are processed within five business days, and the fee of 2.9% is not returned to the merchant.',
    ],
  },
  ru: {
    paragraph:
      'Выручка за квартал выросла на 12% до 4,8 млрд рублей благодаря <1>подписочным сервисам</1> и небольшому вкладу продаж оборудования.<2/> Операционная маржа увеличилась до 31,5%, поскольку компания сократила логистические расходы и пересмотрела контракты с поставщиками. Руководство повысило прогноз на год, но предупредило, что колебания курса могут снизить отчётный рост на два–три пункта в четвёртом квартале. Аналитики трёх банков сохранили рекомендацию «покупать», отметив регулярный характер выручки и чистую денежную позицию в 9,1 млрд рублей.',
    sentences: [
      'Продавец обязан загрузить сертификат соответствия в личный кабинет до начала продаж товара на площадке.',
      'Налоговая декларация подаётся не позднее <1>25 апреля</1>, а уплата налога производится до 28 числа того же месяца.',
      'Комиссия маркетплейса составляет 15% от стоимости заказа и удерживается при перечислении выплаты продавцу.',
    ],
  },
  'zh-Hans': {
    paragraph:
      '本季度营收同比增长12%，达到48亿元，主要得益于<1>订阅服务</1>的增长，硬件销售的贡献较小。<2/>由于公司削减了物流成本并重新谈判了供应商合同，营业利润率扩大至31.5%。管理层上调了全年业绩指引，但警告称汇率波动可能使第四季度的报告增速下降两到三个百分点。三家银行的分析师维持买入评级，理由是收入基础具有经常性，且净现金头寸达91亿元。',
    sentences: [
      '该接口返回分页的订单列表，每一页都包含用于获取下一批数据的游标。',
      '请将<1>超时时间</1>设置为30秒，以免上游服务响应缓慢时阻塞整个工作线程池。',
      '退款将在五个工作日内处理完成，2.9%的手续费不会退还给商户。',
    ],
  },
  'zh-Hant': {
    paragraph:
      '本季營收年增12%，達到48億元，主要受惠於<1>訂閱服務</1>的成長，硬體銷售的貢獻較小。<2/>由於公司削減物流成本並重新協商供應商合約，營業利益率擴大至31.5%。管理層上調全年財測，但警告匯率波動可能使第四季的帳面成長率下降兩到三個百分點。三家銀行的分析師維持買進評等，理由是營收基礎具經常性，且淨現金部位達91億元。',
    sentences: [
      '該介面回傳分頁的訂單清單，每一頁都包含用於取得下一批資料的游標。',
      '請將<1>逾時時間</1>設定為30秒，以免上游服務回應緩慢時阻塞整個工作執行緒池。',
      '退款將於五個工作天內處理完成，2.9%的手續費不會退還給商家。',
    ],
  },
  th: {
    paragraph:
      'รายได้ประจำไตรมาสเพิ่มขึ้น 12% เป็น 4.8 พันล้านบาท โดยได้แรงหนุนจาก<1>บริการสมาชิกรายเดือน</1> และการขายฮาร์ดแวร์ที่มีสัดส่วนน้อยกว่า<2/> อัตรากำไรจากการดำเนินงานขยายตัวเป็น 31.5% หลังบริษัทลดต้นทุนโลจิสติกส์และเจรจาสัญญากับซัพพลายเออร์ใหม่ ฝ่ายบริหารปรับเพิ่มเป้าหมายทั้งปี แต่เตือนว่าความผันผวนของค่าเงินอาจทำให้อัตราการเติบโตที่รายงานในไตรมาสที่สี่ลดลงสองถึงสามจุด นักวิเคราะห์จากสามธนาคารยังคงคำแนะนำซื้อ โดยอ้างถึงรายได้ที่เกิดขึ้นประจำและฐานะเงินสดสุทธิ 9.1 พันล้านบาท',
    sentences: [
      'ผู้ขายต้องอัปโหลดใบรับรองมาตรฐานสินค้าเข้าสู่ระบบก่อนเริ่มจำหน่ายสินค้าบนแพลตฟอร์ม',
      'ตั้งค่า<1>เวลาหมดอายุ</1>ไว้ที่ 30 วินาที เพื่อไม่ให้บริการต้นทางที่ตอบสนองช้าปิดกั้นกลุ่มเวิร์กเกอร์ทั้งหมด',
      'การคืนเงินจะดำเนินการภายในห้าวันทำการ และค่าธรรมเนียม 2.9% จะไม่คืนให้กับร้านค้า',
    ],
  },
};
```

- [ ] **Step 6: Write `src/locales/vi.ts`**

```ts
import type { ErrorCode } from '../lib/errors.ts';
import type { Profile } from '../lib/prompt/profile.ts';

/** Every user-visible Vietnamese string (CLAUDE.md §4). Keep code identifiers English. */
export const vi = {
  popup: {
    title: 'Snagon - Dịch AI',
    checkConnection: 'Kiểm tra kết nối',
    checking: 'Đang kiểm tra…',
    notChecked: 'Chưa kiểm tra kết nối.',
    modelLabel: 'Model',
    noModels: '(chưa có model — chạy ollama pull)',
    warm: 'đang nạp',
    sourceLabel: 'Ngôn ngữ nguồn',
    textLabel: 'Văn bản thử',
    translateTest: 'Dịch thử',
    cancel: 'Hủy',
    cancelled: 'Đã hủy.',
    translating: 'Đang dịch…',
    tokens: 'token',
    copy: 'Copy',
    copied: 'Đã copy',
    describing: 'Đang đọc thông tin model…',
    unknownContext: 'ctx ?',
  },
  ollama: {
    ok: 'ok',
    down: 'chưa chạy',
    cors: 'chặn origin (CORS)',
    busy: 'đang bận',
    error: 'lỗi',
  },
  errors: {
    E_DOWN: 'Ollama chưa chạy. Mở app Ollama rồi thử lại.',
    E_CORS: 'Ollama chặn origin của extension (403). Chạy lệnh dưới trong Terminal:',
    E_MODEL: 'Model chưa được tải. Chạy ollama pull <model> hoặc chọn model khác.',
    E_BUSY: 'Ollama đang bận (503). Thử lại sau vài giây.',
    E_OOM: 'Không đủ bộ nhớ cho model này. Chọn model nhỏ hơn.',
    E_TIMEOUT: 'Model không phản hồi kịp (timeout).',
    E_TRUNC: 'Bản dịch bị cắt vì vượt num_predict.',
    E_BADREQ: 'Ollama từ chối request (400). Kiểm tra phiên bản Ollama.',
    E_PERM: 'Extension chưa có quyền truy cập endpoint này.',
    E_OUTPUT: 'Output của model không hợp lệ.',
  } satisfies Record<ErrorCode, string>,
  corsCommand: (extensionId: string): string =>
    `launchctl setenv OLLAMA_ORIGINS "chrome-extension://${extensionId}"`,
  corsRestart: 'Sau đó Quit Ollama trên menu bar rồi mở lại.',
  profileLabel: (profile: Profile): string =>
    profile === 'translategemma' ? 'Profile A (translategemma)' : 'Profile B (instruct-json)',
  statsLine: (ttftMs: number, tokPerSec: number, evalCount: number, doneReason: string): string =>
    `TTFT ${Math.round(ttftMs)} ms · ${tokPerSec.toFixed(1)} tok/s · ${evalCount} token · ${doneReason}`,
};
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/messages.test.ts tests/unit/samples.test.ts`
Expected: PASS (5 + 5 tests).

- [ ] **Step 8: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/messages.ts src/lib/log.ts src/lib/samples.ts src/locales/vi.ts tests/unit/messages.test.ts tests/unit/samples.test.ts
git commit -m "feat: add job/popup message types, logger, sample texts and vi strings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Service worker — popup requests and the job Port

**Files:**
- Modify: `src/entrypoints/background.ts` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: everything from Tasks 4, 7, 8, 9 (`createOllamaProvider`, `DEFAULT_OLLAMA_URL`, message guards/types, `createLog`, `isSnagonError`).
- Produces: the runtime protocol — `sendMessage({type:'status.get'}) → StatusMsg`, `sendMessage({type:'model.describe', model}) → ModelDescribed`; Port `snagon-job`: `job.start` → warm-up; `batch.translate` → `seg.partial*` then per segment `seg.done` (with `stats`) or `seg.error` (`E_TRUNC` when `done_reason: "length"`, `E_OUTPUT` when the model skipped the id, provider code otherwise); `job.cancel`/disconnect → abort. Config key `snagon.endpoint` (string) in `chrome.storage.local`, default `DEFAULT_OLLAMA_URL`.

No unit test: everything here is `browser.*` glue over already-tested modules; it is verified on the runtime in Task 13.

- [ ] **Step 1: Replace `src/entrypoints/background.ts`**

```ts
import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { isSnagonError, type ErrorCode } from '../lib/errors.ts';
import { createLog } from '../lib/log.ts';
import {
  PORT_NAME,
  isPopupRequest,
  isPortMessage,
  type BatchTranslate,
  type JobStart,
  type OllamaState,
  type PopupReply,
  type PopupRequest,
  type PortReply,
} from '../lib/messages.ts';
import { DEFAULT_OLLAMA_URL, createOllamaProvider } from '../lib/provider/ollama.ts';
import type { GenStats, TranslateBatch, TranslateProvider } from '../lib/provider/types.ts';

type Port = ReturnType<typeof browser.runtime.connect>;

const ENDPOINT_KEY = 'snagon.endpoint';
const log = createLog('sw');

interface Job {
  start: JobStart;
  controller: AbortController;
}

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isPopupRequest(message)) return false;
      handlePopupRequest(message).then(sendResponse, (error: unknown) => {
        log.error('popup request failed', message.type, error);
        sendResponse(failureReply(message, error));
      });
      return true; // keep the channel open for the async response
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME) return;
      attachJobPort(port);
    });
  },
});

/** The SW keeps no config in memory: read the endpoint on every use (spec §7.4). */
async function getProvider(): Promise<TranslateProvider> {
  const stored = await browser.storage.local.get(ENDPOINT_KEY);
  const endpoint = stored[ENDPOINT_KEY];
  return createOllamaProvider({
    baseUrl: typeof endpoint === 'string' && endpoint !== '' ? endpoint : DEFAULT_OLLAMA_URL,
  });
}

function stateFromCode(code: ErrorCode): OllamaState {
  if (code === 'E_DOWN') return 'down';
  if (code === 'E_CORS') return 'cors';
  if (code === 'E_BUSY') return 'busy';
  return 'error';
}

/** Unknown failures (bugs, not provider errors) are reported as E_OUTPUT so the client still gets a code. */
function errorInfo(error: unknown): { code: ErrorCode; message: string } {
  if (isSnagonError(error)) {
    return { code: error.code, message: error.detail ? `${error.message}: ${error.detail}` : error.message };
  }
  return { code: 'E_OUTPUT', message: error instanceof Error ? error.message : String(error) };
}

async function handlePopupRequest(request: PopupRequest): Promise<PopupReply> {
  const provider = await getProvider();

  if (request.type === 'status.get') {
    const [version, models, loaded] = await Promise.allSettled([
      provider.version(),
      provider.listModels(),
      provider.loaded(),
    ]);
    if (version.status === 'rejected') {
      const info = errorInfo(version.reason);
      return { type: 'status', ollama: stateFromCode(info.code), models: [], loaded: [], error: info };
    }
    return {
      type: 'status',
      ollama: 'ok',
      version: version.value,
      models: models.status === 'fulfilled' ? models.value : [],
      loaded: loaded.status === 'fulfilled' ? loaded.value : [],
      ...(models.status === 'rejected' ? { error: errorInfo(models.reason) } : {}),
    };
  }

  const details = await provider.describe(request.model);
  return {
    type: 'model.described',
    model: request.model,
    profile: details.profile,
    contextLength: details.contextLength,
    capabilities: details.capabilities,
  };
}

function failureReply(request: PopupRequest, error: unknown): PopupReply {
  const info = errorInfo(error);
  if (request.type === 'model.describe') {
    return { type: 'model.described', model: request.model, error: info };
  }
  return { type: 'status', ollama: stateFromCode(info.code), models: [], loaded: [], error: info };
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function attachJobPort(port: Port): void {
  // The only job state in the SW: in-flight controllers for this port (spec §7.4 allows a temporary in-flight map).
  const jobs = new Map<string, Job>();

  const post = (reply: PortReply): void => {
    try {
      port.postMessage(reply);
    } catch (error) {
      log.warn('port closed while posting', reply.type, error);
    }
  };

  port.onMessage.addListener((raw: unknown) => {
    if (!isPortMessage(raw)) {
      log.warn('rejected malformed port message', raw);
      return;
    }
    switch (raw.type) {
      case 'job.start': {
        const job: Job = { start: raw, controller: new AbortController() };
        jobs.set(raw.jobId, job);
        void warmUp(job);
        return;
      }
      case 'batch.translate':
        void runBatch(raw);
        return;
      case 'job.cancel':
        jobs.get(raw.jobId)?.controller.abort();
        jobs.delete(raw.jobId);
        return;
    }
  });

  // Port closed (popup closed, tab navigated) → abort every fetch of its jobs (spec §4).
  port.onDisconnect.addListener(() => {
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  });

  async function warmUp(job: Job): Promise<void> {
    try {
      const provider = await getProvider();
      await provider.warmUp(job.start.model, job.controller.signal);
    } catch (error) {
      if (!job.controller.signal.aborted) log.warn('warm-up failed', job.start.model, error);
    }
  }

  async function runBatch(message: BatchTranslate): Promise<void> {
    const job = jobs.get(message.jobId);
    if (!job) {
      for (const segment of message.segments) {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_BADREQ',
          message: `unknown jobId ${message.jobId} (send job.start first)`,
        });
      }
      return;
    }

    const { start } = job;
    const batch: TranslateBatch = {
      model: start.model,
      profile: start.profile,
      src: start.src,
      tgt: start.tgt,
      segments: message.segments,
      context: { title: start.title, domain: domainOf(start.url) },
    };
    const firstId = message.segments[0]?.id ?? '';
    const texts = new Map<string, string>();
    let stats: GenStats | undefined;

    try {
      const provider = await getProvider();
      for await (const chunk of provider.translate(batch, job.controller.signal)) {
        if (chunk.kind === 'progress') {
          post({
            type: 'seg.partial',
            jobId: message.jobId,
            segId: firstId,
            text: chunk.text ?? '',
            tokens: chunk.tokens,
          });
        } else if (chunk.kind === 'segment') {
          texts.set(chunk.id, chunk.text);
        } else {
          stats = chunk.stats;
        }
      }
    } catch (error) {
      const info = errorInfo(error);
      log.warn('batch failed', message.batchId, info.code, info.message);
      for (const segment of message.segments) {
        post({ type: 'seg.error', jobId: message.jobId, segId: segment.id, code: info.code, message: info.message });
      }
      return;
    }

    if (job.controller.signal.aborted) return; // cancelled — the client already knows

    for (const segment of message.segments) {
      const text = texts.get(segment.id);
      if (text !== undefined) {
        post({ type: 'seg.done', jobId: message.jobId, segId: segment.id, text, stats });
      } else if (stats?.doneReason === 'length') {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_TRUNC',
          message: 'output cut by num_predict (done_reason=length)',
        });
      } else {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_OUTPUT',
          message: 'model output has no translation for this segment',
        });
      }
    }
  }
}
```

- [ ] **Step 2: Gate, build, check manifest**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:manifest`
Expected: all green; `manifest OK · extension id = …`. If `tsc` cannot type `browser.runtime.onMessage.addListener`'s callback, annotate the listener parameters as `(message: unknown, _sender: unknown, sendResponse: (reply: PopupReply) => void)`.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/background.ts
git commit -m "feat: service worker handles popup status/describe and the snagon-job port

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Popup — connection check, model pick, translate test, CORS guidance

**Files:**
- Modify: `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`, `src/entrypoints/popup/style.css`

**Interfaces:**
- Consumes: the Task 10 protocol; `vi` strings, `SAMPLES`, `tokensEst`, `pickProfile`, message guards.
- Produces: the M0 client. Storage key `snagon.model` (string). No `innerHTML`: all DOM through `textContent`, `createElement`, `replaceChildren`.

No unit test (DOM glue; verified on the runtime in Task 13 — design §5.4).

- [ ] **Step 1: Write `src/entrypoints/popup/index.html`**

All visible strings are set from `src/locales/vi.ts` in `main.ts`, so the markup only has ids.

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>Snagon - Dịch AI</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main id="app">
      <header class="row">
        <h1 id="title"></h1>
        <div id="status" class="status"></div>
        <button id="check" type="button"></button>
      </header>

      <section class="row">
        <label id="model-label" for="model"></label>
        <select id="model"></select>
        <div id="model-info" class="muted"></div>
      </section>

      <section class="row">
        <label id="src-label" for="src"></label>
        <select id="src"></select>
        <label id="text-label" for="text"></label>
        <textarea id="text" rows="6" spellcheck="false"></textarea>
        <div class="actions">
          <button id="run" type="button" class="primary"></button>
          <button id="cancel" type="button" disabled></button>
        </div>
      </section>

      <section class="row">
        <pre id="output" class="output"></pre>
        <div id="stats" class="muted"></div>
        <div id="error" class="error" hidden></div>
        <div id="cors" class="cors" hidden>
          <p id="cors-help"></p>
          <pre id="cors-cmd" class="cmd"></pre>
          <button id="copy" type="button"></button>
          <p id="cors-restart" class="muted"></p>
        </div>
      </section>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/entrypoints/popup/style.css`**

```css
body {
  margin: 0;
  min-width: 380px;
  max-width: 420px;
  font: 13px/1.4 system-ui, sans-serif;
  color: #1a1a1a;
  background: #fff;
}
#app {
  padding: 12px;
  display: grid;
  gap: 12px;
}
h1 {
  font-size: 15px;
  margin: 0;
}
.row {
  display: grid;
  gap: 6px;
}
.status {
  font-weight: 600;
}
.muted {
  color: #666;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
button {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid #bbb;
  border-radius: 6px;
  background: #f6f6f6;
  cursor: pointer;
}
button.primary {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
select,
textarea {
  font: inherit;
  width: 100%;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid #bbb;
  border-radius: 6px;
}
.output,
.cmd {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: #f3f3f3;
  min-height: 2.5em;
  font: inherit;
}
.cmd {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  user-select: all;
}
.error {
  color: #b00020;
}
.cors {
  display: grid;
  gap: 6px;
}
```

- [ ] **Step 3: Write `src/entrypoints/popup/main.ts`**

```ts
import { browser } from 'wxt/browser';
import type { ErrorCode } from '../../lib/errors.ts';
import { SOURCE_LANGS, isSourceLang } from '../../lib/lang/codes.ts';
import { createLog } from '../../lib/log.ts';
import {
  PORT_NAME,
  isPopupReply,
  isPortReply,
  type BatchTranslate,
  type JobCancel,
  type JobStart,
  type ModelDescribe,
  type ModelDescribed,
  type StatusGet,
  type StatusMsg,
} from '../../lib/messages.ts';
import { pickProfile, type Profile } from '../../lib/prompt/profile.ts';
import { SAMPLES } from '../../lib/samples.ts';
import { tokensEst } from '../../lib/tokens.ts';
import { vi } from '../../locales/vi.ts';

type Port = ReturnType<typeof browser.runtime.connect>;

const MODEL_KEY = 'snagon.model';
const TEST_URL = 'https://example.com/snagon-test';
const TEST_TITLE = 'Snagon test';
const log = createLog('popup');

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup: missing #${id}`);
  return node as T;
}

const ui = {
  title: el<HTMLHeadingElement>('title'),
  status: el<HTMLDivElement>('status'),
  check: el<HTMLButtonElement>('check'),
  modelLabel: el<HTMLLabelElement>('model-label'),
  model: el<HTMLSelectElement>('model'),
  modelInfo: el<HTMLDivElement>('model-info'),
  srcLabel: el<HTMLLabelElement>('src-label'),
  src: el<HTMLSelectElement>('src'),
  textLabel: el<HTMLLabelElement>('text-label'),
  text: el<HTMLTextAreaElement>('text'),
  run: el<HTMLButtonElement>('run'),
  cancel: el<HTMLButtonElement>('cancel'),
  output: el<HTMLPreElement>('output'),
  stats: el<HTMLDivElement>('stats'),
  error: el<HTMLDivElement>('error'),
  cors: el<HTMLDivElement>('cors'),
  corsHelp: el<HTMLParagraphElement>('cors-help'),
  corsCmd: el<HTMLPreElement>('cors-cmd'),
  copy: el<HTMLButtonElement>('copy'),
  corsRestart: el<HTMLParagraphElement>('cors-restart'),
};

let currentProfile: Profile = 'instruct-json';
let activePort: Port | undefined;
let activeJobId: string | undefined;

function setStaticText(): void {
  ui.title.textContent = vi.popup.title;
  ui.status.textContent = vi.popup.notChecked;
  ui.check.textContent = vi.popup.checkConnection;
  ui.modelLabel.textContent = vi.popup.modelLabel;
  ui.srcLabel.textContent = vi.popup.sourceLabel;
  ui.textLabel.textContent = vi.popup.textLabel;
  ui.run.textContent = vi.popup.translateTest;
  ui.cancel.textContent = vi.popup.cancel;
  ui.copy.textContent = vi.popup.copy;
  ui.corsRestart.textContent = vi.corsRestart;
  for (const lang of SOURCE_LANGS) {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang;
    ui.src.append(option);
  }
  ui.text.value = SAMPLES.en.paragraph;
}

function showCors(show: boolean): void {
  ui.cors.hidden = !show;
  if (show) {
    ui.corsHelp.textContent = vi.errors.E_CORS;
    ui.corsCmd.textContent = vi.corsCommand(browser.runtime.id);
    ui.copy.textContent = vi.popup.copy;
  }
}

function showError(code: ErrorCode, message: string): void {
  ui.error.hidden = false;
  ui.error.textContent = `${code} — ${vi.errors[code]} ${message}`.trim();
  showCors(code === 'E_CORS');
}

function clearError(): void {
  ui.error.hidden = true;
  ui.error.textContent = '';
  showCors(false);
}

async function checkConnection(): Promise<void> {
  ui.status.textContent = vi.popup.checking;
  clearError();
  const request: StatusGet = { type: 'status.get' };
  const reply: unknown = await browser.runtime.sendMessage(request);
  if (!isPopupReply(reply) || reply.type !== 'status') {
    ui.status.textContent = vi.ollama.error;
    log.warn('unexpected status reply', reply);
    return;
  }
  renderStatus(reply);
}

function renderStatus(status: StatusMsg): void {
  const version = status.version ? ` ${status.version}` : '';
  ui.status.textContent = `Ollama${version} · ${vi.ollama[status.ollama]}`;
  if (status.error) showError(status.error.code, status.error.message);

  const loaded = new Set(status.loaded.map((model) => model.name));
  const previous = ui.model.value;
  ui.model.replaceChildren();
  if (status.models.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = vi.popup.noModels;
    ui.model.append(option);
  }
  for (const model of status.models) {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = loaded.has(model.name) ? `• ${model.name} (${vi.popup.warm})` : model.name;
    ui.model.append(option);
  }
  void restoreModel(previous);
}

async function restoreModel(previous: string): Promise<void> {
  const stored = await browser.storage.local.get(MODEL_KEY);
  const remembered = stored[MODEL_KEY];
  const wanted = previous || (typeof remembered === 'string' ? remembered : '');
  const names = [...ui.model.options].map((option) => option.value);
  if (wanted && names.includes(wanted)) ui.model.value = wanted;
  if (ui.model.value) await describeModel(ui.model.value);
}

async function describeModel(model: string): Promise<void> {
  ui.modelInfo.textContent = vi.popup.describing;
  await browser.storage.local.set({ [MODEL_KEY]: model });
  const request: ModelDescribe = { type: 'model.describe', model };
  const reply: unknown = await browser.runtime.sendMessage(request);
  if (!isPopupReply(reply) || reply.type !== 'model.described') {
    ui.modelInfo.textContent = vi.ollama.error;
    log.warn('unexpected describe reply', reply);
    return;
  }
  renderModel(reply);
}

function renderModel(reply: ModelDescribed): void {
  if ('error' in reply) {
    currentProfile = pickProfile(reply.model);
    ui.modelInfo.textContent = `${vi.profileLabel(currentProfile)} · ${reply.error.code}`;
    showError(reply.error.code, reply.error.message);
    return;
  }
  currentProfile = reply.profile;
  const context =
    reply.contextLength === null
      ? vi.popup.unknownContext
      : `ctx ${reply.contextLength.toLocaleString('vi-VN')}`;
  ui.modelInfo.textContent = `${vi.profileLabel(reply.profile)} · ${context} · ${reply.capabilities.join(', ')}`;
}

function finishTest(): void {
  const port = activePort;
  activePort = undefined;
  activeJobId = undefined;
  port?.disconnect();
  ui.run.disabled = false;
  ui.cancel.disabled = true;
}

function cancelTest(): void {
  if (activePort && activeJobId) {
    const cancel: JobCancel = { type: 'job.cancel', jobId: activeJobId };
    try {
      activePort.postMessage(cancel);
    } catch (error) {
      log.warn('port already closed', error);
    }
    ui.stats.textContent = vi.popup.cancelled;
  }
  finishTest();
}

function startTest(): void {
  const model = ui.model.value;
  const src = ui.src.value;
  const text = ui.text.value.trim();
  if (!model || !isSourceLang(src) || !text) return;

  finishTest();
  clearError();
  ui.output.textContent = '';
  ui.stats.textContent = vi.popup.translating;
  ui.run.disabled = true;
  ui.cancel.disabled = false;

  const jobId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: PORT_NAME });
  activePort = port;
  activeJobId = jobId;

  port.onMessage.addListener((raw: unknown) => {
    if (!isPortReply(raw) || raw.jobId !== jobId) return;
    if (raw.type === 'seg.partial') {
      ui.output.textContent = raw.text;
      ui.stats.textContent = `${raw.tokens} ${vi.popup.tokens}`;
      return;
    }
    if (raw.type === 'seg.done') {
      ui.output.textContent = raw.text;
      const stats = raw.stats;
      ui.stats.textContent = stats
        ? vi.statsLine(
            stats.ttftMs,
            stats.evalDurationMs > 0 ? (stats.evalCount * 1000) / stats.evalDurationMs : 0,
            stats.evalCount,
            stats.doneReason,
          )
        : '';
    } else {
      showError(raw.code, raw.message);
      ui.stats.textContent = '';
    }
    finishTest();
  });
  port.onDisconnect.addListener(() => {
    if (activePort === port) finishTest(); // SW side went away
  });

  void (async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const start: JobStart = {
      type: 'job.start',
      jobId,
      tabId: tab?.id ?? -1,
      frameId: 0,
      src,
      tgt: 'vi',
      model,
      profile: currentProfile,
      url: TEST_URL,
      title: TEST_TITLE,
    };
    const batch: BatchTranslate = {
      type: 'batch.translate',
      jobId,
      batchId: 'b1',
      priority: 0,
      segments: [{ id: 's1', text, tokensEst: tokensEst(text, src) }],
    };
    port.postMessage(start);
    port.postMessage(batch);
  })();
}

async function copyCommand(): Promise<void> {
  await navigator.clipboard.writeText(ui.corsCmd.textContent ?? '');
  ui.copy.textContent = vi.popup.copied;
}

setStaticText();
ui.check.addEventListener('click', () => void checkConnection());
ui.model.addEventListener('change', () => void describeModel(ui.model.value));
ui.src.addEventListener('change', () => {
  const src = ui.src.value;
  if (isSourceLang(src)) ui.text.value = SAMPLES[src].paragraph;
});
ui.run.addEventListener('click', startTest);
ui.cancel.addEventListener('click', cancelTest);
ui.copy.addEventListener('click', () => void copyCommand());
void checkConnection();
```

- [ ] **Step 4: Gate, build, smoke-open the popup**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:manifest`
Expected: all green. `.output/chrome-mv3/popup.html` exists and references a built script (no inline `<script>` content — MV3 CSP forbids it).

Optional smoke test when a display is available (a subagent without one skips it — Task 14 covers the runtime): run `pnpm dev`; WXT opens a Chromium with the extension; click the toolbar icon; the popup must render the title, the status line (`cors` or `down` is expected at this point — `OLLAMA_ORIGINS` is not set yet) and the CORS command containing the same ID as `pnpm check:manifest`. Stop `pnpm dev` (Ctrl+C). If the popup is blank, open its DevTools (right-click the icon → Inspect popup) and fix the console error before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/popup
git commit -m "feat: popup checks the connection, lists models and runs a translate test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Bench script with measurement and probes

**Files:**
- Create: `bench/lib.ts`, `bench/measure.ts`, `bench/results/.gitkeep`
- Test: `tests/unit/bench-lib.test.ts`

**Interfaces:**
- Consumes: `createOllamaProvider`, `DEFAULT_OLLAMA_URL` (Task 7/8), `SAMPLES` (Task 9), `tokensEst` (Task 3), `pickProfile` (Task 6), `isSnagonError` (Task 4).
- Produces (`bench/lib.ts`, pure): `parseArgs(argv): BenchArgs`, `DEFAULT_MODELS`, `tagSet(text)`, `tagOk(input, output)`, `median(values)`, `tokPerSec(evalCount, evalDurationMs)`, `CSV_HEADER`, `csvLine(values)`, `rowLine(row)`, `summarize(rows)`, `markdownTable(rows)`.
- Produces (`bench/measure.ts`): `SNAGON_LIVE=1 pnpm bench -- [--model m]… [--runs 3] [--out dir]` and `SNAGON_LIVE=1 pnpm bench -- --probe`. Without `SNAGON_LIVE=1` it prints a hint and exits 0. Writes `bench/results/m0-<yyyymmdd>.csv` (+ `.jsonl` of translations, gitignored) or `bench/results/m0-probe-<yyyymmdd>.csv`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/bench-lib.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  DEFAULT_MODELS,
  csvLine,
  markdownTable,
  median,
  parseArgs,
  rowLine,
  summarize,
  tagOk,
  tagSet,
  tokPerSec,
  type CsvRow,
} from '../../bench/lib.ts';

describe('parseArgs', () => {
  it('defaults to the five M0 models, 3 runs, bench/results', () => {
    expect(parseArgs([])).toEqual({ models: DEFAULT_MODELS, runs: 3, probe: false, out: 'bench/results' });
    expect(DEFAULT_MODELS).toEqual([
      'gemma4:26b',
      'translategemma:12b',
      'translategemma:27b',
      'qwen3.5:27b',
      'gemma4:26b-mlx',
    ]);
  });

  it('reads repeated --model, --runs, --probe, --out', () => {
    expect(parseArgs(['--model', 'a', '--model', 'b', '--runs', '5', '--probe', '--out', 'tmp'])).toEqual({
      models: ['a', 'b'],
      runs: 5,
      probe: true,
      out: 'tmp',
    });
  });

  it('rejects bad input', () => {
    expect(() => parseArgs(['--runs', '0'])).toThrow(/--runs/);
    expect(() => parseArgs(['--model'])).toThrow(/--model/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/);
  });
});

describe('placeholder tags', () => {
  it('extracts tags in order', () => {
    expect(tagSet('a <1>b</1> c<2/> d')).toEqual(['<1>', '</1>', '<2/>']);
    expect(tagSet('plain')).toEqual([]);
  });

  it('tagOk compares the multiset of tags', () => {
    expect(tagOk('<1>a</1><2/>', '<2/><1>x</1>')).toBe(true);
    expect(tagOk('<1>a</1><2/>', '<1>x</1>')).toBe(false);
    expect(tagOk('<1>a</1>', '<1>x</1><1>y</1>')).toBe(false);
  });
});

describe('numbers', () => {
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('tokPerSec guards zero duration', () => {
    expect(tokPerSec(100, 2000)).toBe(50);
    expect(tokPerSec(100, 0)).toBe(0);
  });
});

describe('csv', () => {
  it('quotes fields with commas or quotes and rounds numbers to 2 decimals', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', 1.2345, true, ''])).toBe('a,"b,c","say ""hi""",1.23,true,');
  });

  it('rowLine follows CSV_HEADER order', () => {
    const row = Object.fromEntries(CSV_HEADER.map((key) => [key, key])) as unknown as CsvRow;
    expect(rowLine(row)).toBe(CSV_HEADER.join(','));
  });
});

describe('summary', () => {
  const base: CsvRow = {
    ts: 't',
    model: 'gemma4:26b',
    profile: 'instruct-json',
    lang: 'en',
    kind: 'single',
    run: 1,
    ttft_ms: 100,
    total_ms: 1000,
    prompt_eval_count: 50,
    eval_count: 60,
    eval_duration_ms: 1000,
    tok_s: 60,
    done_reason: 'stop',
    chars_in: 300,
    chars_out: 320,
    tag_ok: true,
    loaded_before: true,
  };

  it('groups by model+profile with medians over single runs and the warm-up time', () => {
    const rows: CsvRow[] = [
      { ...base, kind: 'warmup', total_ms: 4000 },
      base,
      { ...base, run: 2, ttft_ms: 300, tok_s: 50, tag_ok: false },
      { ...base, kind: 'batch3', ttft_ms: 999 },
    ];
    expect(summarize(rows)).toEqual([
      {
        model: 'gemma4:26b',
        profile: 'instruct-json',
        warmupMs: 4000,
        ttftMs: 200,
        tokS: 55,
        tagOkPct: 50,
        n: 2,
      },
    ]);
  });

  it('renders a markdown table', () => {
    const table = markdownTable(summarize([base]));
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| gemma4:26b | instruct-json | — | 100 | 60.0 | 100 | 1 |');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/bench-lib.test.ts`
Expected: FAIL — module `../../bench/lib.ts` not found.

- [ ] **Step 3: Write `bench/lib.ts`**

```ts
export interface BenchArgs {
  models: string[];
  runs: number;
  probe: boolean;
  out: string;
}

/** Spec §13: four candidates plus the MLX build. Missing models are skipped at runtime, not fatal. */
export const DEFAULT_MODELS = [
  'gemma4:26b',
  'translategemma:12b',
  'translategemma:27b',
  'qwen3.5:27b',
  'gemma4:26b-mlx',
];

export function parseArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = { models: [], runs: 3, probe: false, out: 'bench/results' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') {
      const value = argv[index + 1];
      if (!value) throw new Error('--model needs a value');
      args.models.push(value);
      index += 1;
    } else if (arg === '--runs') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--runs needs a positive integer');
      args.runs = value;
      index += 1;
    } else if (arg === '--probe') {
      args.probe = true;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out needs a value');
      args.out = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  if (args.models.length === 0) args.models = [...DEFAULT_MODELS];
  return args;
}

/** Placeholder tags (<1>, </1>, <2/>) in order of appearance. */
export function tagSet(text: string): string[] {
  return text.match(/<\/?\d+\s*\/?>/g) ?? [];
}

/** Sanity indicator for spec §5.6 tag integrity: same multiset of tags in and out. */
export function tagOk(input: string, output: string): boolean {
  const expected = tagSet(input).sort();
  const actual = tagSet(output).sort();
  return expected.length === actual.length && expected.every((tag, index) => tag === actual[index]);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] ?? Number.NaN;
  return (lower + upper) / 2;
}

export function tokPerSec(evalCount: number, evalDurationMs: number): number {
  return evalDurationMs > 0 ? (evalCount * 1000) / evalDurationMs : 0;
}

export const CSV_HEADER = [
  'ts',
  'model',
  'profile',
  'lang',
  'kind',
  'run',
  'ttft_ms',
  'total_ms',
  'prompt_eval_count',
  'eval_count',
  'eval_duration_ms',
  'tok_s',
  'done_reason',
  'chars_in',
  'chars_out',
  'tag_ok',
  'loaded_before',
] as const;

export type CsvValue = string | number | boolean;
export type CsvRow = Record<(typeof CSV_HEADER)[number], CsvValue>;

export function csvLine(values: readonly CsvValue[]): string {
  return values
    .map((value) => {
      const text =
        typeof value === 'number'
          ? Number.isFinite(value)
            ? String(Math.round(value * 100) / 100)
            : ''
          : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}

export function rowLine(row: CsvRow): string {
  return csvLine(CSV_HEADER.map((key) => row[key]));
}

export interface SummaryRow {
  model: string;
  profile: string;
  warmupMs: number;
  ttftMs: number;
  tokS: number;
  tagOkPct: number;
  n: number;
}

/** Medians over `single` rows per model+profile; warm-up time from the `warmup` row. */
export function summarize(rows: readonly CsvRow[]): SummaryRow[] {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = `${String(row.model)}|${String(row.profile)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [model = '', profile = ''] = key.split('|');
    const singles = list.filter((row) => row.kind === 'single');
    const warmup = list.find((row) => row.kind === 'warmup');
    const okCount = singles.filter((row) => row.tag_ok === true || row.tag_ok === 'true').length;
    return {
      model,
      profile,
      warmupMs: warmup ? Number(warmup.total_ms) : Number.NaN,
      ttftMs: median(singles.map((row) => Number(row.ttft_ms))),
      tokS: median(singles.map((row) => Number(row.tok_s))),
      tagOkPct: singles.length > 0 ? (100 * okCount) / singles.length : Number.NaN,
      n: singles.length,
    };
  });
}

export function markdownTable(rows: readonly SummaryRow[]): string {
  const format = (value: number, digits = 0): string =>
    Number.isFinite(value) ? value.toFixed(digits) : '—';
  const lines = [
    '| Model | Profile | Warm-up ms | TTFT ms (median) | tok/s (median) | tag_ok % | n |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.model} | ${row.profile} | ${format(row.warmupMs)} | ${format(row.ttftMs)} | ${format(row.tokS, 1)} | ${format(row.tagOkPct)} | ${row.n} |`,
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/bench-lib.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Write `bench/measure.ts` and `bench/results/.gitkeep`**

`bench/results/.gitkeep` is an empty file. `bench/measure.ts`:

```ts
// Live measurement against the real Ollama (design §6). Runs the extension's own provider code.
// Usage:  SNAGON_LIVE=1 pnpm bench -- [--model gemma4:26b]... [--runs 3] [--out bench/results]
//         SNAGON_LIVE=1 pnpm bench -- --probe
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSnagonError } from '../src/lib/errors.ts';
import { SOURCE_LANGS, type SourceLang } from '../src/lib/lang/codes.ts';
import { pickProfile, type Profile } from '../src/lib/prompt/profile.ts';
import { DEFAULT_OLLAMA_URL, createOllamaProvider } from '../src/lib/provider/ollama.ts';
import type { GenStats, TranslateBatch, TranslateProvider } from '../src/lib/provider/types.ts';
import { SAMPLES } from '../src/lib/samples.ts';
import { tokensEst } from '../src/lib/tokens.ts';
import {
  CSV_HEADER,
  csvLine,
  markdownTable,
  parseArgs,
  rowLine,
  summarize,
  tagOk,
  tokPerSec,
  type CsvRow,
} from './lib.ts';

const CONTEXT = { title: 'Snagon bench', domain: 'example.com' };

interface Outcome {
  stats: GenStats;
  outputs: string[];
  tagOk: boolean;
  charsIn: number;
  charsOut: number;
}

function describeError(error: unknown): string {
  if (isSnagonError(error)) return `${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ''}`;
  return error instanceof Error ? error.message : String(error);
}

function makeBatch(model: string, profile: Profile, lang: SourceLang, inputs: readonly string[]): TranslateBatch {
  return {
    model,
    profile,
    src: lang,
    tgt: 'vi',
    segments: inputs.map((text, index) => ({ id: `s${index + 1}`, text, tokensEst: tokensEst(text, lang) })),
    context: CONTEXT,
  };
}

async function translateOnce(
  provider: TranslateProvider,
  batch: TranslateBatch,
  signal: AbortSignal = new AbortController().signal,
): Promise<Outcome> {
  const texts = new Map<string, string>();
  let lastProgress = '';
  let stats: GenStats | undefined;
  for await (const chunk of provider.translate(batch, signal)) {
    if (chunk.kind === 'progress') lastProgress = chunk.text ?? lastProgress;
    else if (chunk.kind === 'segment') texts.set(chunk.id, chunk.text);
    else stats = chunk.stats;
  }
  if (!stats) throw new Error('translate ended without stats (aborted?)');
  const outputs = batch.segments.map(
    (segment) => texts.get(segment.id) ?? (batch.segments.length === 1 ? lastProgress : ''),
  );
  return {
    stats,
    outputs,
    tagOk: batch.segments.every((segment, index) => tagOk(segment.text, outputs[index] ?? '')),
    charsIn: batch.segments.reduce((sum, segment) => sum + segment.text.length, 0),
    charsOut: outputs.reduce((sum, text) => sum + text.length, 0),
  };
}

function row(
  base: { model: string; profile: Profile; lang: string; kind: string; run: number; loadedBefore: boolean },
  outcome: Outcome | undefined,
  errorCode = '',
): CsvRow {
  const stats = outcome?.stats;
  return {
    ts: new Date().toISOString(),
    model: base.model,
    profile: base.profile,
    lang: base.lang,
    kind: base.kind,
    run: base.run,
    ttft_ms: stats?.ttftMs ?? '',
    total_ms: stats?.totalMs ?? '',
    prompt_eval_count: stats?.promptEvalCount ?? '',
    eval_count: stats?.evalCount ?? '',
    eval_duration_ms: stats?.evalDurationMs ?? '',
    tok_s: stats ? tokPerSec(stats.evalCount, stats.evalDurationMs) : '',
    done_reason: stats?.doneReason ?? errorCode,
    chars_in: outcome?.charsIn ?? '',
    chars_out: outcome?.charsOut ?? '',
    tag_ok: outcome?.tagOk ?? '',
    loaded_before: base.loadedBefore,
  };
}

async function measure(provider: TranslateProvider, models: string[], runs: number, out: string, stamp: string): Promise<void> {
  const csvPath = join(out, `m0-${stamp}.csv`);
  const jsonlPath = join(out, `m0-${stamp}.jsonl`);
  if (!existsSync(csvPath)) writeFileSync(csvPath, csvLine([...CSV_HEADER]) + '\n');
  const rows: CsvRow[] = [];
  const record = (entry: CsvRow): void => {
    rows.push(entry);
    appendFileSync(csvPath, rowLine(entry) + '\n');
  };
  const recordText = (entry: Record<string, unknown>): void => {
    appendFileSync(jsonlPath, JSON.stringify(entry) + '\n');
  };

  for (const model of models) {
    const profile = pickProfile(model);
    try {
      await provider.describe(model);
    } catch (error) {
      console.log(`skipped ${model}: ${describeError(error)}`);
      continue;
    }
    const loadedBefore = (await provider.loaded()).some((loaded) => loaded.name === model);
    const startedAt = performance.now();
    await provider.warmUp(model);
    const warmupMs = performance.now() - startedAt;
    const warmupRow = row({ model, profile, lang: '', kind: 'warmup', run: 0, loadedBefore }, undefined);
    record({ ...warmupRow, total_ms: warmupMs, done_reason: 'load' });
    console.log(`\n${model} (${profile}) warm-up ${Math.round(warmupMs)} ms · loaded before: ${loadedBefore}`);

    for (const lang of SOURCE_LANGS) {
      const sample = SAMPLES[lang];
      for (let run = 1; run <= runs; run += 1) {
        const base = { model, profile, lang, kind: 'single', run, loadedBefore };
        try {
          const outcome = await translateOnce(provider, makeBatch(model, profile, lang, [sample.paragraph]));
          record(row(base, outcome));
          recordText({ ...base, input: sample.paragraph, output: outcome.outputs[0] });
          const tokS = tokPerSec(outcome.stats.evalCount, outcome.stats.evalDurationMs).toFixed(1);
          console.log(
            `  ${lang} run ${run}: ttft ${Math.round(outcome.stats.ttftMs)} ms · ${tokS} tok/s · ${outcome.stats.doneReason} · tag_ok ${outcome.tagOk}`,
          );
        } catch (error) {
          const code = isSnagonError(error) ? error.code : 'ERROR';
          record(row(base, undefined, code));
          console.log(`  ${lang} run ${run}: ${describeError(error)}`);
        }
      }
      if (profile === 'instruct-json') {
        const base = { model, profile, lang, kind: 'batch3', run: 1, loadedBefore };
        try {
          const outcome = await translateOnce(provider, makeBatch(model, profile, lang, sample.sentences));
          record(row(base, outcome));
          recordText({ ...base, input: sample.sentences, output: outcome.outputs });
          console.log(`  ${lang} batch3: ttft ${Math.round(outcome.stats.ttftMs)} ms · ${outcome.stats.doneReason} · tag_ok ${outcome.tagOk}`);
        } catch (error) {
          record(row(base, undefined, isSnagonError(error) ? error.code : 'ERROR'));
          console.log(`  ${lang} batch3: ${describeError(error)}`);
        }
      }
    }
  }

  console.log('\n' + markdownTable(summarize(rows)));
  console.log(`\nCSV: ${csvPath}\nJSONL (gitignored): ${jsonlPath}`);
}

async function probes(provider: TranslateProvider, out: string, stamp: string): Promise<void> {
  const csvPath = join(out, `m0-probe-${stamp}.csv`);
  if (!existsSync(csvPath)) writeFileSync(csvPath, 'ts,probe,model,result,detail\n');
  const record = (probe: string, model: string, result: 'ok' | 'fail', detail: string): void => {
    appendFileSync(csvPath, csvLine([new Date().toISOString(), probe, model, result, detail]) + '\n');
    console.log(`${probe} [${model}]: ${result} — ${detail}`);
  };
  const firstSentence = SAMPLES.en.sentences[0];

  // P1 — `format` schema together with `stream: true` (design §6.2).
  try {
    await provider.warmUp('gemma4:26b');
    let progressChunks = 0;
    const ids: string[] = [];
    let doneReason = '';
    const batch = makeBatch('gemma4:26b', 'instruct-json', 'en', SAMPLES.en.sentences);
    for await (const chunk of provider.translate(batch, new AbortController().signal)) {
      if (chunk.kind === 'progress') progressChunks += 1;
      else if (chunk.kind === 'segment') ids.push(chunk.id);
      else doneReason = chunk.stats.doneReason;
    }
    const ok = progressChunks >= 2 && ids.length === 3;
    record('P1_format_stream', 'gemma4:26b', ok ? 'ok' : 'fail', `progress_chunks=${progressChunks} segments=${ids.join('+')} done_reason=${doneReason}`);
  } catch (error) {
    record('P1_format_stream', 'gemma4:26b', 'fail', describeError(error));
  }

  // P2 — client abort stops generation on the server (spec §7.3, Ollama 0.34.2).
  try {
    await provider.warmUp('translategemma:12b');
    const short = makeBatch('translategemma:12b', 'translategemma', 'en', [firstSentence]);
    const baseline = (await translateOnce(provider, short)).stats.ttftMs;
    const controller = new AbortController();
    let seen = 0;
    const long = makeBatch('translategemma:12b', 'translategemma', 'en', [SAMPLES.en.paragraph]);
    for await (const chunk of provider.translate(long, controller.signal)) {
      if (chunk.kind === 'progress') {
        seen += 1;
        if (seen >= 5) controller.abort();
      }
    }
    const after = (await translateOnce(provider, short)).stats.ttftMs;
    const ok = after - baseline < 1500;
    record('P2_abort_stops', 'translategemma:12b', ok ? 'ok' : 'fail', `ttft_baseline_ms=${Math.round(baseline)} ttft_after_abort_ms=${Math.round(after)}`);
  } catch (error) {
    record('P2_abort_stops', 'translategemma:12b', 'fail', describeError(error));
  }

  // P3 — `think: false` is accepted by a model without the thinking capability (spec §6.2).
  try {
    const batch = makeBatch('translategemma:12b', 'instruct-json', 'en', [firstSentence]);
    const outcome = await translateOnce(provider, batch);
    record('P3_think_false', 'translategemma:12b', 'ok', `done_reason=${outcome.stats.doneReason}`);
  } catch (error) {
    record('P3_think_false', 'translategemma:12b', 'fail', describeError(error));
  }
}

async function main(): Promise<void> {
  if (process.env.SNAGON_LIVE !== '1') {
    console.log('bench skipped: set SNAGON_LIVE=1 to run against the real Ollama (ask Phát first — it occupies the GPU for minutes).');
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.SNAGON_OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const provider = createOllamaProvider({ baseUrl });
  console.log(`Ollama ${await provider.version()} at ${baseUrl}`);
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (args.probe) await probes(provider, args.out, stamp);
  else await measure(provider, args.models, args.runs, args.out, stamp);
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
```

- [ ] **Step 6: Verify the script loads and self-skips**

Run: `pnpm bench` (no `SNAGON_LIVE`) and `pnpm bench -- --probe`
Expected: both print `bench skipped: set SNAGON_LIVE=1 …` and exit 0 — this proves Node 24 can load every `src/lib` module the bench imports (no non-erasable syntax). Do NOT run with `SNAGON_LIVE=1` in this task.

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add bench/lib.ts bench/measure.ts bench/results/.gitkeep tests/unit/bench-lib.test.ts
git commit -m "feat: add bench script measuring TTFT/tok-s and probing format-stream, abort, think:false

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: CI workflow and README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Produces: CI on `pull_request` and `push` to `main` running the same gate as the tasks; README with load-unpacked and `OLLAMA_ORIGINS` instructions.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm check:manifest
      - run: pnpm audit --audit-level=high
```

- [ ] **Step 2: Write `README.md`**

````markdown
# Snagon - Dịch AI

Chrome MV3 extension dịch trang web EN/RU/ZH/TH → VI bằng model local qua Ollama, 100% offline. Nguồn sự thật về thiết kế: `docs/spec/snagon-dich-ai-spec.md`; hướng dẫn cho agent: `CLAUDE.md`.

## Yêu cầu

- macOS, Chrome ≥ 144, Ollama ≥ 0.34 đang chạy ở `http://127.0.0.1:11434`
- Node 24, pnpm 11 (corepack)

## Chạy

```bash
pnpm install --frozen-lockfile
pnpm build            # → .output/chrome-mv3
pnpm check:manifest   # in ra extension ID (cố định nhờ manifest.key)
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → chọn `.output/chrome-mv3`. ID phải trùng với `pnpm check:manifest`.

Ollama chỉ chấp nhận origin đã khai báo. Chạy một lần rồi Quit/mở lại app Ollama:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://<ID>"
```

Popup (M0): **Kiểm tra kết nối** → chọn model → **Dịch thử** (profile A cho `translategemma*`, B cho model khác) → **Hủy** để dừng giữa chừng. Nếu Ollama chưa có origin, popup tự in lệnh trên với ID thật.

## Phát triển

```bash
pnpm dev                          # Chrome riêng với extension, hot reload
pnpm typecheck && pnpm lint && pnpm test
SNAGON_LIVE=1 pnpm bench -- --runs 3    # đo TTFT/tok/s trên Ollama thật (chiếm GPU)
SNAGON_LIVE=1 pnpm bench -- --probe     # 3 giả định M0: format+stream, abort, think:false
```

Private key của extension nằm ngoài repo (`~/.config/snagon-dich-ai/snagon-dich-ai.pem`); chỉ public key vào `wxt.config.ts`.
````

- [ ] **Step 3: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:manifest`

```bash
git add .github/workflows/ci.yml README.md
git commit -m "chore: add CI workflow and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Runtime verification, measurements, spec update and PR

This task alternates between the agent and Phát. Each **STOP** means: report, then wait for Phát's reply in the conversation. Nothing here is automated in CI.

**Files:**
- Modify: `docs/spec/snagon-dich-ai-spec.md` (§6.2, §7.1, §7.3, §8.2), `LEDGER.md`
- Create: `bench/results/m0-<yyyymmdd>.csv`, `bench/results/m0-probe-<yyyymmdd>.csv`

- [ ] **Step 1: Hand the extension to Phát**

Run: `pnpm build && pnpm check:manifest` and report the ID. Ask Phát to: load unpacked `.output/chrome-mv3`; open the popup; confirm the status line says `chặn origin (CORS)` (or `chưa chạy` if Ollama is off) and the CORS block shows `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<same ID>"`; run that command in Terminal; Quit and reopen Ollama. **STOP.**

- [ ] **Step 2: D1 + D2 on the runtime (Phát)**

Ask Phát to: click **Kiểm tra kết nối** → `Ollama 0.34.2 · ok` and the dropdown lists the real models (D1); pick `translategemma:12b` → info line says `Profile A (translategemma)` → **Dịch thử** with `en` → Vietnamese text appears with a stats line (D2-A); pick `gemma4:26b` → `Profile B (instruct-json)` → **Dịch thử** → Vietnamese text (D2-B); start another test and press **Hủy** within a second → stats line says `Đã hủy.` and the run button re-enables; close the popup mid-translation and reopen → no stuck state. Record each outcome verbatim in the completion report. Any failure → `superpowers:systematic-debugging` before touching code. **STOP.**

- [ ] **Step 3: Ask for the bench go-ahead**

Tell Phát the bench takes ~15–25 minutes of GPU (5 languages × 3 runs × available models + 3 probes) and that missing models (`qwen3.5:27b`, `gemma4:26b-mlx`) are skipped unless pulled. **STOP** until Phát says go.

- [ ] **Step 4: Run the probes, then the measurement**

```bash
SNAGON_LIVE=1 pnpm bench -- --probe
SNAGON_LIVE=1 pnpm bench -- --runs 3
```

Expected: `bench/results/m0-probe-<date>.csv` with three rows (`P1_format_stream`, `P2_abort_stops`, `P3_think_false`) and `bench/results/m0-<date>.csv` with `warmup`, `single` and `batch3` rows per available model, plus the markdown summary on stdout. Read `bench/results/m0-<date>.jsonl` and note obvious quality problems (echoes, untranslated text) in the report — do not judge quality beyond that (A7 is Phát's blind scoring at M3).

- [ ] **Step 5: Write the findings into the spec and LEDGER**

Edit `docs/spec/snagon-dich-ai-spec.md`:
- §8.2: after the candidates table, add a heading `#### Số đo M0 (<date>, Ollama 0.34.2, num_ctx 8192)` followed by the markdown summary table from the bench output and one line naming skipped models.
- §7.3: append three bullets with the probe results, e.g. `- M0 (<date>): \`format\` + \`stream: true\` → ok/fail (chi tiết …); abort → ok/fail (TTFT baseline … ms, sau abort … ms); \`think: false\` trên translategemma → 200.` If P1 failed, also state that profile B uses `stream: false` from M1 and add the LEDGER line.
- §7.1 (`/api/show` row): replace `template → tự chọn profile (có template dạng TranslateGemma → A, còn lại → B)` with `chọn profile theo tên model (translategemma* → A, còn lại → B; template của /api/show không phân biệt được — kiểm M0)`.
- §6.2 options line: change `num_predict = min(4.096; …)` to `min(2.048; …)` with the note `(trần chung §7.3)`.

Edit `LEDGER.md`: tick the item `Patch spec §7.1 … §6.2 …` with `— PR M0`; on the EMA item, append the measured chars/token per language from the CSV (`chars_in / prompt_eval_count`, noting it includes template tokens); resolve the P1 item (`— P1 ok, giữ stream:true` or `— P1 fail, stream:false từ M1`).

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add bench/results/m0-*.csv docs/spec/snagon-dich-ai-spec.md LEDGER.md
git commit -m "docs: record M0 measurements and probe results in the spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Open the PR and stop**

Invoke `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch` choosing "open a PR" (never merge). PR title: `feat(m0): connection spike — WXT scaffold, Ollama provider, popup test client, bench`. Body sections: **What** (one paragraph + file map), **Why** (spec §13 M0), **How to test** (Steps 1–4 above as a checklist), **Assumptions** (design §8 list), **Residual** (probe outcomes, skipped models, LEDGER additions). End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Post the PR URL and the completion report in CLAUDE.md §8.4 order: results → files → commands + real output → decisions taken → open points. **STOP** — Phát reviews the diff and merges.
