import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { ProfileBenchView, type ProfileBenchViewProps } from '@/features/workspace-ui/profile/ProfileBenchView';
import LearnerError from '@/app/app/error';
import { PageSkeleton } from '@/features/workspace-ui/ui/BenchState';
import { supportReviewParam } from '../../support/support-review-state';
import { seedSupportProfile, supportFixtureState } from '../../support/support-transport';

/** Explicitly synthetic records rendered by the real profile and route-boundary components. */
export function SupportProfileFixture() {
  const focus = useTranslations('learner.focus');
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const requestedState = supportReviewParam('supportState') ?? 'populated';
  const state = requestedState === 'dense-certificates' ? 'dense' : requestedState;
  const empty = state === 'empty';
  const dense = state === 'dense';
  const [recovered, setRecovered] = useState(false);
  const [qrSvg, setQrSvg] = useState<string>();
  const verifyUrl = new URL('/verify/PY-001', location.origin).href;
  useEffect(() => {
    let current = true;
    void QRCode.toString(verifyUrl, { type: 'svg', margin: 1, width: 128 }).then(svg => { if (current) setQrSvg(svg); }).catch(() => { if (current) setQrSvg(undefined); });
    return () => { current = false; };
  }, [verifyUrl]);
  seedSupportProfile(empty ? null : 'minh_anh', !empty && state !== 'private');
  const saved = supportFixtureState();
  if (state === 'error' && !recovered) return <LearnerError error={new Error('Synthetic profile read failure')} reset={() => setRecovered(true)} />;
  if (state === 'loading') return <PageSkeleton variant="home" label={focus('loading')} />;
  const baseSkill: ProfileBenchViewProps['skills'][number] = {
    id: 'python', name: { en: 'Python programming', vi: 'Lập trình Python' }, category: 'technology', level: 'demonstrated',
    evidence: [{ id: 'fixture-evidence-1', level: 'demonstrated', evidenceType: 'course_completion', refType: 'course', refId: 'python-foundations', createdAt: '2026-10-18T03:00:00Z', href: '/app/courses/python-foundations' },
      { id: 'fixture-evidence-2', level: 'applied', evidenceType: 'project_contribution', refType: 'project', refId: 'school-garden', createdAt: '2026-10-17T03:00:00Z', href: null }],
  };
  const course = { id: 'python-foundations', title: { en: 'Python foundations', vi: 'Python cơ bản' }, completedAt: '2026-10-18T03:00:00Z', currentDestinationAvailable: true };
  const certificate = { id: 'certificate-1', serial: 'VF-FIXTURE-001', holder: 'Nguyễn Minh Anh', courseTitle: locale === 'en' ? 'Python foundations' : 'Python cơ bản', issuedAt: '2026-10-18T03:00:00Z', verifyPath: '/verify/PY-001', verifyUrl, pdfAvailable: true, branch: 'Fixture branch', result: { score: 88, threshold: 70 }, qrSvg };
  return <ProfileBenchView locale={locale}
    profile={{ displayName: 'Nguyễn Minh Anh', handle: saved.handle, locale, avatarUrl: null }}
    branch={state === 'no-branch' ? null : 'Fixture branch'}
    settings={{ displayName: 'Nguyễn Minh Anh', handle: saved.handle, profilePublic: saved.profilePublic }}
    skills={empty ? [] : dense ? [baseSkill, { ...baseSkill, id: 'research', name: { en: 'Research and evidence synthesis with a deliberately long skill title', vi: 'Nghiên cứu và tổng hợp minh chứng với tiêu đề kỹ năng dài để kiểm tra bố cục' }, level: 'exposed', evidence: [] }] : [baseSkill]}
    completedCourses={empty ? [] : dense ? [course, { ...course, id: 'archived-course', title: 'Archived synthetic course', currentDestinationAvailable: false }] : [course]}
    projects={empty ? [] : [{ id: 'school-garden', title: { en: 'School garden', vi: 'Vườn trường thông minh' }, summary: { en: 'A synthetic sensor project for the school garden.', vi: 'Dự án cảm biến mẫu cho vườn trường.' }, outputLinks: [] }]}
    certificates={empty ? [] : dense ? [certificate, { ...certificate, id: 'certificate-2', serial: 'VF-FIXTURE-002', pdfAvailable: false, result: null, qrSvg: undefined }] : [certificate]}
    xpTotal={empty ? 0 : 1240}
  />;
}
