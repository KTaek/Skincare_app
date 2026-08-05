"""
SkinScan API — EMCAD + PVTv2-B0 병변 분할(segmentation) 서버

사진을 받아 EMCAD 디코더 + PVTv2-B0 인코더 모델로 병변 영역을 분할하고,
 - 원본 위에 병변 영역을 표시한 오버레이 이미지(base64 PNG)
 - 전체 대비 병변 면적 비율(%)
 - 면적 기반 위험도(낮음/중간/높음)
를 반환한다.

체크포인트: skin_seg/runs_deeplab_emcad_pvt_v2_b0_imagenet/best.pth 를
emcad_pvtv2b0_352.pth 로 복사해 사용 (img_size=352, test dice≈0.834).
모델 코드는 emcad/lib/ (EMCAD 원본 lib) 에 자체 포함되어 있어
학습 리포지토리(skin_seg)와 독립적으로 동작한다.
"""
import io
import os
import sys
import base64
from typing import List

import cv2
import numpy as np
import torch
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware

# EMCAD 원본 lib(`from lib.networks import ...`) 해석용 경로 등록
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "emcad"))

# emcad/lib/pvtv2.py 가 @register_model 로 timm 레지스트리의 'pvt_v2_b0' 을 덮어써
# 중증도 분류기용 정품 timm pvt_v2_b0(num_features 보유)이 가려진다.
# emcad import 전에 원본 엔트리를 저장해 두고, 분류기 생성 시 복원한다(아래 참고).
try:
    import timm  # noqa: E402
    from timm.models import _registry as _timm_reg  # noqa: E402
    _TIMM_PVT_V2_B0 = _timm_reg._model_entrypoints.get("pvt_v2_b0")
except Exception:  # noqa: BLE001
    _timm_reg = None
    _TIMM_PVT_V2_B0 = None

from lib.networks import EMCADNet  # noqa: E402  (여기서 timm 레지스트리가 덮어써짐)

# severity 멀티헤드 분류 코드(model.py / labels.py) 경로 — 리포 루트의 severity/
SEVERITY_DIR = os.environ.get(
    "SEVERITY_DIR", os.path.join(HERE, "..", "..", "..", "severity")
)

app = FastAPI(title="SkinScan Segmentation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# 모델 로드 (EMCAD + PVTv2-B0)
# ----------------------------------------------------------------------------
IMG_SIZE = 352               # 체크포인트 학습 해상도와 일치
THRESHOLD = 0.5
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)  # ImageNet (인코더 사전학습)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# GPU가 있어도 CPU로 강제 실행 (서버 CPU 추론)
device = "cpu"
print(f"Device: {device}")

MODEL_PATH = os.path.join(HERE, "emcad_pvtv2b0_352.pth")

# 학습된 전체 state_dict를 로드하므로 인코더 사전학습(pretrain) 불필요 → False
model = EMCADNet(
    num_classes=1, kernel_sizes=[1, 3, 5], expansion_factor=2,
    dw_parallel=True, add=True, lgag_ks=3, activation="relu",
    encoder="pvt_v2_b0", pretrain=False,
)
ckpt = torch.load(MODEL_PATH, map_location=device, weights_only=False)
state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
model.load_state_dict(state)
model.eval().to(device)
print(f"EMCAD + PVTv2-B0 모델 로드 완료! (img_size={IMG_SIZE}, "
      f"val_dice={ckpt.get('val_dice', 'n/a') if isinstance(ckpt, dict) else 'n/a'})")

