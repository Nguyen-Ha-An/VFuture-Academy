import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { VFutureLogo } from '@/features/public-site/VFutureLogo';
import '@/features/public-site/academy-base.css';
import '@/features/public-site/public-site.css';
import '@/features/public-site/public-legal.css';

/** Root boundary: Next serves missing routes with 404; private /app retains its own boundary. */
export default async function NotFound() {
  const en = await getLocale() === 'en';
  const href = (path: string) => en ? `${path}?lang=en` : path;
  return <div className="academy-shell-site public-site">
    <header className="public-container" style={{ paddingTop: '2rem' }}><Link className="academy-shell-brand" href={href('/')} aria-label="VFuture Academy"><VFutureLogo academy /></Link></header>
    <main id="main-content" className="public-container public-not-found">
      <span className="public-not-found__number" aria-hidden="true">404</span>
      <p className="public-kicker">{en ? 'Page not found' : 'Không tìm thấy trang'}</p>
      <h1>{en ? 'A different path forward.' : 'Chọn một hướng đi mới.'}</h1>
      <p className="public-copy">{en ? 'This page may have moved, or the link may be incomplete. Explore the learning paths and projects that are available now.' : 'Trang có thể đã được chuyển hoặc liên kết chưa đầy đủ. Khám phá những lộ trình học tập và dự án hiện có.'}</p>
      <nav className="public-actions" aria-label={en ? 'Continue exploring' : 'Tiếp tục khám phá'}><Link className="public-button" href={href('/')}>{en ? 'Back to Academy' : 'Về Academy'} <span aria-hidden="true">↗</span></Link><Link className="public-button public-button--secondary" href={href('/courses')}>{en ? 'Explore Academy' : 'Khám phá Academy'}</Link><Link className="public-button public-button--secondary" href={href('/contact')}>{en ? 'Contact us' : 'Liên hệ'}</Link></nav>
    </main>
  </div>;
}
