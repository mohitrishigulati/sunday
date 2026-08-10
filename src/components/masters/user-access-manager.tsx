"use client";

import { useState, useTransition } from "react";
import {
  setCompanyAccess,
  setLocationAccess,
  setUserActive,
  setUserRoles,
} from "@/lib/actions/access";
import { Button, EmptyState, Select } from "@/components/ui/primitives";

type Role = { code: string; name: string };
type Company = { id: string; code: string; name: string };
type Location = { id: string; code: string; name: string; company_id: string };

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  roleCodes: string[];
  companyAccess: Record<
    string,
    { read: boolean; write: boolean; approve: boolean; manage: boolean }
  >;
  locationAccess: Record<string, { read: boolean; write: boolean }>;
};

const COMPANY_CAPS = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "approve", label: "Approve" },
  { key: "manage", label: "Manage" },
] as const;

export function UserAccessManager({
  users,
  roles,
  companies,
  locations,
  currentUserId,
}: {
  users: UserRow[];
  roles: Role[];
  companies: Company[];
  locations: Location[];
  currentUserId: string;
}) {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id ?? "");
  const [companyId, setCompanyId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const user = users.find((u) => u.id === selectedUserId);
  const companyLocations = locations.filter((l) => l.company_id === companyId);
  const isSelf = user?.id === currentUserId;

  if (users.length === 0) {
    return <EmptyState message="No users yet." />;
  }

  const run = (label: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const result = await action();
      if (result.ok) setMessage(`${label} updated`);
      else setError(result.error ?? "Failed");
    });
  };

  const toggleRole = (code: string) => {
    if (!user) return;
    const next = user.roleCodes.includes(code)
      ? user.roleCodes.filter((c) => c !== code)
      : [...user.roleCodes, code];
    run("Roles", () => setUserRoles({ userId: user.id, roleCodes: next }));
  };

  const toggleCompanyCap = (
    targetCompanyId: string,
    cap: (typeof COMPANY_CAPS)[number]["key"],
  ) => {
    if (!user) return;
    const current = user.companyAccess[targetCompanyId] ?? {
      read: false,
      write: false,
      approve: false,
      manage: false,
    };
    const next = { ...current, [cap]: !current[cap] };
    run("Company access", () =>
      setCompanyAccess({
        userId: user.id,
        companyId: targetCompanyId,
        canRead: next.read,
        canWrite: next.write,
        canApprove: next.approve,
        canManage: next.manage,
      }),
    );
  };

  const toggleLocationCap = (locationId: string, cap: "read" | "write") => {
    if (!user) return;
    const current = user.locationAccess[locationId] ?? { read: false, write: false };
    const next = { ...current, [cap]: !current[cap] };
    run("Location access", () =>
      setLocationAccess({
        userId: user.id,
        locationId,
        canRead: next.read,
        canWrite: next.write,
      }),
    );
  };

  return (
    <div className="space-y-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="User"
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} — {u.email}
              {u.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
        {user ? (
          <div className="flex items-end">
            <Button
              variant="secondary"
              disabled={pending || isSelf}
              onClick={() =>
                run("Status", () =>
                  setUserActive({ userId: user.id, isActive: !user.is_active }),
                )
              }
            >
              {user.is_active ? "Deactivate user" : "Activate user"}
            </Button>
          </div>
        ) : null}
      </div>

      {user ? (
        <>
          <section className="space-y-2">
            <h3 className="font-medium">Roles</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              {roles.map((role) => (
                <label key={role.code} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={user.roleCodes.includes(role.code)}
                    disabled={pending || (isSelf && role.code === "admin")}
                    onChange={() => toggleRole(role.code)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
            <p className="rounded-md bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
              <strong>Entry Operator:</strong> select “Entry Operator — Entries Only (No Statements / Reports)”, then give only Read + Write for the required companies. Do not give Approve or Manage.
            </p>
            {isSelf ? (
              <p className="text-xs text-[var(--muted)]">
                You cannot remove your own admin role or deactivate yourself.
              </p>
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Company access</h3>
            <div className="overflow-x-auto rounded-md border border-[var(--border)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Company</th>
                    {COMPANY_CAPS.map((cap) => (
                      <th key={cap.key} className="px-4 py-2 font-medium">
                        {cap.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => {
                    const access = user.companyAccess[company.id];
                    return (
                      <tr key={company.id} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2">
                          {company.code} — {company.name}
                        </td>
                        {COMPANY_CAPS.map((cap) => (
                          <td key={cap.key} className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={access?.[cap.key] ?? false}
                              disabled={pending}
                              onChange={() => toggleCompanyCap(company.id, cap.key)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Clearing every capability removes the grant. Read is implied by any
              higher capability.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Location access</h3>
            <p className="text-xs text-[var(--muted)]">
              Only applies to users holding the cashier role without admin — they
              are limited to the locations granted here.
            </p>
            <Select
              label="Company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">Select a company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
            {companyId && companyLocations.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No locations in this company.
              </p>
            ) : null}
            {companyLocations.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Location</th>
                      <th className="px-4 py-2 font-medium">Read</th>
                      <th className="px-4 py-2 font-medium">Write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyLocations.map((location) => {
                      const access = user.locationAccess[location.id];
                      return (
                        <tr key={location.id} className="border-t border-[var(--border)]">
                          <td className="px-4 py-2">
                            {location.code} — {location.name}
                          </td>
                          {(["read", "write"] as const).map((cap) => (
                            <td key={cap} className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={access?.[cap] ?? false}
                                disabled={pending}
                                onChange={() => toggleLocationCap(location.id, cap)}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--accent)]">{message}</p> : null}
    </div>
  );
}
