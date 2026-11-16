import { PRICING_PLANS } from "@/lib/pricing";

const creator = PRICING_PLANS.find(plan => plan.id === "creator");
const clipperUsage = `Creator includes ${creator?.entitlements.exportsLimit ?? 20} finished videos per month. Each clip counts once across platform versions.`;
const clipperCaptions = "Clipper includes caption editing and face-aware framing, with native 16:9 and vertical 9:16 exports.";

export const comparisonIndex = {
  path: "/compare",
  title: "Compare Clipper With Other Video Clipping Tools",
  description: "Compare tools for livestream highlights, video podcasts, and turning recordings into social clips.",
};

type Comparison = {
  slug: `clipper-vs-${string}`;
  name: string;
  title: string;
  description: string;
  decision: string;
  rows: { topic: string; clipper: string; competitor: string }[];
  trial: string[];
  sources: { label: string; url: string }[];
};

const entries: Comparison[] = [
  {
    slug: "clipper-vs-opusclip",
    name: "OpusClip",
    title: "Clipper vs. OpusClip for Stream and Video Highlights",
    description: "Compare Clipper and OpusClip for live editing, automatic clip selection, framing, and export.",
    decision: "Try Clipper’s sample if you usually remember a quote or moment and want to find it quickly in a transcript. OpusClip is a candidate if you prefer reviewing a batch of automatic picks or need its listed Pro export options for Premiere Pro or DaVinci Resolve.",
    rows: [
      { topic: "Finding moments", clipper: "Start with AI suggestions or use transcript search to jump to a line and set the cut on the timeline.", competitor: "OpusClip lists automatic clip generation and Virality Score for uploads or supported video links." },
      { topic: "Captions and framing", clipper: clipperCaptions, competitor: "OpusClip lists animated captions and automatic reframing. It lists multiple aspect ratios and custom fonts on Pro." },
      { topic: "Usage limits", clipper: clipperUsage, competitor: "OpusClip lists monthly credits. Check the credits available on your plan against the lengths of the sources you usually submit." },
      { topic: "Evaluation", clipper: "Preview a prepared Short and compare its original frame in the interactive sample.", competitor: "OpusClip lists a Free plan with watermarked exports and no editing. Starter lists an editor and watermark removal." },
    ],
    trial: [
      "Import the same original file in both tools. Compare the first automatic picks for context, complete endings, and overlap.",
      "Trim the same moment in both tools and export with captions in 9:16. Compare caption fixes, framing at shot changes, and hands-on time.",
    ],
    sources: [{ label: "OpusClip plans and features", url: "https://www.opus.pro/pricing" }],
  },
  {
    slug: "clipper-vs-eklipse",
    name: "Eklipse",
    title: "Clipper vs. Eklipse for Gaming Highlights",
    description: "Compare gameplay detection, live clipping, and vertical layouts for gaming streams.",
    decision: "Eklipse is a candidate if you want automatic highlight detection built around a supported game. Clipper is a candidate if you want to find a particular callout or reaction and choose exactly how much of the setup and payoff stays in the cut.",
    rows: [
      { topic: "Highlight discovery", clipper: "Search spoken moments or start with clip suggestions, then adjust the range around the play and reaction.", competitor: "Eklipse focuses on gaming highlight detection and provides a catalog of supported games." },
      { topic: "When you can clip", clipper: "Open the timeline for a supported live stream or work from a completed recording.", competitor: "Eklipse lists automatic VOD clipping and lists live clipping under Premium Pro." },
      { topic: "Game framing", clipper: "Preview the vertical layout before export and keep a native version when the play needs the wide frame.", competitor: "Eklipse offers its Studio to convert highlights into vertical social clips and lists gaming-specific editing tools." },
      { topic: "Plan fit", clipper: clipperUsage, competitor: "Check whether your game and preferred workflow are covered, especially if you need live clipping or the published higher-quality options." },
    ],
    trial: [
      "Try one clear play and one reaction that happens between plays. Check whether each tool finds the moment and keeps the setup that explains it.",
      "Watch each vertical export on a phone. Check the crosshair, facecam, and the scoreboard or minimap needed to follow the play.",
    ],
    sources: [{ label: "Eklipse feature and game catalog", url: "https://eklipse.gg/" }],
  },
  {
    slug: "clipper-vs-quso",
    name: "quso.ai",
    title: "Clipper vs. quso.ai (Formerly Vidyo.ai)",
    description: "Compare editing long recordings into shorts, planning social posts, and how each service measures usage.",
    decision: "quso.ai is a candidate if the same person needs to turn recordings into clips and plan posts across channels. Clipper is a candidate if the core job is picking an exact moment in a stream or VOD and checking the resulting cut before posting.",
    rows: [
      { topic: "Clip workflow", clipper: "Find a phrase in the transcript or start from a suggested clip, then check its boundaries on the video timeline.", competitor: "quso.ai documents automatic clip detection, reframing, and animated captions for long-video repurposing." },
      { topic: "Delivery", clipper: clipperCaptions, competitor: "quso.ai lists landscape, vertical, and square clips. Its Essential plan lists a content planner and scheduling to multiple platforms." },
      { topic: "Usage limits", clipper: clipperUsage, competitor: "quso.ai describes one credit as roughly one processed minute and says clipping, captioning, and editing draw from the monthly credit allowance." },
      { topic: "Evaluation", clipper: "The interactive sample shows trimming and the original-to-vertical comparison.", competitor: "quso.ai lists a Free plan with 720p watermarked exports. Check plan limits for scheduling and source support." },
    ],
    trial: [
      "Use a recording similar in length to one you publish each week. Compare which suggested clips preserve the context needed by a new viewer.",
      "Track what a full month of source footage and finished clips would use. Check the specific scheduling destinations you need.",
    ],
    sources: [
      { label: "quso.ai clip generator", url: "https://quso.ai/products/ai-clips-generator" },
      { label: "quso.ai plans and credit rules", url: "https://quso.ai/pricing" },
    ],
  },
  {
    slug: "clipper-vs-descript",
    name: "Descript",
    title: "Clipper vs. Descript for Interview and Podcast Clips",
    description: "Compare transcript-based editing, automatic clip suggestions, and export workflows for interviews and podcasts.",
    decision: "Descript is a candidate if you also produce the full episode and want a transcript editor with audio cleanup and retake tools. Clipper is a candidate if the recording or livestream is already made and your task is to turn a specific moment into a finished short.",
    rows: [
      { topic: "Starting point", clipper: "Search the transcript and set a short selection on the timeline from a supported stream or a recording.", competitor: "Descript offers text-based editing of recordings and an AI Create Clips feature that proposes highlights from the source." },
      { topic: "Finishing tools", clipper: clipperCaptions, competitor: "Descript documents caption styling, adaptable layouts, audio enhancement, and tools for removing filler words or retakes." },
      { topic: "Usage limits", clipper: clipperUsage, competitor: "Descript lists separate limits for media hours and AI credits. Check both if you also edit full-length episodes." },
      { topic: "Evaluation", clipper: "Use the prepared interview sample to check range editing and preview a captioned Short.", competitor: "Descript lists a Free tier with 720p watermarked exports and limited AI use. Check which tier includes the editing tools you need." },
    ],
    trial: [
      "Pick an answer from an interview with a speaker change or crosstalk. Compare how quickly you can set the same clean opening and ending.",
      "Check names and audio sync in the exported vertical clips. If you also need to finish the full episode, try your usual dialogue cleanup on the source.",
    ],
    sources: [
      { label: "Descript Create Clips", url: "https://www.descript.com/clips" },
      { label: "Descript plans and media limits", url: "https://www.descript.com/pricing" },
    ],
  },
];

export const comparisons = entries.map(entry => ({
  ...entry,
  path: `/compare/${entry.slug}`,
}));
