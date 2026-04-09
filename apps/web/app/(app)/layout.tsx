import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Sidebar } from "@/components/nav/sidebar";
import { auth } from "@/lib/auth/server";

// Authenticated shell. Server component so we can gate the whole (app) segment
// on a valid Better Auth session without shipping auth state to the client.
//
// Next 15+ makes `headers()` asynchronous, so it must be awaited before being
// passed into `auth.api.getSession`.
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-background p-6">{children}</main>
    </div>
  );
}
