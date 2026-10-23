# Central and school administration

Start at `/admin`. The header names the active scope: Central or one authorized school. Changing scope replaces the workspace data and navigation. Studio is opened from Admin and contains course authoring and media; members, schools, reporting and review remain in Admin.

## Roles

| Built-in role | Scope | Purpose |
| --- | --- | --- |
| Central Admin | Central | System, schools, members, roles, CMS, reviews and reports |
| Central Reviewer | Central | Read submitted content, request changes, approve and publish |
| Central Editor | Central | Author content and request review |
| School Admin | School | Members, approved role assignments, learning summaries, reports and audit |
| School Editor | School | Author school-owned content and request review |
| Teacher | School | Teaching operations, grading and school reports |
| Member | School | Learning only; no Admin access |

School Admin does not include grading or publishing. Assign Teacher separately when needed. Staff can hold different roles at multiple schools; each learner has one primary school. Membership suspension affects that school; account suspension affects protected access throughout the application, including existing authenticated API sessions.

Central defines custom roles using the fixed permission registry. School roles cannot contain Central-only permissions. Central also chooses which school roles are delegable. School administrators cannot grant Central Admin, School Admin or elevate themselves. Limited Central role managers cannot create or grant capabilities beyond their own authority. Built-ins are protected and the final active Central Admin cannot be removed or suspended.

Legacy role tuples are migrated to protected compatibility definitions without broadening functional scope. Existing branch-lead delegation is limited to the Teacher replacement. New assignments should use built-in or explicit custom definitions; compatibility definitions are not grantable.

## Members and invitations

`/admin/users` loads a paginated directory immediately. Filters cover text, role, effective status and learner/staff membership. Member detail shows the primary school, scoped staff memberships, grants and effective permissions. Learning, submission/exam results and audit tabs are independently authorized.

Invitations use a private one-time link bound to an email, school and optional role. They expire after seven days. The recipient must authenticate with the invited email and explicitly accept. Acceptance rechecks the inviter's current authority, the role version, revocation and expiry; a changed role requires a new invitation. Invitations never silently transfer an existing learner between schools. Creating an invitation does not send email automatically.

Only Central can change shared identity, transfer the primary school or suspend the account globally. School administrators can suspend/restore their own memberships. Suspended membership and global account state remain distinct.

## Historical school ownership

Enrollment captures its school on creation; submissions and exams inherit that enrollment scope. Transferring a profile does not move existing enrollments or submission ownership. The new school sees aggregate learning/exam progress; detailed historic submissions and grading stay with the original school. Central and the learner retain the appropriate full history.

Pre-migration history is not guessed from today's profile. Records without reliable school evidence remain explicitly unverified and are excluded from school-specific detailed access and reports. School audits contain only school-safe changes; full Central snapshots remain Central-only.

## Bootstrap and migration

During release, pause Admin/Studio mutations, apply the checked-in migrations in lexical order with the existing migration runner, then switch all application traffic to this version before restoring mutations. Retire older deployment routes that still authorize against `user_roles`. Published learner snapshots remain available during the transition:

1. `20260906065948_admin_authorization_foundation.sql`
2. `20260906065949_admin_management.sql`
3. `20260906065951_admin_content_review.sql`

Notebook migration `20260906065957_notebook_foundation.sql` belongs to the separate notebook implementation and follows these migrations when the two features are integrated.

For operator bootstrap, `npm run grant-role -- <email> central_admin` targets the new role assignment table. School roles require a school ID. The original service-key bootstrap email-confirmation behavior is preserved. Routine grants/revocations belong in Admin so they are scoped and audited. The legacy `user_roles` table is read-only after migration.

Do not roll the application back to a publisher that bypasses Central review. If a rollout must pause, disable writes while keeping the migrated schema and immutable publication history.
