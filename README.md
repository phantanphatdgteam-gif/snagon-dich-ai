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

Ollama chỉ chấp nhận origin đã khai báo. Chạy lệnh này để tắt rồi mở lại Ollama kèm origin:

```bash
pkill -x Ollama; sleep 2; open -a Ollama --env 'OLLAMA_ORIGINS=chrome-extension://afdehlbopanflojemfiplepnfccgafge'
```

Kiểm tra bằng `curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: chrome-extension://afdehlbopanflojemfiplepnfccgafge" 127.0.0.1:11434/api/version` — phải trả `200`.

**Không dùng `launchctl setenv OLLAMA_ORIGINS …`** dù tài liệu Ollama khuyên vậy: trên macOS 26, app mở qua Finder/Dock không kế thừa biến của launchd, nên server vẫn khởi động với danh sách origin mặc định và trả 403. Đo 2026-09-21: `launchctl getenv` trả đúng giá trị, app đã restart sau khi đặt biến, nhưng log server vẫn ghi danh sách mặc định. Lệnh `open --env` chỉ có hiệu lực cho lần mở đó — mở Ollama từ Dock thì phải chạy lại.

ID ở trên là ID hiện tại của repo. Nếu `key` trong `wxt.config.ts` đổi, chạy lại `pnpm build && pnpm check:manifest` để lấy ID mới rồi đặt lại `OLLAMA_ORIGINS`.

Popup (M0): **Kiểm tra kết nối** → chọn model → **Dịch thử** (profile A cho `translategemma*`, B cho model khác) → **Hủy** để dừng giữa chừng. Nếu Ollama chưa có origin, popup tự in lệnh trên với ID thật.

## Phát triển

```bash
pnpm dev                          # Chrome riêng với extension, hot reload
pnpm typecheck && pnpm lint && pnpm test
SNAGON_LIVE=1 pnpm bench -- --runs 3    # đo TTFT/tok/s trên Ollama thật (chiếm GPU)
SNAGON_LIVE=1 pnpm bench -- --probe     # 3 giả định M0: format+stream, abort, think:false
```

Private key của extension nằm ngoài repo (`~/.config/snagon-dich-ai/snagon-dich-ai.pem`); chỉ public key vào `wxt.config.ts`.