# ----------------------------------------------------------------------------
# 중증도 멀티헤드 분류기 (EMCAD 분할 마스크 → PVTv2-B0) 로드
#   seg 마스크로 병변 영역만 남긴 이미지를 입력으로 받는 masked 파이프라인
#   (학습: severity/train_masked.py, dataset_masked.py — 1024 기준 15px 팽창).
#   heads: iga_grade(전체 중증도, 5단계) + erythema/papulation/excoriation/
#          lichenification (개별 병변, None/Mild/Moderate/Severe)
#   분류기가 없거나 로드 실패해도 서버는 분할(segmentation) 전용으로 계속 동작한다.
# ----------------------------------------------------------------------------
CLS_IMG_SIZE = 384        # 분류기 입력 해상도(letterbox)
CLS_CANVAS = 1024         # 학습 이미지 해상도 = 마스크 팽창 기준 스케일
CLS_DILATE_PX = 15        # 병변 주변 컨텍스트 밴드(px @1024) — 학습과 동일
CLS_CKPT = os.environ.get(
    "CLS_CKPT", os.path.join(SEVERITY_DIR, "runs_cls_pvtv2b0_dlsplit", "best.pt")
)
CLS_BACKBONE = os.environ.get("CLS_BACKBONE", "pvt_v2_b0")

# 병변 헤드(영문 클래스명) -> 화면 표기용 한글명
LESION_KO = {
    "erythema": "홍반",
    "papulation": "구진",
    "excoriation": "찰상",
    "lichenification": "태선화",
}

classifier = None
CLS_HEADS = None      # labels.HEADS (head -> ordered class list)
try:
    sys.path.insert(0, SEVERITY_DIR)
    from labels import HEAD_NAMES, HEADS  # noqa: E402
    from model import MultiHeadSeverityNet  # noqa: E402

    # emcad 가 덮어쓴 timm pvt_v2_b0 레지스트리를 정품으로 복원(분류기 백본용)
    if _timm_reg is not None and _TIMM_PVT_V2_B0 is not None:
        _timm_reg._model_entrypoints["pvt_v2_b0"] = _TIMM_PVT_V2_B0

    classifier = MultiHeadSeverityNet(backbone=CLS_BACKBONE, pretrained=False)
    cls_ckpt = torch.load(CLS_CKPT, map_location=device, weights_only=False)
    classifier.load_state_dict(cls_ckpt["model"])
    classifier.eval().to(device)
    CLS_HEADS = HEADS
    _tm = cls_ckpt.get("test", {}).get("mean", {}) if isinstance(cls_ckpt, dict) else {}
    print(f"중증도 분류기 로드 완료! (backbone={CLS_BACKBONE}, img_size={CLS_IMG_SIZE}, masked)")
except Exception as e:  # noqa: BLE001
    print(f"[warn] 중증도 분류기 로드 실패 → 분할 전용으로 동작합니다: {e}")
    classifier = None


def cls_preprocess(rgb: np.ndarray) -> torch.Tensor:
    """RGB uint8 HxWx3 -> letterbox(비율 유지 + 0패딩) 384x384 ImageNet 정규화 텐서.

    학습(albumentations LongestMaxSize + PadIfNeeded center)과 동일한 전처리."""
    h, w = rgb.shape[:2]
    scale = CLS_IMG_SIZE / max(h, w)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)

    canvas = np.zeros((CLS_IMG_SIZE, CLS_IMG_SIZE, 3), dtype=np.uint8)
    top = (CLS_IMG_SIZE - nh) // 2
    left = (CLS_IMG_SIZE - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized

    arr = canvas.astype(np.float32) / 255.0
    arr = (arr - MEAN) / STD
    x = torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0).contiguous().to(device)
    return x


