import type { OnboardingState } from '@/features/auth/onboarding-state';
import { safeInternalPath } from '@/lib/safe-internal-path';

/**
 * Browser-only server-action simulation. Playwright controls this local endpoint;
 * it does not call Supabase or implement the production action's save logic.
 */
export async function completeOnboarding(
  _previousState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const values = {
    handle: String(formData.get('handle') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
  };
  const next = String(formData.get('next') ?? '');
  const response = await fetch('/__onboarding/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...values, next }),
  });
  if (!response.ok) throw new Error(`Unconfigured onboarding fixture: ${response.status}`);
  const result = await response.json() as {
    outcome: 'success' | 'recoverable';
    fieldErrors?: OnboardingState['fieldErrors'];
    error?: OnboardingState['error'];
  };
  if (result.outcome === 'success') {
    // A real document navigation, deliberately not a navigateAfterAuth spy.
    window.location.assign(safeInternalPath(next));
    return new Promise<OnboardingState>(() => {});
  }
  return { values, fieldErrors: result.fieldErrors ?? {}, error: result.error ?? null };
}
