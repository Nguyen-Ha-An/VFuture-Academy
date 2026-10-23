// The learner shell is always the Calibration Bench; `?theme=` picks its saved theme.
const params = new URLSearchParams(location.search);
export const benchTheme = params.get('theme') === 'dark' ? 'dark' as const : params.get('theme') === 'light' ? 'light' as const : 'system' as const;
