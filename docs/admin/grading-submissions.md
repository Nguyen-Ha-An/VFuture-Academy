# Grade assignment submissions

Submission grading requires branch-scoped `submission.grade`. Instructors and Branch Leads see their permitted branches; administrators may grade globally. The Studio submissions navigation is not yet enabled, so use the authenticated API until its UI is released.

## Grade a queue item

1. Load the queue with `GET /api/v1/studio/submissions`. Filter by `branchId`, `courseId`, or `status` (`submitted`, `in_review`, `approved`, `changes_requested`).
2. Confirm the learner, branch, course version, assignment item, attempt number, and submitted files before opening content.
3. Scan links/files according to the organization safety policy. Do not download suspicious files to a personal device.
4. Score only rubric criterion IDs declared in the published assignment. A score cannot exceed that criterion's `maxPoints`.
5. Write actionable feedback as one string or a `{ "vi": "…", "en": "…" }` object.
6. Choose `approved` or `changes_requested`. Set `release: false` while a second reviewer or moderation step is pending; set it to `true` only when the learner may see the grade.
7. Submit `POST /api/v1/studio/submissions/<submission-id>/grade?branchId=<branch-id>`:

   ```json
   {
     "rubricScores": { "criterion-id": 3 },
     "feedback": { "vi": "Phản hồi…", "en": "Feedback…" },
     "decision": "approved",
     "release": true
   }
   ```

8. Re-open the queue item, verify totals and visibility, and confirm the `submission.grade` audit entry.

A released approved grade is locked against later edits. If it is wrong, record an incident; do not work around the lock with direct database changes.
