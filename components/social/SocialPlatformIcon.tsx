import { siYoutube, siTiktok, siInstagram, siFacebook, siX, siReddit } from "simple-icons";
import { cn } from "@/lib/cn";
import type { SocialPlatform } from "@/lib/social/types";

const ICONS: Record<
  SocialPlatform,
  { path: string; hex: string; title: string }
> = {
  youtube: siYoutube,
  tiktok: siTiktok,
  instagram: siInstagram,
  facebook: siFacebook,
  x: siX,
  reddit: siReddit,
};

/** Brand tile backgrounds so marks read as logos, not faint glyphs. */
const TILE: Record<SocialPlatform, string> = {
  youtube: "#FF0000",
  tiktok: "#010101",
  instagram: "#E4405F",
  facebook: "#1877F2",
  x: "#000000",
  reddit: "#FF4500",
};

const SIZE = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
} as const;

const ICON_PX = {
  sm: "h-[18px] w-[18px]",
  md: "h-6 w-6",
  lg: "h-7 w-7",
} as const;

export function SocialPlatformIcon({
  platform,
  size = "md",
  className,
}: {
  platform: SocialPlatform;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const icon = ICONS[platform];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        SIZE[size],
        className
      )}
      style={{ backgroundColor: TILE[platform] }}
      title={icon.title}
      aria-hidden
    >
      <svg
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className={ICON_PX[size]}
        fill="#ffffff"
      >
        <title>{icon.title}</title>
        <path d={icon.path} />
      </svg>
    </span>
  );
}
