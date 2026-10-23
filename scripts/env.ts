import { z } from 'zod';

const scriptEnvironmentSchema = z.object({
  SUPABASE_DB_URL: z.string().url(),
});

export type ScriptEnvironment = z.infer<typeof scriptEnvironmentSchema>;

/** Direct database credentials are intentionally validated only by scripts. */
export function readScriptEnvironment(source: NodeJS.ProcessEnv = process.env): ScriptEnvironment {
  const result = scriptEnvironmentSchema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new Error(`Missing or invalid script environment variables: ${names}`);
}