def cls_masked_input(rgb: np.ndarray, mask_seg: np.ndarray) -> torch.Tensor:
    """seg 마스크로 병변 영역만 남긴 뒤 letterbox 384 정규화 텐서 반환.

    학습 masked 파이프라인(dataset_masked.MaskedSeverityDataset) 재현:
      원본을 1024 기준으로 스케일 → 마스크 15px 팽창 → 배경 0 → bbox 크롭
      → letterbox 384(확대).
      마스크가 비어 있으면(병변 미검출) 원본을 그대로 사용(검은 프레임 방지)."""
    h, w = rgb.shape[:2]
    scale = CLS_CANVAS / max(h, w)
    cw, ch = max(1, round(w * scale)), max(1, round(h * scale))
    img = cv2.resize(rgb, (cw, ch), interpolation=cv2.INTER_LINEAR)
    m = cv2.resize(mask_seg.astype(np.uint8), (cw, ch), interpolation=cv2.INTER_NEAREST)

    if m.max() > 0:
        k = 2 * CLS_DILATE_PX + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        m = cv2.dilate(m, kernel)
        img = (img.astype(np.float32) * (m > 0)[..., None]).astype(np.uint8)
        # bbox 크롭: (팽창된) 마스크 경계 상자로 잘라 병변이 프레임을 채우게 한 뒤
        # cls_preprocess 의 letterbox 가 384 로 확대한다.
        ys, xs = np.where(m > 0)
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        img = img[y0:y1, x0:x1]
    return cls_preprocess(img)


@torch.no_grad()
def classify(rgb: np.ndarray, mask_seg: np.ndarray):
    """원본 RGB + seg 마스크 -> (전체 중증도 iga dict, 검출된 병변 리스트).

    반환:
      iga     = {"grade": <Clear..Severe>, "prob": 0~1}
      lesions = [{"key","name","grade","prob"}, ...]  # None 제외, 확률 높은순
    """
    if classifier is None:
        return None, None
    x = cls_masked_input(rgb, mask_seg)
    out = classifier(x)

    # 전체 중증도 (iga_grade, 5단계)
    iga_classes = CLS_HEADS["iga_grade"]
    iga_p = torch.softmax(out["iga_grade"], 1)[0].cpu().numpy()
    iga_idx = int(iga_p.argmax())
    iga = {"grade": iga_classes[iga_idx], "prob": round(float(iga_p[iga_idx]), 4)}

    # 개별 병변 헤드 — argmax가 None이면 미검출로 제외
    lesions = []
    for head in ("erythema", "papulation", "excoriation", "lichenification"):
        classes = CLS_HEADS[head]                       # [None, Mild, Moderate, Severe]
        p = torch.softmax(out[head], 1)[0].cpu().numpy()
        idx = int(p.argmax())
        if classes[idx] == "None":
            continue                                     # 병변으로 인식하지 않음
        lesions.append({
            "key": head,
            "name": LESION_KO[head],
            "grade": classes[idx],                       # Mild / Moderate / Severe
            "prob": round(float(p[idx]), 4),             # 예측 확률(해당 등급 confidence)
        })
    lesions.sort(key=lambda d: d["prob"], reverse=True)  # 확률 높은순
    return iga, lesions


def preprocess(rgb: np.ndarray) -> torch.Tensor:
    """RGB uint8 HxWx3 -> 정규화된 [1,3,IMG_SIZE,IMG_SIZE] 텐서"""
    r = cv2.resize(rgb, (IMG_SIZE, IMG_SIZE)).astype(np.float32) / 255.0
    r = (r - MEAN) / STD
    x = torch.from_numpy(r.transpose(2, 0, 1)).unsqueeze(0).contiguous().to(device)
    return x


@torch.no_grad()
def segment(rgb: np.ndarray):
    """원본 RGB 이미지 -> (병변 확률맵 IMG_SIZE float, 이진 마스크 IMG_SIZE bool).

    EMCADNet은 deep-supervision 헤드 4개 [p4, p3, p2, p1]를 반환하며,
    가장 정밀한 최종 예측은 마지막 헤드(preds[-1] = p1)다."""
    x = preprocess(rgb)
    preds = model(x)                       # [p4, p3, p2, p1]
    logit = preds[-1]                      # 최종 예측 헤드
    prob = torch.sigmoid(logit)[0, 0].cpu().numpy()  # IMG_SIZE x IMG_SIZE
    mask = prob > THRESHOLD
    return prob, mask


