import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";
import type { SocialPlatform } from "@/lib/social/types";

export function SocialPlatformIcon({
  platform,
  size = "md",
  className,
}: {
  platform: SocialPlatform;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <PlatformBrandIcon brand={platform} size={size} className={className} />
  );
}
