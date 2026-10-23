import { PolicyPage, policyMetadata } from '@/features/public-site/PolicyPage';
export const generateMetadata = () => policyMetadata('terms');
export default function TermsPage() { return <PolicyPage kind="terms" />; }
