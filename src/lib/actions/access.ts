"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/types";

/**
 * Every write here is admin-only, matching the RLS policies on user_roles,
 * user_company_access and user_location_access. The check is duplicated in the
 * app so callers get a readable message instead of a bare RLS rejection.
 */
async function requireAdmin() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!auth.data.roles.includes("admin")) {
    return fail("Only an admin can manage users and access");
  }
  return auth;
}

const createUserSchema=z.object({email:z.string().email(),password:z.string().min(10).max(128),fullName:z.string().trim().min(1).max(200)});
export async function createApplicationUser(input:z.infer<typeof createUserSchema>):Promise<ActionResult<{id:string;confirmationRequired:boolean}>>{const auth=await requireAdmin();if(!auth.ok)return auth;const parsed=createUserSchema.safeParse(input);if(!parsed.success)return fail(parsed.error.issues[0]?.message??"Invalid user");const url=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceRole=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!serviceRole||serviceRole==="your-service-role-key")return fail("Server-only SUPABASE_SERVICE_ROLE_KEY is not configured. Keep public Auth sign-up disabled and add the key only to the server environment.");const isolated=createSupabaseClient(url,serviceRole,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const{data,error}=await isolated.auth.admin.createUser({email:parsed.data.email,password:parsed.data.password,email_confirm:true,user_metadata:{full_name:parsed.data.fullName}});if(error||!data.user)return fail(error?.message??"Could not create user");revalidatePath("/masters/users");return ok({id:data.user.id,confirmationRequired:false});}

const setRolesSchema = z.object({
  userId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid database UUID",
  ),
  roleCodes: z.array(z.string().trim().min(1)),
});

export async function setUserRoles(
  input: z.infer<typeof setRolesSchema>,
): Promise<ActionResult<{ roleCodes: string[] }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = setRolesSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const roleCodes = [...new Set(parsed.data.roleCodes)];
  if (roleCodes.includes("data_entry") && roleCodes.length > 1) {
    return fail("Entry Operator is an exclusive role. Remove other roles before selecting it.");
  }
  const { data, error } = await supabase.rpc("admin_set_user_roles", {
    p_user_id: parsed.data.userId,
    p_role_codes: roleCodes,
  });

  if (error) return fail(error.message);

  revalidatePath("/masters/users");
  return ok({ roleCodes: (data as string[] | null) ?? roleCodes });
}

const companyAccessSchema = z.object({
  userId: setRolesSchema.shape.userId,
  companyId: z.string().uuid(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canApprove: z.boolean(),
  canManage: z.boolean(),
});

export async function setCompanyAccess(
  input: z.infer<typeof companyAccessSchema>,
): Promise<ActionResult<{ removed: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = companyAccessSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { userId, companyId, canRead, canWrite, canApprove, canManage } = parsed.data;

  // No capability at all means no grant — drop the row instead of storing an
  // all-false record that reads like access but grants nothing.
  if (!canRead && !canWrite && !canApprove && !canManage) {
    const { error } = await supabase
      .from("user_company_access")
      .delete()
      .eq("user_id", userId)
      .eq("company_id", companyId);
    if (error) return fail(error.message);

    revalidatePath("/masters/users");
    return ok({ removed: true });
  }

  // Higher capabilities are meaningless without read; keep the row coherent.
  const { error } = await supabase.from("user_company_access").upsert(
    {
      user_id: userId,
      company_id: companyId,
      can_read: canRead || canWrite || canApprove || canManage,
      can_write: canWrite,
      can_approve: canApprove,
      can_manage: canManage,
    },
    { onConflict: "user_id,company_id" },
  );

  if (error) return fail(error.message);

  revalidatePath("/masters/users");
  return ok({ removed: false });
}

const locationAccessSchema = z.object({
  userId: setRolesSchema.shape.userId,
  locationId: z.string().uuid(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
});

export async function setLocationAccess(
  input: z.infer<typeof locationAccessSchema>,
): Promise<ActionResult<{ removed: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = locationAccessSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const { userId, locationId, canRead, canWrite } = parsed.data;

  if (!canRead && !canWrite) {
    const { error } = await supabase
      .from("user_location_access")
      .delete()
      .eq("user_id", userId)
      .eq("location_id", locationId);
    if (error) return fail(error.message);

    revalidatePath("/masters/users");
    return ok({ removed: true });
  }

  const { error } = await supabase.from("user_location_access").upsert(
    {
      user_id: userId,
      location_id: locationId,
      can_read: canRead || canWrite,
      can_write: canWrite,
    },
    { onConflict: "user_id,location_id" },
  );

  if (error) return fail(error.message);

  revalidatePath("/masters/users");
  return ok({ removed: false });
}

const activeSchema = z.object({
  userId: setRolesSchema.shape.userId,
  isActive: z.boolean(),
});

export async function setUserActive(
  input: z.infer<typeof activeSchema>,
): Promise<ActionResult<{ isActive: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  // user_company_ids()/user_location_ids() filter on profiles.is_active, so
  // deactivating yourself would revoke your own access mid-session.
  if (parsed.data.userId === auth.data.userId && !parsed.data.isActive) {
    return fail("You cannot deactivate your own account");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.userId);

  if (error) return fail(error.message);

  revalidatePath("/masters/users");
  return ok({ isActive: parsed.data.isActive });
}
