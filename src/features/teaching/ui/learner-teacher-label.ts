import type { CourseTeachers } from '../assignment-contracts';

/** A missing enrollment scope is distinct from a known school with no assigned teachers. */
export function learnerTeacherLabel(locale: 'en' | 'vi', enrolled: boolean, teachers: CourseTeachers | null): string {
  if (!enrolled) return locale === 'en' ? 'Available after enrollment' : 'Hiển thị sau khi ghi danh';
  if (!teachers) return locale === 'en' ? 'Teacher information unavailable' : 'Không thể tải thông tin giáo viên';
  if (teachers.branchScopeKnown === false) return locale === 'en' ? 'Enrollment school unknown; teachers cannot be determined' : 'Không xác định được trường ghi danh nên không thể xác định giáo viên';
  return teachers.teachers.map(teacher => teacher.displayName).join(', ') || (locale === 'en' ? 'No teachers assigned' : 'Chưa phân công giáo viên');
}
