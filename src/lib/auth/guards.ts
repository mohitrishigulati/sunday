import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

export type AuthContext = {
  userId: string;
  email: string;
  roles: string[];
  permissions: Record<string, boolean>;
};

export async function requireUser(): Promise<ActionResult<AuthContext>> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return fail("Not authenticated");
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(code, permissions)")
    .eq("user_id", user.id);

  const roles: string[] = [];
  const permissions: Record<string, boolean> = {};

  for (const row of roleRows ?? []) {
    const role = row.roles as unknown as {
      code: string;
      permissions: Record<string, boolean>;
    } | null;
    if (!role) continue;
    roles.push(role.code);
    for (const [key, value] of Object.entries(role.permissions ?? {})) {
      permissions[key] = Boolean(permissions[key] || value);
    }
  }

  return ok({
    userId: user.id,
    email: user.email ?? "",
    roles,
    permissions,
  });
}

export async function assertCompanyAccess(
  companyId: string,
  capability: "read" | "write" | "approve" | "manage",
): Promise<ActionResult<true>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  if (auth.data.roles.includes("admin")) {
    return ok(true);
  }

  const supabase = await createClient();
  const column =
    capability === "read"
      ? "can_read"
      : capability === "write"
        ? "can_write"
        : capability === "approve"
          ? "can_approve"
          : "can_manage";

  const { data, error } = await supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", auth.data.userId)
    .eq("company_id", companyId)
    .eq(column, true)
    .maybeSingle();

  if (error || !data) {
    return fail(`No ${capability} access to company`);
  }

  return ok(true);
}

export async function assertLocationAccess(
  locationId: string,
  capability: "read" | "write",
): Promise<ActionResult<true>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  if (auth.data.roles.includes("admin")) {
    return ok(true);
  }

  // Cashiers are always scoped to their assigned locations. Holding a second
  // role must not widen that — only `admin` (handled above) lifts the scope.
  if (!auth.data.roles.includes("cashier")) {
    const supabase = await createClient();
    const { data: loc } = await supabase
      .from("locations")
      .select("company_id")
      .eq("id", locationId)
      .maybeSingle();
    if (!loc) return fail("Location not found");
    return assertCompanyAccess(
      loc.company_id,
      capability === "read" ? "read" : "write",
    );
  }

  const supabase = await createClient();
  const column = capability === "read" ? "can_read" : "can_write";
  const { data, error } = await supabase
    .from("user_location_access")
    .select("location_id")
    .eq("user_id", auth.data.userId)
    .eq("location_id", locationId)
    .eq(column, true)
    .maybeSingle();

  if (error || !data) {
    return fail(`No ${capability} access to location`);
  }

  return ok(true);
}

export function assertPermission(
  auth: AuthContext,
  key: string,
): ActionResult<true> {
  if (auth.roles.includes("admin") || auth.permissions[key]) {
    return ok(true);
  }
  return fail(`Missing permission: ${key}`);
}
