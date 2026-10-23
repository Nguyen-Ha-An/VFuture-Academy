import type { LessonBlockType } from '../schema/lesson';

export type BlockCategory = 'content' | 'container' | 'activity' | 'reserved';
export interface BlockManifestRow { type: LessonBlockType; category: BlockCategory; renderable: boolean; label: { vi: string; en: string } }

export const BLOCK_MANIFEST: BlockManifestRow[] = [
  { type: 'paragraph', category: 'content', renderable: true, label: { vi: 'Đoạn văn', en: 'Paragraph' } },
  { type: 'heading', category: 'content', renderable: true, label: { vi: 'Tiêu đề', en: 'Heading' } },
  { type: 'list', category: 'content', renderable: true, label: { vi: 'Danh sách', en: 'List' } },
  { type: 'quote', category: 'content', renderable: true, label: { vi: 'Trích dẫn', en: 'Quote' } },
  { type: 'image', category: 'content', renderable: true, label: { vi: 'Hình ảnh', en: 'Image' } },
  { type: 'video', category: 'content', renderable: true, label: { vi: 'Video', en: 'Video' } },
  { type: 'audio', category: 'content', renderable: true, label: { vi: 'Âm thanh', en: 'Audio' } },
  { type: 'table', category: 'content', renderable: true, label: { vi: 'Bảng', en: 'Table' } },
  { type: 'code', category: 'content', renderable: true, label: { vi: 'Mã nguồn', en: 'Code' } },
  { type: 'divider', category: 'content', renderable: true, label: { vi: 'Đường kẻ', en: 'Divider' } },
  { type: 'embed', category: 'content', renderable: true, label: { vi: 'Nhúng', en: 'Embed' } },
  { type: 'pdf', category: 'content', renderable: true, label: { vi: 'Tài liệu PDF', en: 'PDF' } },
  { type: 'callout', category: 'container', renderable: true, label: { vi: 'Khung chú ý', en: 'Callout' } },
  { type: 'math', category: 'reserved', renderable: false, label: { vi: 'Công thức', en: 'Math' } },
  { type: 'diagram', category: 'reserved', renderable: false, label: { vi: 'Sơ đồ', en: 'Diagram' } },
  { type: 'quiz', category: 'activity', renderable: true, label: { vi: 'Bài trắc nghiệm', en: 'Quiz' } },
  { type: 'assignment', category: 'activity', renderable: true, label: { vi: 'Bài nộp', en: 'Assignment' } },
  { type: 'reflection', category: 'activity', renderable: true, label: { vi: 'Suy ngẫm', en: 'Reflection' } },
  { type: 'flashcards', category: 'activity', renderable: true, label: { vi: 'Thẻ ghi nhớ', en: 'Flashcards' } },
  { type: 'accordion', category: 'container', renderable: true, label: { vi: 'Mục xếp gọn', en: 'Accordion' } },
  { type: 'tabs', category: 'container', renderable: true, label: { vi: 'Thẻ chuyển', en: 'Tabs' } },
  { type: 'reveal', category: 'container', renderable: true, label: { vi: 'Nhấn để xem', en: 'Reveal' } },
  { type: 'stepper', category: 'container', renderable: true, label: { vi: 'Từng bước', en: 'Stepper' } },
  { type: 'resource_link', category: 'activity', renderable: true, label: { vi: 'Tài nguyên', en: 'Resource link' } },
  { type: 'opportunity_link', category: 'activity', renderable: true, label: { vi: 'Cơ hội', en: 'Opportunity link' } },
  { type: 'next_step', category: 'activity', renderable: true, label: { vi: 'Bước tiếp theo', en: 'Next step' } },
];
export const RENDERABLE_BLOCK_TYPES = BLOCK_MANIFEST.filter((b) => b.renderable).map((b) => b.type);
export const isRenderableBlock = (type: string) => RENDERABLE_BLOCK_TYPES.includes(type as LessonBlockType);
export const blockCategory = (type: string) => BLOCK_MANIFEST.find((b) => b.type === type)?.category;
