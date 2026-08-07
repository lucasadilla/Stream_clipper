import type { Detection, FaceDetector } from "@mediapipe/tasks-vision";

export type BrowserFaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let detectorPromise: Promise<FaceDetector> | null = null;
let lastDetectorTimestamp = 0;

const XNNPACK_INFO_MESSAGE = /Created TensorFlow Lite XNNPACK delegate for CPU/i;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function nextDetectorTimestamp(): number {
  const now = performance.now();
  lastDetectorTimestamp = Math.max(now, lastDetectorTimestamp + 0.01);
  return lastDetectorTimestamp;
}

export async function loadBrowserFaceDetector(): Promise<FaceDetector> {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("On-device face tracking is unavailable in this browser.");
  }
  if (!detectorPromise) {
    detectorPromise = import("@mediapipe/tasks-vision")
      .then(async ({ FaceDetector, FilesetResolver }) => {
        const root = window.location.origin;
        const vision = await FilesetResolver.forVisionTasks(
          `${root}/mediapipe/wasm`
        );

        // Emscripten binds console.error while it creates the WASM module and
        // retains that bound function for subsequent inference logs. Install
        // the narrow filter during initialization so Next's dev overlay does
        // not present TensorFlow Lite's one-time INFO message as an error.
        const originalError = console.error;
        console.error = (...args: unknown[]) => {
          const message = args.map(String).join(" ");
          if (XNNPACK_INFO_MESSAGE.test(message)) return;
          originalError(...args);
        };
        try {
          return await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: `${root}/mediapipe/models/blaze_face_short_range.tflite`,
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.42,
            minSuppressionThreshold: 0.3,
          });
        } finally {
          console.error = originalError;
        }
      })
      .catch((error) => {
        detectorPromise = null;
        throw error;
      });
  }
  return detectorPromise;
}

export function detectBrowserFaces(
  detector: FaceDetector,
  video: HTMLVideoElement
): Detection[] {
  return detector.detectForVideo(video, nextDetectorTimestamp()).detections;
}

/** Select one stable subject instead of jumping to every high-score face. */
export function selectBrowserTrackedFace(
  detections: Detection[],
  videoWidth: number,
  videoHeight: number,
  previous: BrowserFaceRect | null
): BrowserFaceRect | null {
  if (videoWidth <= 0 || videoHeight <= 0) return null;

  const candidates = detections.flatMap((detection) => {
    const box = detection.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) return [];
    const rect = {
      x: clamp01(box.originX / videoWidth),
      y: clamp01(box.originY / videoHeight),
      width: clamp01(box.width / videoWidth),
      height: clamp01(box.height / videoHeight),
    };
    if (rect.width < 0.018 || rect.height < 0.018) return [];

    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const confidence = detection.categories[0]?.score ?? 0.5;
    const area = rect.width * rect.height;
    let continuity = 0;
    if (previous) {
      const previousX = previous.x + previous.width / 2;
      const previousY = previous.y + previous.height / 2;
      const distance = Math.hypot(centerX - previousX, centerY - previousY);
      continuity = Math.max(0, 1 - distance / 0.35);
    }
    return [{ rect, score: confidence * 0.35 + Math.sqrt(area) * 0.3 + continuity }];
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.rect ?? null;
}

export function smoothBrowserFaceRect(
  previous: BrowserFaceRect | null,
  next: BrowserFaceRect,
  amount = 0.2
): BrowserFaceRect {
  if (!previous) return next;

  const response = Math.min(1, Math.max(0.04, amount));
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const nextCenterX = next.x + next.width / 2;
  const nextCenterY = next.y + next.height / 2;

  let centerDeltaX = nextCenterX - previousCenterX;
  let centerDeltaY = nextCenterY - previousCenterY;
  const centerDistance = Math.hypot(centerDeltaX, centerDeltaY);

  // Ignore tiny detector noise, then cap each sample's travel so a false box
  // or a newly detected face cannot snap the crop across the frame.
  if (centerDistance < 0.006) {
    centerDeltaX = 0;
    centerDeltaY = 0;
  } else {
    const requestedDistance = centerDistance * response;
    const appliedDistance = Math.min(0.055, requestedDistance);
    const scale = appliedDistance / centerDistance;
    centerDeltaX *= scale;
    centerDeltaY *= scale;
  }

  const sizeResponse = response * 0.45;
  const resize = (from: number, to: number) => {
    const delta = (to - from) * sizeResponse;
    return from + Math.max(-0.025, Math.min(0.025, delta));
  };
  const width = resize(previous.width, next.width);
  const height = resize(previous.height, next.height);
  const centerX = previousCenterX + centerDeltaX;
  const centerY = previousCenterY + centerDeltaY;

  return {
    x: clamp01(centerX - width / 2),
    y: clamp01(centerY - height / 2),
    width,
    height,
  };
}
