# Prompt mở đầu M1 — dán nguyên khối này vào phiên mới

Gõ `/superpowers:brainstorming` rồi dán phần trong khung dưới làm đối số. Phần còn lại của file là ghi chú cho Phát, agent không cần đọc.

---

```
Triển khai M1 — dịch trang lõi (replace mode) của Snagon - Dịch AI.

Đọc trước khi hỏi bất cứ câu nào:
- docs/spec/snagon-dich-ai-spec.md — §5 (pipeline, đọc cả 5.1→5.8), §5.6 (validator), §6 (prompt), §9.2 (UI trong trang), §10 (bảo mật), §11 (failure modes), §12 (fixture + tiêu chí A1/A3/A5/A8), §13 (dòng M1). Grep theo heading, đừng nạp cả file.
- CLAUDE.md — đặc biệt §8.2 (boundary pass, bắt buộc) và §10 khối "Đo được ở M0".
- .claude/rules/content-script.md — luật DOM, đã viết sẵn cho đúng M1 này.
- docs/superpowers/specs/2026-09-21-m0-connection-spike-design.md §8 — 12 quyết định M0 còn hiệu lực.
- docs/superpowers/plans/2026-09-21-m0-connection-spike.md — lấy làm mẫu cấu trúc plan.
- LEDGER.md — các món M1 phải trả.

Nền M0 đã có, dùng lại nguyên, KHÔNG thiết kế lại:
- src/lib/provider/ (Ollama client: stream NDJSON, abort, 3 timeout, fail-closed khi done_reason=length hoặc output rỗng)
- src/lib/prompt/ (profile A/B, buildChatRequest, parseTranslations)
- src/lib/{errors,messages,tokens,samples,log}.ts, src/locales/vi.ts
- src/entrypoints/background.ts — service worker, đã xử lý job.start / batch.translate / seg.* / job.cancel / port disconnect
- src/entrypoints/popup/ — hiện là client của giao thức job. Content script M1 nói ĐÚNG giao thức đó.

Phạm vi M1 theo §13: segmenter + placeholder; detect ngôn ngữ 4 nguồn; IntersectionObserver viewport-first; replace mode + hover xem gốc + Alt+H + nút khôi phục; cache IndexedDB ở SW; Alt+T; unit test + property test.
Điều kiện xong: A1 (≥95% block được dịch), A3 (khôi phục DOM nguyên vẹn), A5 property test placeholder round-trip, A8 (0 request ngoài endpoint) xanh trên 10 fixture tĩnh; và đọc được thật một bài Habr, một bài Zhihu, một trang tiếng Thái bằng gemma4:26b.

Ba điều M0 đo được làm đổi giả định của M1 — mang vào từ đầu:
1. Mặc định là gemma4:26b + profile B cho MỌI cặp ngôn ngữ (83,6 tok/s, tag_ok 100%). translategemma:12b XOÁ placeholder trên zh/th (0/9) nên không dùng cho hai thứ tiếng đó. Điều này ảnh hưởng thẳng tới quyết định batch size và tới việc plain-mode fallback của §6.1 có cần không.
2. TTFT warm chỉ 68 ms, tức nút thắt là tốc độ sinh chữ chứ không phải độ trễ đầu. Nhưng cold load thật 15,2 s cho model 8 GB, vượt ngưỡng A6 — warm-up ở đầu job là bắt buộc và phải gửi options.num_ctx 8192.
3. Ba giả định của spec đã đóng: format chạy cùng stream:true, abort dừng sinh token, think:false an toàn. Không cần thiết kế đường dự phòng cho chúng nữa.

Ràng buộc cứng của M1, đừng hỏi lại:
- Content script KHÔNG gọi mạng và KHÔNG mở IndexedDB (IDB ở đó thuộc origin trang) — mọi thứ qua Port tới SW.
- Cấm innerHTML/outerHTML/insertAdjacentHTML/eval/new Function; ESLint đã chặn kể cả literal. Output model chỉ vào DOM qua textContent và cây node dựng bằng createElement từ bản đồ placeholder; tên tag không bao giờ lấy từ output model.
- Style trong trang chỉ qua chrome.scripting.insertCSS, class .snagon-*; không chèn <style>, không gán chuỗi style="".
- MutationObserver bỏ qua node mang data-snagon; cap 3 lần dịch lại mỗi block trong 60 s (retranslation storm là lỗi thật đã thấy ở Read Frog).
- Thêm dependency ngoài idb/fast-check/jsdom/@playwright/test → hỏi trước.

Việc phải làm trong M1, đã ghi LEDGER:
- vitest.config.ts hiện environment 'node' và include chỉ tests/unit/** — segmenter/placeholder cần jsdom, nên task đầu tiên chạm vào đó phải sửa config.
- Hàng đợi ưu tiên viewport + in-flight tối đa 2 (§5.4).
- Cân nhắc tách attachJobPort/runBatch khỏi defineBackground ra src/lib/ để test được; M1 cần chính module đó cho content script.

Trước khi viết plan, chạy boundary pass theo CLAUDE.md §8.2 và ghi câu trả lời vào từng task brief. M0 mất ba vòng review vì plan tả kỹ happy path rồi bỏ lửng đường lỗi.

Quy trình: brainstorming → design lưu docs/superpowers/specs/ → em duyệt → worktree → writing-plans → em duyệt plan → subagent-driven-development → requesting-code-review → DỪNG ở PR, không merge.
Subagent tối thiểu Opus 5 effort max; task suy luận sâu dùng Fable 5.1; được chạy song song khi các task không đụng cùng file, và commit bằng pathspec (git commit -m "..." -- <paths>), không bao giờ git add -A.
```

---

## Ghi chú cho Phát (agent không cần đọc)

**Vì sao prompt dài như vậy.** Phiên mới không có ký ức phiên này. Ba thứ nó không thể tự suy ra mà lại đổi thiết kế M1: mặc định model đã đổi, ba giả định của spec đã đóng, và `vitest.config.ts` cần sửa. Nếu không nói, agent sẽ thiết kế lại đường dự phòng `stream: false` đã bị bác, hoặc chọn `translategemma:12b` cho tiếng Trung.

**Việc của anh trước khi bắt đầu M1:**

```bash
pkill -x Ollama; sleep 2; open -a Ollama --env 'OLLAMA_ORIGINS=chrome-extension://afdehlbopanflojemfiplepnfccgafge'
```

Nếu muốn bench đủ 5 model ở M3 thì pull thêm khi rảnh (~37 GB): `ollama pull qwen3.5:27b` và `ollama pull gemma4:26b-mlx`.

**Đáng cân nhắc trước khi vào M1:** M0 tiêu khá nhiều token vì 6 wave song song, mỗi wave một vòng review. M1 phức tạp hơn (segmenter và placeholder là nơi dễ sai nhất trong cả dự án) nên nếu muốn tiết kiệm, có thể cắt M1 làm hai PR: một PR cho `segmenter` + `placeholder` + property test (thuần TS, dễ test, dễ review), một PR cho render + observer + cache. Nói với agent ở bước brainstorming nếu anh chọn hướng đó.
