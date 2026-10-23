import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".worktrees/**",
      "notebook-runtime/**",
      ".next/**",
      "out/**",
      "build/**",
      "public/studio-workers/**",
      "coverage/**",
      "playwright-report/**",
      "playwright-report-studio/**",
      "playwright-report-admin/**",
      "test-results/**",
      "test-results-*/**",
      "playwright-report-*/**",
      "tests/e2e/*/artifacts/**",
      "tests/e2e/*/.cache/**",
      "tests/e2e/*/dist/**",
      "test-results-admin/**",
      "recovery-evidence/**",
      "graphify-out/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ['src/content-engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['next', 'next/*', '@supabase/*', '@/app/*', '@/features/*', '@/lib/*'], message: 'content-engine must stay framework-free.' },
      ] }],
    },
  },
  {
    files: ['src/content-engine/{schema,manifest,diagnostics,validate,compile,grading,prompt-pack,fixtures}/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', 'react/*', 'react-dom/*', 'next', 'next/*', '@supabase/*', '@/app/*', '@/features/*', '@/lib/*'], message: 'Only render/ may import React.' },
      ] }],
    },
  },
  {
    files: ['src/features/studio-mcp/**/*.{ts,tsx}'],
    ignores: ['src/features/studio-mcp/db/read-only-database.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@/features/studio/drafts',
          importNames: ['createCourse', 'saveWorkspace', 'saveManifest', 'saveItem', 'deleteItem',
            'importSingle', 'importNewCourse', 'importBundle', 'publishPreparedCourse', 'publish',
            'restoreAsDraft'],
          message: 'Studio MCP may only use read and saveability helpers.',
        }],
        patterns: [{
          group: ['@/lib/supabase/*', '@/lib/audit'],
          message: 'Studio MCP must access storage only through its read-only database facade.',
        }],
      }],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "react-hooks/exhaustive-deps": "error",
    },
  },
];

export default eslintConfig;
