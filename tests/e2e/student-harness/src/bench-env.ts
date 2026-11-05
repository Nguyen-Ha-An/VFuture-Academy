// The learner shell is always the Calibration Bench; `?theme=` picks its saved theme.
import { supportReviewParam } from '../../support/support-review-state';
export const benchTheme = supportReviewParam('theme') === 'dark' ? 'dark' as const : supportReviewParam('theme') === 'light' ? 'light' as const : 'system' as const;
