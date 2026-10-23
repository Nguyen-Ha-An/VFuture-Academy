# Central publishing workflow

1. Select Central or the owning school in Admin. Ownership controls who may edit; audience independently controls who may learn or view.
2. Open CMS, create or open content, and use Studio for courses/media. Save the draft explicitly.
3. Submit the current saved revision from CMS. This freezes source, ownership, audience, asset/bank references and notebook dependencies.
4. In `/admin/reviews`, a Central Reviewer opens **Read submitted version**. Inspect the immutable source preview and the changes from the previous publication, including audience.
5. Request changes or approve with a decision note. Central may review its own work; the action is explicit and audited.
6. Publish the approved revision. Courses use the Studio publishing checklist/compiler; other supported types publish from review. Existing publisher APIs are guarded by the same PostgreSQL review transaction.

Editing source, ownership, audience or a dependency invalidates the previous review. Resubmit the changed revision. Saving a draft does not remove or modify the currently published snapshot, and publishing a course does not migrate enrolled learners to a new course version.

School users can read shared published content only through its publication-safe projection; a pending Central draft must never be returned in that projection. Media references must have a compatible audience/owner. Replace approved files with new asset revisions rather than overwriting the object.

## Notebook integration

Notebook schemas, editor, JupyterLite/Colab runtime and learner draft/submission storage are owned by the notebook implementation. The Admin server factory in `src/features/admin/content-review-production.ts` must supply its `validateNotebookWorkspaceDependencies(courseId, items)` adapter to `createContentReviewService({ notebookDependencies })` after integration.

The adapter freezes assignment location (standalone `blockId: null` or inline block ID), runtime mode/profile/version, Colab reason, and ready template/dataset IDs, checksums and sizes. Both application and SQL checks reject notebook review without these pins. The shared schema/service module is imported by client UI, so do not import the server-only adapter there.

JupyterLite is the default; Colab is external and assignment-specific. Opening Colab is not a completion/submission event. Template checksums and submitted artifact checksums are distinct. Grading follows the historical school of the submission.
