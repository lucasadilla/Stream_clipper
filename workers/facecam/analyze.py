#!/usr/bin/env python3
"""Clipper facecam analysis worker.

Reads JSON from stdin:
  {
    "videoPath": "...",
    "startSeconds": 0,
    "endSeconds": 10,
    "sampleFps": 4,
    "analysisWidth": 640,
    "minConfidence": 0.55,
    "maxFrames": 600
  }

Writes JSON to stdout with per-frame detections (normalized 0-1 rects).
Progress lines ("PROGRESS <0-100>") are written to stderr.

The worker only reads sampled frames. It never modifies the source file and
never renders video — tracking, classification and rendering happen in the
TypeScript backend.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalize_rect(x: float, y: float, w: float, h: float, frame_w: int, frame_h: int) -> dict[str, float] | None:
    if frame_w <= 0 or frame_h <= 0 or w <= 0 or h <= 0:
        return None
    nx = clamp01(x / frame_w)
    ny = clamp01(y / frame_h)
    nw = clamp01(w / frame_w)
    nh = clamp01(h / frame_h)
    if nx + nw > 1:
        nx = max(0.0, 1.0 - nw)
    if ny + nh > 1:
        ny = max(0.0, 1.0 - nh)
    if nw <= 0 or nh <= 0:
        return None
    return {"x": nx, "y": ny, "width": nw, "height": nh}


def report_progress(percent: float) -> None:
    try:
        sys.stderr.write(f"PROGRESS {max(0, min(100, int(percent)))}\n")
        sys.stderr.flush()
    except Exception:
        pass


def _model_cache_dir():
    import os
    from pathlib import Path

    cache = Path(os.environ.get("FACECAM_MODEL_DIR", Path.home() / ".cache" / "clipper"))
    cache.mkdir(parents=True, exist_ok=True)
    return cache


def _download_model(filename: str, url: str) -> str:
    import urllib.request

    model = _model_cache_dir() / filename
    if not model.exists():
        urllib.request.urlretrieve(url, model)
    return str(model)


class YuNetDetector:
    """OpenCV YuNet face detector (primary).

    Unlike MediaPipe's short-range BlazeFace, YuNet reliably finds small faces
    such as embedded gaming facecams occupying only a few percent of the frame.
    Requires only opencv + a ~230 KB ONNX model.
    """

    name = "opencv-yunet"
    version = "2023mar"

    def __init__(self, min_confidence: float) -> None:
        import cv2

        model_path = _download_model(
            "face_detection_yunet_2023mar.onnx",
            "https://github.com/opencv/opencv_zoo/raw/main/models/"
            "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        )
        self._cv2 = cv2
        self._detector = cv2.FaceDetectorYN.create(
            model_path, "", (320, 320), float(min_confidence), 0.3, 5000
        )
        self._input_size: tuple[int, int] | None = None
        self._min_confidence = min_confidence

    def detect(self, frame) -> list[dict[str, Any]]:
        h, w = frame.shape[:2]
        if self._input_size != (w, h):
            self._detector.setInputSize((w, h))
            self._input_size = (w, h)
        _, faces = self._detector.detect(frame)

        out: list[dict[str, Any]] = []
        if faces is None:
            return out
        for face in faces:
            conf = float(face[14])
            if conf < self._min_confidence:
                continue
            rect = normalize_rect(float(face[0]), float(face[1]), float(face[2]), float(face[3]), w, h)
            if not rect:
                continue
            detection: dict[str, Any] = {"rect": rect, "confidence": conf}
            # YuNet landmarks: right/left mouth corners → mouth width / face width.
            # Variance of this ratio over time is a strong "who is talking" signal.
            face_w = max(1.0, float(face[2]))
            mx1, my1 = float(face[10]), float(face[11])
            mx2, my2 = float(face[12]), float(face[13])
            mouth_w = ((mx1 - mx2) ** 2 + (my1 - my2) ** 2) ** 0.5
            detection["mouthOpenRatio"] = float(mouth_w / face_w)
            out.append(detection)
        return out

    def close(self) -> None:
        pass


class MediaPipeDetector:
    """Reusable MediaPipe face detector (created once, used for every frame).

    Note: BlazeFace short-range is tuned for selfie-distance faces and misses
    small embedded facecams, so it is only a fallback behind YuNet.
    """

    name = "mediapipe-blaze-face"
    version = "short_range-float16-1"

    def __init__(self, min_confidence: float) -> None:
        import mediapipe as mp

        model_path = _download_model(
            "blaze_face_short_range.tflite",
            "https://storage.googleapis.com/mediapipe-models/face_detector/"
            "blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        )
        self._mp = mp
        options = mp.tasks.vision.FaceDetectorOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            min_detection_confidence=min_confidence,
        )
        self._detector = mp.tasks.vision.FaceDetector.create_from_options(options)
        self._min_confidence = min_confidence

    def detect(self, frame) -> list[dict[str, Any]]:
        import numpy as np

        h, w = frame.shape[:2]
        rgb = np.ascontiguousarray(frame[:, :, ::-1])
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        result = self._detector.detect(mp_image)

        out: list[dict[str, Any]] = []
        for det in result.detections or []:
            box = det.bounding_box
            conf = float(det.categories[0].score) if det.categories else 0.0
            if conf < self._min_confidence:
                continue
            rect = normalize_rect(box.origin_x, box.origin_y, box.width, box.height, w, h)
            if not rect:
                continue
            out.append({"rect": rect, "confidence": conf})
        return out

    def close(self) -> None:
        try:
            self._detector.close()
        except Exception:
            pass


class HaarDetector:
    """OpenCV Haar cascade fallback when MediaPipe is unavailable."""

    name = "opencv-haar"
    version = "frontalface_default"

    def __init__(self, min_confidence: float) -> None:
        import cv2

        self._cv2 = cv2
        self._cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self._min_confidence = min_confidence

    def detect(self, frame) -> list[dict[str, Any]]:
        h, w = frame.shape[:2]
        gray = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2GRAY)
        faces = self._cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
        )
        out: list[dict[str, Any]] = []
        for (x, y, fw, fh) in faces:
            rect = normalize_rect(x, y, fw, fh, w, h)
            if not rect:
                continue
            # Haar has no confidence score; report a conservative constant.
            out.append({"rect": rect, "confidence": max(self._min_confidence, 0.6)})
        return out

    def close(self) -> None:
        pass


def create_detector(min_confidence: float):
    for cls in (YuNetDetector, MediaPipeDetector, HaarDetector):
        try:
            return cls(min_confidence)
        except Exception:
            continue
    return HaarDetector(min_confidence)


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    import cv2

    video_path = payload["videoPath"]
    start = float(payload.get("startSeconds", 0))
    end = float(payload.get("endSeconds", 0))
    sample_fps = float(payload.get("sampleFps", 4))
    analysis_width = int(payload.get("analysisWidth", 640))
    min_confidence = float(payload.get("minConfidence", 0.55))
    max_frames = int(payload.get("maxFrames", 600))

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / src_fps if src_fps > 0 else 0
    if end <= 0 or (duration > 0 and end > duration):
        end = duration if duration > 0 else end
    if end <= start:
        end = start + 1

    sample_fps = max(0.25, min(8.0, sample_fps))
    interval = 1.0 / sample_fps
    # Cap total work for extremely long ranges by widening the interval.
    expected = (end - start) / interval
    if max_frames > 0 and expected > max_frames:
        interval = (end - start) / max_frames
        sample_fps = 1.0 / interval

    detector = create_detector(min_confidence)
    detections: list[dict[str, Any]] = []
    sampled_frames = 0
    t = start
    try:
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ok, frame = cap.read()
            if not ok or frame is None:
                t += interval
                continue

            h, w = frame.shape[:2]
            if analysis_width > 0 and w > analysis_width:
                scale = analysis_width / float(w)
                frame = cv2.resize(frame, (analysis_width, max(1, int(h * scale))))

            try:
                faces = detector.detect(frame)
            except Exception:
                if not isinstance(detector, HaarDetector):
                    detector.close()
                    detector = HaarDetector(min_confidence)
                    faces = detector.detect(frame)
                else:
                    faces = []

            for face in faces:
                detections.append(
                    {
                        "timestampSeconds": round(t, 3),
                        "rect": face["rect"],
                        "confidence": face["confidence"],
                        **(
                            {"mouthOpenRatio": face["mouthOpenRatio"]}
                            if "mouthOpenRatio" in face
                            else {}
                        ),
                    }
                )

            sampled_frames += 1
            if sampled_frames % 10 == 0:
                report_progress(100.0 * (t - start) / max(0.001, end - start))
            t += interval
    finally:
        detector.close()
        cap.release()

    return {
        "ok": True,
        "sourceWidth": src_w,
        "sourceHeight": src_h,
        "sampleFps": sample_fps,
        "sampledFrames": sampled_frames,
        "detections": detections,
        "modelName": detector.name,
        "modelVersion": detector.version,
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        result = analyze(payload)
        json.dump(result, sys.stdout)
    except Exception as exc:  # noqa: BLE001
        json.dump({"ok": False, "error": str(exc), "detections": []}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
