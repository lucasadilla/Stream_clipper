export function renderProgressMessage(stage: string) {
  if (stage === "reconnecting") return { title: "Reconnecting to your render", detail: "Your server job is saved. Waiting for the connection to recover…" };
  if (stage === "resuming") return { title: "Resuming your render", detail: "Checking the existing job before starting any new work…" };
  if (stage === "queued" || stage === "claimed") return { title: "Waiting to render", detail: "Your clip is queued. You can reopen it and resume this render." };
  if (/source|download|mux/.test(stage)) return { title: "Preparing source video", detail: "Retrieving or reusing the highest-quality source and original audio…" };
  if (/caption|subtitle/.test(stage)) return { title: "Preparing captions", detail: "Applying your saved words, timing, and caption style…" };
  if (/face|layout|framing/.test(stage)) return { title: "Preparing framing", detail: "Applying the selected layout and camera tracking…" };
  if (/quality|review|verif|validate/.test(stage)) return { title: "Checking the finished video", detail: "Verifying the encoded video, audio, framing, and captions…" };
  if (/retry|reclaimed/.test(stage)) return { title: "Recovering your render", detail: "The worker is retrying with your saved settings and reusable source files…" };
  if (stage === "completed") return { title: "Video ready", detail: "The finished file is ready to preview or download." };
  return { title: "Encoding your video", detail: "Creating the final high-quality video and original audio…" };
}
