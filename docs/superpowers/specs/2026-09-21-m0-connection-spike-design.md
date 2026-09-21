# Design — M0 Spike kết nối (Snagon - Dịch AI)

Ngày: 2026-09-21 · Người duyệt: Phát · Spec gốc: `docs/spec/snagon-dich-ai-spec.md` (§4, §6, §7, §8, §13)
Đường brainstorming: architectural. Approach đã chọn: **spike gọn** — popup đóng vai client, chưa có content script.

## 1. Mục tiêu và phạm vi

M0 trả lời một câu hỏi: extension MV3 nói chuyện được với Ollama 0.34.2 trên máy này qua đúng đường mà v1 sẽ dùng (service worker → `/api/chat` stream), và các con số/giả định trong spec §7–§8 đúng đến đâu.

Điều kiện xong (§13, verify trên runtime, không tin báo cáo):

| # | Điều kiện | Cách chứng minh |
| --- | --- | --- |
| D1 | Popup liệt kê model thật từ `/api/tags` | Phát mở popup trên Chrome thật |
| D2 | Dịch một chuỗi cứng qua cả hai profile | `translategemma:12b` (A) và `gemma4:26b` (B) trong popup |
| D3 | Bảng tok/s thật ghi vào spec §8.2 | `bench/results/m0-<ngày>.csv` + bảng markdown dán vào §8.2 trong PR |
| D4 | Xác nhận giả định: `format` chạy cùng `stream: true`; abort dừng sinh token | Kết quả `pnpm bench -- --probe` ghi vào §7.3 và mục Residual của PR |
| D5 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` xanh; CI xanh trên PR | Output thật trong completion report |

Không có trong M0: content script, segmenter, cache IDB, validator, retry/backoff, hàng đợi, Options, banner trong trang, e2e. Tất cả thuộc M1–M2 theo §13.

## 2. Máy thật (kiểm 2026-09-21) và sai lệch với CLAUDE.md

| Mục | CLAUDE.md nói | Thực tế | Quyết định |
| --- | --- | --- | --- |
| Node | 22 LTS qua `.nvmrc` | 24.19.0 tại `~/.local/node`, không có nvm/fnm/volta/brew | `.nvmrc` = `24`; `engines.node >= 24` |
| pnpm | 10 qua corepack | 11.22.0 qua shim corepack 0.35 (`~/.local/bin/pnpm`) | `packageManager: pnpm@11.22.0` |
| TypeScript | 5 `strict` | npm latest là 7.0 (compiler mới) | pin `^5.9`, không lên 7 |
| git | — | `/usr/bin/git` bị chặn cho đến khi chấp nhận Xcode license | Phát chạy `sudo xcodebuild -license accept` trước khi commit |
| Ollama | 0.34.2 | 0.34.2, `OLLAMA_ORIGINS`/`OLLAMA_CONTEXT_LENGTH`/`OLLAMA_KEEP_ALIVE` chưa set | Đúng kỳ vọng — M0 sinh lệnh theo ID |
| Model | 4 model §8.1 + `gemma4:26b-mlx` | Có `gemma4:26b`, `translategemma:12b`, `translategemma:27b`; thiếu `qwen3.5:27b`, `gemma4:26b-mlx` | Bench tự skip model 404; Phát pull khi rảnh |
| Chrome / gh / Playwright | ≥ 144 | Chrome 153; gh 2.97 login `phantanphatdgteam-gif`; Chromium Playwright đã cache | Không cần làm gì |

Node 24 chạy file `.ts` trực tiếp (đã thử, kể cả import có đuôi `.ts`) → `bench/measure.ts` chạy bằng `node`, không thêm `tsx`.

Soi `/api/show` thật:

- `translategemma:12b`: `capabilities: [completion, vision]`, `family: gemma3`, context 131.072, template là template chat Gemma-3 chuẩn (system gộp vào turn user) — **không có dấu hiệu "TranslateGemma" nào trong template**.
- `gemma4:26b`: `capabilities: [completion, vision, tools, thinking]`, context 262.144, `template: "{{ .Prompt }}"` (renderer của engine mới).

Hệ quả: quy tắc §7.1 "template dạng TranslateGemma → profile A" không dùng được; M0 chọn profile theo **tên model** (`translategemma*` → A, còn lại → B). `gemma4:26b` có `thinking` nên profile B bắt buộc gửi `think: false` (đúng §6.2).

## 3. Bootstrap repo và toolchain

1. `git init` tại thư mục hiện tại, branch `main`. Commit đầu trên `main` chỉ gồm tài liệu: `CLAUDE.md`, `docs/spec/`, `.claude/rules/`, design này, `LEDGER.md` (đã gieo mục 9), `.gitignore`. Từ đó mọi thay đổi đi qua branch + PR.
2. `gh repo create phantanphatdgteam-gif/snagon-dich-ai --private --source . --push`.
3. Worktree M0: `.worktrees/feat/m0-connection-spike`, branch `feat/m0-connection-spike`; setup `pnpm install --frozen-lockfile`; baseline `pnpm test`.
4. Dependency M0 (devDependencies, đúng cái dùng ngay): `wxt`, `typescript@^5.9`, `vitest`, `eslint`, `typescript-eslint` (parser/plugin để ESLint đọc TS — bổ sung ngoài danh sách CLAUDE.md, Phát đã duyệt), `eslint-plugin-no-unsanitized`, `prettier`. `idb`, `fast-check`, `jsdom`, `@playwright/test` chỉ thêm khi milestone dùng.
5. Scripts: `dev: wxt` · `build: wxt build` · `zip: wxt zip` · `postinstall: wxt prepare` · `typecheck: tsc --noEmit` · `lint: eslint .` · `format: prettier --write .` · `test: vitest run` · `bench: node bench/measure.ts`.
6. `tsconfig.json` extends `.wxt/tsconfig.json`; `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly` (để Node strip-types chạy được mọi file `src/lib` mà bench import), `verbatimModuleSyntax`; include `src`, `bench`, `tests`. Quy ước: import tương đối trong repo ghi đuôi `.ts`.
7. ESLint flat config: `typescript-eslint` recommended + `no-unsanitized` (chặn `innerHTML`, `insertAdjacentHTML`) + `no-eval`, `no-implied-eval`, `no-new-func`; rule `no-restricted-globals`/`no-restricted-syntax` cấm `fetch` ngoài `src/lib/provider/**`.
8. Extension ID cố định: sinh một lần
   ```bash
   mkdir -p ~/.config/snagon-dich-ai
   openssl genrsa -out ~/.config/snagon-dich-ai/snagon-dich-ai.pem 2048
   openssl pkey -in ~/.config/snagon-dich-ai/snagon-dich-ai.pem -pubout -outform DER | base64
   ```
   Chuỗi base64 vào `wxt.config.ts` → `manifest.key`; ID = 32 ký tự `a–p` suy từ SHA-256 của public key DER (script nhỏ in ra trong quá trình implement, ghi vào README/PR). `.pem` nằm ngoài repo; `.gitignore` có `*.pem`, `.worktrees/`, `.output/`, `.wxt/`, `node_modules/`, `bench/results/*.jsonl`.
9. `wxt.config.ts` (`srcDir: 'src'`) sinh manifest đúng §4: `name`, `short_name`, `version 0.1.0`, `minimum_chrome_version: '144'`, `key`, `permissions: [activeTab, scripting, storage, contextMenus, unlimitedStorage]`, `host_permissions: [http://127.0.0.1:11434/*, http://localhost:11434/*]`, `optional_host_permissions: [http://*/*, https://*/*]`, `commands` Alt+T / Alt+H / Alt+S. Bề mặt quyền đóng băng từ M0; `options_ui` xuất hiện khi có entrypoint Options (M2); M0 chỉ khai báo `commands`, chưa xử lý.
10. CI `.github/workflows/ci.yml`: `pull_request` + `push` lên `main` → `actions/setup-node` theo `.nvmrc` → `corepack enable` → `pnpm install --frozen-lockfile` → `typecheck` → `lint` → `test` → `build` → `pnpm audit --audit-level=high`. Chưa e2e.
11. Sửa CLAUDE.md và `.claude/rules/*` cho khớp mục 2 và mục 8 của design này (cùng commit đầu).

