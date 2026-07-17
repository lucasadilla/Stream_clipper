import Link from "next/link";
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
    <svg
      viewBox="0 0 72 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="13" cy="13" r="9" stroke="currentColor" strokeWidth="4" />
      <circle cx="13" cy="43" r="9" stroke="currentColor" strokeWidth="4" />
      <path
        d="M19.7 19.1 31 28M19.7 36.9 31 28"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M30 13.5 61 28 30 42.5V13.5Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="30" cy="28" r="5.5" fill="#8FCB55" />
      <circle cx="30" cy="28" r="2" fill="#0B0D0C" />
    </svg>
  );
}

export function SiteLogo({ className, showText = true }: SiteLogoProps) {
  return (
    <Link
      href="/"
      aria-label="Clipper home"
      className={cn("group flex min-w-0 shrink-0 items-center gap-2.5", className)}
    >
      <ClipperMark className="site-logo-mark h-11 w-[3.5rem] shrink-0 text-[#F1EFE7]" />
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
