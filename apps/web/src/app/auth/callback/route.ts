import { NextResponse } from "next/server";
import { getServerSupabase } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Handles email-confirmation links and any future OAuth code exchange. The
 * `code` query param is exchanged for a session cookie, then we redirect to
 * the `next` param if present, else /dashboard.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, request.url),
      );
    }
  }
  return NextResponse.redirect(new URL(next, request.url));
}
