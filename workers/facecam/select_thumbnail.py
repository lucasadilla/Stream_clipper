#!/usr/bin/env python3
"""Choose and compose a high-quality portrait thumbnail for a clip suggestion.

Reads JSON from stdin and writes a small JSON result to stdout. The selected
image is written atomically to outputPath as a 9:16 JPEG.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Any


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def create_detector(min_confidence: float):
    from analyze import HaarDetector, YuNetDetector

    try:
        return YuNetDetector(min_confidence)
    except Exception:
        return HaarDetector(min_confidence)


def frame_quality(frame) -> tuple[float, dict[str, float]]:
    import cv2
    import numpy as np

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness_raw = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness = clamp01(math.log1p(sharpness_raw) / math.log1p(1100.0))
    brightness_value = float(np.mean(gray)) / 255.0
    exposure = clamp01(1.0 - abs(brightness_value - 0.53) / 0.5)
    contrast = clamp01(float(np.std(gray)) / 72.0)
    score = sharpness * 1.2 + exposure * 0.75 + contrast * 0.55
    return score, {
        "sharpness": round(sharpness, 4),
        "exposure": round(exposure, 4),
        "contrast": round(contrast, 4),
    }


def face_quality(face: dict[str, Any]) -> float:
    rect = face["rect"]
    area = rect["width"] * rect["height"]
    center_x = rect["x"] + rect["width"] * 0.5
    center_y = rect["y"] + rect["height"] * 0.5
    center_distance = math.hypot((center_x - 0.5) * 0.8, center_y - 0.42)
    centered = clamp01(1.0 - center_distance / 0.72)
    useful_size = clamp01(math.sqrt(max(0.0, area)) / 0.19)
    edge_room = clamp01(
        min(
            center_x,
            1.0 - center_x,
            center_y,
            1.0 - center_y,
        )
        / 0.22
    )
    return (
        float(face.get("confidence", 0.6)) * 1.25
        + useful_size * 1.55
        + centered * 0.42
        + edge_room * 0.28
    )


def portrait_crop(frame, face: dict[str, Any] | None):
    height, width = frame.shape[:2]
    target_aspect = 9.0 / 16.0
    if width / max(1, height) > target_aspect:
        crop_height = height
        crop_width = max(1, int(round(height * target_aspect)))
    else:
        crop_width = width
        crop_height = max(1, int(round(width / target_aspect)))

    center_x = width * 0.5
    center_y = height * 0.5
    if face is not None:
        rect = face["rect"]
        face_center_x = (rect["x"] + rect["width"] * 0.5) * width
        face_center_y = (rect["y"] + rect["height"] * 0.42) * height
        center_x = face_center_x
        # Place the eyes around 36% from the top for natural portrait headroom.
        center_y = face_center_y + crop_height * 0.14

    left = max(0, min(width - crop_width, int(round(center_x - crop_width * 0.5))))
    top = max(0, min(height - crop_height, int(round(center_y - crop_height * 0.5))))
    return frame[top : top + crop_height, left : left + crop_width]


def polish_portrait(frame, output_width: int, output_height: int):
    import cv2

    portrait = cv2.resize(
        frame,
        (output_width, output_height),
        interpolation=cv2.INTER_LANCZOS4,
    )
    lab = cv2.cvtColor(portrait, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.35, tileGridSize=(8, 8))
    lightness = clahe.apply(lightness)
    portrait = cv2.cvtColor(
        cv2.merge((lightness, channel_a, channel_b)), cv2.COLOR_LAB2BGR
    )
    hsv = cv2.cvtColor(portrait, cv2.COLOR_BGR2HSV).astype("float32")
    hsv[:, :, 1] *= 1.07
    hsv[:, :, 1] = hsv[:, :, 1].clip(0, 255)
    portrait = cv2.cvtColor(hsv.astype("uint8"), cv2.COLOR_HSV2BGR)
    blurred = cv2.GaussianBlur(portrait, (0, 0), 1.05)
    return cv2.addWeighted(portrait, 1.24, blurred, -0.24, 0)


def select_thumbnail(payload: dict[str, Any]) -> dict[str, Any]:
    import cv2

    video_path = str(payload["videoPath"])
    output_path = Path(str(payload["outputPath"]))
    candidate_times = [
        max(0.0, float(value))
        for value in payload.get("candidateTimes", [])
        if isinstance(value, (int, float)) and math.isfinite(float(value))
    ][:10]
    if not candidate_times:
        raise RuntimeError("No thumbnail candidate times were supplied")
    output_width = max(360, min(1080, int(payload.get("outputWidth", 720))))
    output_height = max(640, min(1920, int(payload.get("outputHeight", 1280))))

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    detector = create_detector(float(payload.get("minConfidence", 0.45)))
    candidates = []
    try:
        for index, timestamp in enumerate(candidate_times):
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            height, width = frame.shape[:2]
            analysis = frame
            if width > 960:
                scale = 960.0 / width
                analysis = cv2.resize(
                    frame,
                    (960, max(1, int(height * scale))),
                    interpolation=cv2.INTER_AREA,
                )
            try:
                faces = detector.detect(analysis, int(round(timestamp * 1000.0)))
            except TypeError:
                faces = detector.detect(analysis)
            quality_score, quality = frame_quality(analysis)
            best_face = max(faces, key=face_quality) if faces else None
            # A clear face is the strongest click signal. Candidate order still
            # gives the story's focus beat a small preference among close ties.
            priority = max(0.0, 0.42 - index * 0.055)
            score = quality_score + priority
            if best_face is not None:
                score += 3.7 + face_quality(best_face)
            candidates.append(
                {
                    "frame": frame,
                    "face": best_face,
                    "faces": len(faces),
                    "score": score,
                    "timestamp": timestamp,
                    "quality": quality,
                }
            )
    finally:
        detector.close()
        capture.release()

    if not candidates:
        raise RuntimeError("No candidate thumbnail frames could be decoded")
    best = max(candidates, key=lambda item: item["score"])
    crop = portrait_crop(best["frame"], best["face"])
    output = polish_portrait(crop, output_width, output_height)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.stem}.{os.getpid()}.tmp.jpg")
    if not cv2.imwrite(str(temporary), output, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise RuntimeError("OpenCV could not write the selected thumbnail")
    os.replace(temporary, output_path)
    return {
        "ok": True,
        "selectedTimeSeconds": round(float(best["timestamp"]), 3),
        "faceDetected": best["face"] is not None,
        "facesInFrame": int(best["faces"]),
        "score": round(float(best["score"]), 4),
        **best["quality"],
    }


def main() -> None:
    try:
        result = select_thumbnail(json.load(sys.stdin))
        json.dump(result, sys.stdout)
    except Exception as exc:  # noqa: BLE001
        json.dump({"ok": False, "error": str(exc)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
