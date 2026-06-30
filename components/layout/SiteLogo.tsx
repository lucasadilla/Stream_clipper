import Link from "next/link";
import { cn } from "@/lib/utils";

interface SiteLogoProps {
  className?: string;
  showText?: boolean;
}

export function SiteLogo({ className, showText = true }: SiteLogoProps) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 group shrink-0", className)}
    >
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[#6d28d9] flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/35 transition-shadow">
        SC
      </div>
      {showText && (
        <span className="font-semibold text-[15px] tracking-tight group-hover:text-white/90 transition-colors">
          Stream Clipper
        </span>
      )}
    </Link>
  );
}
