"""
EMCAD + PVTv2-B0 분할 모델 → ONNX export (온디바이스 TFLite 변환 1단계)

server.py 와 동일한 설정으로 체크포인트를 로드한 뒤,
배포용으로 최종 헤드(p1)에 sigmoid 를 적용한 단일 출력 [1,1,352,352] 로 감싸 export 한다.
 - 입력  : input  [1, 3, 352, 352]  (NCHW, ImageNet 정규화된 값)
 - 출력  : mask   [1, 1, 352, 352]  (병변 확률 0~1, threshold 0.5 는 앱에서 적용)
"""
import os
import sys
import numpy as np
import torch
import torch.nn as nn

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EMCAD_DIR = os.path.join(APP, "emcad")
sys.path.insert(0, EMCAD_DIR)  # `from lib.networks import ...`

from lib.networks import EMCADNet  # noqa: E402

CKPT = os.path.join(APP, "emcad_pvtv2b0_352.pth")
OUT_ONNX = os.path.join(os.path.dirname(__file__), "out", "skin_emcad.onnx")
IMG_SIZE = 352

# --- 모델 로드 (server.py 와 동일 파라미터) ---
model = EMCADNet(
    num_classes=1, kernel_sizes=[1, 3, 5], expansion_factor=2,
    dw_parallel=True, add=True, lgag_ks=3, activation="relu",
    encoder="pvt_v2_b0", pretrain=False,
)
ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
model.load_state_dict(state)
model.eval()


class SegWrapper(nn.Module):
    """EMCADNet 의 deep-supervision 4-head 출력 중 최종 헤드(p1)에 sigmoid 적용."""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        outs = self.m(x)          # [p4, p3, p2, p1]
        return torch.sigmoid(outs[-1])  # [1,1,352,352]


wrapper = SegWrapper(model).eval()

# --- 참조 출력 저장 (이후 ONNX/TFLite 수치 검증용) ---
torch.manual_seed(0)
x = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
with torch.no_grad():
    ref = wrapper(x).numpy()
np.save(os.path.join(os.path.dirname(__file__), "out", "ref_input.npy"), x.numpy())
np.save(os.path.join(os.path.dirname(__file__), "out", "ref_output.npy"), ref)
print("torch out:", ref.shape, "min/max/mean:", float(ref.min()), float(ref.max()), float(ref.mean()))

# --- ONNX export (고정 입력, 정적 shape) ---
torch.onnx.export(
    wrapper, x, OUT_ONNX,
    opset_version=16,           # 16 이하: LayerNorm이 fused 노드 대신 기본 연산으로 분해 → onnx2tf 호환
    input_names=["input"],
    output_names=["mask"],
    dynamic_axes=None,           # 352 고정 → 정적 shape (모바일에 유리)
    do_constant_folding=True,
    dynamo=False,                # torch 2.10 신규 dynamo exporter는 adaptive_max_pool2d 미지원 → 레거시 TorchScript 경로 사용
)
print("ONNX exported →", OUT_ONNX)
