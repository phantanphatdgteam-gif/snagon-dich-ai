---
paths:
  - "src/lib/provider/**"
  - "src/lib/prompt/**"
  - "src/entrypoints/background*"
---

# Provider, prompt & service-worker rules (spec §6, §7)

- `fetch` chỉ tồn tại trong `src/lib/provider/`. Endpoint mặc định `http://127.0.0.1:11434`, override qua config; không hardcode `localhost` lẫn `127.0.0.1` ở nơi khác. `createOllamaProvider({ baseUrl, fetch })` nhận `fetch` inject để unit test bằng stub; `bench/measure.ts` import thẳng module này (số đo = request thật của extension).
- Request `/api/chat` chuẩn: `stream: true`, `keep_alive: "10m"`, `options.num_ctx: 8192` (KHÔNG đổi giữa các request), `seed: 42`, `num_predict` = min(2.048, 3 × tokensEst(in) + hằng) — trần 2.048 cho cả hai profile (§7.3 thắng §6.2). Profile B thêm `think: false` và `format` = JSON schema `{translations: [{id, text}]}`; profile A không gửi `system`, `think`, `format`.
- Ngân sách token đầu ra mỗi request = 100 s × tok/s đo được, trần 2.048 — để không request nào chạm giới hạn 5 phút của SW.
- Timeout: TTFT 60 s, idle giữa hai chunk 20 s, tổng 150 s; hủy bằng `AbortController`; port đóng → abort mọi fetch của `jobId`.
- Parse NDJSON theo dòng, chịu được chunk cắt giữa dòng; dòng `done: true` phải ghi `eval_count`, `eval_duration`, `prompt_eval_count`, `done_reason` vào stats (EMA chars/token theo ngôn ngữ). `done_reason === "length"` → `E_TRUNC`.
- Map lỗi: connection refused → `E_DOWN` (retry 3, backoff 1/2/4 s); 403 → `E_CORS` (không retry, banner kèm lệnh `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<chrome.runtime.id>"`); 404 → `E_MODEL`; 503 → `E_BUSY` (backoff 2/4/8 s, tối đa 3); 500 có "memory" → `E_OOM`; 400 khác → `E_BADREQ` (retry 1 lần không `format`); JSON profile B không parse được → `E_OUTPUT`. Provider KHÔNG yield segment cho output `done_reason: "length"`, cũng không cho text rỗng/toàn khoảng trắng (fail-closed); SW quy segment thiếu về `E_TRUNC` (length) hoặc `E_OUTPUT`.
- Retry/backoff của bảng trên là M2; M0 chỉ map mã lỗi, không retry.
- Warm-up khi job bắt đầu: `POST /api/chat` với `{model, keep_alive: "10m", options: {num_ctx: 8192}}` không `messages`, chạy song song với segmenter. `num_ctx` là load option của Ollama: thiếu nó thì model nạp ở context mặc định rồi reload ngay ở request dịch đầu tiên (đo 2026-09-21 trên server log: `19:34:36 n_ctx = 131072` → `19:34:37 n_ctx = 8192`).
- `/api/show` được cache 24 h (từ M2). Chọn profile theo **tên model**: `translategemma*` → A, còn lại → B — `template` từ `/api/show` không phân biệt được (translategemma trả template chat Gemma-3 chuẩn, gemma4 trả `{{ .Prompt }}`; kiểm 2026-09-21). Không gửi `think` trừ `false`.
- Template TranslateGemma (profile A) copy nguyên văn từ spec §6.1, HAI dòng trống trước `{TEXT}`; `SOURCE_CODE` ∈ {`en`, `ru`, `zh-Hans`, `zh-Hant`, `th`}.
- Đổi bất kỳ template nào → tăng `PROMPT_VERSION` (nằm trong cache key) và chạy lại golden set trước khi mở PR; hỏi Phát trước khi đổi.
- SW không giữ state job trong biến toàn cục ngoài map in-flight tạm; config ở `chrome.storage.local`, cache ở IndexedDB (extension origin), dedup resume theo `(jobId, segId)`.
- Không dùng `chrome.alarms` để giữ SW sống khi không có job.
