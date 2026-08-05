"""
EMCAD + PVTv2-B0 분할 모델 → TFLite (PyTorch 직접 변환, ai-edge/litert-torch)

onnx2tf(ONNX 경로)는 PVTv2 트랜스포머의 (B,N,C) 토큰 텐서를 conv (B,C,W)로
오해해 축 변환이 깨진다. litert-torch(구 ai-edge-torch)는 torch.export→StableHLO로
내려 NCHW/NHWC 추측 자체를 하지 않으므로 트랜스포머 세그멘테이션에 적합하다.

 - 입력 : [1, 3, 352, 352] (NCHW, ImageNet 정규화)
 - 출력 : [1, 1, 352, 352] (병변 확률 0~1)
"""
import os
import sys
import numpy as np
import torch
import torch.nn as nn
import litert_torch

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(APP, "emcad"))
from lib.networks import EMCADNet  # noqa: E402

CKPT = os.path.join(APP, "emcad_pvtv2b0_352.pth")
OUT_DIR = os.path.join(os.path.dirname(__file__), "out")
OUT_TFLITE = os.path.join(OUT_DIR, "skin_emcad_f32.tflite")
IMG_SIZE = 352

model = EMCADNet(
    num_classes=1, kernel_sizes=[1, 3, 5], expansion_factor=2,
    dw_parallel=True, add=True, lgag_ks=3, activation="relu",
    encoder="pvt_v2_b0", pretrain=False,
)
ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
model.load_state_dict(state)
model.eval()


class GlobalMaxPool(nn.Module):
    """nn.AdaptiveMaxPool2d(1) 등가 치환 — adaptive_max_pool2d 는 litert-torch 미지원.
    커널=전체 spatial 크기인 표준 max_pool2d 로 두면 avg_pool 처럼 정식 MaxPool 노드가
    생성돼 NHWC 레이아웃 패스가 처리할 수 있다. (정적 shape 라 커널 크기는 상수로 고정)"""
    def forward(self, x):
        return nn.functional.max_pool2d(x, kernel_size=x.shape[2:])


def patch_adaptive_maxpool(m: nn.Module):
    """모델 내 모든 AdaptiveMaxPool2d(=CAB 채널어텐션) 를 GlobalMaxPool 로 교체."""
    for mod in m.modules():
        for name, child in list(mod.named_children()):
            if isinstance(child, nn.AdaptiveMaxPool2d):
                setattr(mod, name, GlobalMaxPool())


patch_adaptive_maxpool(model)


class SegWrapper(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return torch.sigmoid(self.m(x)[-1])  # 최종 헤드 p1 + sigmoid


wrapper = SegWrapper(model).eval()

sample = (torch.randn(1, 3, IMG_SIZE, IMG_SIZE),)
with torch.no_grad():
    ref = wrapper(*sample).numpy()
print("torch out:", ref.shape, "mean:", float(ref.mean()))

print("converting (litert-torch)…")
edge = litert_torch.convert(wrapper, sample)
edge.export(OUT_TFLITE)
print("TFLite saved →", OUT_TFLITE, "size:", os.path.getsize(OUT_TFLITE), "bytes")

# 변환 산출물 검증용 참조 저장 (동일 입력)
np.save(os.path.join(OUT_DIR, "aet_input.npy"), sample[0].numpy())
np.save(os.path.join(OUT_DIR, "aet_ref_output.npy"), ref)
