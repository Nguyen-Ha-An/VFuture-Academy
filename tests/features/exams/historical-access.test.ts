import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createHistoricalExamReviewAuthorizer, type HistoricalReviewDatabase } from '@/features/exams/historical-access';

type Row=Record<string,unknown> | null;
function fixture(version:Row,enrollment:Row,membership:Row) {
  const branchQueries:string[]=[];
  const rows:Record<string,Row>={course_versions:version,enrollments:enrollment,branch_memberships:membership};
  const database={from(table:string){
    const query={select(){return query;},eq(column:string,value:unknown){if(table==='branch_memberships' && column==='branch_id')branchQueries.push(String(value));return query;},in(){return query;},async maybeSingle(){return {data:rows[table],error:null};}};
    return query;
  }};
  return {database:database as unknown as HistoricalReviewDatabase,branchQueries};
}
const actor={id:'learner-one',locale:'en' as const};
const attempt={userId:'learner-one',courseVersionId:'old-version',branchId:'old-school'};
describe('historical exam access',()=>{
  it('accepts a newer same-course enrollment and checks the original school',async()=>{
    const db=fixture({course_id:'course-one'},{course_version_id:'new-version'},{status:'active'});
    await expect(createHistoricalExamReviewAuthorizer(db.database)(actor,attempt,'course-one')).resolves.toBe(true);
    expect(db.branchQueries).toEqual(['old-school']);
  });
  it('rejects a different historical course or a missing current course enrollment',async()=>{
    const wrong=fixture({course_id:'other-course'},{course_version_id:'new-version'},null);
    await expect(createHistoricalExamReviewAuthorizer(wrong.database)(actor,attempt,'course-one')).resolves.toBe(false);
    const absent=fixture({course_id:'course-one'},null,null);
    await expect(createHistoricalExamReviewAuthorizer(absent.database)(actor,attempt,'course-one')).resolves.toBe(false);
    await expect(createHistoricalExamReviewAuthorizer(absent.database)({...actor,id:'other-learner'},attempt,'course-one')).resolves.toBe(false);
  });
  it('denies a suspended historical school without guessing from the new enrollment',async()=>{
    const db=fixture({course_id:'course-one'},{course_version_id:'new-version'},{status:'suspended'});
    await expect(createHistoricalExamReviewAuthorizer(db.database)(actor,attempt,'course-one')).rejects.toMatchObject({code:'MEMBERSHIP_SUSPENDED'});
    expect(db.branchQueries).toEqual(['old-school']);
  });
  it('preserves owner access for unknown historical school without inferring another branch',async()=>{
    const db=fixture({course_id:'course-one'},{course_version_id:'new-version'},null);
    await expect(createHistoricalExamReviewAuthorizer(db.database)(actor,{...attempt,branchId:null},'course-one')).resolves.toBe(true);
    expect(db.branchQueries).toEqual([]);
  });
});