## 4. Layout và module

Mọi thứ trong `src/lib` thuần TS, không `chrome.*`, unit test chạy ở môi trường `node`.

```
wxt.config.ts · package.json · tsconfig.json · eslint.config.js · .prettierrc · .nvmrc · LEDGER.md
.github/workflows/ci.yml
src/entrypoints/background.ts              SW: onMessage + onConnect, gọi provider, stream về Port
src/entrypoints/popup/{index.html,main.ts,style.css}
src/lib/provider/types.ts                  TranslateProvider, TranslateBatch, Chunk, GenStats, ModelInfo…
src/lib/provider/ollama.ts                 nơi DUY NHẤT có fetch
src/lib/provider/ndjson.ts                 parser dòng NDJSON
src/lib/prompt/index.ts                    PROMPT_VERSION, buildChatRequest()
src/lib/prompt/translategemma.ts           template A nguyên văn §6.1
src/lib/prompt/instruct-json.ts            system prompt B §6.2 + JSON schema
src/lib/prompt/profile.ts                  pickProfile(modelName)
src/lib/errors.ts · src/lib/messages.ts · src/lib/tokens.ts · src/lib/log.ts
src/lib/lang/codes.ts                      SourceLang + bảng tên §6.1
src/lib/samples.ts                         5 đoạn mẫu cố định (popup + bench dùng chung)
src/locales/vi.ts                          chuỗi UI + thông điệp theo mã lỗi
bench/measure.ts · bench/results/
tests/unit/{ndjson,prompt,profile,errors,ollama,messages,tokens}.test.ts
```

