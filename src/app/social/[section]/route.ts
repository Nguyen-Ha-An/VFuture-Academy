import { isPublicSocialSection, publicSocialImage } from '@/features/public-site/social-image';

export async function GET(request: Request, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isPublicSocialSection(section)) return new Response(null, { status: 404 });
  const locale = new URL(request.url).searchParams.get('lang') === 'en' ? 'en' : 'vi';
  const response = publicSocialImage(section, locale);
  response.headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}
