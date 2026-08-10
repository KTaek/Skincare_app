#!/usr/bin/env python3
"""
얼굴 검출 모델(BlazeFace)을 번들 에셋으로 내려받아 검증한다.

다른 세 모델(seg_lesion_512 · sev_cls_384 · disease_cls_512)과 달리 이건 우리가 학습한 것이
아니라 MediaPipe가 공개한 face_detection_short_range 체크포인트를 그대로 쓴다. 그래서
export_models.py 같은 PyTorch → ONNX → TFLite 변환 과정이 없고, "내려받아 무결성을 확인한다"가
이 스크립트가 하는 일의 전부다.

이 모델을 직접 학습하지 않는 이유: 여기서 얼굴은 진단 대상이 아니라 **자(ruler)**다.
병변 면적을 회차 간 비교하려면 시간에 따라 변하지 않는 기준 길이가 필요한데, 눈·입 세 점이면
충분하고 그 정도는 이미 잘 검증된 공개 모델이 우리가 만들 어떤 것보다 낫다.

    python3 tools/export_face_tflite.py            # 없으면 받고, 있으면 해시만 확인
    python3 tools/export_face_tflite.py --force    # 다시 받아 덮어쓴다

⚠️ 해시가 바뀌면 앱을 고쳐야 할 수도 있다. faceDetector.ts는 이 모델의 규격(128px 입력,
   896 앵커, 앵커당 16개 값, 키포인트 6개)을 앵커 생성 로직에 그대로 반영하고 있다.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets", "models")
MODEL_PATH = os.path.join(ASSETS, "face_det_128.tflite")
META_PATH = os.path.join(ASSETS, "face_labels.json")

URL = "https://storage.googleapis.com/mediapipe-assets/face_detection_short_range.tflite"


def sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def check_tflite(path: str) -> None:
    """FlatBuffer 식별자만 확인한다 — TensorFlow 설치 없이 할 수 있는 최소한의 검증이다."""
    with open(path, "rb") as f:
        head = f.read(8)
    if head[4:8] != b"TFL3":
        raise SystemExit(f"TFLite 파일이 아니다 (식별자 {head[4:8]!r}): {path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 내려받는다")
    args = ap.parse_args()

    with open(META_PATH, encoding="utf-8") as f:
        meta = json.load(f)
    expected = meta["sha256"]

    if args.force or not os.path.exists(MODEL_PATH):
        print(f"내려받는 중: {URL}")
        urllib.request.urlretrieve(URL, MODEL_PATH)

    check_tflite(MODEL_PATH)
    actual = sha256(MODEL_PATH)
    size = os.path.getsize(MODEL_PATH)

    if actual != expected:
        print(f"⚠️ 해시가 다르다\n   기대: {expected}\n   실제: {actual}", file=sys.stderr)
        print("   모델이 바뀌었다면 face_labels.json의 sha256과 앵커 규격을 함께 확인할 것.", file=sys.stderr)
        return 1

    print(f"✅ {os.path.relpath(MODEL_PATH)} ({size:,} bytes)\n   sha256 {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
