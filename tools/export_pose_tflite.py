#!/usr/bin/env python3
"""
자세 추정 모델(BlazePose) 두 개를 번들 에셋으로 내려받아 검증한다.

얼굴 모델과 같은 이유로 우리가 학습하지 않는다 — 여기서 몸은 진단 대상이 아니라 **자(ruler)**다.
병변 면적을 회차 간 비교하려면 시간에 따라 변하지 않는 기준 길이가 필요한데, 몸통에서 그 조건을
만족하는 것은 뼈뿐이다(어깨너비 = 견봉간거리, 어깨중점→골반중점 = 척추 길이). 네 점이면 충분하고,
그 정도는 이미 잘 검증된 공개 모델이 우리가 만들 어떤 것보다 낫다.

왜 두 개인가. BlazePose는 MediaPipe의 다른 모델들처럼 2단계다:

    pose_detection.tflite     224px · 사람을 찾고 상체/전신 크기와 방향을 잡는다 (키포인트 4개)
    pose_landmark_lite.tflite 256px · 그 자리를 잘라 넣으면 관절 33개를 낸다 (어깨·골반 포함)

1단계만으로는 안 되는 이유가 분명하다. 검출기가 주는 네 점은 골반 중점·어깨 중점과 크기 원이라
**척추 길이 v는 나오지만 어깨너비 d가 나오지 않는다.** d 없이 v만으로 면적을 정규화하면(v²) 몸을
앞으로 숙이는 것만으로 넓이가 부풀려진다 — 얼굴에서 안간거리 하나(d²)를 쓰지 않는 것과 똑같은
이유다(ai/faceFrame.ts 첫 주석).

    python3 tools/export_pose_tflite.py            # 없으면 받고, 있으면 해시만 확인
    python3 tools/export_pose_tflite.py --force    # 다시 받아 덮어쓴다

⚠️ 해시가 바뀌면 앱을 고쳐야 할 수도 있다. poseDetector.ts가 두 모델의 규격(224px 입력·2254 앵커·
   앵커당 12값 · 256px 입력·랜드마크 39개×5값)을 코드에 그대로 반영하고 있다.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets", "models")
META_PATH = os.path.join(ASSETS, "pose_labels.json")

MODELS = {
    "detector": {
        "file": "pose_det_224.tflite",
        "url": "https://storage.googleapis.com/mediapipe-assets/pose_detection.tflite",
        "sha256": "9ba9dd3d42efaaba86b4ff0122b06f29c4122e756b329d89dca1e297fd8f866c",
    },
    "landmark": {
        "file": "pose_landmark_256.tflite",
        "url": "https://storage.googleapis.com/mediapipe-assets/pose_landmark_lite.tflite",
        "sha256": "1150dc68a713b80660b90ef46ce4e85c1c781bb88b6e3512cc64e6a685ba5588",
    },
}


def sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def check_tflite(path: str) -> None:
    """FlatBuffer 식별자만 확인한다 — TensorFlow 설치 없이 할 수 있는 최소한의 검증이다."""
    with open(path, "rb") as f:
        head = f.read(8)
    if head[4:8] != b"TFL3":
        raise SystemExit(f"TFLite 파일이 아니다 (식별자 {head[4:8]!r}): {path}")


def fetch(spec: dict, force: bool) -> str:
    path = os.path.join(ASSETS, spec["file"])
    if force or not os.path.exists(path):
        print(f"내려받는 중: {spec['url']}")
        os.makedirs(ASSETS, exist_ok=True)
        urllib.request.urlretrieve(spec["url"], path)
    check_tflite(path)
    got = sha256(path)
    want = spec.get("sha256")
    if want and want != got:
        # 해시가 다르면 배포본이 바뀐 것이다. 조용히 쓰면 앵커·출력 규격이 어긋난 채로 도는
        # 최악의 경우가 나오므로 여기서 멈추고, 사람이 poseDetector.ts를 확인하게 한다.
        print(f"⚠️  해시가 다르다 ({spec['file']})\n    기대: {want}\n    실제: {got}")
        print("    모델이 갱신됐을 수 있다. poseDetector.ts의 규격을 확인한 뒤 이 파일의 해시를 갱신할 것.")
    return got


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 받는다")
    args = ap.parse_args()

    hashes = {key: fetch(spec, args.force) for key, spec in MODELS.items()}

    meta = {
        "source": "MediaPipe BlazePose (pose_detection + pose_landmark_lite)",
        "detector": {
            "model": MODELS["detector"]["file"],
            "sha256": hashes["detector"],
            "img_size": 224,
            "num_anchors": 2254,
            "num_coords": 12,
            "num_keypoints": 4,
            "keypoint_order": ["hipCenter", "fullBodyScale", "shoulderCenter", "upperBodyScale"],
            "anchor_options": {
                "num_layers": 5,
                "min_scale": 0.1484375,
                "max_scale": 0.75,
                "strides": [8, 16, 32, 32, 32],
                "anchor_offset_x": 0.5,
                "anchor_offset_y": 0.5,
                "interpolated_scale_aspect_ratio": 1.0,
            },
            # 0.5에서 낮췄다. 이 값이 높으면 몸통만 크게 담긴 사진(사람이 프레임을 꽉 채워
            # 전신 실루엣이 안 보이는 사진)에서 검출이 통째로 실패한다 — 그러면 자가 없어서
            # 넓이를 아예 못 보여준다. 낮춰서 생기는 오검출은 뒤 단계(랜드마크 존재 확률,
            # 어깨·골반이 프레임 안인지)가 거른다.
            "score_threshold": 0.4,
            "iou_merge_threshold": 0.3,
            "input": "image: (1,224,224,3) RGB, 레터박스로 종횡비 유지, (v/127.5 - 1.0) 정규화 후 float32",
            "output": "regressors (1,2254,12) + classificators (1,2254,1) — 출력 순서는 길이로 판별한다",
        },
        "landmark": {
            "model": MODELS["landmark"]["file"],
            "sha256": hashes["landmark"],
            "img_size": 256,
            "num_landmarks": 39,
            "values_per_landmark": 5,
            "landmark_index": {
                "leftShoulder": 11,
                "rightShoulder": 12,
                "leftHip": 23,
                "rightHip": 24,
            },
            # 0.5에서 낮췄다. 옷·팔에 가려지면 어깨나 골반의 존재 확률이 쉽게 이 아래로 내려가고,
            # 그때 네 점을 통째로 버리면 "자를 못 찾음"이 된다. 위치 자체는 대개 맞으므로,
            # 값을 내고 프레이밍 검사(torsoFrame)와 정렬 게이트가 판단하게 둔다.
            "presence_threshold": 0.3,
            "input": "image: (1,256,256,3) RGB, 사람 자리를 잘라 넣고 v/255 정규화 후 float32",
            "output": "landmarks (1,195) = 39개 × (x, y, z, visibility, presence) — x·y는 256px 입력 좌표계",
        },
    }
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"완료: {META_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
