import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Missing Vercel env → avoid opaque 500 from createServerClient.
    const path = request.nextUrl.pathname;
    if (path.startsWith("/login") || path.startsWith("/_next")) {
      return supabaseResponse;
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("error", "config");
    return NextResponse.redirect(login);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login");
  const isPublicAsset = path.startsWith("/_next") || path === "/favicon.ico";

  // getUser() may have refreshed the session. Any response we return instead of
  // supabaseResponse must carry those cookies, or the new tokens are lost and
  // the user is signed out on the next request.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const response = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  };

  if (!user && !isAuthRoute && !isPublicAsset) {
    return redirectTo("/login");
  }

  if (user && isAuthRoute) {
    return redirectTo("/dashboard");
  }

  return supabaseResponse;
}
