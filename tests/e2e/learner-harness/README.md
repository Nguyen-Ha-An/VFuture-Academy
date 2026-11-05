# Learner core browser fixture

Run `npx playwright test --config playwright.learner.config.ts` from the repository root. It starts the core fixture on strict port 4177, separate from the admin fixture on 4176. During an explicitly scheduled review slot, `npx vite --config tests/e2e/learner-harness/vite.config.ts --port 4287` serves the same fixture on the review port. Stop the other fixture before switching configurations; a reachable server on the same port is not evidence that the correct fixture is running.

The fixture imports actual learner page, shell, dashboard, catalog, course workspace, calendar, tasks and results components. Server auth/read functions and Next navigation are disposable local replacements. No credentials, database, migrations or backend writes are needed. Local checks remain local; GitHub Actions is deployment-only.

The ItemPlayer import is an explicit test bridge, not the production ItemPlayer orchestrator. It now mounts the actual LessonRenderer, AssignmentRenderer and ExamFlow components. ExamFlow uses actual ExamIntro/ExamPlayer/ExamReview with a typed local client. Upload, submit, progress and review responses are local fixture behavior. This proves component composition and interactions, not live authorization, storage delivery, grading correctness, autosave gateways or hosted recovery. The separate student `runtime.html` fixture exercises the production ItemPlayer and progress guard with its own disposable transport.

## Review settings

Append `lang=en|vi&theme=light|dark`; normal identity is Avery Nguyen and `longName=1` is the explicit name stress case.

`fixture=baseline|sparse|dense|empty|mixed-error|tasks-error` selects service records. Baseline has four task targets including the exam; dense has four enrolled courses, 12 unique task targets, six recorded results and five published announcements. Sparse keeps an enrolled course with empty secondary reads. Empty has no catalog records. Mixed-error keeps tasks available while results/announcements fail; tasks-error makes tasks unavailable while results/announcements remain available. Catalog filters and courseId filters actually filter those records.

Fixture, locale, theme and name-stress settings persist in test-only session state through unchanged production link URLs. Explicit `fixture=baseline` resets the core scenario and name stress. Independent cases should use a fresh browser context or explicit resets. Assignment/exam/upload state query flags are case-local and are not inherited by unrelated task links.

## Actual core routes

- `/app`; `/app/courses?tab=learning|discover`.
- `/app/courses/active?view=overview|modules|assignments|grades|announcements|calendar`; dense also registers data/design/systems. `/app/courses/available` is unenrolled, `/app/courses/completed` preserves Review-first-item behavior despite an unfinished optional lesson.
- `/app/tasks`; `/app/results`; `/app/calendar?month=2026-11`; `/app/explore`; `/app/loading`.
- `/app/courses/active/items/first|optional|long` uses actual LessonRenderer. Every task href resolves to its corresponding published outline item and item payload; assignments no longer point at the optional lesson.
- `/app/courses/active/items/exam?examState=active|intro|review|unreleased|restore-error|start-error|submit-error|review-error` uses actual ExamFlow. Active is the default for an in-progress task; submitted or graded task records default to their matching local flow phase. Scores are deterministic display fixtures, not backend grading of edited answers.
- `/app/courses/assignment-course/items/assignment?assignmentState=draft|submitted|unreleased|feedback|approved|late|unavailable|submit-error|submit-pending` uses actual AssignmentRenderer with immutable published version `assignment-fixture-published-v1`.
- `/app/courses/assignment-course/items/inline` uses actual LessonRenderer → AssignmentBlockRenderer and preserves embedded block ID `embedded-work`.
- Add `upload=pending|error`, then select a real local file through the rendered input to observe actual progress/cancel/error/retry controls. Add notes and submit to exercise submit failure/retry or pending controls. No network write occurs.

Baseline assignment targets are `active/items/research-assignment`, `active/items/research-journal`, and `active/items/reflection-assignment`. Dense targets have unique assignment-N item identities; each course has one registered exam target. Corresponding enrollment, outline, payload and submission session share the same per-course pinned version.

## Explicit limits

Unknown paths in this lightweight core entry still fall back to the dashboard; never count that fallback as route coverage. Supporting profile/resources/opportunities/projects routes belong to the student fixture, and unknown student paths show its unavailable fixture page. The canonical production catch-all and eight legacy redirects are checked by executing their actual page functions in `tests/lib/learner-aliases.test.ts`; that is not deployed HTTP proof.

The student fixture has an explicit real NotebookWorkspace route plus a disposable session response recipe in `notebook-ui.check.ts`; its iframe is a documented stand-in. This core fixture does not prove the canonical notebook RSC loader, JupyterLite/Python execution or Colab integration.

All browser contexts are disposable. Screenshots and failure traces use ignored Playwright output paths. A passing fixture does not establish hosted production readiness.
