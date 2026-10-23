export const AUTHORING_RULES = {
  en: [
    'Output only the JSON document. No prose, no Markdown fences, no comments.',
    'Top level must include "schemaVersion": 1, "kind", and a kebab-case "id" (a-z, 0-9, "-", max 64 chars).',
    'IDs must be unique within their scope and stable: never rename an id when revising.',
    'Every activity block (quiz, assignment, reflection, flashcards, accordion, tabs, reveal, stepper, resource_link, opportunity_link, next_step) needs an "id". Pure content blocks do not.',
    'Text fields may be a plain string or a locale map { "vi": "...", "en": "..." }. RichContent may be { "blocks": [...] } or { "vi": { "blocks": [...] }, "en": { "blocks": [...] } }. Always provide the default language.',
    'Rich text is an array of runs: { "text": "...", "annotations": { "bold": true } }. Never put HTML or Markdown inside "text".',
    'Blanks are inline runs { "blank": "b1" } and exist only inside fill_blank questions; declare each in "blanks" and answer each in "correctAnswer".',
    'Answer keys live only in "correctAnswer" and follow the shape for the type (see the table). Manual types (essay, upload_answer, code_answer) have no correctAnswer; give them a rubric.',
    'Give every auto-graded question an "explanation" and sensible "points". Give every image a meaningful "alt".',
    'Media: prefer { "assetId": "..." } from the media library; external URLs must be https and on an allowlisted host. Videos from YouTube/Vimeo use { "provider": "youtube", "url": "..." }.',
    'Keep a lesson under 60 minutes and under 150 blocks. Split long content into more lessons.',
    'Do not invent resource or opportunity ids; use only the ones provided.',
  ],
  vi: [
    'Chỉ xuất tài liệu JSON. Không văn bản mô tả, không khối Markdown, không chú thích.',
    'Cấp cao nhất phải có "schemaVersion": 1, "kind" và "id" dạng kebab-case (a-z, 0-9, "-", tối đa 64 ký tự).',
    'ID phải duy nhất trong phạm vi của nó và ổn định: không đổi id khi chỉnh sửa.',
    'Mọi khối hoạt động (quiz, assignment, reflection, flashcards, accordion, tabs, reveal, stepper, resource_link, opportunity_link, next_step) cần "id". Khối nội dung thuần không cần.',
    'Trường văn bản có thể là chuỗi hoặc bản đồ ngôn ngữ { "vi": "...", "en": "..." }. RichContent có thể là { "blocks": [...] } hoặc { "vi": { "blocks": [...] }, "en": { "blocks": [...] } }. Luôn có ngôn ngữ mặc định.',
    'Văn bản giàu là mảng run: { "text": "...", "annotations": { "bold": true } }. Không đưa HTML hay Markdown vào "text".',
    'Chỗ trống là run { "blank": "b1" } và chỉ dùng trong câu fill_blank; khai báo trong "blanks" và trả lời trong "correctAnswer".',
    'Đáp án chỉ nằm trong "correctAnswer" theo đúng dạng của loại câu hỏi (xem bảng). Loại chấm tay (essay, upload_answer, code_answer) không có correctAnswer; hãy cung cấp rubric.',
    'Mọi câu tự chấm phải có "explanation" và "points" hợp lý. Mọi hình ảnh phải có "alt" có ý nghĩa.',
    'Media: ưu tiên { "assetId": "..." } từ thư viện; URL ngoài phải là https và thuộc máy chủ cho phép. Video YouTube/Vimeo dùng { "provider": "youtube", "url": "..." }.',
    'Giữ bài học dưới 60 phút và dưới 150 khối. Tách nội dung dài thành nhiều bài.',
    'Không tự bịa id tài nguyên hay cơ hội; chỉ dùng các id được cung cấp.',
  ],
};
export const ANSWER_SHAPES: Record<string, string> = {
  single_choice: 'string (option id)', multiple_choice: 'string[] (option ids)', true_false: 'boolean', fill_blank: 'Record<blankId, string | string[]> (word_bank: wordBank ids)', short_answer: 'string[] accepted answers', numeric: 'number (+ tolerance)',
  matching: '[{ "left": id, "right": id }]', ordering: 'string[] item ids in correct order', classification: 'Record<itemId, categoryId>', essay: 'none — rubric', upload_answer: 'none — rubric', code_answer: 'none — rubric', question_group: 'none — children carry their own keys',
};
