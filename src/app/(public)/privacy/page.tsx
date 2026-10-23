import { PolicyPage, policyMetadata } from '@/features/public-site/PolicyPage';
export const generateMetadata = () => policyMetadata('privacy');
export default function PrivacyPage() { return <PolicyPage kind="privacy" />; }
