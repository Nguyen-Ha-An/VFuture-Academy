import type { OwnerCompletedCourse, ProfileSettings, PublicProject } from '../../../../src/features/profile/service';
import type { PassportSkill } from '../../../../src/features/skills/service';
import { seedSupportProfile, supportFixtureState } from '../../support/support-transport';
import { supportReviewParam } from '../../support/support-review-state';

const supportState = () => supportReviewParam('supportState');
function assertAvailable() {
 if (supportState() === 'error') throw new Error('Synthetic support fixture: profile unavailable');
}

export async function getOwnerProfileEvidence(): Promise<{ skills: PassportSkill[]; completedCourses: OwnerCompletedCourse[]; projects: PublicProject[] }> {
 assertAvailable();
 if (supportState() === 'empty') return { skills: [], completedCourses: [], projects: [] };
 const completed: OwnerCompletedCourse = { id: 'ai-basics', title: 'AI foundations', completedAt: '2026-10-18T03:00:00Z', currentDestinationAvailable: true };
 if (supportState() !== 'dense') return { skills: [], completedCourses: [completed], projects: [] };
 const skills: PassportSkill[] = Array.from({ length: 6 }, (_, index) => ({
  id: `fixture-skill-${index}`, category: 'technology', name: { en: `Synthetic research skill ${index + 1}`, vi: `Kỹ năng nghiên cứu mẫu ${index + 1}` },
  level: index % 3 === 0 ? 'demonstrated' : index % 3 === 1 ? 'applied' : 'exposed',
  evidence: [{ id: `fixture-evidence-${index}`, level: 'demonstrated', evidenceType: 'course_completion', refType: 'course', refId: 'ai-basics', createdAt: completed.completedAt, href: '/app/courses/ai-basics' },
   { id: `fixture-evidence-unavailable-${index}`, level: 'applied', evidenceType: 'mentor_review', refType: 'review', refId: `fixture-review-${index}`, createdAt: completed.completedAt, href: null }],
 }));
 return { skills, completedCourses: [completed, ...Array.from({ length: 4 }, (_, index) => ({ ...completed, id: `fixture-retired-course-${index}`, title: { en: `Synthetic archived course ${index + 1}`, vi: `Khóa học mẫu đã lưu trữ ${index + 1}` }, currentDestinationAvailable: false }))],
  projects: [{ id: 'fixture-project', title: { en: 'Synthetic community learning map', vi: 'Bản đồ học tập cộng đồng mẫu' }, summary: { en: 'A local fixture showing project evidence.', vi: 'Dữ liệu cục bộ minh họa minh chứng dự án.' }, outputLinks: [] }],
 };
}
export async function getProfileSettings(): Promise<ProfileSettings> {
 assertAvailable();
 seedSupportProfile('fixture-student', ['dense', 'public', 'unranked'].includes(supportState() ?? ''));
 const fixture = supportFixtureState();
 return { displayName: 'Fixture Student', handle: fixture.handle, profilePublic: fixture.profilePublic };
}
