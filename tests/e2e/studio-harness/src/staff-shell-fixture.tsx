import Link from 'next/link';
import { StaffWorkspaceShell, type StaffWorkspaceShellProps } from '../../../../src/features/staff-ui/ui/StaffWorkspaceShell';
import { StaffPageHeader } from '../../../../src/features/workspace/ui/StaffPageHeader';
import { staffChromeFixture } from './staff-chrome';

/**
 * Browser-harness-only: the Catmin StaffWorkspaceShell with the shared chrome fixture, loaded
 * lazily by the studio and admin harnesses under `?uiv2=1` so legacy runs load no extra modules.
 */
const chrome = staffChromeFixture();

export function StaffHarnessShell(props: Omit<StaffWorkspaceShellProps, 'chrome'>) {
  return <StaffWorkspaceShell chrome={chrome} {...props} />;
}

/** `/studio/courses` under `?uiv2=1`: a plain list page carrying the 12px Vietnamese eyebrow the clipping check reads. */
export function CoursesFixture() {
  return <>
    <StaffPageHeader eyebrow="Studio — Nguyễn Thị Thanh Hương" title="Khoá học" description="Soạn, kiểm tra và gửi duyệt các khóa học của bạn." />
    <ul className="divide-y divide-border rounded-md border border-border">
      {['Khóa học tối giản', 'Nền tảng trí tuệ nhân tạo', 'Python cơ bản'].map(title => <li key={title} className="px-4 py-3 text-sm leading-normal"><Link href="/studio/courses/minimal" className="font-medium underline-offset-4 hover:underline">{title}</Link></li>)}
    </ul>
  </>;
}
