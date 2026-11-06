// Metadata-only cutover inventory. This works before55 without successor tables or RPCs.
// Keep candidate capabilities equal to teaching_candidate in migration55.
export const TEACHER_CANDIDATE_CAPABILITIES=Object.freeze(['submission.grade','exam.release','teaching.announcement.manage','teaching.schedule.manage','report.branch.read','analytics.branch.read']);
export const TEACHER_CUTOVER_COUNT_KEYS=Object.freeze(['ordinaryActorCount','eligibleBranchTeacherPairCount','activeEnrollmentCourseBranchPairCount','ordinaryGlobalActorWithoutMembershipCount']);
export function validateTeacherCutoverInventory(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5
  ||Object.keys(value).some(key=>![...TEACHER_CUTOVER_COUNT_KEYS,'requiresInitialAssignments'].includes(key))
  ||!TEACHER_CUTOVER_COUNT_KEYS.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)
  ||value.ordinaryGlobalActorWithoutMembershipCount>value.ordinaryActorCount
  ||value.requiresInitialAssignments!==(value.ordinaryActorCount>0))throw new Error('Invalid teacher cutover inventory');
 return value;
}
export async function teacherCutoverInventory(db){
 const rows=(await db.query(`with active_ordinary as materialized (
  select account.user_id from public.user_accounts account where account.status='active'
  -- Only a future central-admin scope-all grant exempts an entire actor.
  and not exists(select 1 from public.role_assignments assignment join public.role_definitions definition on definition.id=assignment.role_definition_id
   where assignment.user_id=account.user_id and definition.built_in and definition.id='central_admin'
    and definition.scope_kind='central' and assignment.branch_id is null)
 ), future_admin_branches as materialized (
  select ordinary.user_id,assignment.branch_id from active_ordinary ordinary
  join public.role_assignments assignment on assignment.user_id=ordinary.user_id
  join public.role_definitions definition on definition.id=assignment.role_definition_id
  join public.branch_memberships membership on membership.user_id=ordinary.user_id and membership.branch_id=assignment.branch_id
  where definition.built_in and definition.id='school_admin' and definition.scope_kind='branch' and membership.status='active'
 ), ordinary_global as materialized (
  select ordinary.user_id from active_ordinary ordinary where exists(select 1 from unnest($1::text[]) permission
   where public.authorization_has_permission(ordinary.user_id,permission,'central',null))
 ), ordinary_branch_pairs as materialized (
  select ordinary.user_id,branch.id as branch_id from active_ordinary ordinary cross join public.branches branch
  where not exists(select 1 from future_admin_branches admin where admin.user_id=ordinary.user_id and admin.branch_id=branch.id)
   and exists(select 1 from unnest($1::text[]) permission where public.authorization_has_permission(ordinary.user_id,permission,'branch',branch.id))
 ), ordinary_actors as materialized (
  select user_id from ordinary_branch_pairs union select user_id from ordinary_global
 ), eligible_pairs as materialized (
  select ordinary.user_id,ordinary.branch_id from ordinary_branch_pairs ordinary
  join public.branch_memberships membership on membership.user_id=ordinary.user_id and membership.branch_id=ordinary.branch_id
  where membership.status='active' and exists(select 1 from unnest($2::text[]) permission
   where public.authorization_has_permission(ordinary.user_id,permission,'branch',ordinary.branch_id))
 ), affected_branches as materialized (
  select distinct branch_id as id from ordinary_branch_pairs
 ) select (select count(*)::integer from ordinary_actors) as "ordinaryActorCount",
  (select count(*)::integer from eligible_pairs) as "eligibleBranchTeacherPairCount",
  (select count(*)::integer from (select distinct enrollment.course_id,enrollment.branch_id from public.enrollments enrollment
    join affected_branches branch on branch.id=enrollment.branch_id
    where enrollment.status='active' and enrollment.branch_scope_known and enrollment.branch_id is not null) pairs) as "activeEnrollmentCourseBranchPairCount",
  (select count(*)::integer from ordinary_global ordinary where not exists(select 1 from public.branch_memberships membership where membership.user_id=ordinary.user_id and membership.status='active')) as "ordinaryGlobalActorWithoutMembershipCount"`,
 [['learning.read','grading.read','grading.manage',...TEACHER_CANDIDATE_CAPABILITIES,'report.global.read','analytics.global.read'],TEACHER_CANDIDATE_CAPABILITIES])).rows;
 if(rows.length!==1)throw new Error('Invalid teacher cutover inventory');
 // No IDs, rows, names, handles or email addresses may cross this boundary.
 const counts=Object.fromEntries(TEACHER_CUTOVER_COUNT_KEYS.map(key=>[key,rows[0][key]]));
 return validateTeacherCutoverInventory({...counts,requiresInitialAssignments:counts.ordinaryActorCount>0});
}
