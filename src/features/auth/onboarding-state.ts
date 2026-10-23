export type OnboardingState = {
  values: { handle: string; displayName: string };
  fieldErrors: {
    handle?: 'invalidHandle' | 'handleTaken';
    displayName?: 'invalidDisplayName';
  };
  error: 'profileLoadError' | 'profileUpdateError' | null;
};

export const initialOnboardingState: OnboardingState = {
  values: { handle: '', displayName: '' },
  fieldErrors: {},
  error: null,
};
