import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser verifies the identity and refreshes an expired cookie session.
  // Do not use getSession() as the source of server-side identity.
  await supabase.auth.getUser();
  return response;
}

// Only routes that need a verified session run the refresh; public pages,
// share cards and static assets skip the extra Supabase call.
export const config = {
  matcher: [
    "/library/:path*",
    "/settings/:path*",
    "/creator-studio/:path*",
    "/support/:path*",
    "/stories/:slug/read/:path*",
    "/stories/:slug/react/:path*",
    "/stories/:slug/reviews/:path*",
    "/auth/:path*",
  ],
};
