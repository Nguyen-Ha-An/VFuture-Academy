import type { Locale } from '@/content-engine';

const copy = {
  en: {
    home: 'Home', overview: 'Project overview', projectRecord: 'Project record', updated: 'Updated', created: 'Created',
    outputs: 'Explore the work', learning: 'Connected learning', overviewOpportunity: 'About this opportunity',
    application: 'Application details', organization: 'Organization', continueNote: 'Sign in to check your eligibility and continue your application.',
    noApplication: 'An application route has not been published for this opportunity.',
    eligibilityNote: 'Course requirements are checked after you sign in. Additional requirements may be listed in the description.',
    viewProject: 'Explore project', viewOpportunity: 'View details', noCover: 'Project record',
    emptyHint: 'Try adjusting the filters, or return to the full collection.', reset: 'Clear filters',
    skillFilter: 'Skill', courseFilter: 'Course', allCourses: 'All courses', unavailableCourse: 'Selected course unavailable',
    skillFilterHint: 'Use the exact skill tag shown on a project.',
    filterOpportunities: 'Filter opportunities', details: 'Details', skills: 'Skills',
  },
  vi: {
    home: 'Trang chủ', overview: 'Tổng quan dự án', projectRecord: 'Thông tin dự án', updated: 'Cập nhật', created: 'Khởi tạo',
    outputs: 'Khám phá sản phẩm', learning: 'Học tập liên quan', overviewOpportunity: 'Về cơ hội này',
    application: 'Thông tin ứng tuyển', organization: 'Đơn vị tổ chức', continueNote: 'Đăng nhập để kiểm tra điều kiện và tiếp tục ứng tuyển.',
    noApplication: 'Cơ hội này chưa công bố hình thức ứng tuyển.',
    eligibilityNote: 'Điều kiện khóa học được kiểm tra sau khi đăng nhập. Các yêu cầu khác có thể được nêu trong phần mô tả.',
    viewProject: 'Khám phá dự án', viewOpportunity: 'Xem chi tiết', noCover: 'Thông tin dự án',
    emptyHint: 'Thử điều chỉnh bộ lọc hoặc xem lại toàn bộ danh sách.', reset: 'Xóa bộ lọc',
    skillFilter: 'Kỹ năng', courseFilter: 'Khóa học', allCourses: 'Tất cả khóa học', unavailableCourse: 'Khóa học đã chọn không còn khả dụng',
    skillFilterHint: 'Nhập đúng tên thẻ kỹ năng hiển thị trên dự án.',
    filterOpportunities: 'Lọc cơ hội', details: 'Chi tiết', skills: 'Kỹ năng',
  },
} as const;

export const discoveryCopy = (locale: Locale) => copy[locale];

export function discoveryDate(value: string | null | undefined, locale: Locale, withTime = false): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } as const : {}),
  }).format(new Date(value));
}
