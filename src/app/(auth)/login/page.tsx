"use client";

import { useEffect, useState } from "react";
import { signIn, signUp } from "@/lib/actions/auth";
import { Button, Card, Input } from "@/components/ui/primitives";

// Mirrors the server-side gate in signUp(). Inlined at build time.
const SIGNUP_ENABLED = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "config") {
      setError(
        "Supabase is not configured on this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then redeploy.",
      );
    }
  }, []);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setMessage(null);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const fullName = String(formData.get("fullName") ?? "");

    if (mode === "signin") {
      const result = await signIn(email, password);
      if (result && !result.ok) setError(result.error);
    } else {
      const result = await signUp(email, password, fullName);
      if (!result.ok) setError(result.error);
      else setMessage("Account created. Confirm email if required, then sign in.");
    }
    setPending(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-[family-name:var(--font-display)] text-4xl tracking-tight text-[var(--ink)]">
            SundayMD
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Multi-company accounting
          </p>
        </div>
        <Card>
          <form action={onSubmit} className="space-y-4">
            {mode === "signup" ? (
              <Input label="Full name" name="fullName" required />
            ) : null}
            <Input label="Email" name="email" type="email" required />
            <Input
              label="Password"
              name="password"
              type="password"
              required
              minLength={8}
            />
            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : null}
            {message ? (
              <p className="text-sm text-[var(--accent)]">{message}</p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
          {SIGNUP_ENABLED ? (
            <button
              type="button"
              className="mt-4 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
              onClick={() =>
                setMode((m) => (m === "signin" ? "signup" : "signin"))
              }
            >
              {mode === "signin"
                ? "Need an account? Sign up"
                : "Already registered? Sign in"}
            </button>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Accounts are created by an administrator.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
