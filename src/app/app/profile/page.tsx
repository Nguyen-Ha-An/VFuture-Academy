import { getLocale } from 'next-intl/server';

import type { Locale } from '@/content-engine';
import { readLearnerRewards } from '@/features/learner/summary';
import { getOwnerProfileEvidence, getProfileSettings } from '@/features/profile/service';
import { branchIdForUser } from '@/features/me/service';
import type { CalibrationCertificateData } from '@/features/workspace-ui/profile/CalibrationCertificate';
import { certificateQrSvg, certificateVerifyUrl } from '@/features/workspace-ui/profile/certificate-qr';
import { LearnerActivityTrace } from '@/features/workspace-ui/learner/dashboard.server';
import { ProfileBenchView } from '@/features/workspace-ui/profile/ProfileBenchView';
import { requireUser } from '@/lib/auth';

type Rewards = Awaited<ReturnType<typeof readLearnerRewards>>;

/** A failed lookup just hides the branch. */
async function learnerBranch(userId: string): Promise<string | null> {
  try {
    return await branchIdForUser(userId);
  } catch {
    return null;
  }
}

async function benchCertificates(rewards: Rewards): Promise<CalibrationCertificateData[]> {
  return Promise.all(rewards.certificates.map(async (certificate) => {
    const verifyPath = `/verify/${encodeURIComponent(certificate.verificationCode)}`;
    const verifyUrl = certificateVerifyUrl(verifyPath);
    return {
      id: certificate.id,
      serial: certificate.serial,
      courseTitle: certificate.courseTitle || certificate.courseId,
      holder: rewards.profile.displayName,
      issuedAt: certificate.issuedAt,
      verifyPath,
      verifyUrl,
      pdfAvailable: Boolean(certificate.pdfAssetId),
      qrSvg: await certificateQrSvg(verifyUrl),
    };
  }));
}

export default async function LearnerProfilePage() {
  const [user, localeValue] = await Promise.all([requireUser(), getLocale()]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const [rewards, evidence, settings] = await Promise.all([
    readLearnerRewards({ userId: user.id, roles: [] }, locale),
    getOwnerProfileEvidence(user.id),
    getProfileSettings(user.id),
  ]);
  const [branch, certificates] = await Promise.all([learnerBranch(user.id), benchCertificates(rewards)]);
  return (
    <ProfileBenchView
      locale={locale}
      profile={rewards.profile}
      branch={branch}
      settings={settings}
      skills={evidence.skills}
      completedCourses={evidence.completedCourses}
      projects={evidence.projects}
      certificates={certificates}
      xpTotal={rewards.xpTotal}
      trace={<LearnerActivityTrace userId={user.id} />}
    />
  );
}
