<!--
═════════════════════════════════════════════════════════CLAUDE.md — Snagon - Dịch AI · điền từ template ngày 2026-09-21 Nguồn sự thật về thiết kế: docs/spec/snagon-dich-ai-spec.md (export từ Spec trên Claude Docs, 16 mục). Mọi "§x" trong file này trỏ vào mục của spec đó. Repo chạy Claude Code với plugin superpowers (obra/superpowers). Vòng làm việc của plugin là: brainstorming → using-git-worktrees → writing-plans → subagent-driven-development / executing-plans (+ test-driven-development bên trong) → requesting-code-review → finishing-a-development-branch; bug → systematic-debugging; trước khi báo xong → verification-before-completion. File này KHÔNG chép lại nội dung các skill đó. Nó chỉ cung cấp context dự án và những điểm superpowers để "explicit user preference" quyết định: package manager, lệnh test/baseline, đường dẫn spec/plan, worktree, và điểm DỪNG ở PR. Khối comment này bị strip trước khi nạp context — không tốn token. ═════════════════════════════════════════════════════════
-->
# Snagon - Dịch AI

 

## 1. Project Context

 

- Mục tiêu: Chrome extension MV3 dịch trang web EN/RU/ZH/TH → VI bằng model local qua Ollama (`http://127.0.0.1:11434`), replace mode như Google Translate, 100% offline, không telemetry. Người dùng duy nhất là Phát trên MacBook Pro M5 Pro 64 GB; không publish Web Store.
- Spec đầy đủ: `docs/spec/snagon-dich-ai-spec.md` — nguồn sự thật. Spec và code mâu thuẫn → spec thắng, báo lại; spec sai → nói thẳng 1 câu rồi làm đúng phạm vi.
- Kiến trúc & lý do: content script chỉ đọc/ghi DOM và giữ state job; service worker (SW) là client Ollama DUY NHẤT vì content script mang origin của trang → Ollama trả 403 CORS và CSP trang chặn (§4). SW stateless vì Chrome kill nó bất kỳ lúc nào (30 s idle / 5 phút một request / fetch > 30 s chưa có response) → job resume từ content script theo `(jobId, segId)` (§7.4).
- Hai profile prompt (§6): A `translategemma` — đúng 1 user message theo template cố định, 1 segment/request; B `instruct-json` — system prompt + JSON schema qua `format`, batch ≤ 8 segment, luôn `think: false`. Không glossary, dịch hết; tên riêng/thương hiệu/ticker/số/URL/code giữ nguyên.
- Ràng buộc cứng: `num_ctx` 8192 cố định mọi request (đổi → Ollama reload model; mặc định trên máy này là 256K, quá lớn); tối đa 2 request in-flight; viewport-first rồi lazy khi cuộn; validator fail-closed — segment lỗi giữ gốc + đánh dấu (§5.4, §5.6, §8.3).
- Lộ trình (§13): M0 spike kết nối → M1 dịch trang lõi (replace mode) → M2 độ bền → M3 bake-off + site rules → M4 hoàn thiện. Mỗi milestone = một design + một plan superpowers + một PR có giới hạn.
- Ngoài phạm vi v1: glossary, song ngữ (M4), PDF/OCR, dịch ngược chiều khi soạn thảo, Firefox, adapter provider khác Ollama (M4).

 

## 2. Environment Setup

 

