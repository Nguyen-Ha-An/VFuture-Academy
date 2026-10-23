import { getLocale } from 'next-intl/server';
import { PublicBreadcrumbs, PublicDetailLayout, PublicPageHeader } from './PublicPrimitives';
import { PublicLink } from './PublicNavigation';
import { CookiePreferencesButton } from './ConsentPanel';
import { breadcrumbJsonLd, buildPublicMetadata, JsonLd } from './metadata';
import { getPolicyContent, LEGAL_SOURCES, type PolicyKind } from './legal-content';
import { policyPublication } from './policy-publication';
import { LEGAL_EMAIL } from './site-config';
import './public-legal.css';

export async function policyMetadata(kind: PolicyKind) {
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  const content = getPolicyContent(kind, locale);
  return { ...buildPublicMetadata({ title: content.title, description: content.description, pathname: `/${kind}`, locale }), robots: { index: policyPublication().approved, follow: true } };
}

export async function PolicyPage({ kind }: { kind: PolicyKind }) {
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  const en = locale === 'en';
  const content = getPolicyContent(kind, locale);
  const publication = policyPublication();
  const breadcrumbs = [{ label: 'VFuture Academy', href: '/' }, { label: content.title }];
  return <PublicDetailLayout className="public-legal">
    <JsonLd data={breadcrumbJsonLd(breadcrumbs, locale)} />
    <PublicBreadcrumbs items={breadcrumbs} />
    <PublicPageHeader eyebrow={en ? 'Trust & transparency' : 'Minh bạch & tin cậy'} title={content.title} description={content.description} />
    <div className="public-legal__status" role="note">
      <strong>{publication.approved ? (en ? 'Effective date' : 'Ngày có hiệu lực') : (en ? 'Draft — awaiting owner review' : 'Bản dự thảo — chờ chủ sở hữu phê duyệt')}</strong>
      <p>{publication.approved ? publication.effectiveDate : (en ? 'Prepared on 21 September 2026. This draft is available for review and is not an approved policy. It is excluded from search indexing pending approval.' : 'Soạn ngày 21/09/2026. Bản này phục vụ xem xét, chưa phải chính sách được phê duyệt và chưa được cho phép lập chỉ mục tìm kiếm.')}</p>
    </div>
    <div className="public-legal__layout">
      <nav className="public-legal__contents" aria-label={en ? 'On this page' : 'Nội dung trang'}><p className="public-kicker">{en ? 'On this page' : 'Nội dung'}</p><ol>{content.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
      <article className="public-prose public-legal__body">{content.sections.map((section, index) => <section id={section.id} key={section.id}><span className="public-kicker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
        {kind === 'privacy' ? <section><h2>{en ? 'Official references' : 'Nguồn tham chiếu chính thức'}</h2><ul>{LEGAL_SOURCES.map((source) => <li key={source.href}><a href={source.href} rel="external">{source.label}</a></li>)}</ul><CookiePreferencesButton>{en ? 'Cookie preferences' : 'Tùy chọn cookie'}</CookiePreferencesButton></section> : null}
        <div className="public-legal__links"><a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a><PublicLink href={kind === 'privacy' ? '/terms' : '/privacy'}>{kind === 'privacy' ? (en ? 'Terms of use' : 'Điều khoản sử dụng') : (en ? 'Privacy notice' : 'Thông báo quyền riêng tư')}</PublicLink><PublicLink href="/contact">{en ? 'Contact' : 'Liên hệ'}</PublicLink></div>
      </article>
    </div>
  </PublicDetailLayout>;
}
