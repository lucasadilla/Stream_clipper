#!/usr/bin/env python3
"""Clipper facecam analysis worker.

Reads JSON from stdin:
  {
    "videoPath": "...",
    "startSeconds": 0,
    "endSeconds": 10,
    "sampleFps": 6,
    "analysisWidth": 960,
    "minConfidence": 0.55,
    "maxFrames": 1200
  }

Writes JSON to stdout with per-frame detections (normalized 0-1 rects).
Progress lines ("PROGRESS <0-100>") are written to stderr.

The worker only reads sampled frames. It never modifies the source file and
never renders video — tracking, classification and rendering happen in the
TypeScript backend.
"""

from __future__ import annotations

import json
import math
import subprocess
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


def _rect_center(rect: dict[str, float]) -> tuple[float, float]:
    return (rect["x"] + rect["width"] * 0.5, rect["y"] + rect["height"] * 0.5)


def _rect_iou(a: dict[str, float], b: dict[str, float]) -> float:
    left = max(a["x"], b["x"])
    top = max(a["y"], b["y"])
    right = min(a["x"] + a["width"], b["x"] + b["width"])
    bottom = min(a["y"] + a["height"], b["y"] + b["height"])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = a["width"] * a["height"] + b["width"] * b["height"] - intersection
    return intersection / union if union > 1e-8 else 0.0


