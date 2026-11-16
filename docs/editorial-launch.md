# Clipper SEO launch

The first release contains the guides hub, two written tutorials and documented comparisons with OpusClip, Eklipse, quso.ai and Descript. Turn on the interview case study after the original excerpt and finished Short are cleared for that page. The case route returns 404 until approval and is kept out of links and the sitemap. The gaming case study needs its own source and approved published results.

## Record the two walkthroughs

Record the actual editor using demo accounts and an approved source. Start with the exported result, then show the edits that explain what the viewer saw. The approximate chapter times below are targets. Replace them with the times in the final cut.

### Interview to YouTube Short

| Target | Show on screen | Narration |
| --- | --- | --- |
| 0:00 | Finished 9:16 clip, then the original 16:9 moment | “Here’s the finished Short. The original interview gives this answer more lead-in. I’m going to show where I cut it and why.” |
| 0:20 | Transcript search and matching line in the timeline | “I start with the line I want people to hear, then play backwards until the viewer has enough context to understand it.” |
| 0:55 | In and out points, then playback through the ending | “The first sentence tells us what the answer is about. The last sentence completes the thought. I’ll preview the cut with sound before changing the layout.” |
| 1:30 | 9:16 preview through a wide shot and caption correction | “Check the wides and speaker changes. Then listen for names and numbers and fix any caption that lands at the wrong time.” |
| 2:30 | Final MP4 playback and the matching guide | “Play the actual download at phone size. Watch the framing through every cut and check that captions still match the audio.” |

Description link for the full walkthrough
`https://streamclipper.stream/guides/interview-to-youtube-short?utm_source=youtube&utm_medium=video&utm_campaign=clipper_walkthroughs&content_id=interview-to-youtube-short`

### Gaming stream to vertical clips

| Target | Show on screen | Narration |
| --- | --- | --- |
| 0:00 | Full-width play, then finished vertical export | “The moment only works if you can see the play. Here’s what survives when the frame gets narrower.” |
| 0:20 | Lead-in, play, and reaction on the timeline | “Keep just enough setup to show the stakes. End after the result or reaction, whichever completes the moment.” |
| 1:00 | Compare vertical crop and a layout preserving more gameplay | “Watch the crosshair and the parts of the game interface that explain the outcome. A tighter crop works only if those details still fit.” |
| 1:55 | Check captions against game UI at phone size | “Make space for captions without covering the action, and correct names or callouts that the transcription got wrong.” |
| 2:40 | Play finished vertical and native exports | “Compare the actual exported files. Keep the native version when the full width makes the play easier to follow.” |

Description link for the full walkthrough
`https://streamclipper.stream/guides/gaming-stream-to-vertical-clips?utm_source=youtube&utm_medium=video&utm_campaign=clipper_walkthroughs&content_id=gaming-stream-to-vertical-clips`

Publish with reviewed captions and chapters. Add the public, embeddable video’s ID, title, description, thumbnail URL, upload date and ISO duration to the matching guide in `lib/editorialContent.ts`. Add the final chapter times to the guide steps. The guide then renders the player, structured data and video sitemap entry from that record.

## Run the comparison

Use the same authorized original in both products. Record source duration, date, plan, settings and target output. Save screenshots and the actual exported files for each pass.

| Pass | Evidence to record for each product |
| --- | --- |
| Automatic suggestions | Initial wait, first five suggestions or all if fewer, exact time ranges, overlaps, and which moments make sense on their own. |
| Same selection in 9:16 | Input boundaries, export resolution, caption fixes, framing on the hardest shot, active editing time and export wait. |

Update the comparison with the findings and approved side-by-side output. Label plan constraints, record any differences in defaults, and recheck the official plan pages before release. Use actual findings as the basis for a later alternatives roundup.

## Verify discovery and conversion after release

- Take a 28-day baseline in Search Console before submitting the updated sitemap. Inspect the actual guide and comparison URLs after the release. Check video indexing for each guide after its player is public.
- Record page impressions and clicks in Search Console. In PostHog use the existing pageview event, `editorial_cta_clicked`, and `sample_preview_started`. Split by `content_id` where present and use `utm_source=youtube` for tagged walkthrough visits.
- Inspect the existing `signup_completed`, `first_clip_rendered`, and `subscription_activated` funnel from the editorial landing paths. Confirm identity stitching on a real test journey before attributing cross-session conversions. Review after 30 days and prioritize topics that lead to finished clips.
