# Run an exam

Exam operations are branch-scoped. Instructors and Branch Leads may operate only within branches where they hold `exam.release`; administrators may operate globally. The Studio exam navigation is not yet enabled, so the current operator workflow uses the authenticated Studio APIs.

## Before publishing

1. Set `settings.availability.openAt` and `closeAt` as ISO-8601 UTC timestamps. `openAt` must be earlier than `closeAt`.
2. Choose `lateSubmission: "reject"` or `"accept_flagged"`; document the learner policy before the window opens.
3. Verify the total/section timer, attempt limit, scoring policy, pool tags, shuffle behavior, navigation mode, and integrity settings.
4. Set review visibility explicitly: `showScore`, `showCorrectAnswers`, and `showExplanations` are `immediately`, `on_release`, or `never`. Set `releaseAt` only for an approved automatic release time.
5. Complete the course publishing checklist and test with a non-admin learner account.
6. Confirm the scheduled internal exam sweep is configured with `CRON_SECRET`; it settles expired in-progress attempts.

## During the window

- Monitor application errors and capacity; do not change the published exam or its answer keys.
- List attempts with `GET /api/v1/studio/exams/<item-id>/attempts?branchId=<branch-id>&courseVersionId=<version-id>`.
- Treat the server deadline as authoritative. Record any extension or incident decision outside the learner session.
- Never inspect or alter a learner's answer payload directly in the database.

## Manual grading and release

1. Wait for an attempt to reach `pending_manual`.
2. For every manual question, submit points within its snapshotted maximum plus appropriate feedback to `POST /api/v1/studio/exams/attempts/<attempt-id>/manual-grade`. Include `branchId`, `questionId`, `points`, and `feedback`.
3. Confirm the attempt becomes `graded`; partial manual grading can leave it pending.
4. Release the branch/version cohort with `POST /api/v1/studio/exams/<item-id>/release`, passing `branchId` and `courseVersionId`.
5. Review the returned `released` and `skipped` groups. Investigate skipped attempts rather than repeating the request blindly.
6. Verify one learner review view and the corresponding `exam.release`/grading audit entries.

Do not release correct answers while another authorized cohort is still inside its exam window.