- OS/Shell: macOS 26 / zsh. Ollama 0.34.2 chạy dạng app menu bar (đã có engine MLX). Biến môi trường Ollama đặt bằng `launchctl setenv` rồi restart app — KHÔNG tự chạy, chỉ in lệnh cho Phát.
- Runtime: Node 24 (`.nvmrc` = `24`; cài tại `~/.local/node`, máy không có nvm/brew — kiểm 2026-09-21). Node 24 chạy `.ts` trực tiếp nên `pnpm bench` = `node bench/measure.ts`, không thêm `tsx`; import tương đối trong repo ghi đuôi `.ts`. Chrome ≥ 144 (manifest `minimum_chrome_version`; máy đang 153). `git` hệ thống chỉ chạy sau khi chấp nhận Xcode license (`sudo xcodebuild -license accept`) — Phát tự chạy, không sudo hộ.
- Package manager: pnpm 11 qua corepack (`packageManager: pnpm@11.22.0` trong `package.json`; corepack 0.35 nằm ở `~/.local/node/bin`) — không npm/yarn; không sửa tay `pnpm-lock.yaml`. Với superpowers worktree: setup bằng `pnpm install --frozen-lockfile`, baseline bằng `pnpm test` (không phải `npm install`/`npm test`).
- Tech stack: TypeScript 5.x `strict` (pin `^5.9`, không lên 7) · WXT (MV3, `srcDir: 'src'`) · không UI framework (vanilla DOM) · `idb` · Vitest + jsdom + fast-check · Playwright (Chromium, load unpacked từ `.output/chrome-mv3`) · ESLint + `typescript-eslint` + `eslint-plugin-no-unsanitized` · Prettier.
- Dependency được phép: đúng danh sách trên. Thêm bất kỳ package nào khác → hỏi trước. Mỗi milestone chỉ cài cái nó dùng (M0: `wxt`, `typescript`, `vitest`, `eslint`, `typescript-eslint`, `eslint-plugin-no-unsanitized`, `prettier`; `idb`/`fast-check`/`jsdom`/`@playwright/test` khi M1–M2 dùng).
- Biến môi trường (chỉ tên): `SNAGON_OLLAMA_URL` (override endpoint khi test), `SNAGON_LIVE` (`=1` mới chạy test/bench cần Ollama thật). Phía Ollama trên máy: `OLLAMA_ORIGINS`, `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_KEEP_ALIVE`.
- Dịch vụ phụ thuộc: Ollama thật ở `127.0.0.1:11434` — chỉ cho bench/live test. Mock Ollama `tests/mock-ollama/` ở `127.0.0.1:11435` cho integration và e2e (phát NDJSON, giả lập 403/404/503/500, `done_reason: length`, TTFT chậm).

 

## 3. Project Structure

 

- `src/entrypoints/`: `background.ts` (SW), `content.ts` (`all_frames: true`), `popup/`, `options/`. WXT sinh manifest từ `wxt.config.ts` — mọi thay đổi manifest chỉ ở file đó.
- `src/lib/provider/`: nơi DUY NHẤT được gọi `fetch` (`ollama.ts`; `openai-compatible.ts` ở M4). Interface `TranslateProvider` trong `types.ts`; pipeline không biết provider nào đang chạy.
- `src/lib/prompt/`: template A/B + hằng `PROMPT_VERSION` (nằm trong cache key). Đổi template = tăng version + chạy lại golden set.
- `src/lib/{segmenter,placeholder,validator,lang,cache}/` và `src/lib/{tokens,samples,log}.ts`: thuần TS, không phụ thuộc `chrome.*`, để unit test (jsdom chỉ khi cần DOM; provider/prompt test ở môi trường `node` với `fetch` stub inject qua `createOllamaProvider({ fetch })`).
- `src/lib/messages.ts`: mọi message CS↔SW (`job.start`, `batch.translate`, `seg.partial/done/error`, `job.cancel`, `job.ping`, `job.resume`, `status`, `config.changed`) và cặp request/response của popup (`status.get`→`status`, `model.describe`→`model.described`) khai báo + type guard ở đây; không gửi object ad-hoc. Chỉ khai báo message đã có code dùng (M0: `job.start`, `batch.translate`, `seg.partial/done/error`, `job.cancel` + 2 cặp popup).
- `src/lib/errors.ts`: mã lỗi `E_DOWN`, `E_CORS`, `E_MODEL`, `E_BUSY`, `E_OOM`, `E_TIMEOUT`, `E_TRUNC`, `E_BADREQ`, `E_PERM` (§7.5) + `E_OUTPUT` (output model không hợp lệ: JSON hỏng, thiếu id, rỗng/rác — bổ sung ở design M0 vì §5.6/§11 không đặt tên mã).
- `tests/unit`, `tests/integration` (qua mock Ollama), `tests/e2e` (Playwright), `tests/mock-ollama/`.
- `fixtures/pages/*.html`: 20 trang tĩnh (§12) — test không được gọi mạng ngoài.
- `bench/`: `measure.ts` (chạy bằng `node`; import thẳng `src/lib/provider` + `prompt` + `samples` để số đo = request thật; `--probe` đo 3 giả định M0), `golden/{en,ru,zh,th}.jsonl` (M3), `results/*.csv` (commit CSV; `*.jsonl` bản dịch thô thì gitignore).
- `docs/spec/` (spec export), `docs/superpowers/specs/` và `docs/superpowers/plans/` (superpowers tự ghi), `LEDGER.md` (nợ kỹ thuật, việc ngoài scope phát hiện khi làm).
- `.worktrees/`: worktree của superpowers, đã có trong `.gitignore`.

 

