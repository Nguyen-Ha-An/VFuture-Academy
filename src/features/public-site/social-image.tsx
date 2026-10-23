import { ImageResponse } from 'next/og';

export const PUBLIC_SOCIAL_COPY = {
  academy: { en: ['VFuture Academy', 'Choose a path. Put it into practice.'], vi: ['VFuture Academy', 'Chọn lộ trình. Đưa kiến thức vào thực hành.'] },
  courses: { en: ['Courses', 'Build skills through structured learning.'], vi: ['Khóa học', 'Phát triển kỹ năng qua lộ trình học tập.'] },
  projects: { en: ['Projects', 'Explore ideas taking shape.'], vi: ['Dự án', 'Khám phá những ý tưởng đang thành hình.'] },
  opportunities: { en: ['Opportunities', 'Find your next way to participate.'], vi: ['Cơ hội', 'Tìm cơ hội tiếp theo để tham gia.'] },
  resources: { en: ['Resources', 'A library for learning and making.'], vi: ['Tài nguyên', 'Thư viện để học hỏi và thực hành.'] },
  contact: { en: ['Start a conversation.', 'Learning. Projects. Partnerships.'], vi: ['Bắt đầu trò chuyện.', 'Học tập. Dự án. Hợp tác.'] },
  privacy: { en: ['Privacy notice', 'Your information. Your choices.'], vi: ['Quyền riêng tư', 'Thông tin của bạn. Lựa chọn của bạn.'] },
  terms: { en: ['Terms of use', 'Using the VFuture Academy platform.'], vi: ['Điều khoản sử dụng', 'Sử dụng nền tảng VFuture Academy.'] },
} as const;

export type PublicSocialSection = keyof typeof PUBLIC_SOCIAL_COPY;
export function isPublicSocialSection(section: string): section is PublicSocialSection {
  return Object.hasOwn(PUBLIC_SOCIAL_COPY, section);
}

/** Fixed public labels only: no URL text, database content or account data enters these images. */
export function publicSocialImage(section: PublicSocialSection, locale: 'vi' | 'en') {
  const [title, description] = PUBLIC_SOCIAL_COPY[section][locale];
  return new ImageResponse(<div style={{ display: 'flex', width: '100%', height: '100%', background: '#080b0d', color: '#f1f5f5', padding: '64px', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}><svg width="62" height="62" viewBox="0 0 126 125" fill="#45c6ca"><path d="M2 0H39V10H19L29 30H47V39H33L45 63L39 75Z" /><path d="M0 57L10 52L33 102L86 0H126L64 124L53 103L59 91L64 101L109 10H93L33 125Z" /></svg><span style={{ fontSize: 28, letterSpacing: '0.12em' }}>VFUTURE ACADEMY</span></div>
    <div style={{ display: 'flex', marginTop: '80px', fontSize: 78, letterSpacing: '-0.04em', lineHeight: 1.1, color: '#45c6ca' }}>{title}</div>
    <div style={{ display: 'flex', marginTop: '24px', fontSize: 32, lineHeight: 1.4 }}>{description}</div>
    <div style={{ display: 'flex', borderTop: '1px solid #2a3a3d', marginTop: 'auto', paddingTop: '24px', fontSize: 20, color: '#a5b5b7' }}>Learn. Connect. Build. Share.</div>
  </div>, { width: 1200, height: 630 });
}
