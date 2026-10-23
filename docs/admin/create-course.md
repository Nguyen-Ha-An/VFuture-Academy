# Create a course with the prompt pack

Use this workflow for new course content. Editors and administrators need global `course.create` and `course.edit` permissions; a branch-scoped role cannot change shared course content.

## 1. Create the workspace

1. Open `/studio/courses` and select **New course**.
2. Choose a stable kebab-case course ID. IDs are permanent references; do not put dates or version numbers in them.
3. Select Vietnamese and/or English, set the default language, pathway, and level.
4. Create the course and open its workspace.

## 2. Generate from a prompt

Use the workspace prompt-pack action for the selected document. The server builds the prompt from the current draft and supports `outline`, `lesson`, `exam`, `quiz`, and `translate` prompts. If the UI control is unavailable, an authenticated editor can retrieve the same text from:

```text
GET /api/v1/studio/prompt-pack?courseId=<course-id>&kind=<kind>&itemId=<item-id>&locale=vi
```

`itemId` is needed for item-level prompts. Paste the prompt into the approved content-generation tool. Never include learner names, email addresses, submissions, access tokens, or other personal data. Ask for JSON only and do not weaken the prompt's schema, localization, age-range, media-host, or answer-key rules.

## 3. Import and review

1. Paste the generated JSON into the correct manifest or item editor.
2. Fix parse and schema errors before content review. Do not silence diagnostics by deleting required learning outcomes, grading data, alt text, or translations.
3. Review every visible string in Vietnamese and English. Machine translation is a draft, not an approval.
4. Preview every lesson, quiz, exam, assignment, resource link, and opportunity link.
5. Save the draft, reload the workspace, and confirm the saved content still renders.

Continue with the [publishing checklist](publishing-checklist.md). Generated content is untrusted until a human reviewer completes that checklist.