### 4.1 `provider/types.ts`

```ts
type SourceLang = 'en' | 'ru' | 'zh-Hans' | 'zh-Hant' | 'th';           // lang/codes.ts
type Profile = 'translategemma' | 'instruct-json';

interface Segment { id: string; text: string; tokensEst: number }
interface TranslateBatch {
  model: string; profile: Profile; src: SourceLang; tgt: 'vi';
  segments: Segment[]; context: { title: string; domain: string };
}
interface GenStats {
  ttftMs: number; totalMs: number; promptEvalCount: number;
  evalCount: number; evalDurationMs: number; doneReason: string;
}
type Chunk =
  | { kind: 'progress'; tokens: number; text?: string }   // A: text tích luỹ; B: chỉ đếm token
  | { kind: 'segment'; id: string; text: string }         // A: 1 cái ở cuối; B: mỗi id sau khi parse JSON
  | { kind: 'done'; stats: GenStats };

interface ModelInfo { name: string; size: number; family: string; modifiedAt: string }
interface ModelDetails { name: string; family: string; capabilities: string[]; contextLength: number | null; profile: Profile }
interface LoadedModel { name: string; sizeVram: number; until: string }

interface TranslateProvider {
  version(): Promise<string>;                                   // GET /api/version
  listModels(): Promise<ModelInfo[]>;                           // GET /api/tags
  describe(model: string): Promise<ModelDetails>;               // POST /api/show
  loaded(): Promise<LoadedModel[]>;                             // GET /api/ps
  warmUp(model: string, signal?: AbortSignal): Promise<void>;   // POST /api/chat {model, keep_alive:"10m", options:{num_ctx:8192}} không messages
  translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk>;
}
```

Hợp đồng `warmUp`: body không `messages` nhưng **phải** có `options.num_ctx: 8192` (cùng `NUM_CTX` với mọi request dịch) — thiếu nó thì Ollama nạp model ở context mặc định rồi unload/reload ngay ở request dịch đầu tiên (đo 2026-09-21 trên server log: `19:34:36 n_ctx = 131072` → `19:34:37 n_ctx = 8192`).

`createOllamaProvider({ baseUrl, fetch = globalThis.fetch })` — `fetch` inject được để unit test bằng stub. Hợp đồng `translate`:

