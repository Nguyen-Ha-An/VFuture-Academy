const ACTION_LABELS_EN: Readonly<Record<string, string>> = {
  "branch.create": "School created",
  "branch.created": "School created",
  "branch.update": "School updated",
  "branch.updated": "School updated",
  "content.ownership.assign": "Content ownership assigned",
  "content.publish": "Content published",
  "content.review.approve": "Content review approved",
  "content.review.changes_requested": "Content changes requested",
  "content.review.request": "Content review requested",
  "content.review.withdraw": "Content review withdrawn",
  "course.publish": "Course published",
  "course.restore": "Course restored",
  "invitation.accepted": "Invitation accepted",
  "invitation.create": "Invitation created",
  "invitation.revoke": "Invitation revoked",
  "profile.handle.updated": "Profile handle changed",
  "profile.visibility.updated": "Profile visibility changed",
  "project.delete": "Project deleted",
  "project.draft.update": "Project draft updated",
  "project.update": "Project updated",
  "role.create": "Role created",
  "role.update": "Role updated",
  "submission.grade": "Submission graded",
  "user.account-status": "Account status changed",
  "user.branch.assign": "School assignment changed",
  "user.branch_changed": "School assignment changed",
  "user.exact_email_lookup": "Exact email search performed",
  "user.membership-status": "Membership status changed",
  "user.role": "Role assignment changed",
  "user.role.set": "Role assignment changed",
  "user.role_granted": "Role granted",
  "user.role_revoked": "Role revoked",
};

const ACTION_LABELS_VI: Readonly<Record<string, string>> = {
  "branch.create": "Đã tạo trường",
  "branch.created": "Đã tạo trường",
  "branch.update": "Đã cập nhật trường",
  "branch.updated": "Đã cập nhật trường",
  "content.ownership.assign": "Đã phân quyền sở hữu nội dung",
  "content.publish": "Đã xuất bản nội dung",
  "content.review.approve": "Đã phê duyệt nội dung",
  "content.review.changes_requested": "Đã yêu cầu chỉnh sửa nội dung",
  "content.review.request": "Đã gửi yêu cầu duyệt nội dung",
  "content.review.withdraw": "Đã rút yêu cầu duyệt nội dung",
  "course.publish": "Đã xuất bản khóa học",
  "course.restore": "Đã khôi phục khóa học",
  "invitation.accepted": "Đã chấp nhận lời mời",
  "invitation.create": "Đã tạo lời mời",
  "invitation.revoke": "Đã thu hồi lời mời",
  "profile.handle.updated": "Đã thay đổi tên định danh hồ sơ",
  "profile.visibility.updated": "Đã thay đổi chế độ hiển thị hồ sơ",
  "project.delete": "Đã xóa dự án",
  "project.draft.update": "Đã cập nhật bản nháp dự án",
  "project.update": "Đã cập nhật dự án",
  "role.create": "Đã tạo vai trò",
  "role.update": "Đã cập nhật vai trò",
  "submission.grade": "Đã chấm bài nộp",
  "user.account-status": "Đã thay đổi trạng thái tài khoản",
  "user.branch.assign": "Đã thay đổi trường của thành viên",
  "user.branch_changed": "Đã thay đổi trường của thành viên",
  "user.exact_email_lookup": "Đã tìm kiếm chính xác theo email",
  "user.membership-status": "Đã thay đổi trạng thái thành viên",
  "user.role": "Đã thay đổi vai trò",
  "user.role.set": "Đã thay đổi vai trò",
  "user.role_granted": "Đã cấp vai trò",
  "user.role_revoked": "Đã thu hồi vai trò",
};

const TARGET_LABELS_EN: Readonly<Record<string, string>> = {
  assignment_submission: "Assignment submission",
  bank_question: "Question bank item",
  branch: "School",
  course: "Course",
  invitation: "Invitation",
  media_asset: "Media asset",
  opportunity: "Opportunity",
  profile: "Profile",
  project: "Project",
  resource: "Resource",
  role: "Role",
  user: "Member",
};

const TARGET_LABELS_VI: Readonly<Record<string, string>> = {
  assignment_submission: "Bài nộp",
  bank_question: "Câu hỏi trong ngân hàng đề",
  branch: "Trường",
  course: "Khóa học",
  invitation: "Lời mời",
  media_asset: "Tệp phương tiện",
  opportunity: "Cơ hội",
  profile: "Hồ sơ",
  project: "Dự án",
  resource: "Tài nguyên",
  role: "Vai trò",
  user: "Thành viên",
};

function readableCode(value: string) {
  const words = value.trim().split(/[._-]+/u).filter(Boolean).join(" ");
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Unknown activity";
}

function isVietnamese(locale: string) {
  return locale.toLowerCase().startsWith("vi");
}

export function formatStaffAuditAction(action: string, locale = "en"): {
  label: string;
  rawCode: string | null;
} {
  const label = (isVietnamese(locale) ? ACTION_LABELS_VI : ACTION_LABELS_EN)[
    action
  ];
  return label
    ? { label, rawCode: null }
    : {
        label: isVietnamese(locale) ? "Hoạt động khác" : readableCode(action),
        rawCode: action || null,
      };
}

export function formatStaffAuditTarget(targetType: string, locale = "en") {
  return (
    (isVietnamese(locale) ? TARGET_LABELS_VI : TARGET_LABELS_EN)[targetType] ??
    (isVietnamese(locale) ? "Đối tượng khác" : readableCode(targetType))
  );
}
