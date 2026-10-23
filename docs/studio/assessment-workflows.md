# Assessment workflows

## Workspaces

- **Studio:** JSON authoring and preview, courses, library/media, question bank, content review and publication.
- **Assessment & grading / Khảo thí & đánh giá:** assessment inventory, grading queues/workbenches and learning reports together.
- **Admin:** people, schools/branches, roles, enrollment-version migration and audit.

The workspace selector shows spaces available to the signed-in account. The school/scope selector determines which records and actions are available within that workspace. Old bookmarks redirect to the owning workspace.

## Author, review and publish

Keep unfinished JSON in the editor's recovery draft. Save a valid draft, submit that revision for review, and publish after approval. Editing the draft or a reviewed dependency requires a fresh review. Preview and published content use the same strict content pipeline.

## Choose an assessment

- Use a **quiz** for automatically scored questions or unscored self-assessment/reflection (`selfAssessment: true`). Its completed score is shown immediately; answer keys and explanations follow the quiz's feedback settings.
- Use an **assignment or exam** for essay, code or upload questions that require an instructor's score. Exams can combine automatic and manual questions.
- **Authoring rejects a manually graded quiz question.** An `essay`, `upload_answer` or `code_answer` in a quiz — written inline, inside a question group, or pulled in by a `$ref` to a bank question — fails validation with `E_QUIZ_MANUAL_QUESTION` at that question's exact location, in both languages, so it can never be saved or published. The same question is valid in an exam or an assignment, and adding `"selfAssessment": true` keeps it in the quiz as an unscored reflection.
- **A quiz that still cannot be graded automatically returns `QUIZ_REQUIRES_MANUAL_GRADING`** instead of recording a misleading partial grade. This is now reachable only through content published before the authoring rule, including an unsupported historical regular expression. No new attempt, progress or XP is recorded, and the current answers remain in the open quiz; move the manually graded work into an assignment/exam. Historical records are not rewritten. `npm run inventory:quiz-manual -- --out recovery-evidence/quiz-manual.json` is a read-only inventory of already-published quizzes in this state. It writes nothing to the database, prints counts only — separating course versions that are still current from historical ones — and puts the per-question detail (course/version/item/quiz/question ids and the question type, never an answer key, learner answer or any personal record) in that git-ignored local artifact. `--input <rows.json>` runs the same scan offline over fixture rows. Missing live credentials are reported as such; no inventory is claimed.
- **An answer that is simply too long is not a grading failure.** The regular-expression matcher evaluates at most 1,000 characters, so a longer answer to an otherwise auto-gradable question returns `QUIZ_ANSWER_TOO_LONG` naming that question and the limit. The answer is not marked wrong, no attempt or XP is consumed, every answer stays editable, and the content needs no change — the learner shortens the answer and submits again.

**Tiếng Việt:** Quiz dùng cho câu chấm tự động hoặc tự đánh giá không tính điểm (`selfAssessment: true`); hệ thống từ chối lưu/xuất bản quiz có câu chấm tay. Câu cần giảng viên chấm phải đặt trong bài tập/bài thi. Nội dung cũ không chấm tự động được vẫn báo lỗi rõ ràng và không trừ lượt làm. Câu trả lời dài quá 1.000 ký tự chỉ báo lỗi độ dài — không bị tính là sai, không trừ lượt làm, học viên chỉ cần rút ngắn rồi nộp lại.

## Draft and complete grading

Save partial rubric/question scores while reviewing a submission. Draft scores can be edited. **Complete grading / Hoàn tất chấm** is available only after every required manual score is valid and the current edits are saved. Completion immediately makes the score and feedback available to the learner and locks further grading edits.

Automatic exams finish grading when submitted. Mixed exams keep partial scores private until the instructor completes grading. A repeated completion request returns the existing completed result without publishing twice.

Answer keys and explanations have their own configured review access. Completing grading does not unlock them. Use the assessment's review-release operation when its configuration calls for manual release.

## Historical results

Already graded but unpublished results keep their existing state. The new completion operation does not backfill or release them; use the historical release workflow. Published course versions, pinned assessment sources and old learner attempts remain unchanged.
