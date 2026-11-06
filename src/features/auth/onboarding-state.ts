export type OnboardingState = {
  values: { displayName: string };
  fieldErrors: {
    displayName?: 'invalidDisplayName';
  };
  error: 'profileLoadError' | 'profileUpdateError' | null;
};

export const initialOnboardingState: OnboardingState = {
  values: { displayName: '' },
  fieldErrors: {},
  error: null,
};