## 4. Coding Conventions

 

- ES modules; file `kebab-case.ts`; class/type `PascalCase`; hằng `UPPER_SNAKE_CASE`.
- Ngôn ngữ: identifier, comment, commit message tiếng Anh. Chuỗi UI tiếng Việt tập trung ở `src/locales/vi.ts`, không hardcode. Số hiển thị dùng `.` phân cách nghìn (`1.000`), `,` thập phân.
- Cấm `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`. Output của model chỉ vào DOM qua `textContent` và cây node dựng bằng `createElement` từ bản đồ placeholder (§10). ESLint đã chặn — không disable rule.
- Style trong trang chỉ qua `chrome.scripting.insertCSS` + class `.snagon-*`; không chèn `<style>`, không gán chuỗi `style=""`.
- Tiền tố kỹ thuật thống nhất: `data-snagon`, key storage `snagon.*`, class `.snagon-*`.
- Lỗi: mọi lỗi provider map sang mã `E_*`; không nuốt exception; không retry vô hạn (giới hạn theo bảng §7.5); mỗi segment tối đa 2 lần gọi model rồi về trạng thái `Failed`.
- Log qua `src/lib/log.ts`; không `console.log` trực tiếp trong content script.
- Không thêm option, config hay abstraction chưa có trong spec.

 

## 5. Common CLI Commands

 

- Cài đặt: `pnpm install --frozen-lockfile`
- Dev (mở Chrome với extension, hot reload): `pnpm dev`
- Build: `pnpm build` → `.output/chrome-mv3/`; đóng gói: `pnpm zip`
- Typecheck + lint: `pnpm typecheck && pnpm lint`
- Test một file (ưu tiên hơn cả suite): `pnpm test -- tests/unit/placeholder.test.ts`
- Test unit + integration: `pnpm test`
- E2E (tự build rồi chạy với mock Ollama): `pnpm test:e2e`
- Chạy mock Ollama riêng: `pnpm mock-ollama`
- Bench với Ollama thật (hỏi trước — chiếm GPU nhiều phút): `SNAGON_LIVE=1 pnpm bench -- --model gemma4:26b --runs 3` · probe 3 giả định (format+stream, abort, think:false): `SNAGON_LIVE=1 pnpm bench -- --probe`
- Kiểm tra Ollama: `curl -s 127.0.0.1:11434/api/version` · `ollama ps`

 

## 6. Testing & Verification

 

- Framework: Vitest (unit, integration) · fast-check (property) · Playwright (e2e).
- Vị trí: `tests/<tầng>/<module>.test.ts`; fixture ở `fixtures/`.
- Tiêu chí hoàn thành một task: `pnpm typecheck && pnpm lint && pnpm test` xanh; task đụng content script hoặc render → thêm `pnpm test:e2e` xanh.
- Quy tắc: TDD theo skill superpowers (test fail trước, implement tối thiểu, pass, commit). Property test bắt buộc cho `placeholder` (round-trip `decode(encode(x)) ≡ x`) và `validator` (không bao giờ pass output có tập tag khác input). Integration test chỉ đi qua mock Ollama; test cần Ollama thật gate bằng `SNAGON_LIVE=1` và tự skip khi thiếu.
- Tiêu chí nghiệm thu A1–A11 (§12) là điều kiện xong của MILESTONE, không phải của từng task.

 

## 7. Git Workflow

 

