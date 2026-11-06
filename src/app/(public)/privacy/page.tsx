import { LegalShell } from '@/features/public-site/LegalShell';
import { PolicyPage, policyMetadata } from '@/features/public-site/PolicyPage';
export const generateMetadata = () => policyMetadata('privacy');
export default function PrivacyPage() { return <LegalShell><PolicyPage kind="privacy" /></LegalShell>; }
