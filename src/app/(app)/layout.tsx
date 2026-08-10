import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireUser();

  return <AppShell email={auth.ok ? auth.data.email : undefined} roles={auth.ok ? auth.data.roles : []} permissions={auth.ok ? auth.data.permissions : {}}>{children}</AppShell>;
}
