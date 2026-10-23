export const reportCopy = {
  vi: {
    eyebrow: 'Báo cáo vận hành', title: 'Báo cáo học tập', description: 'Theo dõi kết quả học và công việc cần xử lý trong cùng phạm vi dữ liệu.',
    tabs: ['Tổng quan', 'Khóa học', 'Bài thi & câu hỏi', 'Khối lượng chấm'],
    branch: 'Trường', allBranches: 'Tất cả trường', course: 'Khóa học', allCourses: 'Tất cả khóa học', from: 'Từ ngày', to: 'Đến ngày', apply: 'Áp dụng', loading: 'Đang tải báo cáo…', error: 'Không tải được báo cáo. Vui lòng thử lại.', retry: 'Thử lại', empty: 'Chưa có dữ liệu',
    active: 'Học viên hoạt động', enrollments: 'Ghi danh mới', completion: 'Hoàn thành trong nhóm ghi danh', cohortHint: 'Số ghi danh mới trong kỳ đã hoàn thành đến cuối kỳ / tổng ghi danh mới trong kỳ.',
    quiz: 'Quiz', exam: 'Bài thi', assignment: 'Bài tập', type: 'Loại bài', attempts: 'Lượt nộp', average: 'Điểm trung bình', passed: 'Tỷ lệ đạt', sample: 'lượt đã chấm',
    current: 'Tồn đọng hiện tại · không phụ thuộc bộ lọc ngày', asOf: 'Cập nhật lúc', assignmentsPending: 'Bài tập chờ chấm', examsPending: 'Lượt thi chờ chấm tay', questionsPending: 'Câu hỏi chờ chấm tay', unpublished: 'Kết quả chưa công bố', openGrading: 'Mở chấm bài',
    question: 'Câu hỏi', version: 'Phiên bản', zero: 'Lượt 0 điểm', graded: 'Lượt đã chấm', zeroRate: 'Tỷ lệ 0 điểm', viewQuestion: 'Xem câu hỏi',
    unknown: 'Phạm vi gồm dữ liệu chưa xác định được trường tại thời điểm học. Dữ liệu này chỉ hiển thị cho Central.',
    datesHint: 'Ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh). Mặc định 30 ngày; tối đa 366 ngày.', publication: 'Kết quả', released: 'Đã công bố', unreleased: 'Chưa công bố', allResults: 'Tất cả kết quả', invalidDates: 'Chọn ngày bắt đầu không sau ngày kết thúc.',
    averageHint: 'Điểm trung bình tính theo phần trăm của từng lượt đã chấm xong; không gộp trung bình giữa các nhóm.',
  },
  en: {
    eyebrow: 'Operations reporting', title: 'Learning reports', description: 'Track learning outcomes and outstanding work within one data scope.',
    tabs: ['Overview', 'Courses', 'Exams & questions', 'Grading workload'],
    branch: 'School', allBranches: 'All schools', course: 'Course', allCourses: 'All courses', from: 'From', to: 'To', apply: 'Apply', loading: 'Loading reports…', error: 'Reports could not be loaded. Please try again.', retry: 'Retry', empty: 'No data yet',
    active: 'Active learners', enrollments: 'New enrollments', completion: 'Enrollment cohort completion', cohortHint: 'New enrollments in the period completed by its end / all new enrollments in the period.',
    quiz: 'Quiz', exam: 'Exam', assignment: 'Assignment', type: 'Assessment type', attempts: 'Submitted attempts', average: 'Average score', passed: 'Pass rate', sample: 'graded attempts',
    current: 'Current backlog · independent of date filters', asOf: 'Updated at', assignmentsPending: 'Assignments awaiting grading', examsPending: 'Exam attempts awaiting manual grading', questionsPending: 'Questions awaiting manual grading', unpublished: 'Unreleased results', openGrading: 'Open grading',
    question: 'Question', version: 'Version', zero: 'Zero-point answers', graded: 'Graded answers', zeroRate: 'Zero-point rate', viewQuestion: 'View question',
    unknown: 'Includes records whose historical school is unknown. These records are visible only to Central.',
    datesHint: 'Dates use Vietnam time (Asia/Ho_Chi_Minh). Defaults to 30 days; maximum 366 days.', publication: 'Results', released: 'Released', unreleased: 'Unreleased', allResults: 'All results', invalidDates: 'The start date must not be after the end date.',
    averageHint: 'Averages use each fully graded attempt’s percentage; group averages are never averaged together.',
  },
};
export type ReportCopy = typeof reportCopy.vi | typeof reportCopy.en;
