import type { Metadata, MetadataRoute } from "next";
import { comparisonIndex, comparisons } from "@/lib/editorialComparisons";
import { getPublicSiteUrl } from "@/lib/publicOrigin";

type EditorialPage = {
  path: string;
  title: string;
  description: string;
};

export type TutorialVideo = {
  youtubeId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  uploadedAt: string;
  duration: string; // ISO 8601 duration, for example PT4M20S.
};

type Guide = EditorialPage & {
  slug: string;
  topic: string;
  steps: { title: string; body: string; timestamp?: string }[];
  checklist: string[];
  video?: TutorialVideo;
};

export const resources = {
  path: "/guides",
  title: "Clipper Guides and Editing Examples",
  description: "Learn to cut, caption, and reframe interviews and gaming streams for YouTube Shorts, TikTok, and Reels.",
};

// Enable after the source and finished clip are cleared for this page.
export const interviewCase = {
  path: "/case-studies/interview-to-youtube-short",
  title: "How We Turned an Interview Moment Into a Captioned YouTube Short",
  description: "See the source segment and finished vertical Short, with notes on clip boundaries, framing, and captions.",
  approved: false as boolean,
};

export const guides: Guide[] = [
  {
    slug: "interview-to-youtube-short",
    path: "/guides/interview-to-youtube-short",
    topic: "Interview editing",
    title: "How to Turn a Long Interview Into a YouTube Short With Captions",
    description: "Find a complete moment in a long interview, trim it with the transcript, frame the speaker, and export a captioned vertical Short.",
    steps: [
      {
        title: "Find an answer that stands on its own",
        body: "Search the transcript for a name, question, or phrase you remember. Play the source around the match. Pick an answer with a clear point and an ending. If it starts with “that” or “he,” listen for the line that tells a new viewer what those words refer to.",
      },
      {
        title: "Trim the beginning and the ending",
        body: "Set the in point just before the sentence that supplies the context. Set the out point after the answer or reaction lands. Preview the opening and ending with sound. A short pause can help the line land, but remove unrelated greetings and the start of the next topic.",
      },
      {
        title: "Preview the speaker in 9:16",
        body: "Switch to the vertical preview. Watch through the widest shot and any speaker change. Use speaker framing when it follows the conversation clearly. If the crop loses the other speaker during a shared reaction, try a wider layout and replay that section.",
      },
      {
        title: "Correct the caption track",
        body: "Listen while reading the captions. Check names, numbers, negatives, and overlapping speech first. Fix timing where a caption lands late. Keep text off faces and away from the app controls near the bottom and right side of the frame.",
      },
      {
        title: "Export and watch the actual MP4",
        body: "Render the vertical version with captions enabled. Open the downloaded file and play it through once before posting. Listen for sync at the opening and after cuts, check the framing at each shot change, and use a title that describes the point the speaker actually makes.",
      },
    ],
    checklist: ["The opening identifies who or what the clip is about.", "The ending completes the thought.", "Names and numbers match the audio.", "The finished MP4 keeps the speaker and captions visible."],
  },
  {
    slug: "gaming-stream-to-vertical-clips",
    path: "/guides/gaming-stream-to-vertical-clips",
    topic: "Gaming highlights",
    title: "How to Turn a Gaming Stream Into Vertical Clips Without Hiding the Gameplay",
    description: "Trim a complete gaming highlight and choose a vertical layout that keeps the play, facecam, and captions readable.",
    steps: [
      {
        title: "Start with the play and its payoff",
        body: "Find the callout, surprising play, or reaction. Play a few seconds on both sides before choosing the range. For a clutch, keep the setup that shows the stakes, then end after the result or reaction. A reaction alone often loses the part viewers came to see.",
      },
      {
        title: "Find what the viewer needs to read",
        body: "Pause on the most important frame. Check where the crosshair, opponent, scoreboard, minimap, or inventory appears. Mark the two or three areas that explain the moment. Review them again after a camera cut because their positions can change.",
      },
      {
        title: "Choose a layout based on what matters",
        body: "If the decisive action stays near the center, try a vertical crop. If it depends on action across the screen, preserve more of the game frame and place the facecam in a smaller region when available. Use a reaction-focused crop only where it leaves the event understandable.",
      },
      {
        title: "Keep captions clear of the game interface",
        body: "Move captions clear of the crosshair and any status text the viewer needs. Review team callouts, player names, and game terms against the audio. Check the result at phone size. On a phone, a scoreboard can become unreadable even when it technically fits inside the crop.",
      },
      {
        title: "Check both export formats",
        body: "Watch the rendered 9:16 MP4 for cut-off action, late captions, and jumpy framing. If the play needs the full width, also keep a native 16:9 version for platforms and posts where the wide frame fits.",
      },
    ],
    checklist: ["The opening shows why the play matters.", "The important action and game indicators stay visible.", "The facecam supports the play.", "Captions do not cover information needed to follow the result."],
  },
];

export function editorialMetadata(page: EditorialPage, index = true): Metadata {
  const url = new URL(page.path, getPublicSiteUrl());
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Clipper",
      url,
      title: page.title,
      description: page.description,
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: ["/og.png"],
    },
    ...(index ? {} : { robots: { index: false, follow: false, googleBot: { index: false, follow: false } } }),
  };
}

export function youtubeEmbedUrl(youtubeId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`;
}

export function editorialSitemap(siteUrl: string): MetadataRoute.Sitemap {
  const pages = [resources, comparisonIndex, ...comparisons, ...(interviewCase.approved ? [interviewCase] : [])];
  return [
    ...pages.map(page => ({ url: siteUrl + page.path })),
    ...guides.map(guide => ({
      url: siteUrl + guide.path,
      ...(guide.video ? {
        videos: [{
          title: guide.video.title,
          description: guide.video.description,
          thumbnail_loc: guide.video.thumbnailUrl,
          player_loc: youtubeEmbedUrl(guide.video.youtubeId),
          publication_date: guide.video.uploadedAt,
        }],
      } : {}),
    })),
  ];
}
