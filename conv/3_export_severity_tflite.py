"""
중증도 멀티헤드 분류기 (timm PVTv2-B0 + 5 heads) → TFLite (litert-torch)

server.py 의 masked 분류 파이프라인 입력(letterbox 384 + ImageNet 정규화)을 받아
각 헤드의 raw logit 을 반환한다. softmax 는 앱에서 적용(서버와 동일).

주의: emcad/lib.pvtv2 를 import 하면 timm 레지스트리의 정품 pvt_v2_b0 이 덮어써지므로
      이 스크립트는 emcad 를 절대 import 하지 않는다(분류기 백본 = 정품 timm).

 - 입력 : [1, 3, 384, 384] (NCHW, ImageNet 정규화된 masked 이미지)
 - 출력 : 5개 텐서 (HEAD_NAMES 순서, raw logits)
     iga_grade[1,5], erythema[1,4], papulation[1,4], excoriation[1,4], lichenification[1,4]
"""
import os
import sys
import numpy as np
import torch
import torch.nn as nn
import litert_torch

R = "/home/work/MINJI"
SEVERITY_DIR = os.path.join(R, "severity")
sys.path.insert(0, SEVERITY_DIR)  # labels.py / model.py

from labels import HEAD_NAMES        # noqa: E402
from model import MultiHeadSeverityNet  # noqa: E402

CKPT = os.path.join(SEVERITY_DIR, "runs_cls_pvtv2b0_dlsplit", "best.pt")
OUT_DIR = os.path.join(os.path.dirname(__file__), "out")
OUT_TFLITE = os.path.join(OUT_DIR, "skin_severity_f32.tflite")
IMG_SIZE = 384

print("HEAD_NAMES(출력 순서):", HEAD_NAMES)

model = MultiHeadSeverityNet(backbone="pvt_v2_b0", pretrained=False)
ck = torch.load(CKPT, map_location="cpu", weights_only=False)
model.load_state_dict(ck["model"])
model.eval()


class ClsWrapper(nn.Module):
    """dict 출력을 HEAD_NAMES 고정 순서의 tuple 로 변환 (TFLite 다중 출력)."""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        out = self.m(x)
        return tuple(out[h] for h in HEAD_NAMES)


wrapper = ClsWrapper(model).eval()

sample = (torch.randn(1, 3, IMG_SIZE, IMG_SIZE),)
with torch.no_grad():
    ref = [t.numpy() for t in wrapper(*sample)]
for h, r in zip(HEAD_NAMES, ref):
    print(f"  torch {h}: {r.shape}")

print("converting (litert-torch)…")
edge = litert_torch.convert(wrapper, sample)
edge.export(OUT_TFLITE)
print("TFLite saved →", OUT_TFLITE, "size:", os.path.getsize(OUT_TFLITE), "bytes")

np.save(os.path.join(OUT_DIR, "sev_input.npy"), sample[0].numpy())
np.savez(os.path.join(OUT_DIR, "sev_ref_output.npz"),
         **{h: r for h, r in zip(HEAD_NAMES, ref)})
