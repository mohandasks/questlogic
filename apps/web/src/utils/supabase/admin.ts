import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. SERVER ONLY. Bypasses RLS — every call must
 * have already verified the user identity via the cookie-auth client.
 *
 * Used for cross-table writes (curriculum_templates, template_nodes, etc.)
 * during quest creation, where RLS would be cumbersome and the writes are
 * happening on behalf of an authenticated user we've already authorized.
 */
export function getAdminSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
  return cached;
}
