import {
  UserAccessManager,
  type UserRow,
} from "@/components/masters/user-access-manager";
import { DataTable, PageHeader } from "@/components/ui/primitives";
import { CreateUserForm } from "@/components/masters/create-user-form";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const supabase = await createClient();
  const auth = await requireUser();
  const isAdmin = auth.ok && auth.data.roles.includes("admin");

  const [
    { data: profiles },
    { data: roleAssignments },
    { data: companyAccess },
    { data: locationAccess },
    { data: roles },
    { data: companies },
    { data: locations },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_active").order("full_name"),
    supabase.from("user_roles").select("user_id, roles(code)"),
    supabase
      .from("user_company_access")
      .select("user_id, company_id, can_read, can_write, can_approve, can_manage"),
    supabase
      .from("user_location_access")
      .select("user_id, location_id, can_read, can_write"),
    supabase.from("roles").select("code, name").order("code"),
    supabase.from("companies").select("id, code, name").is("deleted_at", null).order("code"),
    supabase
      .from("locations")
      .select("id, code, name, company_id")
      .is("deleted_at", null)
      .order("code"),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const row of roleAssignments ?? []) {
    const code = (row.roles as unknown as { code: string } | null)?.code;
    if (!code) continue;
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(code);
    rolesByUser.set(row.user_id, list);
  }

  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const users: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    is_active: p.is_active,
    roleCodes: rolesByUser.get(p.id) ?? [],
    companyAccess: Object.fromEntries(
      (companyAccess ?? [])
        .filter((a) => a.user_id === p.id)
        .map((a) => [
          a.company_id,
          {
            read: a.can_read,
            write: a.can_write,
            approve: a.can_approve,
            manage: a.can_manage,
          },
        ]),
    ),
    locationAccess: Object.fromEntries(
      (locationAccess ?? [])
        .filter((a) => a.user_id === p.id)
        .map((a) => [a.location_id, { read: a.can_read, write: a.can_write }]),
    ),
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users & access"
        description={
          isAdmin
            ? "Roles and company access are enforced by RLS. Changes here apply immediately."
            : "Roles and company access are enforced by RLS. Only an admin can change them."
        }
      />

      {isAdmin ? (
        <><CreateUserForm /><UserAccessManager
          users={users}
          roles={roles ?? []}
          companies={companies ?? []}
          locations={locations ?? []}
          currentUserId={auth.ok ? auth.data.userId : ""}
        /></>
      ) : null}

      <DataTable
        columns={["Name", "Email", "Active", "Roles", "Company access"]}
        rows={users.map((u) => [
          u.full_name,
          u.email,
          u.is_active ? "Yes" : "No",
          u.roleCodes.join(", ") || "—",
          Object.entries(u.companyAccess)
            .map(([id, caps]) => {
              const code = companyById.get(id)?.code ?? id.slice(0, 8);
              const flags = [
                caps.read ? "R" : null,
                caps.write ? "W" : null,
                caps.approve ? "A" : null,
                caps.manage ? "M" : null,
              ]
                .filter(Boolean)
                .join("");
              return `${code}:${flags}`;
            })
            .join(", ") || "—",
        ])}
      />
    </div>
  );
}
