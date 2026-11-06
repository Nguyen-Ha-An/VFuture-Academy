import { LegalShell } from '@/features/public-site/LegalShell';
import { PolicyPage, policyMetadata } from '@/features/public-site/PolicyPage';
export const generateMetadata = () => policyMetadata('terms');
export default function TermsPage() { return <LegalShell><PolicyPage kind="terms" /></LegalShell>; }
