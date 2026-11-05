import type { Locale } from '@/content-engine';

const en = {
  dashboard: 'Dashboard', welcome: 'Your learning, at a glance.', continueLearning: 'Continue learning', resumeExam: 'Resume exam',
  courses: 'My courses', allCourses: 'All courses', tasks: 'To do', feedback: 'Recent feedback',
  noTasks: 'You have no upcoming tasks.', noFeedback: 'Feedback will appear here after your work is reviewed.',
  tasksTitle: 'All tasks', tasksDescription: 'Assignments and exams from your courses, including work without a due date.', noAllTasks: 'Your courses have no assignments or exams yet.',
  submittedLate: 'Submitted late', lateNote: 'Recorded at submission. No automatic score penalty.',
  overview: 'Overview', modules: 'Modules', assignments: 'Assignments', grades: 'Grades',
  announcements: 'Announcements', calendar: 'Calendar', results: 'Results',
  noAnnouncements: 'No announcements have been published.', noEvents: 'Nothing scheduled for this month.',
  noResults: 'No recorded results yet.', noAssignments: 'This course has no assignments or exams yet.',
  resultsNote: 'Recorded scores are shown for released results. A course total is not calculated.',
  score: 'Score', activity: 'Activity', course: 'Course', status: 'Status', recorded: 'Recorded',
  due: 'Due', noDue: 'No due date', open: 'Open', submitted: 'Submitted', completed: 'Completed',
  pending: 'Not started', inProgress: 'In progress', inReview: 'In review', changesRequested: 'Changes requested', required: 'Required', optional: 'Optional',
  exam: 'Exam', assignment: 'Assignment', lesson: 'Lesson', agenda: 'Agenda', today: 'Today',
  previousMonth: 'Previous month', nextMonth: 'Next month', month: 'Month', calendarNote: 'Dates and times use Vietnam time (ICT).',
  announcementsNote: 'Updates from your school and course team.', unavailable: 'This information could not be loaded. Please try again.',
  browse: 'Browse courses', next: 'Next activity', progress: 'Course progress', recent: 'Recent activity',
  allTasks: 'View all tasks', allResults: 'View results', published: 'Published', finished: 'You’re all caught up.',
  chooseCourse: 'Choose a course to start learning.', viewCourse: 'Open course', courseInformation: 'Course information',
  school: 'School', task: 'Task', examOpens: 'Exam opens', examCloses: 'Exam closes',
  weekDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};
type Copy = typeof en;
const vi: Copy = {
  dashboard: 'Tổng quan', welcome: 'Theo dõi việc học của bạn.', continueLearning: 'Tiếp tục học', resumeExam: 'Tiếp tục bài thi',
  courses: 'Khóa học của tôi', allCourses: 'Tất cả khóa học', tasks: 'Việc cần làm', feedback: 'Nhận xét gần đây',
  noTasks: 'Bạn chưa có nhiệm vụ sắp tới.', noFeedback: 'Nhận xét sẽ xuất hiện sau khi bài làm được đánh giá.',
  tasksTitle: 'Tất cả nhiệm vụ', tasksDescription: 'Bài tập và bài thi trong các khóa học, bao gồm cả hoạt động chưa có hạn nộp.', noAllTasks: 'Các khóa học của bạn chưa có bài tập hoặc bài thi.',
  submittedLate: 'Nộp muộn', lateNote: 'Ghi nhận khi nộp bài. Không tự động trừ điểm.',
  overview: 'Giới thiệu', modules: 'Nội dung', assignments: 'Bài tập', grades: 'Điểm số',
  announcements: 'Thông báo', calendar: 'Lịch học', results: 'Kết quả',
  noAnnouncements: 'Chưa có thông báo được đăng.', noEvents: 'Chưa có lịch trong tháng này.',
  noResults: 'Chưa có kết quả được ghi nhận.', noAssignments: 'Khóa học chưa có bài tập hoặc bài thi.',
  resultsNote: 'Chỉ hiển thị điểm đã được công bố. Không tính điểm tổng kết khóa học.',
  score: 'Điểm', activity: 'Hoạt động', course: 'Khóa học', status: 'Trạng thái', recorded: 'Ghi nhận',
  due: 'Hạn nộp', noDue: 'Chưa có hạn nộp', open: 'Mở', submitted: 'Đã nộp', completed: 'Hoàn thành',
  pending: 'Chưa bắt đầu', inProgress: 'Đang thực hiện', inReview: 'Đang đánh giá', changesRequested: 'Cần chỉnh sửa', required: 'Bắt buộc', optional: 'Tùy chọn',
  exam: 'Bài thi', assignment: 'Bài tập', lesson: 'Bài học', agenda: 'Lịch trình', today: 'Hôm nay',
  previousMonth: 'Tháng trước', nextMonth: 'Tháng sau', month: 'Tháng', calendarNote: 'Ngày giờ hiển thị theo giờ Việt Nam (ICT).',
  announcementsNote: 'Cập nhật từ trường và đội ngũ khóa học.', unavailable: 'Không tải được thông tin. Vui lòng thử lại.',
  browse: 'Tìm khóa học', next: 'Hoạt động tiếp theo', progress: 'Tiến độ khóa học', recent: 'Hoạt động gần đây',
  allTasks: 'Xem tất cả nhiệm vụ', allResults: 'Xem kết quả', published: 'Đăng lúc', finished: 'Bạn đã hoàn thành các việc hiện tại.',
  chooseCourse: 'Chọn một khóa học để bắt đầu.', viewCourse: 'Mở khóa học', courseInformation: 'Thông tin khóa học',
  school: 'Trường', task: 'Nhiệm vụ', examOpens: 'Mở bài thi', examCloses: 'Đóng bài thi',
  weekDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
};
export function canvasCopy(locale: string): Copy { return locale === 'en' ? en : vi; }
export function canvasDate(value: string, locale: Locale | string, time = true): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
