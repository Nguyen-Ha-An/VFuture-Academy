import { studioHomeData } from '@/features/studio/home-data';
import { StudioHomeView } from '@/features/studio/ui/StudioHomeView';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const data = await studioHomeData();
  return <StudioHomeView data={data} />;
}
