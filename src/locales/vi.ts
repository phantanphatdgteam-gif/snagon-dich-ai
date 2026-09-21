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
  // macOS 26 does not pass launchd variables to apps opened through Launch Services, so the
  // documented `launchctl setenv` + restart leaves the server on its default origin list
  // (verified 2026-09-21 on Ollama 0.34.2). `open --env` sets the variable on the launch itself.
  corsCommand: (extensionId: string): string =>
    `pkill -x Ollama; sleep 2; open -a Ollama --env 'OLLAMA_ORIGINS=chrome-extension://${extensionId}'`,
  corsRestart:
    'Lệnh trên tự tắt rồi mở lại Ollama. Chỉ có hiệu lực cho lần mở đó — mở Ollama từ Dock thì phải chạy lại.',
  profileLabel: (profile: Profile): string =>
    profile === 'translategemma' ? 'Profile A (translategemma)' : 'Profile B (instruct-json)',
  statsLine: (ttftMs: number, tokPerSec: number, evalCount: number, doneReason: string): string =>
    `TTFT ${Math.round(ttftMs)} ms · ${tokPerSec.toFixed(1)} tok/s · ${evalCount} token · ${doneReason}`,
};
