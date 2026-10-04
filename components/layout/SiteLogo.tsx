import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";

interface SiteLogoProps {
  className?: string;
  showText?: boolean;
}

interface ClipperMarkProps {
  className?: string;
}

export function ClipperMark({ className }: ClipperMarkProps) {
  return (
    <Image
      src="/brand/clipper-mark-ivory.png"
      alt=""
      width={1024}
      height={1024}
      className={cn("object-contain", className)}
      aria-hidden="true"
      priority
    />
  );
}

export function SiteLogo({ className, showText = true }: SiteLogoProps) {
  return (
    <Link
      href="/"
      aria-label="Clipper home"
      className={cn("group flex min-w-0 shrink-0 items-center gap-2.5", className)}
    >
      <ClipperMark className="site-logo-mark h-11 w-[3.5rem] shrink-0" />
      {showText && (
        <span className="min-w-0 whitespace-nowrap">
          <span className="font-[var(--font-display)] text-[2rem] leading-none text-[#F1EFE7] transition-colors group-hover:text-white">
            Clipper
          </span>
        </span>
      )}
    </Link>
  );
}
