import { CODES, type DiagnosticCode } from './codes';
import { refLabel, toRef, type DocumentRef } from './refs';
import type { Diagnostic, Range, Severity } from './types';

type Meta = Record<string, string | number>;
type Tpl = { vi: (m: Meta) => string; en: (m: Meta) => string; hint?: { vi: string; en: string } };
const m = (meta: Meta, k: string, fallback = '?') => (meta[k] ?? fallback).toString();

export const MESSAGES: Record<DiagnosticCode, Tpl> = {
  E_JSON_PARSE: { vi: (x) => `JSON không hợp lệ: ${m(x, 'detail')}`, en: (x) => `Invalid JSON: ${m(x, 'detail')}` },
  E_JSON_DUPLICATE_KEY: { vi: (x) => `Thuộc tính "${m(x, 'key')}" bị khai báo hai lần trong cùng một đối tượng`, en: (x) => `Property "${m(x, 'key')}" is declared twice in the same object`, hint: { vi: 'Xoá một trong hai khai báo; JSON không cho phép khoá trùng.', en: 'Remove one of the declarations; duplicate keys are not accepted.' } },
  E_JSON_NUMBER_RANGE: { vi: (x) => `Số "${m(x, 'received')}" ngoài phạm vi biểu diễn được`, en: (x) => `Number "${m(x, 'received')}" is outside the representable range` },
  E_JSON_ROOT_NOT_OBJECT: { vi: (x) => `Tài liệu phải là một đối tượng JSON, nhận được ${m(x, 'received')}`, en: (x) => `A document must be a JSON object, received ${m(x, 'received')}` },
  E_UNKNOWN_KIND: { vi: (x) => `Trường "kind" không hợp lệ: ${m(x, 'received')}. Cho phép: ${m(x, 'valid')}`, en: (x) => `Unknown "kind": ${m(x, 'received')}. Allowed: ${m(x, 'valid')}` },
  E_SCHEMA_VERSION_UNSUPPORTED: { vi: (x) => `schemaVersion ${m(x, 'received')} không được hỗ trợ (hiện tại: ${m(x, 'expected')})`, en: (x) => `schemaVersion ${m(x, 'received')} is not supported (current: ${m(x, 'expected')})` },
  E_SCHEMA: { vi: (x) => `Sai cấu trúc: ${m(x, 'detail')}`, en: (x) => `Schema violation: ${m(x, 'detail')}` },
  E_ID_FORMAT: { vi: () => 'ID phải là kebab-case (a-z, 0-9, "-"), tối đa 64 ký tự', en: () => 'id must be kebab-case (a-z, 0-9, "-"), max 64 chars' },
  E_DUPLICATE_ID: { vi: (x) => `ID "${m(x, 'id')}" bị trùng trong cùng phạm vi`, en: (x) => `Duplicate id "${m(x, 'id')}" within its scope` },
  E_MISSING_ITEM_DOCUMENT: { vi: (x) => `Mục "${m(x, 'id')}" (${m(x, 'type')}) chưa có tài liệu nội dung`, en: (x) => `Item "${m(x, 'id')}" (${m(x, 'type')}) has no document`, hint: { vi: 'Dán hoặc tải lên tài liệu có cùng id, hoặc viết nội dung trực tiếp trong manifest.', en: 'Paste or upload a document with the same id, or inline the body in the manifest.' } },
  E_ITEM_KIND_MISMATCH: { vi: (x) => `Mục "${m(x, 'id')}" khai báo ${m(x, 'expected')} nhưng tài liệu có kind = ${m(x, 'received')}`, en: (x) => `Item "${m(x, 'id')}" is declared as ${m(x, 'expected')} but its document has kind = ${m(x, 'received')}` },
  W_ORPHAN_ITEM_DOCUMENT: { vi: (x) => `Tài liệu "${m(x, 'id')}" không được manifest tham chiếu`, en: (x) => `Document "${m(x, 'id')}" is not referenced by the manifest` },
  E_WORKSPACE_ID_MISMATCH: { vi: (x) => `Tài liệu khoá học có id "${m(x, 'received')}" nhưng phải là "${m(x, 'expected')}"`, en: (x) => `The course document id is "${m(x, 'received')}" but must be "${m(x, 'expected')}"` },
  E_ITEM_ID_MISMATCH: { vi: (x) => `Tài liệu được lưu dưới khoá "${m(x, 'expected')}" nhưng khai báo id "${m(x, 'received')}"`, en: (x) => `Document is stored under "${m(x, 'expected')}" but declares id "${m(x, 'received')}"` },
  E_ITEM_NOT_DECLARED: { vi: (x) => `Tài liệu "${m(x, 'id')}" không được khai báo trong manifest`, en: (x) => `Document "${m(x, 'id')}" is not declared in the manifest` },
  E_ORPHAN_ITEM_DOCUMENT: { vi: (x) => `Tài liệu "${m(x, 'id')}" không được manifest tham chiếu`, en: (x) => `Document "${m(x, 'id')}" is not referenced by the manifest` },
  E_DUPLICATE_ITEM_DOCUMENT: { vi: (x) => `Có hai tài liệu cùng id "${m(x, 'id')}"`, en: (x) => `Two documents share the id "${m(x, 'id')}"` },
  W_STUB_METADATA_MISMATCH: { vi: (x) => `Tiêu đề/tóm tắt của mục "${m(x, 'id')}" trong manifest khác với tài liệu; tài liệu được ưu tiên`, en: (x) => `Manifest title/summary for "${m(x, 'id')}" differ from its document; the document wins` },
  E_NESTING_TOO_DEEP: { vi: (x) => `Khối lồng quá sâu (tối đa ${m(x, 'limit')})`, en: (x) => `Blocks nested too deep (max ${m(x, 'limit')})` },
  E_LIMIT_EXCEEDED: { vi: (x) => `Vượt giới hạn ${m(x, 'limit')}: ${m(x, 'received')} > ${m(x, 'expected')}`, en: (x) => `Limit exceeded for ${m(x, 'limit')}: ${m(x, 'received')} > ${m(x, 'expected')}` },
  E_AUTO_TYPE_MISSING_KEY: { vi: (x) => `Câu hỏi ${m(x, 'type')} cần "correctAnswer" (hoặc selfAssessment: true)`, en: (x) => `${m(x, 'type')} questions need "correctAnswer" (or selfAssessment: true)` },
  W_IGNORED_ANSWER_KEY: { vi: (x) => `"correctAnswer" bị bỏ qua với câu hỏi chấm tay (${m(x, 'type')})`, en: (x) => `"correctAnswer" is ignored for manually graded ${m(x, 'type')}` },
  E_QUIZ_MANUAL_QUESTION: { vi: (x) => `Quiz không chấm tay được: câu hỏi ${m(x, 'type')} cần giảng viên chấm`, en: (x) => `A quiz cannot contain a manually graded ${m(x, 'type')} question`, hint: { vi: 'Chuyển câu hỏi sang bài tập hoặc bài thi, hoặc đặt "selfAssessment": true để thành câu tự đánh giá không tính điểm.', en: 'Move the question to an assignment or exam, or set "selfAssessment": true to make it an unscored self-assessment.' } },
  E_ANSWER_SHAPE: { vi: (x) => `Đáp án sai dạng: ${m(x, 'detail')}`, en: (x) => `Answer key has the wrong shape: ${m(x, 'detail')}` },
  E_ANSWER_REF_UNKNOWN: { vi: (x) => `Đáp án tham chiếu id không tồn tại: "${m(x, 'id')}"`, en: (x) => `Answer key references an unknown id: "${m(x, 'id')}"` },
  E_OPTIONS_TOO_FEW: { vi: (x) => `Cần ít nhất ${m(x, 'expected')} lựa chọn`, en: (x) => `At least ${m(x, 'expected')} options are required` },
  E_BLANK_UNDECLARED: { vi: (x) => `Chỗ trống "${m(x, 'id')}" xuất hiện trong nội dung nhưng không có trong "blanks"`, en: (x) => `Blank "${m(x, 'id')}" appears in content but is not declared in "blanks"` },
  E_BLANK_UNUSED: { vi: (x) => `Chỗ trống "${m(x, 'id')}" được khai báo nhưng không xuất hiện trong nội dung`, en: (x) => `Blank "${m(x, 'id')}" is declared but never appears in content` },
  E_BLANK_OUTSIDE_FILL_BLANK: { vi: () => 'Run { blank } chỉ được dùng trong câu hỏi fill_blank', en: () => '{ blank } runs are only allowed inside fill_blank questions' },
  E_ORDERING_NOT_PERMUTATION: { vi: () => 'correctAnswer phải là hoán vị đầy đủ của các item id', en: () => 'correctAnswer must be a full permutation of the item ids' },
  E_PLAYER_UNKNOWN: { vi: (x) => `interactionType "${m(x, 'received')}" không hợp lệ cho ${m(x, 'type')}. Cho phép: ${m(x, 'valid')}`, en: (x) => `interactionType "${m(x, 'received')}" is not valid for ${m(x, 'type')}. Allowed: ${m(x, 'valid')}` },
  E_RENDERER_UNSUPPORTED: { vi: (x) => `Chưa có trình hiển thị cho "${m(x, 'type')}"`, en: (x) => `No renderer for "${m(x, 'type')}" yet` },
  E_REF_UNRESOLVED: { vi: (x) => `Không tìm thấy câu hỏi ngân hàng đã xuất bản "${m(x, 'id')}"`, en: (x) => `Published bank question "${m(x, 'id')}" not found` },
  E_REFERENCE_LOOKUP_FAILED: { vi: (x) => `Không kiểm tra được tham chiếu (${m(x, 'operation')}); hãy thử lại`, en: (x) => `References could not be checked (${m(x, 'operation')}); try again`, hint: { vi: 'Đây là lỗi tra cứu, không phải kết luận rằng tham chiếu thiếu.', en: 'This is a lookup failure, not a conclusion that the reference is missing.' } },
  E_POOL_UNSATISFIABLE: { vi: (x) => `Pool "${m(x, 'id')}" cần ${m(x, 'expected')} câu nhưng chỉ có ${m(x, 'received')} câu phù hợp`, en: (x) => `Pool "${m(x, 'id')}" needs ${m(x, 'expected')} questions but only ${m(x, 'received')} match` },
  E_POOL_SPEC: { vi: () => 'Pool phải có đúng một trong "from" hoặc "filter"', en: () => 'A pool needs exactly one of "from" or "filter"' },
  E_COMPLETION_TARGET_UNKNOWN: { vi: (x) => `Điều kiện hoàn thành tham chiếu "${m(x, 'id')}" không tồn tại`, en: (x) => `Completion rule references unknown "${m(x, 'id')}"` },
  E_NEXT_STEP_TARGET_UNKNOWN: { vi: (x) => `next_step trỏ tới "${m(x, 'id')}" không có trong khoá học`, en: (x) => `next_step targets "${m(x, 'id')}" which is not in this course` },
  E_PREREQ_SELF: { vi: () => 'Khoá học không thể là điều kiện tiên quyết của chính nó', en: () => 'A course cannot be its own prerequisite' },
  E_L10N_MISSING_DEFAULT: { vi: (x) => `Thiếu bản ngôn ngữ mặc định (${m(x, 'locale')})`, en: (x) => `Missing the default language (${m(x, 'locale')})` },
  E_L10N_UNKNOWN_LOCALE: { vi: (x) => `Ngôn ngữ "${m(x, 'locale')}" không nằm trong "languages"`, en: (x) => `Locale "${m(x, 'locale')}" is not in "languages"` },
  W_L10N_MISSING_TRANSLATION: { vi: (x) => `Thiếu bản dịch ${m(x, 'locale')}`, en: (x) => `Missing ${m(x, 'locale')} translation` },
  W_L10N_LANGUAGE_OVERRIDE: { vi: () => 'Ngôn ngữ của tài liệu khác khoá học; dùng thiết lập của khoá học', en: () => 'Document languages differ from the course; course settings win' },
  E_MEDIA_HOST_NOT_ALLOWED: { vi: (x) => `Máy chủ media "${m(x, 'host')}" không nằm trong danh sách cho phép`, en: (x) => `Media host "${m(x, 'host')}" is not allowlisted` },
  E_EMBED_HOST_NOT_ALLOWED: { vi: (x) => `Máy chủ nhúng "${m(x, 'host')}" không nằm trong danh sách cho phép`, en: (x) => `Embed host "${m(x, 'host')}" is not allowlisted` },
  W_EXTERNAL_MEDIA: { vi: () => 'Media dùng URL ngoài; nên tải lên để có assetId', en: () => 'Media uses an external URL; prefer uploading for an assetId' },
  E_ASSET_UNKNOWN: { vi: (x) => `Không tìm thấy asset "${m(x, 'id')}"`, en: (x) => `Asset "${m(x, 'id')}" not found` },
  E_RESOURCE_UNKNOWN: { vi: (x) => `Không tìm thấy tài nguyên "${m(x, 'id')}"`, en: (x) => `Resource "${m(x, 'id')}" not found` },
  E_OPPORTUNITY_UNKNOWN: { vi: (x) => `Không tìm thấy cơ hội "${m(x, 'id')}"`, en: (x) => `Opportunity "${m(x, 'id')}" not found` },
  E_BRANCH_UNKNOWN: { vi: (x) => `Không tìm thấy chi nhánh "${m(x, 'id')}"`, en: (x) => `Branch "${m(x, 'id')}" not found` },
  E_RESOURCE_ACTIVITY_BLOCK: { vi: () => 'Tài nguyên chỉ chứa khối nội dung, không chứa hoạt động', en: () => 'Resources may only contain content blocks, not activities' },
  W_NO_OBJECTIVES: { vi: () => 'Bài học chưa có mục tiêu học tập', en: () => 'Lesson has no learning objectives' },
  W_NO_EXPLANATION: { vi: () => 'Câu hỏi tự chấm chưa có giải thích', en: () => 'Auto-graded question has no explanation' },
  W_NO_ALT_TEXT: { vi: () => 'Hình ảnh thiếu mô tả thay thế (alt)', en: () => 'Image has empty alt text' },
  W_LESSON_TOO_LONG: { vi: (x) => `Bài học quá dài (${m(x, 'received')} ${m(x, 'limit')})`, en: (x) => `Lesson is very long (${m(x, 'received')} ${m(x, 'limit')})` },
  W_LESSON_NO_ACTIVITY: { vi: () => 'Bài học không có hoạt động tương tác', en: () => 'Lesson has no interactive activity' },
  W_COURSE_NO_OUTPUT: { vi: () => 'Khoá học chưa có bài nộp/sản phẩm đầu ra', en: () => 'Course has no assignment or final output' },
  W_COURSE_NO_NEXT_STEP: { vi: () => 'Khoá học chưa liên kết bước tiếp theo hoặc cơ hội', en: () => 'Course links to no next step or opportunity' },
  W_COURSE_NO_SKILLS: { vi: () => 'Khoá học chưa khai báo kỹ năng', en: () => 'Course declares no skills' },
  W_EXAM_NO_TIME_LIMIT: { vi: () => 'Bài kiểm tra không giới hạn thời gian', en: () => 'Exam has no time limit' },
  W_DUPLICATE_OPTION_TEXT: { vi: () => 'Hai lựa chọn có nội dung giống nhau', en: () => 'Two options have identical text' },
  W_POINTS_ZERO: { vi: () => 'Câu hỏi tự chấm có 0 điểm', en: () => 'Auto-graded question is worth 0 points' },
};