- Gửi body từ `buildChatRequest(batch)`; đọc `application/x-ndjson` qua `ndjson.ts` (chịu chunk cắt giữa dòng, dòng dở ở cuối, CRLF, dòng rỗng).
- Timeout: TTFT 60 s, idle giữa hai chunk 20 s, tổng 150 s → `SnagonError('E_TIMEOUT')`; `AbortController` nội bộ nối với `signal` của caller; caller abort → generator kết thúc im lặng (không phải lỗi).
- Dòng `done: true` → `GenStats` (`eval_duration` ns → ms).
- **Không bao giờ yield `segment` cho output bị cắt** (`done_reason === "length"`) **hay text rỗng/toàn khoảng trắng** (fail-closed). Profile B: ghép content, `JSON.parse`, yield `segment` cho từng id có mặt và có text; JSON hỏng → `SnagonError('E_OUTPUT')`. Ai thiếu segment là việc của SW (mục 5.3).
- Lỗi HTTP/mạng → `mapHttpError` / `mapFetchError` (mục 4.4). Không retry ở tầng này (M2).

### 4.2 `prompt/`

- `PROMPT_VERSION = 1` (đi vào cache key từ M1). Đổi template = tăng version + hỏi Phát.
- `buildChatRequest(batch)` trả body `/api/chat`:
  - Chung: `stream: true`, `keep_alive: "10m"`, `options.seed: 42`, `options.num_ctx: 8192` (không đổi giữa các request).
  - A (`translategemma`): đúng 1 user message theo template §6.1 nguyên văn (hai dòng trống trước `{TEXT}`), `SOURCE_LANG`/`SOURCE_CODE` từ `lang/codes.ts`; không `system`, `think`, `format`; `options { temperature: 0.2, top_p: 0.9, num_predict: min(2048, 3 × tokensEst + 64) }`. Chỉ nhận batch 1 segment (assert).
  - B (`instruct-json`): `system` = §6.2 nguyên văn (mảng glossary rỗng giữ chỗ), user = JSON `{ source_lang, context: { title, domain }, segments: [{ id, text }] }`; `think: false`; `format` = schema `{ translations: [{ id, text }] }` với `required` + `additionalProperties: false`; `options { temperature: 0.3, top_p: 0.95, top_k: 64, num_predict: min(2048, 3 × Σ tokensEst + 128) }`.
  - Trần `num_predict` 2.048 cho cả hai profile: §7.3 chốt trần chung 2.048 để không request nào chạm 5 phút của SW; §6.2 ghi 4.096 cho B là mâu thuẫn — lấy 2.048. Phần "100 s × tok/s đo được" nối ở M2 khi có EMA.
- `pickProfile(modelName)`: `/^translategemma(:|$)/i` → `translategemma`, còn lại `instruct-json` (lý do ở mục 2).

### 4.3 `tokens.ts`, `lang/codes.ts`, `samples.ts`, `log.ts`, `locales/vi.ts`

- `tokensEst(text, lang)` = `ceil(chars / ratio)`, ratio tĩnh: `en` 3,5 · `ru` 2,5 · `zh-Hans`/`zh-Hant` 1,3 · `th` 2,5 (**giả định** — spec không cho; bench M0 ghi `prompt_eval_count` để M2 hiệu chỉnh).
- `lang/codes.ts`: `SourceLang`, `SOURCE_LANG_NAME` (English / Russian / Chinese / Chinese / Thai), `isSourceLang()`.
- `samples.ts`: `samples[lang] = { paragraph, sentences: [3 câu] }` cho 5 mã nguồn — `paragraph` 60–100 từ (Thái ~250 ký tự) có 1–2 placeholder `<1>…</1>` và một `<2/>` để nhìn sơ tỉ lệ vỡ tag; `sentences` là 3 câu 15–25 từ cùng ngôn ngữ, dùng cho batch profile B (một `TranslateBatch` chỉ có một `src`). Nội dung kỹ thuật/tài chính trung tính. Popup điền sẵn `paragraph`; bench dùng y nguyên → số đo so được với nhau.
- `log.ts`: `createLog(scope)` → `{ debug, info, warn, error }` prefix `[snagon:<scope>]`.
- `locales/vi.ts`: chuỗi popup, thông điệp theo `ErrorCode`, mẫu lệnh CORS có `{id}` + hàm `format()` nhỏ.

