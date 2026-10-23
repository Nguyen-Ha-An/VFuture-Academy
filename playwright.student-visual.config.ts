import { defineConfig, devices } from '@playwright/test';
import studentConfig from './playwright.student.config';

const run = (process.env.STUDENT_VISUAL_RUN ?? 'visual-latest').replace(/[^a-zA-Z0-9_-]/g, '_');
const artifacts = `tests/e2e/student-harness/artifacts/${run}`;
export default defineConfig({
 ...studentConfig,
 testMatch: '**/visual.check.ts',
 projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
 outputDir: `${artifacts}/results`,
 reporter: [['list'], ['json', { outputFile: `${artifacts}/results.json` }], ['html', { open: 'never', outputFolder: `${artifacts}/report` }]],
 snapshotPathTemplate: '{testDir}/snapshots/{projectName}/{platform}/{arg}{ext}',
 updateSnapshots: 'none',
 use: { ...studentConfig.use, contextOptions: { reducedMotion: 'reduce' }, locale: 'en-US', timezoneId: 'UTC' },
});
