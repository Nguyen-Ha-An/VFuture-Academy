import { nativeAuthentication } from '@/lib/identity/native-routes';
import { withHandler } from '@/lib/api';
export const runtime='nodejs';
export const maxDuration=60;
const authenticate=withHandler(nativeAuthentication);
export async function POST(request:Request) {
  const response=await authenticate(request);
  response.headers.set('Cache-Control','no-store');
  response.headers.set('Referrer-Policy','no-referrer');
  return response;
}