### 4.4 `errors.ts`

```ts
type ErrorCode = 'E_DOWN' | 'E_CORS' | 'E_MODEL' | 'E_BUSY' | 'E_OOM' | 'E_TIMEOUT'
               | 'E_TRUNC' | 'E_BADREQ' | 'E_PERM' | 'E_OUTPUT';
class SnagonError extends Error { code: ErrorCode; detail?: string }
mapHttpError(status, bodyText): SnagonError   // 403→E_CORS · 404→E_MODEL · 503→E_BUSY · 500+/memory/i→E_OOM · 400→E_BADREQ · khác→E_BADREQ kèm status
mapFetchError(err): SnagonError               // TypeError (connection refused)→E_DOWN · AbortError giữ nguyên
```

`E_OUTPUT` là mã thứ 10, ngoài bảng §7.5: output model không hợp lệ (JSON hỏng, thiếu id). §4 nói `seg.error` mang `code` nhưng §5.6/§11 không đặt tên mã cho "rỗng/rác"; validator M2 dùng lại mã này. `E_PERM` khai báo nhưng chưa có đường phát sinh (endpoint LAN là M4).

### 4.5 `messages.ts`

Chỉ khai báo cái M0 dùng, mỗi loại có type guard; SW và popup từ chối message không qua guard.

| Kênh | Message | Payload |
| --- | --- | --- |
| `sendMessage` popup → SW | `status.get` | — |
| ← | `status` | `ollama: 'ok' \| 'down' \| 'cors' \| 'busy' \| 'error'`, `version?`, `models: ModelInfo[]`, `loaded: LoadedModel[]`, `error?: { code, message }` |
| `sendMessage` popup → SW | `model.describe` | `model` |
| ← | `model.described` | `model`, `profile`, `contextLength`, `capabilities` hoặc `error` |
| Port `snagon-job` client → SW | `job.start` | `jobId`, `tabId`, `frameId`, `src`, `tgt: 'vi'`, `model`, `profile`, `url`, `title` |
| → | `batch.translate` | `jobId`, `batchId`, `segments: Segment[]`, `priority: 0 \| 1 \| 2` |
| ← | `seg.partial` | `jobId`, `segId`, `text`, `tokens` |
| ← | `seg.done` | `jobId`, `segId`, `text`, `stats?: GenStats` |
| ← | `seg.error` | `jobId`, `segId`, `code: ErrorCode`, `message` |
| → | `job.cancel` | `jobId` |

Khác bảng §4: thêm cặp `status.get`/`status`, `model.describe`/`model.described` (popup cần hỏi SW), `seg.partial.tokens`, `job.start.title` (context cho profile B). `job.ping`, `job.resume`, `config.changed` thêm ở M1/M2 khi có code dùng.

## 5. Luồng SW ↔ popup

### 5.1 Popup (vanilla DOM)

1. Dòng trạng thái + nút **Kiểm tra kết nối** → `status.get` → hiện `Ollama <version> · ok` hoặc `down / cors / busy / error` kèm thông điệp.
2. Dropdown model từ `status.models`, chấm • trước model có trong `status.loaded`; chọn → `model.describe` → hiện `Profile A|B · ctx <n> · <capabilities>`; lưu `chrome.storage.local['snagon.model']`, đọc lại khi mở popup.
3. Khối **Dịch thử**: select nguồn (`en / ru / zh-Hans / zh-Hant / th`), textarea điền sẵn `samples[src]` (sửa được), nút **Dịch thử** / **Hủy**.
4. Kết quả: khi stream — A hiện text tích luỹ, B hiện bộ đếm token; khi `seg.done` — bản dịch + `TTFT <ms> · <tok/s> · eval <n> · <done_reason>`; khi `seg.error` — mã + thông điệp từ `locales/vi.ts`; với `E_CORS` (và `status.ollama === 'cors'`) hiện thêm khối lệnh
   `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<chrome.runtime.id>"` + nút **Copy** (`navigator.clipboard.writeText`) + dòng "Quit Ollama trên menu bar rồi mở lại". Ollama kiểm `Origin` cả với GET nên nút Kiểm tra kết nối đã lộ CORS trước khi dịch thử.

