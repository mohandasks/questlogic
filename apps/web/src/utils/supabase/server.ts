import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Per-request Supabase client carrying the user's auth cookies. Use this in
 * server components, route handlers, and server actions. Queries are RLS-scoped
 * to the signed-in user.
 *
 * Call sites do not pass the cookieStore in — this helper reads it themselves
 * so the call surface stays small.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — Next.js doesn't let us mutate
            // cookies there. The middleware will refresh the session on the
            // next request, so this is safe to ignore.
          }
        },
      },
    },
  );
}
