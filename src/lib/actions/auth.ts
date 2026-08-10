"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

export async function signIn(
  email: string,
  password: string,
): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(error.message);
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<ActionResult<void>> {
  // Accounts for an internal ledger are provisioned by an admin. Enforce this
  // on the server — hiding the form is not a control.
  if (process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "true") {
    return fail("Self-registration is disabled. Ask an admin to create your account.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) return fail(error.message);
  return ok(undefined);
}