- Branch: `feat/m<N>-<slug>` theo milestone, `fix/<slug>`; làm trong worktree `.worktrees/<branch>`; không commit thẳng `main`.
- Commit: Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`), nhỏ — mỗi bước TDD một commit.
- PR: `gh pr create`, mô tả gồm What / Why / How to test / Assumptions / Residual. DỪNG tại PR: Phát review diff (Output-Gate) và tự merge. Không squash/rebase hộ, không `--force`.
- Việc ngoài scope phát hiện khi làm → một dòng trong `LEDGER.md`, không sửa trong PR hiện tại.

 

## 8. Agent Behaviors

 

### 8.1 Quy trình theo superpowers

 

- Feature/milestone mới: `brainstorming` lấy §tương ứng của spec làm đầu vào — không hỏi lại điều spec đã chốt (§14), chỉ hỏi điều spec để mở → design lưu `docs/superpowers/specs/` → Phát duyệt → `using-git-worktrees` → `writing-plans` với header `Spec:` trỏ `docs/spec/snagon-dich-ai-spec.md` → Phát duyệt plan (Plan-Gate) → M1–M3 chạy `subagent-driven-development`; fix nhỏ chạy `executing-plans` → `requesting-code-review` → `finishing-a-development-branch` chọn "mở PR", không merge.
- Bug: `systematic-debugging` trước mọi sửa. Cùng một hướng sửa thất bại 2 lần → dừng, báo cáo, đề xuất hướng khác.
- Trước khi báo xong: `verification-before-completion` bằng đúng lệnh mục 6, dán output thật.

 

### 8.2 Think Before Coding

 

- Nêu giả định trước khi code. Các cách hiểu dẫn tới kết quả khác nhau đáng kể → liệt kê và hỏi; còn lại tự quyết, ghi giả định vào báo cáo.
- STOP-on-surprise: thực tế mâu thuẫn spec/plan, cần đổi thiết kế, cần nới assert/test, cần đổi permission manifest → dừng, đóng băng trạng thái, báo cáo. Không tự quyết ngoài scope task.
- Search before building: trước khi viết module mới, kiểm tra `src/lib/` đã có chưa và ghi lại trong plan.

 

### 8.3 Simplicity & Surgical

 

- Code tối thiểu đúng yêu cầu; không abstraction, config hay "configurability" chưa ai cần.
- Chỉ chạm vào những gì task cần; theo style file sẵn có; không refactor lân cận. Dead code/bug không liên quan → `LEDGER.md`, không tự sửa.
- Thước đo: mỗi dòng diff truy về được một bước trong plan.

 

### 8.4 Communication

 

- Tiếng Việt; thuật ngữ, lệnh, đường dẫn, code giữ tiếng Anh.
- Trong lúc làm: 1 câu trước khi bắt đầu; sau đó chỉ cập nhật khi đổi hướng hoặc phát hiện điều quan trọng.
- Completion report theo thứ tự: kết quả → file đã sửa → lệnh kiểm tra + output → quyết định tự động đã đưa ra → còn gì chưa chắc.

 

### 8.5 Subagents

 

- Chỉ qua `subagent-driven-development` / `dispatching-parallel-agents`. Không dùng subagent để kiểm tra lại việc của chính mình; review hai giai đoạn (spec compliance → code quality) là của skill, không tự thêm vòng nữa.
- Model cho subagent: tối thiểu **Opus 5** với effort max, không dùng model thấp hơn (Sonnet/Haiku) cho bất kỳ vai nào — implementer, reviewer, re-reviewer; task cần suy luận sâu/phức tạp (thiết kế, debug khó, review cuối toàn branch) dùng **Fable 5.1**. Quy tắc này thắng mục "Model Selection" của skill.
- Được sinh nhiều agent chạy song song khi bối cảnh cho phép và các task không đụng cùng file/branch (không xung đột commit); mọi task ghi vào cùng một worktree thì chạy tuần tự.

 

## 9. Boundaries

 

- Tự làm: đọc mọi file; chạy test/lint/typecheck/build/mock; sửa `src/`, `tests/`, `fixtures/`, `bench/`, `docs/`, `LEDGER.md`.
- Hỏi trước: thêm/xóa dependency; đổi `permissions`, `host_permissions`, `key`, `minimum_chrome_version` trong `wxt.config.ts`; đổi `PROMPT_VERSION` hoặc template prompt; xóa file; chạy bench/live test; sửa `.claude/`, CI.
- Cấm tuyệt đối: gọi mạng ở bất kỳ đâu ngoài `src/lib/provider/`; viết `OLLAMA_ORIGINS=*` vào doc/script/README; commit `*.pem` (private key của extension); đổi cấu hình Ollama trên máy (`launchctl`, `~/.ollama`); push `main`, `git push --force`, merge PR; thêm telemetry/analytics.

 

## 10. Known Gotchas

 

- Ollama trả 403 khi request mang `Origin: chrome-extension://<id>` chưa có trong `OLLAMA_ORIGINS`; `host_permissions` của Chrome không sửa được việc này. Extension ID phải cố định bằng `key` — thiếu key thì ID đổi sau mỗi lần load unpacked và `OLLAMA_ORIGINS` vô hiệu.
- Content script không fetch được Ollama (origin trang + CSP `connect-src`) — mọi fetch ở SW.
- SW bị kill sau 30 s idle, 5 phút/request, hoặc fetch > 30 s chưa có response → `stream: true`, `job.ping` qua Port mỗi 20 s khi có job, state ở content script, resume theo `(jobId, segId)`. Không dùng alarm để giữ SW sống khi không có job.
- Đổi `num_ctx` (hoặc option nạp khác) giữa hai request → Ollama reload model, mất vài giây. Mặc định context máy này là 256K → khi bench bằng `ollama run` phải `/set parameter num_ctx 8192`.
- `think: false` gửi được cho mọi model; `think: true` trên model không hỗ trợ → HTTP 400. Model có thinking mà không gửi `think` = bật thinking.
- TranslateGemma: đúng 1 user message, không system, HAI dòng trống trước văn bản; sai template thì chất lượng rơi mà không có lỗi nào.
- `format` JSON schema cùng `stream: true` chưa được tài liệu Ollama xác nhận — M0 phải kiểm; nếu không chạy cùng, profile B dùng `stream: false` cho batch nhỏ.
- `/api/show` không phân biệt được profile: `translategemma:*` trả template chat Gemma-3 chuẩn, `gemma4:*` trả `{{ .Prompt }}` (kiểm 2026-09-21) → chọn profile theo tên model (`translategemma*` → A, còn lại → B), không theo `template` như spec §7.1 viết.
- Trần `num_predict` là 2.048 cho cả hai profile (§7.3); §6.2 ghi 4.096 cho B là mâu thuẫn — lấy 2.048.
- Extension ID: private key `.pem` ở `~/.config/snagon-dich-ai/`, ngoài repo; chỉ public key (base64 DER) vào `manifest.key` trong `wxt.config.ts`. ID suy từ public key nên load unpacked không cần `.pem`; `.pem` chỉ để ký `.crx`.
- IndexedDB mở từ content script thuộc origin của trang → cache phải nằm ở SW (extension origin).
- `<style>` chèn từ content script có thể bị CSP trang chặn → dùng `chrome.scripting.insertCSS`.
- MutationObserver bắt cả mutation do chính extension tạo → bỏ qua node mang `data-snagon`; cap 3 lần dịch lại/block/60 s (retranslation storm là lỗi thật đã thấy ở Read Frog).
- Playwright: extension chỉ chạy với persistent context + `--load-extension=.output/chrome-mv3` và headless mới (`channel: 'chromium'`); phải `pnpm build` trước e2e.
- `done_reason: "length"` nghĩa là bị cắt bởi `num_predict` — không phải bản dịch hoàn chỉnh; retry một lần với `num_predict × 2`.

 

## 11. Context & References

 

- Chỉ đọc khi cần: `docs/spec/snagon-dich-ai-spec.md` (dài \~660 dòng — đọc đúng § đang cần bằng grep heading, đừng nạp cả file mỗi phiên), `LEDGER.md`, `bench/results/`.
- Rule theo đường dẫn: `.claude/rules/content-script.md` (`paths: ["src/entrypoints/content*", "src/lib/segmenter/**", "src/lib/placeholder/**", "src/lib/validator/**"]`), `.claude/rules/provider.md` (`paths: ["src/lib/provider/**", "src/lib/prompt/**", "src/entrypoints/background*"]`).
- Khi compact context, luôn giữ: đường dẫn plan đang chạy + task hiện tại, file đã sửa, lệnh test đang dùng, giả định/quyết định đã chốt trong phiên, mã lỗi `E_*` đang debug.

