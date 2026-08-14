import {
  siFacebook,
  siGoogle,
  siInstagram,
  siKick,
  siReddit,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
  siYoutubeshorts,
} from "simple-icons";
import { cn } from "@/lib/cn";

export type PlatformBrand =
  | "google"
  | "youtube"
  | "youtube_shorts"
  | "youtube_landscape"
  | "twitch"
  | "kick"
  | "tiktok"
  | "instagram"
  | "instagram_reels"
  | "instagram_feed"
  | "facebook"
  | "facebook_reels"
  | "facebook_feed"
  | "x"
  | "reddit";

const BRAND = {
  google: { icon: siGoogle, color: "#FFFFFF", tile: "#FFFFFF", ink: "#4285F4", border: "#D8DDD6" },
  youtube: { icon: siYoutube, color: "#FF3131", tile: "#FF0000", ink: "#FFFFFF", border: "#FF4A4A" },
  youtube_shorts: { icon: siYoutubeshorts, color: "#FF3131", tile: "#FF0000", ink: "#FFFFFF", border: "#FF4A4A" },
  youtube_landscape: { icon: siYoutube, color: "#FF3131", tile: "#FF0000", ink: "#FFFFFF", border: "#FF4A4A" },
  twitch: { icon: siTwitch, color: "#A970FF", tile: "#9146FF", ink: "#FFFFFF", border: "#B184FF" },
  kick: { icon: siKick, color: "#53FC18", tile: "#53FC18", ink: "#081007", border: "#8BFF63" },
  tiktok: { icon: siTiktok, color: "#FFFFFF", tile: "#080A09", ink: "#FFFFFF", border: "#465044" },
  instagram: { icon: siInstagram, color: "#F05B78", tile: "#E4405F", ink: "#FFFFFF", border: "#F2768D" },
  instagram_reels: { icon: siInstagram, color: "#F05B78", tile: "#E4405F", ink: "#FFFFFF", border: "#F2768D" },
  instagram_feed: { icon: siInstagram, color: "#F05B78", tile: "#E4405F", ink: "#FFFFFF", border: "#F2768D" },
  facebook: { icon: siFacebook, color: "#4593F5", tile: "#1877F2", ink: "#FFFFFF", border: "#5A9DF5" },
  facebook_reels: { icon: siFacebook, color: "#4593F5", tile: "#1877F2", ink: "#FFFFFF", border: "#5A9DF5" },
  facebook_feed: { icon: siFacebook, color: "#4593F5", tile: "#1877F2", ink: "#FFFFFF", border: "#5A9DF5" },
  x: { icon: siX, color: "#FFFFFF", tile: "#080A09", ink: "#FFFFFF", border: "#465044" },
  reddit: { icon: siReddit, color: "#FF6533", tile: "#FF4500", ink: "#FFFFFF", border: "#FF825C" },
} satisfies Record<PlatformBrand, { icon: typeof siYoutube; color: string; tile: string; ink: string; border: string }>;

const TILE_SIZE = {
  xs: "h-7 w-7 rounded",
  sm: "h-9 w-9 rounded-md",
  md: "h-12 w-12 rounded-lg",
  lg: "h-14 w-14 rounded-lg",
} as const;

const MARK_SIZE = {
  xs: "h-4 w-4",
  sm: "h-[18px] w-[18px]",
  md: "h-6 w-6",
  lg: "h-7 w-7",
} as const;

export function PlatformBrandIcon({
  brand,
  size = "sm",
  variant = "tile",
  className,
}: {
  brand: PlatformBrand;
  size?: keyof typeof TILE_SIZE;
  variant?: "tile" | "mark";
  className?: string;
}) {
  const item = BRAND[brand];
  const svg = (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(MARK_SIZE[size], variant === "mark" && className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={item.icon.path} />
    </svg>
  );

  if (variant === "mark") {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ color: item.color }}
        title={item.icon.title}
        aria-hidden="true"
      >
        {svg}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border shadow-[0_1px_0_rgba(255,255,255,0.05)]",
        TILE_SIZE[size],
        className
      )}
      style={{
        backgroundColor: item.tile,
        borderColor: item.border,
        color: item.ink,
      }}
      title={item.icon.title}
      aria-hidden="true"
    >
      {svg}
    </span>
  );
}

export function authProviderBrand(providerId: string): PlatformBrand | null {
  const normalized = providerId.toLowerCase();
  if (normalized.includes("google")) return "google";
  if (normalized.includes("twitch")) return "twitch";
  if (normalized.includes("kick")) return "kick";
  return null;
}
