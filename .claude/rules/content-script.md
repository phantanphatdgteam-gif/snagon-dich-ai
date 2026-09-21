---
paths:
  - "src/entrypoints/content*"
  - "src/lib/segmenter/**"
  - "src/lib/placeholder/**"
  - "src/lib/validator/**"
---

# Content script & DOM rules (spec §5, §10)

- Đơn vị dịch là block lá (`p`, `h1`–`h6`, `li`, `td`/`th`, `blockquote`, `dd`/`dt`, `figcaption`, `div`/`section`/`article` chỉ chứa inline + text). Loại trừ: `script, style, noscript, template, pre, textarea, input, select, button, svg, math, canvas, iframe`, `[contenteditable]`, `[translate="no"]`, `.notranslate`, `[aria-hidden="true"]`, phần tử ẩn, node mang `data-snagon`.
- Inline giữ định dạng mã hóa thành `<n>…</n>` / `<n/>`; `code`/`kbd`/`var` là placeholder nguyên văn, không dịch. Khôi phục bằng clone shallow node gốc + `textContent`; tên tag KHÔNG BAO GIỜ lấy từ output model.
- Replace mode: thay cây con bên trong block gốc, block mang `data-snagon="r"`, cây gốc giữ trong `WeakMap<Element, DocumentFragment>`; chữ chỉ thay khi `done` và validator pass. Tag integrity fail 2 lần → song ngữ cục bộ cho block đó (gốc giữ nguyên, bản dịch text thuần dưới), đánh dấu ⚠. Mã lỗi cho output không hợp lệ (JSON hỏng, thiếu id, rỗng/rác) là `E_OUTPUT` (`src/lib/errors.ts`).
- Không `innerHTML`/`insertAdjacentHTML`; không `<style>` hay chuỗi `style=""` — style qua `chrome.scripting.insertCSS`, class `.snagon-*`.
- `getComputedStyle` chỉ gọi lúc xếp hàng (lazy), không trong lúc duyệt `TreeWalker` — tránh layout thrash.
- Khối > ~1.200 ký tự cắt theo câu bằng `Intl.Segmenter(locale, {granularity: 'sentence'})`; tiếng Thái dùng ngưỡng 12 ký tự thay cho "3 từ".
- MutationObserver: debounce 300 ms; bỏ qua mutation từ node/tổ tiên `data-snagon`; cap 3 lần dịch lại mỗi block trong 60 s rồi ngừng theo dõi block đó.
- Content script không gọi mạng, không đọc/ghi IndexedDB (IDB ở đây thuộc origin trang); mọi thứ qua Port tới SW với message trong `src/lib/messages.ts`.
- Mỗi hàm segmenter/placeholder/validator phải thuần (không `chrome.*`) để unit test bằng jsdom; property test round-trip là bắt buộc khi sửa placeholder.
