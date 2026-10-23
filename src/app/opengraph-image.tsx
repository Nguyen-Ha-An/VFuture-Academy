import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/features/public-site/site-config';

export const alt = `${SITE_NAME} — Learn. Connect. Build. Share.`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#080b0d', color: '#f1f5f5', padding: '64px', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <svg width="62" height="62" viewBox="0 0 126 125" fill="#45c6ca"><path d="M2 0H39V10H19L29 30H47V39H33L45 63L39 75Z" /><path d="M0 57L10 52L33 102L86 0H126L64 124L53 103L59 91L64 101L109 10H93L33 125Z" /></svg>
        <span style={{ fontSize: 28, letterSpacing: '0.12em' }}>VFUTURE ACADEMY</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: '68px', fontSize: 78, letterSpacing: '-0.04em', lineHeight: 1.08 }}><span>Learn. Connect.</span><span style={{ color: '#45c6ca' }}>Build. Share.</span></div>
      <div style={{ display: 'flex', borderTop: '1px solid #2a3a3d', marginTop: 'auto', paddingTop: '24px', fontSize: 20, color: '#a5b5b7', justifyContent: 'space-between' }}><span>Ideas into practice.</span><span>Vietnam · Online</span></div>
    </div>, size,
  );
}
