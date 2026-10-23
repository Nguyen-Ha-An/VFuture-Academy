import "server-only";
import { ApiError } from "@/lib/api";
import { supabaseService } from "@/lib/supabase/server";
/** Checked on protected reads as well as writes; existing access tokens are not authority after suspension. */
export async function assertActiveAccount(userId: string): Promise<void> {
  const { data, error } = await supabaseService()
    .from("user_accounts")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data || !["active", "suspended"].includes(data.status))
    throw new Error("Unable to verify account status");
  if (data.status === "suspended")
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account is suspended");
}
