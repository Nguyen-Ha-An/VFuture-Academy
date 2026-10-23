const enImport = {
  trigger: "Import", title: "Import course content",
  description: "Paste JSON or choose a JSON file, review the changes, then apply them.",
  course: "Whole course", item: "Single item", recovery: "Recovered edits", intentLabel: "Course import action",
  replaceIntent: "Replace current course", createIntent: "Create new course",
  sourceLabel: "JSON document", pastePlaceholder: "Paste a course, lesson, exam, or assignment JSON document…",
  fileLabel: "Choose JSON file", invalidJson: "This is not valid JSON.",
  invalidCourse: "This document does not match the course schema.", invalidItem: "Expected a lesson, exam, or assignment document.",
  missingItems: "A whole-course import must include every declared item document inline.", duplicateIds: "The course contains duplicate ids.",
  fileTooLarge: "The JSON file must be 2 MB or smaller.", fileReadError: "The JSON file could not be read.",
  replaceIdMismatch: "To replace this course, the imported course id must be {id}.",
  crossKind: "An item with this id already exists as {kind}. Change the id before importing.",
  targetModule: "Target module", noModules: "The current course has no module available for this item.",
  replaceItem: "Replace the existing {kind} with id {id}", replaceCourse: "Replace the current course draft with this document",
  summaryTitle: "Change summary", additions: "Additions", changes: "Changes", removals: "Removals", none: "None",
  createNotice: "This creates a separate course draft: {id}.", replaceNotice: "This replaces the open draft: {id}.",
  createDenied: "You do not have permission to create a course.", cancel: "Cancel", apply: "Apply to draft",
  create: "Create and save draft", working: "Importing…", genericError: "Import failed.",
  documentTooLarge: "One content document must be {limit} bytes or smaller.",
  recoveryInvalid: "This is not a recovered-edits file from Studio.",
  recoveryVersion: "This recovered-edits file was written by a different version of Studio and cannot be read.",
  recoveryCourseMismatch: "These recovered edits belong to another course. Open course {id} to restore them.",
  recoveryNotice: "The text is restored exactly as it was typed and stays on this device until it is valid and saved.",
  recoveryWrongMode: "This is a recovered-edits file. Choose Recovered edits to restore it.",
} as const;

const viImport = {
  trigger: "Nhập", title: "Nhập nội dung khóa học",
  description: "Dán JSON hoặc chọn tệp JSON, xem lại thay đổi rồi áp dụng.",
  course: "Toàn bộ khóa học", item: "Một mục", recovery: "Bản nháp đã phục hồi", intentLabel: "Cách nhập khóa học",
  replaceIntent: "Thay thế khóa học hiện tại", createIntent: "Tạo khóa học mới",
  sourceLabel: "Tài liệu JSON", pastePlaceholder: "Dán tài liệu JSON của khóa học, bài học, bài kiểm tra hoặc bài tập…",
  fileLabel: "Chọn tệp JSON", invalidJson: "Nội dung không phải JSON hợp lệ.",
  invalidCourse: "Tài liệu không khớp schema khóa học.", invalidItem: "Cần một tài liệu bài học, bài kiểm tra hoặc bài tập.",
  missingItems: "Bản nhập toàn khóa học phải chứa nội tuyến mọi tài liệu mục đã khai báo.", duplicateIds: "Khóa học chứa id trùng lặp.",
  fileTooLarge: "Tệp JSON phải có dung lượng không quá 2 MB.", fileReadError: "Không thể đọc tệp JSON.",
  replaceIdMismatch: "Để thay thế khóa học này, id của khóa học nhập vào phải là {id}.",
  crossKind: "Đã có mục cùng id thuộc loại {kind}. Hãy đổi id trước khi nhập.",
  targetModule: "Mô-đun đích", noModules: "Khóa học hiện tại chưa có mô-đun để chứa mục này.",
  replaceItem: "Thay thế {kind} hiện có với id {id}", replaceCourse: "Thay thế bản nháp khóa học hiện tại bằng tài liệu này",
  summaryTitle: "Tóm tắt thay đổi", additions: "Thêm mới", changes: "Thay đổi", removals: "Xóa", none: "Không có",
  createNotice: "Thao tác này tạo bản nháp khóa học riêng: {id}.", replaceNotice: "Thao tác này thay thế bản nháp đang mở: {id}.",
  createDenied: "Bạn không có quyền tạo khóa học.", cancel: "Hủy", apply: "Áp dụng vào bản nháp",
  create: "Tạo và lưu nháp", working: "Đang nhập…", genericError: "Nhập nội dung thất bại.",
  documentTooLarge: "Mỗi tài liệu nội dung phải có dung lượng không quá {limit} byte.",
  recoveryInvalid: "Đây không phải tệp bản nháp đã phục hồi của Studio.",
  recoveryVersion: "Tệp bản nháp đã phục hồi này được ghi bởi phiên bản Studio khác nên không thể đọc.",
  recoveryCourseMismatch: "Bản nháp đã phục hồi này thuộc khóa học khác. Hãy mở khóa học {id} để phục hồi.",
  recoveryNotice: "Nội dung được phục hồi đúng như đã nhập và chỉ nằm trên thiết bị này cho đến khi hợp lệ và được lưu.",
  recoveryWrongMode: "Đây là tệp bản nháp đã phục hồi. Hãy chọn Bản nháp đã phục hồi để dùng tệp này.",
} satisfies Record<keyof typeof enImport, string>;

export const dialogMessages = {
  en: { import: enImport },
  vi: { import: viImport },
} as const;

/** The exact kind names used in the single-item replacement confirmation. */
export const itemKindLabels: Record<'en' | 'vi', Record<'lesson' | 'exam' | 'assignment', string>> = {
  en: { lesson: 'lesson', exam: 'exam', assignment: 'assignment' },
  vi: { lesson: 'bài học', exam: 'bài kiểm tra', assignment: 'bài tập' },
};

export function replaceMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}
