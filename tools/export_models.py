"""학습 체크포인트(.pt/.pth) → 온디바이스용 TFLite 3종 변환.

  cls_dis_512.pt    → disease_cls_512.tflite   (질환 분류, EfficientNet-B0, 6-way)
  cls_sev_384.pth   → sev_cls_384.tflite       (중증도, PVTv2-B0, 5개 헤드)
  seg_lesion_512.pth→ seg_lesion_512.tflite    (증상 부위 분할, UNet++ / EfficientNet-B0)

경로: PyTorch → ONNX(NCHW) → onnx2tf → TFLite(NHWC, float32 I/O)

입출력은 float32로 고정한다. 입출력까지 float16인 모델은 TFLite CPU 커널이 CONV_2D를
준비하지 못해 로딩 시점에 "Failed to allocate memory for input/output tensors"로 죽는다.
(가중치까지 float32라 용량은 커지지만, 기기에서 뜨는 게 먼저다.)

변환이 끝나면 같은 입력을 PyTorch와 TFLite에 각각 넣어 최대 오차를 보고하고,
앱이 읽는 메타데이터(assets/models/labels.json · disease_labels.json)를 함께 갱신한다.
특히 중증도 모델은 onnx2tf가 출력 순서를 바꿀 수 있어, 실제 TFLite 출력 순서를
labels.json의 cls_output_order에 적어 앱이 그 순서대로 읽게 한다.

    python3 tools/export_models.py            # 3종 전부
    python3 tools/export_models.py --only sev # 하나만
"""
import argparse
import json
import shutil
import tempfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

APP_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = APP_DIR.parent
OUT_DIR = APP_DIR / "assets" / "models"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# 앱에 표시할 이름 — 체크포인트의 학습 라벨을 사용자용 정식 명칭으로 옮긴다
DISPLAY_NAMES = {
    "건선": "건선",
    "아토피": "아토피피부염",
    "아토피피부염": "아토피피부염",
    "여드름": "여드름",
    "정상": "정상 피부",
    "주사": "주사",
    "지루": "지루피부염",
    "지루피부염": "지루피부염",
}

# 중증도 모델의 헤드 — 앱(labels.ts의 SIGN_KEYS + iga)이 기대하는 이름과 등급 이름
SEV_HEADS = ["erythema", "papulation", "excoriation", "lichenification", "iga_grade"]
SEV_GRADE_NAMES = {
    "erythema": ["None", "Mild", "Moderate", "Severe"],
    "papulation": ["None", "Mild", "Moderate", "Severe"],
    "excoriation": ["None", "Mild", "Moderate", "Severe"],
    "lichenification": ["None", "Mild", "Moderate", "Severe"],
    "iga": ["Clear", "Almost Clear", "Mild", "Moderate", "Severe"],
}


