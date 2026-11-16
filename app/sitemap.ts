import type { MetadataRoute } from "next";
import { editorialSitemap } from "@/lib/editorialContent";
import { getPublicSiteUrl } from "@/lib/publicOrigin";

const siteUrl = getPublicSiteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...editorialSitemap(siteUrl),
  ];
}