def _appearance_descriptor(frame, rect: dict[str, float]) -> list[float] | None:
    """Return an anonymous color+texture cue for identity association.

    This is intentionally not a biometric embedding. It only separates people
    within one clip and is discarded with the analysis result.
    """
    import cv2
    import numpy as np

    height, width = frame.shape[:2]
    left = max(0, min(width - 1, int((rect["x"] + rect["width"] * 0.06) * width)))
    right = max(left + 1, min(width, int((rect["x"] + rect["width"] * 0.94) * width)))
    top = max(0, min(height - 1, int((rect["y"] + rect["height"] * 0.04) * height)))
    bottom = max(top + 1, min(height, int((rect["y"] + rect["height"] * 0.98) * height)))
    patch = frame[top:bottom, left:right]
    if patch.size == 0 or patch.shape[0] < 6 or patch.shape[1] < 6:
        return None

    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [8, 4], [0, 180, 0, 256]).flatten()
    histogram_norm = float(np.linalg.norm(histogram))
    if histogram_norm > 1e-6:
        histogram = histogram / histogram_norm

    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    texture = cv2.resize(gray, (4, 4), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    texture = texture.flatten()
    texture -= float(np.mean(texture))
    texture_norm = float(np.linalg.norm(texture))
    if texture_norm > 1e-6:
        texture = texture / texture_norm

    descriptor = np.concatenate((histogram * 0.78, texture * 0.32))
    norm = float(np.linalg.norm(descriptor))
    if norm <= 1e-6:
        return None
    return [round(float(value), 5) for value in descriptor / norm]


def _descriptor_similarity(a, b) -> float | None:
    if not isinstance(a, list) or not isinstance(b, list) or len(a) != len(b) or len(a) < 8:
        return None
    try:
        dot = sum(float(left) * float(right) for left, right in zip(a, b))
    except (TypeError, ValueError):
        return None
    return clamp01((dot - 0.25) / 0.75)


def _attach_appearance_descriptors(frame, faces: list[dict[str, Any]]) -> None:
    for face in faces:
        descriptor = _appearance_descriptor(frame, face["rect"])
        if descriptor is not None:
            face["appearanceDescriptor"] = descriptor


def _aligned_face_patch(
    gray,
    rect: dict[str, float],
    left_ratio: float,
    right_ratio: float,
    top_ratio: float,
    bottom_ratio: float,
    output_size: tuple[int, int],
):
    """Return a normalized, face-relative patch for visual motion.

    Face boxes move between samples, so comparing full-frame pixels produces
    false speech whenever the subject or camera moves. Face-relative crops make
    the signal substantially more stable.
    """
    import cv2

    height, width = gray.shape[:2]
    left = int((rect["x"] + rect["width"] * left_ratio) * width)
    right = int((rect["x"] + rect["width"] * right_ratio) * width)
    top = int((rect["y"] + rect["height"] * top_ratio) * height)
    bottom = int((rect["y"] + rect["height"] * bottom_ratio) * height)
    left = max(0, min(width - 1, left))
    right = max(left + 1, min(width, right))
    top = max(0, min(height - 1, top))
    bottom = max(top + 1, min(height, bottom))
    patch = gray[top:bottom, left:right]
    if patch.size == 0:
        return None
    patch = cv2.resize(patch, output_size, interpolation=cv2.INTER_AREA)
    return cv2.equalizeHist(patch)


def _attach_speaking_activity(frame, faces: list[dict[str, Any]], previous_faces):
    """Add conservative 0..1 mouth-region motion to each detected face."""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    current = []
    claimed_previous: set[int] = set()
    for face in faces:
        rect = face["rect"]
        center_x, center_y = _rect_center(rect)
        best_index = None
        best_distance = 1.0
        best_match_score = float("inf")
        for index, previous in enumerate(previous_faces):
            if index in claimed_previous:
                continue
            previous_rect = previous["rect"]
            previous_x, previous_y = _rect_center(previous_rect)
            distance = ((center_x - previous_x) ** 2 + (center_y - previous_y) ** 2) ** 0.5
            size_ratio = rect["width"] / max(1e-6, previous_rect["width"])
            appearance = _descriptor_similarity(
                face.get("appearanceDescriptor"), previous.get("appearanceDescriptor")
            )
            match_score = distance - (appearance or 0.0) * 0.055
            if 0.55 <= size_ratio <= 1.8 and match_score < best_match_score:
                best_index = index
                best_distance = distance
                best_match_score = match_score

        mouth_patch = _aligned_face_patch(
            gray, rect, 0.14, 0.86, 0.54, 0.92, (48, 24)
        )
        control_patch = _aligned_face_patch(
            gray, rect, 0.18, 0.82, 0.16, 0.48, (48, 20)
        )
        activity = 0.0
        if (
            best_index is not None
            and best_distance <= 0.14
            and mouth_patch is not None
        ):
            previous_mouth = previous_faces[best_index].get("mouthPatch")
            previous_control = previous_faces[best_index].get("controlPatch")
            if previous_mouth is not None and previous_mouth.shape == mouth_patch.shape:
                mouth_delta = float(
                    np.mean(cv2.absdiff(mouth_patch, previous_mouth)) / 255.0
                )
                control_delta = 0.0
                if (
                    control_patch is not None
                    and previous_control is not None
                    and previous_control.shape == control_patch.shape
                ):
                    control_delta = float(
                        np.mean(cv2.absdiff(control_patch, previous_control)) / 255.0
                    )
                # Subtract shared upper-face motion so nods, camera shake, and
                # hard lighting changes do not look like speech.
                speech_delta = max(0.0, mouth_delta - control_delta * 0.52)
                activity = clamp01((speech_delta - 0.012) * 9.0)
            claimed_previous.add(best_index)
        face["speakingActivity"] = round(activity, 4)
        current.append(
            {
                "rect": rect,
                "mouthPatch": mouth_patch,
                "controlPatch": control_patch,
                "appearanceDescriptor": face.get("appearanceDescriptor"),
            }
        )
    return current


def _extract_audio_activity(
    video_path: str,
    start: float,
    end: float,
    sample_times: list[float],
    ffmpeg_path: str,
) -> list[float] | None:
    """Decode a low-rate mono envelope aligned to the sampled video frames.

    This is deliberately energy-based rather than a second ML model: visual
    mouth motion identifies the person, while audio decides whether the motion
    is actually synchronized with speech. Any FFmpeg/audio failure simply
    falls back to visual-only tracking.
    """
    import numpy as np

    duration = max(0.0, end - start)
    if duration <= 0 or duration > 15 * 60 or not sample_times:
        return None
    sample_rate = 8000
    try:
        process = subprocess.run(
            [
                ffmpeg_path or "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{duration:.3f}",
                "-i",
                video_path,
                "-map",
                "0:a:0?",
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-f",
                "s16le",
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=min(90.0, max(15.0, duration * 0.35)),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if process.returncode != 0 or len(process.stdout) < sample_rate // 2:
        return None

    pcm = np.frombuffer(process.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    half_window = int(sample_rate * 0.12)
    db_values: list[float] = []
    for timestamp in sample_times:
        center = int(max(0.0, timestamp - start) * sample_rate)
        left = max(0, center - half_window)
        right = min(len(pcm), center + half_window)
        window = pcm[left:right]
        if window.size < 32:
            db_values.append(-96.0)
            continue
        rms = float(np.sqrt(np.mean(np.square(window), dtype=np.float64)))
        db_values.append(20.0 * math.log10(max(1e-6, rms)))

    if not db_values:
        return None
    floor = float(np.percentile(db_values, 20))
    active = float(np.percentile(db_values, 85))
    if active < -75.0:
        return [0.0 for _ in db_values]
    spread = max(7.0, active - floor)
    activities: list[float] = []
    for db_value in db_values:
        relative = clamp01((db_value - floor - 2.5) / max(4.0, spread - 2.5))
        absolute = clamp01((db_value + 52.0) / 28.0)
        activities.append(round(clamp01(max(relative, absolute * 0.42)), 4))
    return activities


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

    def detect(self, frame, timestamp_ms: int | None = None) -> list[dict[str, Any]]:
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

    def detect_region(self, frame) -> list[dict[str, Any]]:
        return self.detect(frame)


class MediaPipeFaceLandmarker:
    """Dense landmarks, head direction, and mouth articulation.

    YuNet remains the small-face detector. The landmarker runs beside it when
    MediaPipe is installed and refines facial motion/composition while also
    recovering profile faces YuNet occasionally misses.
    """

    name = "mediapipe-face-landmarker"
    version = "float16-1"

    def __init__(self, min_confidence: float) -> None:
        import mediapipe as mp

        model_path = _download_model(
            "face_landmarker_v1.task",
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker/float16/1/face_landmarker.task",
        )
        self._mp = mp
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_faces=10,
            min_face_detection_confidence=max(0.35, min_confidence - 0.12),
            min_face_presence_confidence=max(0.35, min_confidence - 0.15),
            min_tracking_confidence=0.4,
            output_face_blendshapes=True,
        )
        self._detector = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        self._last_timestamp_ms = -1

    def detect(self, frame, timestamp_ms: int | None = None) -> list[dict[str, Any]]:
        import numpy as np

        h, w = frame.shape[:2]
        rgb = np.ascontiguousarray(frame[:, :, ::-1])
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        safe_timestamp = max(self._last_timestamp_ms + 1, int(timestamp_ms or 0))
        self._last_timestamp_ms = safe_timestamp
        result = self._detector.detect_for_video(mp_image, safe_timestamp)
        out: list[dict[str, Any]] = []
        blendshape_sets = result.face_blendshapes or []
        for index, landmarks in enumerate(result.face_landmarks or []):
            if not landmarks:
                continue
            xs = [clamp01(point.x) for point in landmarks]
            ys = [clamp01(point.y) for point in landmarks]
            left, right = min(xs), max(xs)
            top, bottom = min(ys), max(ys)
            face_w = max(1e-4, right - left)
            face_h = max(1e-4, bottom - top)
            rect = normalize_rect(
                (left - face_w * 0.08) * w,
                (top - face_h * 0.1) * h,
                face_w * 1.16 * w,
                face_h * 1.2 * h,
                w,
                h,
            )
            if rect is None:
                continue

            mouth_width = math.hypot(
                landmarks[291].x - landmarks[61].x,
                landmarks[291].y - landmarks[61].y,
            )
            lip_gap = math.hypot(
                landmarks[14].x - landmarks[13].x,
                landmarks[14].y - landmarks[13].y,
            )
            mouth_activity = clamp01(lip_gap / max(1e-4, mouth_width) * 2.2)
            if index < len(blendshape_sets):
                for category in blendshape_sets[index]:
                    if getattr(category, "category_name", "") == "jawOpen":
                        mouth_activity = clamp01(
                            mouth_activity * 0.35 + float(category.score) * 0.65
                        )
                        break

            eye_mid_x = (landmarks[33].x + landmarks[263].x) * 0.5
            eye_distance = abs(landmarks[263].x - landmarks[33].x)
            look_direction = clamp01(
                0.5 + ((landmarks[1].x - eye_mid_x) / max(1e-4, eye_distance)) * 1.15
            ) * 2.0 - 1.0
            out.append(
                {
                    "rect": rect,
                    "confidence": 0.86,
                    "mouthOpenRatio": round(mouth_activity, 5),
                    "lookDirectionX": round(max(-1.0, min(1.0, look_direction)), 4),
                }
            )
        return out

    def close(self) -> None:
        try:
            self._detector.close()
        except Exception:
            pass


class CompositeDetector:
    """Fuse high-recall YuNet boxes with MediaPipe landmark refinement."""

    def __init__(self, primary, landmarker: MediaPipeFaceLandmarker) -> None:
        self._primary = primary
        self._landmarker = landmarker
        self.name = f"{primary.name}+{landmarker.name}"
        self.version = f"{primary.version}+{landmarker.version}"

    def detect(self, frame, timestamp_ms: int | None = None) -> list[dict[str, Any]]:
        import cv2

        primary_faces = self._primary.detect(frame, timestamp_ms)
        primary_count = len(primary_faces)
        try:
            landmark_faces = self._landmarker.detect(frame, timestamp_ms)
        except Exception:
            landmark_faces = []

        used_primary: set[int] = set()
        for landmark_face in landmark_faces:
            best_index = None
            best_overlap = 0.0
            landmark_center = _rect_center(landmark_face["rect"])
            for index, primary_face in enumerate(primary_faces):
                if index in used_primary:
                    continue
                overlap = _rect_iou(landmark_face["rect"], primary_face["rect"])
                primary_center = _rect_center(primary_face["rect"])
                center_distance = math.hypot(
                    landmark_center[0] - primary_center[0],
                    landmark_center[1] - primary_center[1],
                )
                if overlap > best_overlap and (overlap >= 0.16 or center_distance <= 0.055):
                    best_index = index
                    best_overlap = overlap
            if best_index is None:
                primary_faces.append(landmark_face)
                continue
            used_primary.add(best_index)
            primary_faces[best_index]["mouthOpenRatio"] = landmark_face["mouthOpenRatio"]
            primary_faces[best_index]["lookDirectionX"] = landmark_face["lookDirectionX"]

        # Dense landmarks need more facial pixels than YuNet. Refine up to six
        # unmatched small faces on enlarged local crops so embedded facecams get
        # the same mouth/head-direction quality as full-screen talking heads.
        height, width = frame.shape[:2]
        unmatched = [
            index
            for index in range(primary_count)
            if index not in used_primary
        ]
        unmatched.sort(
            key=lambda index: primary_faces[index]["rect"]["width"]
            * primary_faces[index]["rect"]["height"],
            reverse=True,
        )
        for offset, primary_index in enumerate(unmatched[:6], start=1):
            rect = primary_faces[primary_index]["rect"]
            center_x, center_y = _rect_center(rect)
            crop_w = min(1.0, max(rect["width"] * 2.2, 0.11))
            crop_h = min(1.0, max(rect["height"] * 2.2, 0.13))
            left = max(0.0, min(1.0 - crop_w, center_x - crop_w * 0.5))
            top = max(0.0, min(1.0 - crop_h, center_y - crop_h * 0.5))
            px_left, px_top = int(left * width), int(top * height)
            px_right = max(px_left + 2, int((left + crop_w) * width))
            px_bottom = max(px_top + 2, int((top + crop_h) * height))
            crop = frame[px_top:px_bottom, px_left:px_right]
            if crop.size == 0:
                continue
            crop_height, crop_width = crop.shape[:2]
            scale = max(1.0, 640.0 / max(1, crop_width))
            if scale > 1.01:
                crop = cv2.resize(
                    crop,
                    (int(crop_width * scale), int(crop_height * scale)),
                    interpolation=cv2.INTER_CUBIC,
                )
            try:
                refinements = self._landmarker.detect(
                    crop, int(timestamp_ms or 0) + offset
                )
            except Exception:
                continue
            if not refinements:
                continue
            refinement = max(
                refinements,
                key=lambda item: item["rect"]["width"] * item["rect"]["height"],
            )
            primary_faces[primary_index]["mouthOpenRatio"] = refinement[
                "mouthOpenRatio"
            ]
            primary_faces[primary_index]["lookDirectionX"] = refinement[
                "lookDirectionX"
            ]
        return primary_faces

    def detect_region(self, frame) -> list[dict[str, Any]]:
        return self._primary.detect(frame)

    def close(self) -> None:
        self._primary.close()
        self._landmarker.close()


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

    def detect(self, frame, timestamp_ms: int | None = None) -> list[dict[str, Any]]:
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

    def detect(self, frame, timestamp_ms: int | None = None) -> list[dict[str, Any]]:
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
    primary = None
    landmarker = None
    try:
        primary = YuNetDetector(min_confidence)
    except Exception:
        pass
    try:
        landmarker = MediaPipeFaceLandmarker(min_confidence)
    except Exception:
        pass
    if primary is not None and landmarker is not None:
        return CompositeDetector(primary, landmarker)
    if primary is not None:
        return primary
    if landmarker is not None:
        return landmarker
    for cls in (MediaPipeDetector, HaarDetector):
        try:
            return cls(min_confidence)
        except Exception:
            continue
    return HaarDetector(min_confidence)


def _recover_missed_faces(detector, frame, faces, previous_faces):
    """Re-run YuNet around a recently visible face when full-frame detection misses.

    Small facecams and profiles can fall below a full-frame detector's effective
    resolution for one or two samples. A larger local crop gives the detector a
    second chance without paying for tiled inference across the entire frame.
    """
    import cv2

    detect_region = getattr(detector, "detect_region", None)
    if not callable(detect_region) or not previous_faces:
        return faces
    height, width = frame.shape[:2]
    recovered = list(faces)
    for previous in previous_faces[:8]:
        previous_rect = previous["rect"]
        if any(_rect_iou(previous_rect, face["rect"]) >= 0.12 for face in recovered):
            continue
        center_x, center_y = _rect_center(previous_rect)
        region_w = min(1.0, max(previous_rect["width"] * 2.8, 0.14))
        region_h = min(1.0, max(previous_rect["height"] * 2.8, 0.16))
        left = max(0.0, min(1.0 - region_w, center_x - region_w * 0.5))
        top = max(0.0, min(1.0 - region_h, center_y - region_h * 0.5))
        px_left = int(left * width)
        px_top = int(top * height)
        px_right = max(px_left + 2, int((left + region_w) * width))
        px_bottom = max(px_top + 2, int((top + region_h) * height))
        crop = frame[px_top:px_bottom, px_left:px_right]
        if crop.size == 0:
            continue
        crop_height, crop_width = crop.shape[:2]
        scale = max(1.0, 360.0 / max(1, crop_width))
        inference_crop = (
            cv2.resize(
                crop,
                (int(crop_width * scale), int(crop_height * scale)),
                interpolation=cv2.INTER_CUBIC,
            )
            if scale > 1.01
            else crop
        )
        try:
            local_faces = detect_region(inference_crop)
        except Exception:
            continue
        candidates = []
        for local_face in local_faces:
            local_rect = local_face["rect"]
            mapped = {
                "x": left + local_rect["x"] * region_w,
                "y": top + local_rect["y"] * region_h,
                "width": local_rect["width"] * region_w,
                "height": local_rect["height"] * region_h,
            }
            mapped_center = _rect_center(mapped)
            distance = math.hypot(mapped_center[0] - center_x, mapped_center[1] - center_y)
            if distance <= max(0.08, previous_rect["width"] * 1.15):
                candidate = dict(local_face)
                candidate["rect"] = mapped
                candidate["confidence"] = clamp01(float(candidate["confidence"]) * 0.94)
                candidates.append((distance, candidate))
        if not candidates:
            continue
        candidate = min(candidates, key=lambda item: item[0])[1]
        if not any(_rect_iou(candidate["rect"], face["rect"]) >= 0.25 for face in recovered):
            recovered.append(candidate)
    return recovered


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    import cv2

    video_path = payload["videoPath"]
    start = float(payload.get("startSeconds", 0))
    end = float(payload.get("endSeconds", 0))
    sample_fps = float(payload.get("sampleFps", 6))
    analysis_width = int(payload.get("analysisWidth", 960))
    min_confidence = float(payload.get("minConfidence", 0.55))
    max_frames = int(payload.get("maxFrames", 1200))
    ffmpeg_path = str(payload.get("ffmpegPath", "ffmpeg"))

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

    sample_fps = max(0.25, min(12.0, sample_fps))
    interval = 1.0 / sample_fps
    # Cap total work for extremely long ranges by widening the interval.
    expected = (end - start) / interval
    if max_frames > 0 and expected > max_frames:
        interval = (end - start) / max_frames
        sample_fps = 1.0 / interval

    detector = create_detector(min_confidence)
    detections: list[dict[str, Any]] = []
    scene_changes: list[dict[str, float]] = []
    sampled_frames = 0
    previous_scene_gray = None
    previous_scene_hist = None
    previous_faces = []
    sample_times: list[float] = []
    last_scene_change = start - 10.0
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

            # Scene detection runs on tiny images and adds negligible work next
            # to face inference. Combining pixel and color-histogram distance
            # avoids treating ordinary camera motion as a hard edit.
            scene_frame = cv2.resize(frame, (64, 36))
            scene_gray = cv2.cvtColor(scene_frame, cv2.COLOR_BGR2GRAY)
            scene_gray = cv2.GaussianBlur(scene_gray, (5, 5), 0)
            scene_hsv = cv2.cvtColor(scene_frame, cv2.COLOR_BGR2HSV)
            scene_hist = cv2.calcHist([scene_hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
            cv2.normalize(scene_hist, scene_hist)
            hard_scene_change = False
            if previous_scene_gray is not None and previous_scene_hist is not None:
                pixel_delta = float(cv2.absdiff(scene_gray, previous_scene_gray).mean() / 255.0)
                histogram_delta = float(
                    cv2.compareHist(previous_scene_hist, scene_hist, cv2.HISTCMP_BHATTACHARYYA)
                )
                scene_score = 0.58 * pixel_delta + 0.42 * histogram_delta
                if (
                    scene_score >= 0.24
                    and pixel_delta >= 0.15
                    and histogram_delta >= 0.22
                    and t - last_scene_change >= 0.55
                ):
                    scene_changes.append(
                        {
                            "timestampSeconds": round(t, 3),
                            "score": round(clamp01(scene_score), 4),
                        }
                    )
                    last_scene_change = t
                    hard_scene_change = True
            previous_scene_gray = scene_gray
            previous_scene_hist = scene_hist

            if hard_scene_change:
                previous_faces = []

            try:
                faces = detector.detect(frame, int(round((t - start) * 1000.0)))
            except Exception:
                if not isinstance(detector, HaarDetector):
                    detector.close()
                    detector = HaarDetector(min_confidence)
                    faces = detector.detect(frame, int(round((t - start) * 1000.0)))
                else:
                    faces = []

            faces = _recover_missed_faces(detector, frame, faces, previous_faces)
            _attach_appearance_descriptors(frame, faces)
            previous_faces = _attach_speaking_activity(
                frame, faces, previous_faces
            )
            sample_times.append(t)

            for face in faces:
                detections.append(
                    {
                        "timestampSeconds": round(t, 3),
                        "rect": face["rect"],
                        "confidence": face["confidence"],
                        **(
                            {"appearanceDescriptor": face["appearanceDescriptor"]}
                            if "appearanceDescriptor" in face
                            else {}
                        ),
                        **(
                            {"lookDirectionX": face["lookDirectionX"]}
                            if "lookDirectionX" in face
                            else {}
                        ),
                        **(
                            {"mouthOpenRatio": face["mouthOpenRatio"]}
                            if "mouthOpenRatio" in face
                            else {}
                        ),
                        "speakingActivity": face.get("speakingActivity", 0.0),
                    }
                )

            sampled_frames += 1
            if sampled_frames % 10 == 0:
                report_progress(100.0 * (t - start) / max(0.001, end - start))
            t += interval
    finally:
        detector.close()
        cap.release()

    audio_activity = _extract_audio_activity(
        video_path, start, end, sample_times, ffmpeg_path
    )
    if audio_activity is not None:
        activity_by_time = {
            round(timestamp, 3): activity
            for timestamp, activity in zip(sample_times, audio_activity)
        }
        for detection in detections:
            detection["audioActivity"] = activity_by_time.get(
                round(float(detection["timestampSeconds"]), 3), 0.0
            )

    if sampled_frames < 2:
        raise RuntimeError(
            "The video did not produce enough decodable frames for face analysis"
        )

    return {
        "ok": True,
        "sourceWidth": src_w,
        "sourceHeight": src_h,
        "sampleFps": sample_fps,
        "sampledFrames": sampled_frames,
        "detections": detections,
        "sceneChanges": scene_changes,
        "audioActivityAvailable": audio_activity is not None,
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