### 5.2 Protocol dịch thử

Popup `chrome.runtime.connect({ name: 'snagon-job' })` → `job.start { jobId: crypto.randomUUID(), tabId: tab đang active, frameId: 0, src, tgt: 'vi', model, profile, url: 'https://example.com/snagon-test', title: 'Snagon test' }` → `batch.translate { jobId, batchId: 'b1', segments: [{ id: 's1', text, tokensEst }], priority: 0 }`. **Hủy** = `job.cancel`; đóng popup = port disconnect → SW abort mọi fetch của `jobId` (đúng §4). Content script M1 dùng lại nguyên protocol này.

### 5.3 Service worker

- State duy nhất: `Map<jobId, { port, controller: AbortController }>` (map in-flight tạm mà §7.4 cho phép). Endpoint đọc `chrome.storage.local['snagon.endpoint']`, mặc định `http://127.0.0.1:11434` (chưa có UI sửa).
- `onMessage`: `status.get` → `Promise.allSettled([version(), listModels(), loaded()])` → `status` (`E_DOWN` → `down`, `E_CORS` → `cors`, `E_BUSY` → `busy`, khác → `error`); `model.describe` → `describe()` → `model.described` (chưa cache 24 h — LEDGER, M2).
- `onConnect('snagon-job')`: `job.start` → ghi job, bắn `warmUp(model)` nền, lỗi warm-up chỉ log; `batch.translate` → `for await (chunk of provider.translate(batch, signal))`: `progress` → `seg.partial` (segId = segment duy nhất ở A; ở B gửi cho segment đầu với `text: ''`), `segment` → `seg.done`, `done` → gắn `stats` vào `seg.done` cuối cùng rồi với mỗi id **chưa có** `segment`: `doneReason === 'length'` → `seg.error E_TRUNC`, còn lại → `seg.error E_OUTPUT`. `SnagonError` → `seg.error` cho mọi segment của batch; `AbortError` → im lặng. `job.cancel`/`onDisconnect` → `controller.abort()` + xóa job.
- Chưa có hàng đợi, in-flight cap, retry, `job.ping` (M1/M2). Popup gửi một batch một lúc.

### 5.4 Verify trên runtime (Phát, ~10 phút)

1. `pnpm build` → `chrome://extensions` → Load unpacked `.output/chrome-mv3` → ID trùng ID trong PR.
2. Mở popup → Kiểm tra kết nối → thấy `cors` + lệnh với ID thật → chạy lệnh trong Terminal → Quit/mở lại Ollama.
3. Kiểm tra kết nối → `ok`, dropdown có model thật (D1).
4. `translategemma:12b` → Profile A → Dịch thử với `en` → có bản dịch + tok/s (D2a).
5. `gemma4:26b` → Profile B → Dịch thử → có bản dịch (D2b).
6. Dịch thử rồi bấm **Hủy** giữa chừng → dừng ngay; đóng popup giữa chừng → mở lại không treo.

## 6. Bench và probe

### 6.1 `bench/measure.ts`