export interface DiagnosticInit {
  /** Authoritative document reference. Supply this or the legacy `docId`. */
  ref?: DocumentRef;
  /** Legacy label; `'manifest'` means the course document. */
  docId?: string;
  path: string;
  meta?: Meta;
  range?: Range;
  severity?: Severity;
  revision?: string;
}

export function makeDiagnostic(code: DiagnosticCode, o: DiagnosticInit): Diagnostic {
  const t = MESSAGES[code];
  const meta = o.meta ?? {};
  const ref = o.ref ?? toRef(o.docId ?? '');
  return {
    severity: o.severity ?? CODES[code],
    code,
    ref,
    docId: refLabel(ref),
    path: o.path,
    message: { vi: t.vi(meta), en: t.en(meta) },
    ...(t.hint ? { hint: t.hint } : {}),
    ...(o.range ? { range: o.range } : {}),
    ...(o.revision ? { revision: o.revision } : {}),
    ...(o.meta ? { meta } : {}),
  };
}

/** Stamps the source revision a batch of diagnostics was computed from. */
export const withRevision = (diagnostics: readonly Diagnostic[], revision?: string): Diagnostic[] =>
  revision ? diagnostics.map((d) => ({ ...d, revision })) : [...diagnostics];
export const formatDiagnostic = (d: Diagnostic, locale: 'vi' | 'en') => `${d.severity} ${d.code} ${d.docId} ${d.path}: ${d.message[locale]}`;
