import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/stories";

// Public story pages are open. Account, studio and reading pages need sign-in and carry personal data.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/library",
          "/settings",
          "/sign-in",
          "/creator-studio",
          "/support/",
          "/stories/*/read/",
          "/stories/*/react/",
          "/stories/*/reviews/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