# ────────────────────────────── 모델 정의 ──────────────────────────────
class DiseaseNet(nn.Module):
    """classification_disease/model.py 와 동일한 구조 (사전학습 가중치는 불러오지 않는다)."""

    def __init__(self, backbone, num_classes, embed_dim=512, dropout=0.5):
        super().__init__()
        import timm

        self.backbone = timm.create_model(backbone, pretrained=False, num_classes=0, global_pool="avg")
        with torch.no_grad():
            feat = self.backbone(torch.zeros(2, 3, 224, 224)).shape[1]
        self.neck = nn.Sequential(
            nn.Linear(feat, embed_dim),
            nn.BatchNorm1d(embed_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.head = nn.Linear(embed_dim, num_classes)

    def forward(self, x):
        f = self.backbone(x)
        if f.ndim > 2:
            f = f.flatten(1)
        return self.head(self.neck(f))


class SeverityNet(nn.Module):
    """멀티헤드 중증도 회귀/분류 — 공통 백본(PVTv2-B0) + 증상별 선형 헤드 5개."""

    def __init__(self, backbone, head_dims):
        super().__init__()
        import timm

        self.backbone = timm.create_model(backbone, pretrained=False, num_classes=0, global_pool="avg")
        with torch.no_grad():
            feat = self.backbone(torch.zeros(2, 3, 224, 224)).shape[1]
        self.heads = nn.ModuleDict({name: nn.Linear(feat, n) for name, n in head_dims.items()})

    def forward(self, x):
        f = self.backbone(x)
        if f.ndim > 2:
            f = f.flatten(1)
        # 출력 순서는 SEV_HEADS 순서로 고정한다 (앱이 이 순서를 기준으로 읽는다)
        return tuple(self.heads[name](f) for name in SEV_HEADS)


def build_seg_net():
    """smp UnetPlusPlus + efficientnet-b0 인코더. 출력은 로짓 1채널이라 시그모이드를 붙여 확률로 낸다."""
    import segmentation_models_pytorch as smp

    class SegNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = smp.UnetPlusPlus(
                encoder_name="efficientnet-b0", encoder_weights=None, in_channels=3, classes=1
            )

        def forward(self, x):
            return torch.sigmoid(self.net(x))

    return SegNet()


# ────────────────────────────── 변환 공통 ──────────────────────────────
def to_tflite(net, sample, work, output_names):
    """PyTorch 모듈 → ONNX → onnx2tf → float32 TFLite 파일 경로."""
    import onnx2tf

    onnx_path = work / "model.onnx"
    torch.onnx.export(
        net,
        sample,
        str(onnx_path),
        input_names=["input"],
        output_names=output_names,
        opset_version=13,
        do_constant_folding=True,
        dynamic_axes=None,
    )
    print(f"      ONNX {onnx_path.stat().st_size / 1e6:.1f} MB")

    onnx2tf.convert(
        input_onnx_file_path=str(onnx_path),
        output_folder_path=str(work / "tf"),
        copy_onnx_input_output_names_to_tflite=True,
        non_verbose=True,
    )
    src = next((work / "tf").glob("*_float32.tflite"), None)
    if src is None:
        produced = [p.name for p in (work / "tf").glob("*.tflite")]
        raise SystemExit(f"float32 tflite 미생성: {produced}")
    return src


def run_tflite(path, x_nhwc):
    """배포본을 실제로 열어 텐서 할당까지 해본다 — 여기서 죽으면 기기에서도 죽는다."""
    import tensorflow as tf

    it = tf.lite.Interpreter(model_path=str(path))
    it.allocate_tensors()
    d_in = it.get_input_details()[0]
    it.set_tensor(d_in["index"], x_nhwc.astype(d_in["dtype"]))
    it.invoke()
    outs = [(d["name"], np.array(it.get_tensor(d["index"]), dtype=np.float32)) for d in it.get_output_details()]
    return d_in, outs


def report(name, torch_out, tflite_out):
    diff = float(np.max(np.abs(np.asarray(tflite_out).ravel() - np.asarray(torch_out).ravel())))
    print(f"      {name}: PyTorch vs TFLite 최대 오차 {diff:.5f}")
    return diff


# ────────────────────────────── 개별 내보내기 ──────────────────────────────
def export_disease(ckpt_path, work):
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    sd = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    args = ckpt.get("args", {}) or {}
    classes = ckpt.get("classes") or ckpt.get("diseases") or []
    if not classes:
        raise SystemExit("질환 체크포인트에 클래스 목록이 없습니다")
    backbone = ckpt.get("model_name", "efficientnet_b0")
    imgsz = int(args.get("imgsz") or 512)

    net = DiseaseNet(
        backbone,
        num_classes=len(classes),
        embed_dim=int(args.get("embed_dim") or 512),
        dropout=float(args.get("dropout") or 0.5),
    )
    missing, unexpected = net.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit(f"질환 가중치 불일치 — missing={missing[:5]} unexpected={unexpected[:5]}")
    net.eval()
    print(f"[질환] {backbone} imgsz={imgsz} classes={classes}")

    sample = torch.randn(1, 3, imgsz, imgsz)
    with torch.no_grad():
        torch_logits = net(sample).numpy()[0]

    src = to_tflite(net, sample, work, ["logits"])
    dst = OUT_DIR / "disease_cls_512.tflite"
    shutil.copy2(src, dst)

    d_in, outs = run_tflite(dst, sample.numpy().transpose(0, 2, 3, 1))
    report("질환", torch_logits, outs[0][1][0])
    agree = int(np.argmax(outs[0][1][0])) == int(np.argmax(torch_logits))
    print(f"      입력 {d_in['shape'].tolist()} {np.dtype(d_in['dtype']).name}, 예측 클래스 일치={agree}")

    (OUT_DIR / "disease_labels.json").write_text(
        json.dumps(
            {
                "backbone": backbone,
                "imgsz": imgsz,
                "classes": list(classes),
                "display_names": [DISPLAY_NAMES.get(c, c) for c in classes],
                "mean": IMAGENET_MEAN,
                "std": IMAGENET_STD,
                "layout": "NHWC",
                "input": [1, imgsz, imgsz, 3],
                "io_dtype": "float32",
                "activation": "softmax",
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    print(f"      → {dst.name} ({dst.stat().st_size / 1e6:.1f} MB)")
    return imgsz


def export_severity(ckpt_path, work, imgsz=384):
    sd = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if "model" in sd and isinstance(sd["model"], dict):
        sd = sd["model"]
    head_dims = {name: sd[f"heads.{name}.weight"].shape[0] for name in SEV_HEADS}

    net = SeverityNet("pvt_v2_b0", head_dims)
    missing, unexpected = net.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit(f"중증도 가중치 불일치 — missing={missing[:5]} unexpected={unexpected[:5]}")
    net.eval()
    print(f"[중증도] pvt_v2_b0 imgsz={imgsz} heads={head_dims}")

    sample = torch.randn(1, 3, imgsz, imgsz)
    with torch.no_grad():
        torch_outs = [o.numpy()[0] for o in net(sample)]

    src = to_tflite(net, sample, work, list(SEV_HEADS))
    dst = OUT_DIR / "sev_cls_384.tflite"
    shutil.copy2(src, dst)

    d_in, outs = run_tflite(dst, sample.numpy().transpose(0, 2, 3, 1))

    # onnx2tf는 출력 순서를 바꿀 수 있다. 헤드마다 길이가 달라(4/4/4/4/5) 길이만으로는
    # 구분이 안 되므로, PyTorch 결과와 값이 가장 가까운 출력을 헤드별로 맞춰 순서를 알아낸다.
    order = []
    used = set()
    for i, name in enumerate(SEV_HEADS):
        best, best_diff = None, float("inf")
        for j, (_, arr) in enumerate(outs):
            v = arr.ravel()
            if j in used or v.size != torch_outs[i].size:
                continue
            d = float(np.max(np.abs(v - torch_outs[i])))
            if d < best_diff:
                best, best_diff = j, d
        if best is None:
            raise SystemExit(f"중증도 출력 매칭 실패: {name}")
        used.add(best)
        order.append(best)
        print(f"      {name}: tflite 출력 #{best} ('{outs[best][0]}'), 최대 오차 {best_diff:.5f}")

    print(f"      입력 {d_in['shape'].tolist()} {np.dtype(d_in['dtype']).name}, 출력 순서 {order}")
    return imgsz, order


def export_segmentation(ckpt_path, work, imgsz=512):
    sd = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if "model" in sd and isinstance(sd["model"], dict):
        sd = sd["model"]

    net = build_seg_net()
    missing, unexpected = net.net.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit(f"분할 가중치 불일치 — missing={missing[:5]} unexpected={unexpected[:5]}")
    net.eval()
    print(f"[분할] UnetPlusPlus/efficientnet-b0 imgsz={imgsz}")

    sample = torch.randn(1, 3, imgsz, imgsz)
    with torch.no_grad():
        torch_mask = net(sample).numpy()[0, 0]

    src = to_tflite(net, sample, work, ["mask"])
    dst = OUT_DIR / "seg_lesion_512.tflite"
    shutil.copy2(src, dst)

    d_in, outs = run_tflite(dst, sample.numpy().transpose(0, 2, 3, 1))
    tf_mask = outs[0][1].reshape(imgsz, imgsz)
    report("분할", torch_mask, tf_mask)
    print(f"      입력 {d_in['shape'].tolist()}, 출력 {list(outs[0][1].shape)}")
    print(f"      → {dst.name} ({dst.stat().st_size / 1e6:.1f} MB)")
    return imgsz


def write_labels(seg_size, cls_size, sev_order):
    """앱이 읽는 전처리·후처리 규약. 값 하나하나가 analyzeLocal.ts의 동작을 정한다."""
    (OUT_DIR / "labels.json").write_text(
        json.dumps(
            {
                "sign_names": ["erythema", "papulation", "excoriation", "lichenification", "iga"],
                "grade_names_by_sign": SEV_GRADE_NAMES,
                "dex_thresholds_by_sign": {
                    "erythema": [0.5, 1.5, 2.5],
                    "papulation": [0.5, 1.5, 2.5],
                    "excoriation": [0.5, 1.5, 2.5],
                    "lichenification": [0.5, 1.5, 2.5],
                    "iga": [0.5, 1.5, 2.5, 3.5],
                },
                "img_size_seg": seg_size,
                "img_size_cls": cls_size,
                # 분할 모델이 이미 시그모이드까지 태워서 확률을 내므로 임계값만 적용하면 된다
                "mask_threshold": 0.5,
                "crop_margin": 0.15,
                "min_crop_ratio": 0.1,
                "empty_mask_fallback": "full_image",
                "imagenet_mean": IMAGENET_MEAN,
                "imagenet_std": IMAGENET_STD,
                # onnx2tf가 정한 실제 TFLite 출력 순서 — 앱은 이 인덱스로 헤드를 읽는다
                "cls_output_order": sev_order,
                "seg_input": "image: (1,H,W,3) RGB, 0-1 스케일, imagenet mean/std 정규화 후 float32",
                "seg_output": "mask_prob: (1,H,W,1) sigmoid 확률 (임계값은 앱에서 mask_threshold로 적용)",
                "cls_input": "image: (1,384,384,3) - 분할 마스크 bbox를 crop_margin만큼 넓혀 crop 후 resize, 동일 정규화",
                "cls_output": "헤드마다 (1,num_grades) logits. DEX(softmax 기대값 → threshold)로 등급 산출.",
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dis", default=str(REPO_DIR / "cls_dis_512.pt"))
    ap.add_argument("--sev", default=str(REPO_DIR / "cls_sev_384.pth"))
    ap.add_argument("--seg", default=str(REPO_DIR / "seg_lesion_512.pth"))
    ap.add_argument("--only", choices=["dis", "sev", "seg"], default=None)
    a = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    seg_size, cls_size, sev_order = 512, 384, [0, 1, 2, 3, 4]

    if a.only in (None, "dis"):
        work = Path(tempfile.mkdtemp(prefix="exp_dis_"))
        try:
            export_disease(a.dis, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    if a.only in (None, "sev"):
        work = Path(tempfile.mkdtemp(prefix="exp_sev_"))
        try:
            cls_size, sev_order = export_severity(a.sev, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    if a.only in (None, "seg"):
        work = Path(tempfile.mkdtemp(prefix="exp_seg_"))
        try:
            seg_size = export_segmentation(a.seg, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    if a.only is None:
        write_labels(seg_size, cls_size, sev_order)
        print("labels.json / disease_labels.json 갱신 완료")


if __name__ == "__main__":
    main()