- Chạy: `SNAGON_LIVE=1 pnpm bench -- [--model <tên>]… [--runs 3] [--probe] [--out bench/results]`. Không có `SNAGON_LIVE=1` → in hướng dẫn, exit 0. `SNAGON_OLLAMA_URL` override endpoint.
- Import thẳng `src/lib/provider/ollama.ts`, `src/lib/prompt/index.ts`, `src/lib/samples.ts`, `src/lib/tokens.ts` → số đo là request thật của extension.
- Model mặc định: `gemma4:26b`, `translategemma:12b`, `translategemma:27b`, `qwen3.5:27b`, `gemma4:26b-mlx`; `describe()` trả `E_MODEL` → ghi `skipped`, tiếp tục.
- Mỗi model: ghi `loaded_before` từ `/api/ps` → đo `warmUp` (ms) → với 5 ngôn ngữ × `runs`: một request 1 segment (`paragraph`); profile B thêm 1 request `batch3` (3 `sentences` cùng ngôn ngữ trong một batch, §5.4 batch đầu ≤ 3).
- CSV `bench/results/m0-<yyyymmdd>.csv` (commit): `ts, model, profile, lang, kind (warmup|single|batch3), run, ttft_ms, total_ms, prompt_eval_count, eval_count, eval_duration_ms, tok_s, done_reason, chars_in, chars_out, tag_ok, loaded_before`. `tag_ok` = tập placeholder `<n>`/`<n/>` của output bằng input (regex, không cần validator).
- JSONL `bench/results/m0-<yyyymmdd>.jsonl` (gitignore): `{ model, profile, lang, run, input, output }` để đọc chất lượng bằng mắt.
- Cuối cùng in bảng markdown `model | profile | warm-up ms | ttft ms (median) | tok/s (median) | tag_ok %` để dán vào spec §8.2.

### 6.2 `--probe` — ba giả định

| Probe | Cách đo | Đọc kết quả |
| --- | --- | --- |
| P1 `format` + `stream: true` (`gemma4:26b`, profile B, `batch3` tiếng Anh) | Đếm chunk có `message.content` trước `done`; ghép content → `JSON.parse` → so id | ≥ 2 chunk và JSON đúng schema đủ id = **ok**. Fail → profile B chuyển `stream: false` (fallback §7.3), chốt khi đóng M0 |
| P2 abort dừng sinh token (`translategemma:12b`) | TTFT baseline của request ngắn (`num_predict 16`) → request dài `num_predict 1024`, abort sau 5 chunk → lập tức gửi lại request ngắn, đo TTFT | `ttft_after − ttft_baseline < 1.500 ms` = **ok**; nếu ≈ thời gian sinh còn lại (nhiều giây, vì `OLLAMA_NUM_PARALLEL=1` xếp hàng) = **fail** → LEDGER + hạ `num_predict` ở M2. Đối chiếu tay bằng `~/.ollama/logs/server.log` |
| P3 `think: false` trên model không có `thinking` (`translategemma:12b`) | Một request profile B có `think: false` | HTTP 200 = ok; 400 = §6.2 sai → chỉ gửi `think` khi `capabilities` có `thinking` |

Kết quả ghi `bench/results/m0-probe-<yyyymmdd>.csv`: `ts, probe, model, result, detail`, và tóm tắt vào §7.3 + Residual của PR.

## 7. Test và verification

- `pnpm test` = Vitest, `environment: 'node'`, `tests/unit/**/*.test.ts`, không cần Ollama:
  - `ndjson`: chunk cắt giữa dòng, dòng dở cuối stream, CRLF, dòng rỗng, JSON hỏng một dòng → lỗi rõ.
  - `prompt`: template A **byte-exact** với chuỗi §6.1 (kể cả hai dòng trống) cho 5 mã nguồn; B có `system` §6.2, user là JSON đúng shape, `format` đúng schema, `think: false`; `num_ctx` luôn 8192; `keep_alive` `"10m"`; `num_predict` đúng công thức và trần 2.048; A từ chối batch > 1 segment.
  - `profile`: `translategemma:12b` → A, `translategemma` → A, `gemma4:26b` → B, `qwen3.5:27b` → B.
  - `errors`: bảng status → mã; `TypeError` → `E_DOWN`; `AbortError` giữ nguyên.
  - `ollama` (stub `fetch` trả `Response` với `ReadableStream` NDJSON): A yield `progress` → `segment` → `done` kèm stats đúng; B parse JSON → `segment` theo id, thiếu id → không yield, JSON hỏng → `E_OUTPUT`; `done_reason: length` → không `segment`; abort giữa stream → kết thúc sạch, không lỗi; fake timer: TTFT 60 s / idle 20 s → `E_TIMEOUT`; 403/404/503/500 → đúng mã; `warmUp` gửi body không `messages` nhưng có `options.num_ctx: 8192`.
  - `messages`: guard nhận đúng, từ chối thiếu trường/sai kiểu.
  - `tokens`: tỉ lệ 4 ngôn ngữ, làm tròn lên.
