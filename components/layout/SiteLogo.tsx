import Link from "next/link";
import { cn } from "@/lib/cn";

interface SiteLogoProps {
  className?: string;
  showText?: boolean;
}

export function SiteLogo({ className, showText = true }: SiteLogoProps) {
  return (
    <Link
      href="/"
      aria-label="Stream Clipper home"
      className={cn("group flex min-w-0 shrink-0 items-center gap-3", className)}
    >
      <span className="site-logo-mark relative block h-9 w-9 shrink-0 overflow-hidden border border-[#95ff00]/60 bg-[#070b06]" aria-hidden="true">
        <span className="absolute left-1.5 right-1.5 top-2 h-px bg-white/28" />
        <span className="absolute left-1.5 right-3 top-[1.05rem] h-px bg-white/28" />
        <span className="absolute bottom-2 left-1.5 right-2 h-px bg-white/28" />
        <span className="absolute bottom-1.5 top-1.5 left-[1.15rem] w-px bg-[#95ff00] transition-transform duration-300 group-hover:translate-x-1" />
        <span className="absolute left-[0.94rem] top-[0.88rem] h-1.5 w-1.5 bg-[#95ff00] transition-transform duration-300 group-hover:translate-x-1" />
      </span>
      {showText && (
        <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="font-[var(--font-display)] text-[1.35rem] leading-none text-white">
            Stream
          </span>
          <span className="text-[10px] font-bold uppercase text-white/68 transition-colors group-hover:text-[#95ff00]">
            Clipper
          </span>
        </span>
      )}
    </Link>
  );
}
