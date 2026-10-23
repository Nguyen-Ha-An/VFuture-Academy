import type { QuestionType } from '../schema/questions';

export interface PlayerRow { id: string; type: QuestionType; interactionType: string; isDefault: boolean; label: { vi: string; en: string }; family: 'choice' | 'text' | 'structure' | 'manual' | 'wrapper' }

export const PLAYER_MANIFEST: PlayerRow[] = [
  { id: 'P01', type: 'single_choice', interactionType: 'radio', isDefault: true, label: { vi: 'Chọn một (radio)', en: 'Single choice (radio)' }, family: 'choice' },
  { id: 'P02', type: 'single_choice', interactionType: 'button', isDefault: false, label: { vi: 'Chọn một (nút)', en: 'Single choice (buttons)' }, family: 'choice' },
  { id: 'P03', type: 'single_choice', interactionType: 'dropdown', isDefault: false, label: { vi: 'Chọn một (danh sách thả)', en: 'Single choice (dropdown)' }, family: 'choice' },
  { id: 'P04', type: 'single_choice', interactionType: 'image', isDefault: false, label: { vi: 'Chọn một (ảnh)', en: 'Single choice (image cards)' }, family: 'choice' },
  { id: 'P05', type: 'multiple_choice', interactionType: 'checkbox', isDefault: true, label: { vi: 'Chọn nhiều (checkbox)', en: 'Multiple choice (checkbox)' }, family: 'choice' },
  { id: 'P06', type: 'multiple_choice', interactionType: 'button', isDefault: false, label: { vi: 'Chọn nhiều (nút)', en: 'Multiple choice (buttons)' }, family: 'choice' },
  { id: 'P07', type: 'multiple_choice', interactionType: 'image', isDefault: false, label: { vi: 'Chọn nhiều (ảnh)', en: 'Multiple choice (image cards)' }, family: 'choice' },
  { id: 'P08', type: 'true_false', interactionType: 'boolean', isDefault: true, label: { vi: 'Đúng / Sai', en: 'True / False' }, family: 'choice' },
  { id: 'P09', type: 'true_false', interactionType: 'yes_no', isDefault: false, label: { vi: 'Có / Không', en: 'Yes / No' }, family: 'choice' },
  { id: 'P10', type: 'fill_blank', interactionType: 'text', isDefault: true, label: { vi: 'Điền chỗ trống (gõ)', en: 'Fill in the blank (typed)' }, family: 'text' },
  { id: 'P11', type: 'fill_blank', interactionType: 'dropdown', isDefault: false, label: { vi: 'Điền chỗ trống (chọn)', en: 'Fill in the blank (dropdown)' }, family: 'text' },
  { id: 'P12', type: 'fill_blank', interactionType: 'word_bank', isDefault: false, label: { vi: 'Kéo từ vào chỗ trống', en: 'Word bank' }, family: 'text' },
  { id: 'P13', type: 'short_answer', interactionType: 'text', isDefault: true, label: { vi: 'Trả lời ngắn', en: 'Short answer' }, family: 'text' },
  { id: 'P14', type: 'numeric', interactionType: 'numeric', isDefault: true, label: { vi: 'Nhập số', en: 'Numeric entry' }, family: 'text' },
  { id: 'P15', type: 'matching', interactionType: 'columns', isDefault: true, label: { vi: 'Nối hai cột', en: 'Match two columns' }, family: 'structure' },
  { id: 'P16', type: 'matching', interactionType: 'lines', isDefault: false, label: { vi: 'Nối bằng đường', en: 'Connect with lines' }, family: 'structure' },
  { id: 'P17', type: 'ordering', interactionType: 'list', isDefault: true, label: { vi: 'Sắp xếp danh sách', en: 'Reorder list' }, family: 'structure' },
  { id: 'P18', type: 'ordering', interactionType: 'timeline', isDefault: false, label: { vi: 'Xếp lên dòng thời gian', en: 'Timeline placement' }, family: 'structure' },
  { id: 'P19', type: 'classification', interactionType: 'buckets', isDefault: true, label: { vi: 'Phân loại vào nhóm', en: 'Sort into buckets' }, family: 'structure' },
  { id: 'P20', type: 'essay', interactionType: 'long_text', isDefault: true, label: { vi: 'Tự luận', en: 'Essay' }, family: 'manual' },
  { id: 'P21', type: 'upload_answer', interactionType: 'upload', isDefault: true, label: { vi: 'Nộp tệp / liên kết', en: 'Upload files / links' }, family: 'manual' },
  { id: 'P22', type: 'code_answer', interactionType: 'editor', isDefault: true, label: { vi: 'Viết mã', en: 'Code editor' }, family: 'manual' },
  { id: 'P23', type: 'question_group', interactionType: 'list', isDefault: true, label: { vi: 'Nhóm câu hỏi', en: 'Question group' }, family: 'wrapper' },
];

export const playerKey = (type: string, interactionType: string) => `${type}:${interactionType}`;
export const defaultInteraction = (type: QuestionType) => PLAYER_MANIFEST.find((p) => p.type === type && p.isDefault)!.interactionType;
export function resolvePlayer(type: QuestionType, interactionType?: string): { ok: true; player: PlayerRow } | { ok: false; valid: string[] } {
  const rows = PLAYER_MANIFEST.filter((p) => p.type === type);
  const player = interactionType ? rows.find((p) => p.interactionType === interactionType) : rows.find((p) => p.isDefault);
  return player ? { ok: true, player } : { ok: false, valid: rows.map((p) => p.interactionType) };
}
export const PLAYER_KEYS = PLAYER_MANIFEST.map((p) => playerKey(p.type, p.interactionType));
