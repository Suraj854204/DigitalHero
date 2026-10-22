import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { getSession } from "@/lib/session";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <>
      <SiteHeader signedIn={!!session} isAdmin={session?.profile.role === "admin"} />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
