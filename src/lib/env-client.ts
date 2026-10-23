import { z } from 'zod';

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;
type PublicEnvironmentSource = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

export function readPublicEnvironment(source: PublicEnvironmentSource): PublicEnvironment {
  const result = publicEnvironmentSchema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new Error(`Missing or invalid public environment variables: ${names}`);
}

export const publicEnv = readPublicEnvironment({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
