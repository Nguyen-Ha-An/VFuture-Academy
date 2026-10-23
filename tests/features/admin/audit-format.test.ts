import { describe, expect, it } from "vitest";

import {
  formatStaffAuditAction,
  formatStaffAuditTarget,
} from "@/features/admin/audit-format";

describe("staff audit action formatting", () => {
  it("uses a readable label for known audit actions", () => {
    expect(formatStaffAuditAction("user.account-status")).toEqual({
      label: "Account status changed",
      rawCode: null,
    });
    expect(formatStaffAuditAction("content.review.approve")).toEqual({
      label: "Content review approved",
      rawCode: null,
    });
  });

  it("keeps an unknown action code as secondary diagnostic detail", () => {
    expect(formatStaffAuditAction("future.workflow.done")).toEqual({
      label: "Future workflow done",
      rawCode: "future.workflow.done",
    });
  });

  it("formats known actions and targets in Vietnamese", () => {
    expect(formatStaffAuditAction("invitation.revoke", "vi")).toEqual({
      label: "Đã thu hồi lời mời",
      rawCode: null,
    });
    expect(formatStaffAuditAction("user.account-status", "vi")).toEqual({
      label: "Đã thay đổi trạng thái tài khoản",
      rawCode: null,
    });
    expect(formatStaffAuditTarget("user", "vi")).toBe("Thành viên");
    expect(formatStaffAuditTarget("branch", "vi")).toBe("Trường");
  });
});
