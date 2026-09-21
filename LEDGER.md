# LEDGER — nợ kỹ thuật và việc ngoài scope

Mỗi dòng: `- [ ] <việc> — nguồn (§spec / PR) — milestone dự kiến`. Mục xong thì tick và ghi PR. Rà lại toàn bộ ở M4 (§13).

## Gieo từ design M0 (2026-09-21)

- [ ] Cài `OLLAMA_ORIGINS` cố định (LaunchAgent riêng hoặc script bọc) — hiện phải chạy `open -a Ollama --env ...` mỗi lần mở Ollama từ Dock; `launchctl setenv` vô hiệu trên macOS 26 (đo 2026-09-21) — M4
- [ ] Sao lưu private key `~/.config/snagon-dich-ai/snagon-dich-ai.pem` (mode 600, ngoài repo) — mất file này thì extension ID đổi, `OLLAMA_ORIGINS` im lặng trả 403. ID hiện tại: `afdehlbopanflojemfiplepnfccgafge` — M0

- [ ] Cache `/api/show` 24 h — §7.1 — M2
- [ ] Bảng retry/backoff §7.5; `E_TRUNC` retry với `num_predict × 2` — §7.5 — M2
- [ ] `job.ping` 20 s qua Port; reconnect/resume theo `(jobId, segId)` — §7.4 — M2
- [ ] Hàng đợi ưu tiên viewport + in-flight tối đa 2 — §5.4 — M1
- [ ] Options: endpoint, model theo profile, tham số — §9.3 — M2
- [ ] Ngân sách `num_predict` = 100 s × tok/s đo được; EMA chars/token theo ngôn ngữ (hiệu chỉnh từ `bench/results/m0-*.csv`, kể cả tỉ lệ `th` đang giả định 2,5) — §7.3, §5.4 — M2
- [ ] `E_PERM` + `permissions.request` cho endpoint LAN — §7.5 — M4
- [ ] Nếu probe P1 fail: profile B `stream: false`; incremental JSON cho popover — §7.3 — quyết khi đóng M0
- [ ] Patch spec §7.1 (chọn profile theo tên model) và §6.2 (trần `num_predict` 2.048) khi ghi số đo vào §8.2 — design M0 §8 — PR M0
