"""질환 분류 체크포인트(.pt) → 온디바이스용 TFLite 변환.

경로: PyTorch(DiseaseNet) → ONNX(1x3xNxN, NCHW) → onnx2tf → TFLite(NHWC, [1,H,W,3])

  - 기본 입력: /home/work/ogw/classification_disease/runs/old/dis_effb0_r512_both/best.pt
  - 출력:      assets/models/disease_model_float16.tflite + disease_labels.json
  - 전처리 규약(학습과 동일): Resize((imgsz,imgsz)) → ToTensor → ImageNet 정규화

변환 툴체인은 학습용 가상환경에 이미 있다:
  /home/work/ogw/.venv-train/bin/python tools/export_disease_tflite.py

변환 후 PyTorch 출력과 TFLite 출력을 같은 입력으로 비교해 오차를 보고한다.
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
DEFAULT_CKPT = "/home/work/ogw/classification_disease/runs/old/dis_effb0_r512_both/best.pt"
DEFAULT_OUT = APP_DIR / "assets" / "models"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# 앱에 표시할 이름 — 체크포인트의 클래스명(학습 라벨)을 사용자용 정식 명칭으로 옮긴다
DISPLAY_NAMES = {
    "건선": "건선",
    "아토피": "아토피피부염",
    "여드름": "여드름",
    "정상": "정상 피부",
    "주사": "주사",
    "지루": "지루피부염",
}


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


def load_model(ckpt_path):
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    sd = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    args = ckpt.get("args", {}) if isinstance(ckpt, dict) else {}
    classes = ckpt.get("diseases") or []
    if not classes:
        raise SystemExit("체크포인트에 클래스 목록(diseases)이 없습니다")

    net = DiseaseNet(
        ckpt.get("model_name", "efficientnet_b0"),
        num_classes=len(classes),
        embed_dim=int(args.get("embed_dim") or 512),
        dropout=float(args.get("dropout") or 0.5),
    )
    missing, unexpected = net.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit(f"가중치 불일치 — missing={missing[:3]} unexpected={unexpected[:3]}")
    net.eval()
    return net, classes, int(args.get("imgsz") or 512), ckpt.get("model_name", "efficientnet_b0")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=DEFAULT_CKPT)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--name", default="disease_model")
    ap.add_argument("--imgsz", type=int, default=None, help="입력 크기 override (기본: 학습 당시 값)")
    # fp16w: 가중치만 float16 으로 압축하고 입출력은 float32 (권장).
    #        입출력까지 float16 인 모델은 TFLite CPU 커널이 CONV_2D 를 준비하지 못해
    #        "Failed to allocate memory for input/output tensors" 로 죽는다.
    ap.add_argument("--precision", default="float32", choices=["float32", "float16"])
    a = ap.parse_args()

    import onnx2tf
    import tensorflow as tf

    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="disease_export_"))
    try:
        net, classes, imgsz, backbone = load_model(a.ckpt)
        imgsz = a.imgsz or imgsz
        print(f"[1/4] 체크포인트 로드: {backbone} imgsz={imgsz} classes={classes}")

        sample = torch.randn(1, 3, imgsz, imgsz)
        with torch.no_grad():
            torch_logits = net(sample).numpy()[0]

        onnx_path = work / "model.onnx"
        torch.onnx.export(
            net, sample, str(onnx_path),
            input_names=["input"], output_names=["logits"],
            opset_version=13, do_constant_folding=True, dynamic_axes=None,
        )
        print(f"[2/4] ONNX 내보내기 완료 ({onnx_path.stat().st_size / 1e6:.1f} MB)")

        onnx2tf.convert(
            input_onnx_file_path=str(onnx_path),
            output_folder_path=str(work / "tf"),
            copy_onnx_input_output_names_to_tflite=True,
            non_verbose=True,
        )
        produced = sorted((work / "tf").glob("*.tflite"))
        print(f"[3/4] onnx2tf 산출물: {[p.name for p in produced]}")

        dst = out_dir / f"{a.name}_{a.precision}.tflite"
        if a.precision == "fp16w":
            # onnx2tf 가 남긴 SavedModel 을 다시 변환한다.
            # optimizations=DEFAULT + supported_types=[float16] → 가중치 float16, 입출력 float32.
            conv = tf.lite.TFLiteConverter.from_saved_model(str(work / "tf"))
            conv.optimizations = [tf.lite.Optimize.DEFAULT]
            conv.target_spec.supported_types = [tf.float16]
            dst.write_bytes(conv.convert())
        else:
            src = next(((work / "tf").glob(f"*_{a.precision}.tflite")), None)
            if src is None:
                raise SystemExit(f"{a.precision} tflite 미생성: {[p.name for p in produced]}")
            shutil.copy2(src, dst)

        # 배포본 검증 — 텐서 할당이 되는지(= 기기에서 뜨는지)와 PyTorch 와의 오차를 함께 본다
        it = tf.lite.Interpreter(model_path=str(dst))
        d_in, d_out = it.get_input_details()[0], it.get_output_details()[0]
        io_dtype = np.dtype(d_in["dtype"]).name
        print(f"      배포본 입력 {d_in['shape'].tolist()} {io_dtype} → 출력 {d_out['shape'].tolist()}")

        it.allocate_tensors()  # 여기서 죽으면 기기에서도 "Failed to allocate memory for I/O tensors"
        x = sample.numpy().transpose(0, 2, 3, 1).astype(d_in["dtype"])
        it.set_tensor(d_in["index"], x)
        it.invoke()
        tflite_logits = np.array(it.get_tensor(d_out["index"])[0], dtype=np.float32)
        diff = float(np.max(np.abs(tflite_logits - torch_logits)))
        agree = int(np.argmax(tflite_logits)) == int(np.argmax(torch_logits))

        meta = {
            "backbone": backbone,
            "imgsz": imgsz,
            "classes": classes,
            "display_names": [DISPLAY_NAMES.get(c, c) for c in classes],
            "mean": IMAGENET_MEAN,
            "std": IMAGENET_STD,
            "layout": "NHWC",
            "input": [1, imgsz, imgsz, 3],
            "io_dtype": io_dtype,
            "activation": "softmax",
        }
        (out_dir / "disease_labels.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

        print(f"[4/4] {dst.name} ({dst.stat().st_size / 1e6:.1f} MB), I/O dtype={io_dtype}")
        print(f"      PyTorch vs TFLite 최대 오차 {diff:.4f}, 예측 클래스 일치={agree}")
        print(f"      로짓(torch)  {np.round(torch_logits, 3).tolist()}")
        print(f"      로짓(tflite) {np.round(tflite_logits, 3).tolist()}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
