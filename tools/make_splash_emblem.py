"""assets/splash.png의 원 안쪽 그림을 그린다 (옆얼굴 + 반짝임).

    python3 tools/make_splash_emblem.py

**tools/splash_base.png(추이 화살표가 들어 있던 이전 스플래시)를 원본으로 읽어 매번 처음부터
다시 만든다.** 결과물(assets/splash.png)을 입력으로 삼지 않는 이유는 이 스크립트가 원 안쪽
배경 규칙 — 세로 그라데이션과 아래쪽 언덕의 물결 경계 — 을 **픽셀에서 읽어 내기** 때문이다.
이미 그림이 올라간 이미지를 읽으면 그 선들이 배경 표본에 섞여 규칙이 조금씩 어긋난다.

카드·셔터 테두리·원 테두리·워드마크·태그라인은 원본 픽셀을 그대로 둔다 — 색과 두께를 여기서
다시 정의하면 지금 디자인과 미세하게 어긋나기 때문이다. 실제로 바뀌는 것은 원 테두리 **안쪽**뿐이다.
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'splash_base.png')
OUT = os.path.join(ROOT, 'assets', 'splash.png')

CX, CY = 599.5, 467.0   # 원 중심 (원본에서 측정)
R_IN = 115.0            # 테두리 안쪽 — 이 안만 다시 그린다
INK = (46, 74, 20)      # AppColors.greenDeep
HILL = (183, 246, 121)  # 아래쪽 언덕 색 (원본에서 그대로)
S = 6                   # 슈퍼샘플 배수

im = Image.open(SRC).convert('RGB')
px = im.load()

x0, x1 = int(math.floor(CX - R_IN)), int(math.ceil(CX + R_IN))
y0, y1 = int(math.floor(CY - R_IN)), int(math.ceil(CY + R_IN))

def inside(x, y, r=R_IN):
    return (x - CX) ** 2 + (y - CY) ** 2 <= r * r

def is_hill(p):
    return all(abs(p[c] - HILL[c]) <= 2 for c in range(3))

# ── 1. 원본에서 배경 규칙을 읽어 낸다 ─────────────────────────
# 언덕 경계: 각 열을 아래에서 위로 훑어 언덕색이 끊기는 지점
NONE = 10 ** 6
raw = {}
for x in range(x0, x1 + 1):
    ys = [y for y in range(y0, y1 + 1) if inside(x, y, R_IN - 1)]
    if not ys:
        continue
    top = NONE
    for y in reversed(ys):
        if not is_hill(px[x, y]):
            break
        top = y
    raw[x] = top

# 원 좌우 끝은 열이 짧아 경계 판정이 흔들린다 — 이웃과 중앙값을 내 한 열짜리 계단을 없앤다
wave = {}
for x in raw:
    win = sorted(raw[k] for k in range(x - 4, x + 5) if k in raw)
    wave[x] = win[len(win) // 2]

# 언덕 위쪽의 세로 그라데이션: 행마다 성한 픽셀의 중앙값
grad = {}
for y in range(y0, y1 + 1):
    vals = [px[x, y] for x in range(x0, x1 + 1)
            if inside(x, y, R_IN - 1) and y < wave.get(x, NONE) and px[x, y][0] >= 180]
    if len(vals) >= 5:
        vals.sort(key=lambda p: p[0])
        grad[y] = vals[len(vals) // 2]
known = sorted(grad)
for y in range(y0, y1 + 1):          # 표본이 없는 맨 위/아래 행은 가장 가까운 행으로
    if y not in grad:
        grad[y] = grad[min(known, key=lambda k: abs(k - y))]

# ── 2. 테두리 안쪽 경계를 각도마다 실측한다 ────────────────────
#
# 반지름 하나로 자르면 안 된다. 원이 완전한 정원이 아니라 각도에 따라 1~2px씩 다르고, 그
# 어긋난 만큼 옛 화살표 꼬리가 테두리에 닿던 자리에 잔해가 남는다(꼬리와 테두리 사이의 밝은
# 틈까지 함께). 바깥에서 안으로 훑어 테두리 띠가 끝나는 지점을 각도마다 직접 찾으면 그 문제가
# 통째로 사라진다 — 화살표는 그 틈 덕분에 띠에 이어져 있지 않아 스캔이 먼저 멈춘다.
STEPS = 1440

def is_dark(p):
    return p[0] < 120

edge = []
for i in range(STEPS):
    th = 2 * math.pi * i / STEPS
    cs, sn = math.cos(th), math.sin(th)
    r, seen_ink = 136.0, False
    while r > 95:
        p = px[int(round(CX + r * cs)), int(round(CY + r * sn))]
        if is_dark(p):
            seen_ink = True
        elif seen_ink:
            break
        r -= 0.25
    edge.append(r if seen_ink else R_IN)

def edge_at(x, y):
    th = math.atan2(y - CY, x - CX) % (2 * math.pi)
    return edge[int(th / (2 * math.pi) * STEPS) % STEPS]

# ── 3. 원 안쪽을 다시 칠한다 ─────────────────────────────────
R_MAX = max(edge) + 2
for y in range(int(CY - R_MAX), int(CY + R_MAX) + 1):
    for x in range(int(CX - R_MAX), int(CX + R_MAX) + 1):
        if math.hypot(x - CX, y - CY) <= edge_at(x, y) - 0.5:
            px[x, y] = HILL if y >= wave.get(x, NONE) else grad[min(max(y, y0), y1)]

# ── 3. 새 그림 (원 반지름 = 1 인 좌표계, y는 아래가 +) ──────────────
def bez(p0, p1, p2, p3, n=160):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        ))
    return out

def path(pts):
    """[start, (c1, c2, end), ...] → 폴리라인"""
    out = [pts[0]]
    cur = pts[0]
    for c1, c2, end in pts[1:]:
        out += bez(cur, c1, c2, end)[1:]
        cur = end
    return out

TOP = (-0.11, -0.93)   # 정수리 — 옆얼굴선과 머리선이 여기서 만난다

# 옆얼굴 — 이마 → 콧등 → 코끝 → 인중 → 입술 → 턱 → 턱선 → 목
PROFILE = path([
    TOP,
    ((-0.33, -0.88), (-0.43, -0.62), (-0.44, -0.30)),   # 이마
    ((-0.45, -0.21), (-0.40, -0.19), (-0.40, -0.12)),   # 눈썹뼈 → 콧등 시작
    ((-0.41, 0.01), (-0.49, 0.06), (-0.46, 0.13)),      # 콧등 → 코끝
    ((-0.43, 0.17), (-0.38, 0.18), (-0.34, 0.19)),      # 콧망울 → 인중
    ((-0.31, 0.23), (-0.35, 0.25), (-0.36, 0.29)),      # 윗입술
    ((-0.38, 0.33), (-0.32, 0.36), (-0.35, 0.41)),      # 아랫입술
    ((-0.37, 0.46), (-0.38, 0.50), (-0.32, 0.55)),      # 턱
    ((-0.17, 0.65), (0.01, 0.70), (0.13, 0.71)),        # 턱선
    ((0.18, 0.76), (0.18, 0.88), (0.17, 1.06)),         # 목 — 원 테두리에 닿아 끝난다
])

# 머리 바깥선 — 정수리에서 오른쪽으로 크게 돌아 아래로
HAIR_OUT = path([
    TOP,
    ((0.14, -0.96), (0.47, -0.56), (0.48, -0.02)),
    ((0.50, 0.36), (0.45, 0.65), (0.33, 0.84)),
])

# 머리 안쪽선 — 바깥선과 만나 잎사귀 모양을 만든다
HAIR_IN = path([
    TOP,
    ((-0.02, -0.58), (0.07, -0.22), (0.11, 0.16)),
    ((0.15, 0.46), (0.24, 0.68), (0.33, 0.84)),
])

# 반짝임 (x, y, 반지름) — 얼굴 앞쪽 빈 자리에
SPARKS = [(-0.60, -0.38, 0.155), (-0.48, -0.61, 0.098),
          (-0.78, -0.19, 0.105), (-0.64, -0.03, 0.072)]

STROKE = 0.072  # 원 반지름 대비 선 두께 (기존 화살표와 같은 무게)

def sparkle(cx, cy, r, waist=0.16, n=28):
    """네 갈래 반짝임 — 뾰족한 팁 넷을 중심 가까이 지나는 2차 베지어로 잇는다"""
    tips = [(cx + r * math.cos(a), cy + r * math.sin(a))
            for a in (-math.pi / 2, 0, math.pi / 2, math.pi)]
    pts = []
    for i, p0 in enumerate(tips):
        p1 = tips[(i + 1) % 4]
        # 조절점은 두 팁 사이 방향으로 아주 조금만 — 허리가 잘록해진다
        mx, my = (p0[0] + p1[0]) / 2 - cx, (p0[1] + p1[1]) / 2 - cy
        ml = math.hypot(mx, my) or 1
        c = (cx + mx / ml * r * waist, cy + my / ml * r * waist)
        for k in range(n):
            t = k / n
            u = 1 - t
            pts.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
                        u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]))
    return pts

# ── 4. 슈퍼샘플로 그려서 합성 ──────────────────────────────────
R_DRAW = R_IN + 4      # 테두리 안쪽 살짝 너머까지 (목선이 테두리에 닿아 끝나도록)
side = int(2 * R_DRAW) * S
layer = Image.new('L', (side, side), 0)
d = ImageDraw.Draw(layer)

def to_px(p):
    return ((p[0] * R_IN + R_DRAW) * S, (p[1] * R_IN + R_DRAW) * S)

def stroke_path(pts, width):
    """원판을 촘촘히 찍어 그린다 — 둥근 마감·이음매가 저절로 나온다"""
    rad = width * R_IN * S / 2
    prev = None
    for p in pts:
        q = to_px(p)
        if prev and math.hypot(q[0] - prev[0], q[1] - prev[1]) < rad / 3:
            continue
        d.ellipse([q[0] - rad, q[1] - rad, q[0] + rad, q[1] + rad], fill=255)
        prev = q

for p in (PROFILE, HAIR_OUT, HAIR_IN):
    stroke_path(p, STROKE)
for sx, sy, sr in SPARKS:
    d.polygon([to_px(p) for p in sparkle(sx, sy, sr)], fill=255)

layer = layer.resize((int(2 * R_DRAW), int(2 * R_DRAW)), Image.LANCZOS)

# 원 밖으로 새어 나간 부분을 잘라낸다
clip = Image.new('L', layer.size, 0)
ImageDraw.Draw(clip).ellipse([0, 0, layer.size[0] - 1, layer.size[1] - 1], fill=255)
layer = Image.composite(layer, Image.new('L', layer.size, 0), clip)

ink = Image.new('RGB', layer.size, INK)
im.paste(ink, (int(CX - R_DRAW), int(CY - R_DRAW)), layer)
im.save(OUT)
print('saved', OUT, im.size)
