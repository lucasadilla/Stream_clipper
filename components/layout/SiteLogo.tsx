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
      <div className="w-9 h-9 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-hover))] flex items-center justify-center text-sm font-bold text-black shadow-lg transition-shadow">
        SC
      </div>
      {showText && (
        <span className="font-semibold text-[15px] group-hover:text-white/90 transition-colors">
          Stream Clipper
        </span>
      )}
    </Link>
  );
}
