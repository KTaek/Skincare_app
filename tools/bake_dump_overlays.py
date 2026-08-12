"""
데모(dump) 사진의 병변 오버레이를 미리 구워 에셋으로 저장한다.

왜 미리 굽는가. 앱 안에서 데모 사진에 세그를 돌려 보려 했지만 실기기에서 그림이 나오지 않았다.
데모 기록은 40장이 넘어서 앱을 열 때 전부 돌릴 수도 없고, 화면에 보일 때만 돌리면 이번엔 늦게
뜨거나 실패했을 때 원본만 남는다 — 어느 쪽이든 사용자에게는 "기능이 없는 것"으로 보인다.
데모 사진은 고정된 파일이고 모델도 고정이니, 결과도 고정이다. 그러면 미리 구워 두는 것이 맞다.

**앱과 같은 그림이 나와야 한다.** 그래서 전처리·임계값·색·선 굵기를 전부 앱 코드에서 그대로
옮겼다 — 다른 값을 쓰면 데모에서 본 그림과 실제 촬영에서 나오는 그림이 달라진다:

    전처리   ai/analyzeLocal.ts  runStage1  (512로 눌러 넣기 + imagenet 정규화)
    임계값   assets/models/labels.json  mask_threshold
    합성     ai/maskOverlay.ts  (반투명 면 + 흰 테두리 + 어두운 테두리 한 겹)

사용법:
    python3 tools/bake_dump_overlays.py            # 없는 것만 굽는다
    python3 tools/bake_dump_overlays.py --force    # 전부 다시 굽는다
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageFilter

APP_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = APP_DIR.parent
PHOTO_DIR = APP_DIR / "assets" / "dump_photos"
OUT_DIR = APP_DIR / "assets" / "dump_overlays"
CKPT = REPO_DIR / "seg_lesion_512.pth"
LABELS = json.loads((APP_DIR / "assets" / "models" / "labels.json").read_text())

# ── 앱과 맞춰야 하는 값들 (출처는 위 파일 주석) ──────────────────────────
IMG_SIZE = LABELS["img_size_seg"]           # 512
THRESHOLD = LABELS["mask_threshold"]        # 0.5
MEAN = np.array(LABELS["imagenet_mean"], dtype=np.float32)
STD = np.array(LABELS["imagenet_std"], dtype=np.float32)
# ai/maskOverlay.ts — REGION_COLORS[0], OVERLAY_ALPHA, LINE_RGB/LINE_EDGE_RGB, LINE_R/LINE_EDGE_R
FILL_RGB = (0xEB, 0x57, 0x57)
FILL_ALPHA = 0.45
LINE_RGB = (255, 255, 255)
LINE_EDGE_RGB = (28, 28, 30)
LINE_R = 2
LINE_EDGE_R = 1
MAX_SIDE = 768                              # 합성 결과의 긴 변
JPEG_QUALITY = 85


def build_seg_net():
    """tools/export_models.py의 build_seg_net과 같은 구성이어야 한다 — 다르면 가중치가 안 맞는다."""
    import segmentation_models_pytorch as smp

    class SegNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = smp.UnetPlusPlus(
                encoder_name="efficientnet-b0", encoder_weights=None, in_channels=3, classes=1
            )

        def forward(self, x):
            return torch.sigmoid(self.net(x))

    net = SegNet()
    # 체크포인트는 래퍼(SegNet) 없이 안쪽 smp 모델에서 저장됐다 — export_models.py도 같은 방식이다.
    # strict=False로 두고 빠진 키를 직접 확인한다(조용히 초기 가중치로 도는 것이 최악이다).
    sd = torch.load(CKPT, map_location="cpu")
    missing, unexpected = net.net.load_state_dict(sd, strict=False)
    real_missing = [k for k in missing if "num_batches_tracked" not in k]
    if real_missing or unexpected:
        raise SystemExit(
            f"가중치가 맞지 않아요 — 빠짐 {len(real_missing)}개, 남음 {len(unexpected)}개\n"
            f"  빠짐 예: {real_missing[:3]}\n  남음 예: {unexpected[:3]}"
        )
    net.eval()
    return net


def mask_of(net, img):
    """
    사진 한 장 → 512×512 확률 마스크.

    종횡비를 **일부러 무시하고** 눌러 넣는다 — 앱의 extractNormalizedRGB가 그렇게 하고,
    모델도 학습 때 그 배치를 봤다. 여기서만 비율을 지키면 데모 그림이 실제와 달라진다.
    """
    x = np.asarray(img.convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR), dtype=np.float32) / 255.0
    x = (x - MEAN) / STD
    t = torch.from_numpy(x.transpose(2, 0, 1)[None])
    with torch.no_grad():
        return net(t)[0, 0].numpy()


def outline_of(on):
    """
    마스크 경계선 — 안쪽 흰 선과 그 바깥 어두운 선 한 겹.

    어두운 선을 두르는 이유는 흰 선만으로는 하얗게 날아간 피부나 밝은 배경 위에서 사라지기
    때문이다(maskOverlay.ts의 같은 주석). 체비쇼프 거리를 쓰는 원본과 달리 여기서는 팽창
    연산으로 같은 모양을 만든다 — 결과는 사실상 같고 훨씬 빠르다.
    """
    m = Image.fromarray((on * 255).astype(np.uint8), "L")
    grow = lambda r: m.filter(ImageFilter.MaxFilter(2 * r + 1))
    shrink = lambda r: m.filter(ImageFilter.MinFilter(2 * r + 1))
    inner = np.asarray(grow(LINE_R), dtype=np.int16) - np.asarray(shrink(LINE_R), dtype=np.int16)
    r2 = LINE_R + LINE_EDGE_R
    outer = np.asarray(grow(r2), dtype=np.int16) - np.asarray(shrink(r2), dtype=np.int16)
    return inner > 0, (outer > 0) & ~(inner > 0)


def compose(photo, prob):
    """원본 위에 면·테두리를 얹어 오버레이 한 장을 만든다 (maskOverlay.ts와 같은 순서)."""
    w, h = photo.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    out = photo.convert("RGB").resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    ow, oh = out.size

    on = (prob > THRESHOLD).astype(np.uint8)
    inner, edge = outline_of(on)

    # 마스크는 512 격자라 사진 크기로 되돌린다 — seg 입력이 그 반대 방향의 같은 변환이었다
    to_photo = lambda a: np.asarray(
        Image.fromarray((a * 255).astype(np.uint8), "L").resize((ow, oh), Image.NEAREST)
    ) > 127
    fill_m, inner_m, edge_m = to_photo(on), to_photo(inner), to_photo(edge)

    px = np.asarray(out, dtype=np.float32)
    # 면은 반투명하게 섞고, 테두리는 그 위에 불투명하게 얹는다
    px[fill_m] = px[fill_m] * (1 - FILL_ALPHA) + np.array(FILL_RGB, dtype=np.float32) * FILL_ALPHA
    px[edge_m] = LINE_EDGE_RGB
    px[inner_m] = LINE_RGB
    return Image.fromarray(px.astype(np.uint8)), int(on.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 있는 것도 다시 굽는다")
    args = ap.parse_args()

    photos = sorted(p for p in PHOTO_DIR.rglob("*.jpg"))
    if not photos:
        raise SystemExit(f"데모 사진을 찾지 못했어요: {PHOTO_DIR}")

    net = build_seg_net()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    empty = []
    for p in photos:
        rel = p.relative_to(PHOTO_DIR)
        dst = OUT_DIR / rel.parent / f"{p.stem}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and not args.force:
            continue
        img = Image.open(p)
        overlay, on_px = compose(img, mask_of(net, img))
        overlay.save(dst, quality=JPEG_QUALITY)
        pct = on_px / (IMG_SIZE * IMG_SIZE) * 100
        print(f"  {rel}  병변 {pct:5.1f}%")
        if on_px == 0:
            empty.append(str(rel))

    print(f"\n{len(photos)}장 처리 → {OUT_DIR}")
    if empty:
        # 마스크가 빈 사진은 오버레이가 원본과 같아진다 — 데모에서 "표시가 안 된다"로 보인다
        print(f"⚠️ 병변을 찾지 못한 사진 {len(empty)}장: {', '.join(empty)}")


if __name__ == "__main__":
    main()
