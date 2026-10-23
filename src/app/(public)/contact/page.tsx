import { getLocale } from 'next-intl/server';
import { PublicBreadcrumbs, PublicDetailLayout, PublicPageHeader } from '@/features/public-site/PublicPrimitives';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { breadcrumbJsonLd, buildPublicMetadata, JsonLd } from '@/features/public-site/metadata';
import { CONTACT_EMAIL, LEGAL_EMAIL } from '@/features/public-site/site-config';
import '@/features/public-site/public-legal.css';

const copy = {
  vi: { title: 'Bắt đầu một cuộc trò chuyện.', description: 'Câu hỏi về học tập, dự án, hợp tác hoặc quyền riêng tư — hãy gửi đến đúng địa chỉ.', general: 'Học tập & hợp tác', generalBody: 'Cần hỗ trợ tài khoản, tìm hiểu khóa học, trao đổi về dự án hoặc đề xuất hợp tác? Hãy cho chúng tôi biết bối cảnh và điều bạn cần.', legal: 'Quyền riêng tư & pháp lý', legalBody: 'Gửi yêu cầu về dữ liệu cá nhân, quyền của bạn, điều khoản sử dụng hoặc báo cáo sự cố dữ liệu.', write: 'Soạn email', note: 'Các liên kết mở ứng dụng email của bạn. Thư chỉ được gửi khi bạn chọn gửi trong ứng dụng đó.', help: 'Để chúng tôi hiểu vấn đề', helpBody: 'Đính kèm tên khóa học hoặc liên kết trang liên quan và mô tả điều đã xảy ra. Không gửi mật khẩu, mã đăng nhập hay thông tin nhạy cảm không cần thiết.', online: 'Việt Nam · Hoạt động trực tuyến', browse: 'Khám phá Academy', privacy: 'Quyền riêng tư', terms: 'Điều khoản' },
  en: { title: 'Start a conversation.', description: 'Questions about learning, projects, partnerships or privacy — reach the right inbox.', general: 'Learning & partnerships', generalBody: 'Need account support, course guidance, a project conversation or a partnership? Tell us the context and what you need.', legal: 'Privacy & legal', legalBody: 'Send requests about personal information, your rights, terms of use or a suspected data incident.', write: 'Write an email', note: 'These links open your email application. A message is sent only when you choose to send it there.', help: 'Help us understand', helpBody: 'Include the course name or relevant page link and a description of what happened. Do not send passwords, sign-in codes or unnecessary sensitive information.', online: 'Vietnam · Online only', browse: 'Explore Academy', privacy: 'Privacy', terms: 'Terms' },
};
export async function generateMetadata() {
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  return buildPublicMetadata({ title: locale === 'en' ? 'Contact' : 'Liên hệ', description: copy[locale].description, pathname: '/contact', locale });
}
export default async function ContactPage() {
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  const t = copy[locale];
  const breadcrumbs = [{ label: 'VFuture Academy', href: '/' }, { label: locale === 'en' ? 'Contact' : 'Liên hệ' }];
  return <PublicDetailLayout className="public-contact">
    <JsonLd data={breadcrumbJsonLd(breadcrumbs, locale)} /><PublicBreadcrumbs items={breadcrumbs} />
    <PublicPageHeader eyebrow={t.online} title={t.title} description={t.description} />
    <div className="public-grid public-grid--two public-contact__grid">{[{ title: t.general, body: t.generalBody, email: CONTACT_EMAIL }, { title: t.legal, body: t.legalBody, email: LEGAL_EMAIL }].map((item, index) => <section className="public-card public-contact__card" key={item.email}><span className="public-kicker">0{index + 1}</span><h2>{item.title}</h2><p className="public-copy">{item.body}</p><a className="public-contact__email" href={`mailto:${item.email}`}>{item.email}</a><a className="public-button public-button--secondary" href={`mailto:${item.email}?subject=${encodeURIComponent(item.title)}`}>{t.write}<span aria-hidden="true">↗</span></a></section>)}</div>
    <p className="public-meta public-contact__note">{t.note}</p>
    <section className="public-contact__help"><div><h2>{t.help}</h2><p className="public-copy">{t.helpBody}</p></div><div className="public-legal__links"><PublicLink href="/academy">{t.browse}</PublicLink><PublicLink href="/privacy">{t.privacy}</PublicLink><PublicLink href="/terms">{t.terms}</PublicLink></div></section>
  </PublicDetailLayout>;
}