def make_overlay(rgb: np.ndarray, mask_seg: np.ndarray, max_side: int = 640) -> str:
    """원본 위에 병변 영역을 반투명 빨강 + 외곽선으로 표시한 PNG(base64 data URI)."""
    h, w = rgb.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        rgb = cv2.resize(rgb, (int(w * scale), int(h * scale)))
        h, w = rgb.shape[:2]

    mask = cv2.resize(mask_seg.astype(np.uint8), (w, h),
                      interpolation=cv2.INTER_NEAREST).astype(bool)

    overlay = rgb.copy()
    red = np.zeros_like(rgb)
    red[..., 0] = 255  # RGB 빨강
    overlay[mask] = (0.55 * rgb[mask] + 0.45 * red[mask]).astype(np.uint8)

    # 외곽선
    contours, _ = cv2.findContours(mask.astype(np.uint8),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay, contours, -1, (255, 40, 40), 2)

    bgr = cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".png", bgr)
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def risk_from_area(area_pct: float):
    """병변 면적 비율(%) -> 위험도 등급."""
    if area_pct >= 20:
        return "high", "높음", "병변 범위가 넓습니다. 피부과 방문을 권장합니다."
    elif area_pct >= 5:
        return "medium", "중간", "가까운 시일 내 피부과 상담을 권장합니다."
    else:
        return "low", "낮음", "병변 범위가 작습니다. 경과를 관찰하세요."


@app.get("/")
def root():
    return {"status": "SkinScan Segmentation API running", "model": "EMCAD + PVTv2-B0"}


@app.post("/predict")
async def predict(
    file: List[UploadFile] = File(...),
    # 아래 설문 값들은 앱 호환용(현재 분할 결과에는 사용하지 않음)
    itch: int = Form(0),
    pain: int = Form(0),
    family_itch: str = Form("모름"),
    ring_shape: str = Form("아니오"),
    scale_type: str = Form("없음"),
):
    # 다각도 촬영 시 여러 장이 오면 첫 번째 이미지 사용
    up = file[0] if isinstance(file, list) else file
    img_bytes = await up.read()
    rgb = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))

    # 1) 분할(segmentation): 병변 영역 마스크 + 오버레이
    prob, mask = segment(rgb)
    area_pct = round(float(mask.mean()) * 100, 1)
    lesion_detected = bool(mask.sum() > 0)
    overlay = make_overlay(rgb, mask)

    # 2) 분류(classification): 전체 중증도(iga) + 개별 병변 종류/확률/중증도
    #    seg 마스크로 병변 영역만 남긴 이미지를 PVTv2-B0 분류기에 입력
    iga, lesions = classify(rgb, mask)

    risk_level, risk_label, risk_guide = risk_from_area(area_pct)
    if not lesion_detected:
        risk_level, risk_label, risk_guide = "low", "낮음", "뚜렷한 병변이 감지되지 않았습니다."

    return {
        "mode": "classification" if iga is not None else "segmentation",
        "model": ("EMCAD + PVTv2-B0 (분할) · PVTv2-B0 (중증도 분류)"
                  if iga is not None else "EMCAD + PVTv2-B0"),
        "lesion_detected": lesion_detected,
        "area_pct": area_pct,                 # 전체 대비 병변 면적 비율(%)
        "overlay_base64": overlay,            # 병변 표시 오버레이 이미지
        # 새 체계: 전체 중증도 + 병변별 종류/확률/중증도
        "iga": iga,                           # {"grade","prob"} | null
        "lesions": lesions,                   # [{"key","name","grade","prob"}] | null (확률 높은순)
        "risk_level": risk_level,
        "risk_label": risk_label,
        "risk_guide": risk_guide,
        "message": (f"병변 영역이 전체의 약 {area_pct}%로 분석되었습니다."
                    if lesion_detected else "뚜렷한 병변이 감지되지 않았습니다."),
    }