- Popup không test tự động ở M0 (verify tay mục 5.4). E2E, mock Ollama: M2.
- Xong mỗi task: `pnpm typecheck && pnpm lint && pnpm test`; xong M0: thêm `pnpm build`, CI xanh, mục 5.4 và 6 chạy thật, output dán vào completion report.

## 8. Quyết định và giả định đã chốt trong design

1. Profile chọn theo tên model, không theo `template` (mục 2). Patch spec §7.1 trong PR M0 cùng lúc ghi số đo.
2. Trần `num_predict` 2.048 cho cả A và B (§7.3 thắng §6.2).
3. Thêm mã `E_OUTPUT`; provider không yield `segment` cho output bị cắt; SW quy segment thiếu về `E_TRUNC`/`E_OUTPUT`.
4. `th` chars/token = 2,5 cho đến khi có số đo.
5. Popup là client M0; 403 chỉ hiện trong popup; content script và banner trong trang là M1.
6. Manifest đóng băng đúng §4 từ M0 (kể cả `commands`, `optional_host_permissions`); `options_ui` khi có Options.
7. Node 24 / pnpm 11.22 / TypeScript 5.x; thêm `typescript-eslint`; bench chạy bằng `node`, import đuôi `.ts`.
8. `.pem` ở `~/.config/snagon-dich-ai/`, chỉ public key vào repo.
9. Commit đầu trên `main` chỉ có tài liệu; code M0 qua PR `feat/m0-connection-spike`, dừng ở PR.
10. `/api/show` chưa cache; chưa retry/backoff/queue/ping — theo §13 là M1–M2.
11. Spec gọi module là `ollama-client.ts` (§10, §13); CLAUDE.md đặt ở `src/lib/provider/ollama.ts` — theo CLAUDE.md.
12. `samples[lang] = { paragraph, sentences[3] }`; một batch chỉ chứa một ngôn ngữ nguồn (`TranslateBatch.src`), nên `batch3` của bench là 3 câu cùng ngôn ngữ.

## 9. Ngoài phạm vi M0 → gieo vào `LEDGER.md`

- Cache `/api/show` 24 h (§7.1).
- Bảng retry/backoff §7.5; `E_TRUNC` retry với `num_predict × 2`.
- `job.ping` 20 s, reconnect/resume theo `(jobId, segId)` (§7.4).
- Hàng đợi ưu tiên + in-flight tối đa 2 (§5.4).
- Options: endpoint, model theo profile, tham số (§9.3).
- Ngân sách `num_predict` = 100 s × tok/s đo được (§7.3); EMA chars/token theo ngôn ngữ, hiệu chỉnh từ CSV M0.
- `E_PERM` + `permissions.request` cho endpoint LAN (M4).
- Nếu P1 fail: `stream: false` cho profile B, incremental JSON cho popover (M2).

## 10. Việc chỉ Phát làm được, theo thời điểm

| Khi nào | Việc | Vì sao em không làm |
| --- | --- | --- |
| Trước commit đầu | `sudo xcodebuild -license accept` trong Terminal | cần sudo |
| Khi em báo ID | `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<ID>"` rồi Quit/mở lại Ollama | CLAUDE.md cấm đổi cấu hình Ollama trên máy |
| Trước khi chạy bench | Gật cho `SNAGON_LIVE=1 pnpm bench` (~80 request, 15–25 phút GPU) | CLAUDE.md: bench hỏi trước |
| Tùy anh | `ollama pull qwen3.5:27b`, `ollama pull gemma4:26b-mlx` (~37 GB) | đụng `~/.ollama`; bench tự skip nếu thiếu |
| Cuối M0 | Review diff PR, verify mục 5.4, merge | Output-Gate là của anh |
