import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/** Face detection provider interface — stub for MVP */
export interface FaceDetector {
  detectFaces(imagePath: string, frameWidth: number, frameHeight: number): Promise<FaceBoundingBox[]>;
}

export class StubFaceDetector implements FaceDetector {
  async detectFaces(
    _imagePath: string,
    frameWidth: number,
    frameHeight: number
  ): Promise<FaceBoundingBox[]> {
    // Stub: assume facecam in top-right corner (common streamer layout)
    if (frameWidth === 0 || frameHeight === 0) return [];
    return [
      {
        x: frameWidth * 0.75,
        y: frameHeight * 0.02,
        width: frameWidth * 0.22,
        height: frameHeight * 0.22,
        confidence: 0.3,
      },
    ];
  }
}

interface ClusteredRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  sampleCount: number;
}

/**
 * Cluster face detections by spatial proximity.
 * Groups boxes whose centers are within threshold pixels.
 */
export function clusterFacePositions(
  boxes: FaceBoundingBox[],
  threshold = 50
): ClusteredRegion[] {
  if (boxes.length === 0) return [];

  const clusters: Array<{
    boxes: FaceBoundingBox[];
  }> = [];

  for (const box of boxes) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    let found = false;
    for (const cluster of clusters) {
      const ref = cluster.boxes[0];
      const rcx = ref.x + ref.width / 2;
      const rcy = ref.y + ref.height / 2;
      const dist = Math.hypot(cx - rcx, cy - rcy);
      if (dist < threshold) {
        cluster.boxes.push(box);
        found = true;
        break;
      }
    }
    if (!found) clusters.push({ boxes: [box] });
  }

  return clusters.map((c) => {
    const avgX = c.boxes.reduce((s, b) => s + b.x, 0) / c.boxes.length;
    const avgY = c.boxes.reduce((s, b) => s + b.y, 0) / c.boxes.length;
    const avgW = c.boxes.reduce((s, b) => s + b.width, 0) / c.boxes.length;
    const avgH = c.boxes.reduce((s, b) => s + b.height, 0) / c.boxes.length;
    const avgConf =
      c.boxes.reduce((s, b) => s + b.confidence, 0) / c.boxes.length;

    return {
      x: avgX,
      y: avgY,
      width: avgW,
      height: avgH,
      confidence: avgConf,
      sampleCount: c.boxes.length,
    };
  });
}

export async function detectFacecamRegion(
  streamSessionId: string,
  framePaths: string[],
  frameWidth: number,
  frameHeight: number,
  detector: FaceDetector = new StubFaceDetector()
) {
  await prisma.facecamRegion.deleteMany({ where: { streamSessionId } });

  const allBoxes: FaceBoundingBox[] = [];
  const samplePaths = framePaths.filter((_, i) => i % 5 === 0).slice(0, 20);

  for (const framePath of samplePaths) {
    const faces = await detector.detectFaces(framePath, frameWidth, frameHeight);
    allBoxes.push(...faces);
  }

  const clusters = clusterFacePositions(allBoxes);
  const best = clusters.sort((a, b) => b.sampleCount - a.sampleCount)[0];

  if (!best || best.confidence < 0.1) {
    return null;
  }

  return prisma.facecamRegion.create({
    data: {
      streamSessionId,
      x: best.x,
      y: best.y,
      width: best.width,
      height: best.height,
      confidence: best.confidence,
      sampleCount: best.sampleCount,
      rawData: toJsonValue({ clusterCount: clusters.length }),
    },
  });
}
