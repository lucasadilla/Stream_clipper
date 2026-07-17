import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthSessionProvider>
      <div className="marketing-shell min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 pt-[var(--site-header-height)]">{children}</main>
        <SiteFooter />
      </div>
    </AuthSessionProvider>
  );
}
