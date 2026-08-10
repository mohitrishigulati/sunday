import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/primitives";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function AppShell({
  children,
  email,
  roles,
  permissions,
}: {
  children: React.ReactNode;
  email?: string;
  roles: string[];
  permissions: Record<string, boolean>;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-4 py-6 md:block">
          <div className="mb-8 px-2">
            <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              SundayMD
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Multi-company books
            </p>
          </div>
          <SidebarNav roles={roles} permissions={permissions} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur md:px-8">
            <p className="text-sm text-[var(--muted)] md:hidden">SundayMD</p>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-[var(--muted)]">{email}</span>
              <form action={signOut}>
                <Button type="submit" variant="secondary">
                  Sign out
                </Button>
              </form>
            </div>
          </header>
          <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
