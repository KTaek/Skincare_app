import React, { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Ellipse, Line, Rect } from 'react-native-svg';
import { AppColors } from '../theme';
import { standardRoi, type ScaleKind } from '../ai/scaleFrame';

/**
 * 촬영 가이드 — 지난 사진을 화면 전체에 반투명하게 깔고, 거기 겹쳐 맞추게 한다.
 * 얼굴과 몸통이 같은 화면을 쓰고, 도형만 부위에 따라 달라진다.
 *
 * **왜 사진을 통째로 까는가.** 맞춰야 할 것이 "지난번과 같은 구도"라면, 화면에 있어야 하는 것도
 * 지난번 사진 그 자체다. 도형은 "얼굴을 이만큼 크게 여기에 두라"는 말을 그림으로 옮긴 것뿐이라
 * 한 다리 건너간 지시가 되고, 정작 지난번에 어떻게 찍었는지는 알려주지 못한다. 사진을 깔면
 * 사용자는 눈·코·입이 겹칠 때까지 움직이기만 하면 되고, 그 동작이 곧 목표 구도다.
 *
 * **화면과 판정이 같은 곳을 겨냥한다.** 정렬 게이트도 이 사진의 구도(FaceFraming)를 목표로 삼는다
 * (alignTargetFor). 화면에는 지난 사진을 깔아 두고 게이트는 다른 자리를 재면, 사용자가 눈으로
 * 겹친 순간에 판정이 실패해서 "맞췄는데 왜 안 찍히지"가 된다.
 *
 * **cover로 그린다.** 프리뷰(CameraView)가 프레임을 화면에 꽉 차게 늘려 자르므로, 고스트도 같은
 * 방식으로 깔아야 두 그림의 같은 지점이 화면의 같은 자리에 온다. 지난 사진과 프리뷰의 종횡비가
 * 같다면(같은 카메라로 잠가 두었으므로 보통 같다) 이 대응은 정확하다.
 *
 * 고스트가 없을 때(첫 촬영, 지난 사진에서 얼굴을 못 찾음)만 표준 프레이밍 도형을 그린다 —
 * 그때는 맞출 지난 사진이 없으니 "여기에 이만큼"을 도형으로 말해 주는 수밖에 없다.
 */

/**
 * 지난 사진 겹의 불투명도.
 *
 * 두 얼굴이 겹쳐 보여야 하므로 어느 쪽도 가리면 안 된다. 0.5를 넘으면 지금 얼굴이 묻히고,
 * 0.25 아래로 내리면 지난 얼굴의 윤곽이 사라져 맞출 것이 없어진다.
 */
const GHOST_OPACITY = 0.38;

export default function ScaleGuideOverlay({
  kind,
  imageWidth,
  imageHeight,
  ghostUri,
  mirrored,
  ok,
}: {
  /** 무엇을 자로 쓰는 자리인지 — 도형과 문구가 여기서 갈린다 */
  kind: ScaleKind;
  /** 마지막 판정 프레임의 크기 — 아직 한 장도 못 찍었으면 0 (그때는 화면 비율로 도형을 그린다) */
  imageWidth: number;
  imageHeight: number;
  /** 화면 전체에 깔 지난 사진. 없으면 표준 가이드 도형을 그린다 */
  ghostUri?: string | null;
  /** 전면 카메라 프리뷰는 거울처럼 좌우가 뒤집혀 보인다 — 고스트도 같이 뒤집어야 겹친다 */
  mirrored: boolean;
  /** 정렬이 맞았는지 — 도형을 그릴 때만 색으로 쓴다 */
  ok: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // 고스트는 화면 크기를 몰라도 그릴 수 있다(absoluteFill + cover) — 도형만 실측이 필요하다
  if (ghostUri) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={{ uri: ghostUri }}
          style={[StyleSheet.absoluteFill, { opacity: GHOST_OPACITY }, mirrored && { transform: [{ scaleX: -1 }] }]}
          resizeMode="cover"
        />
      </View>
    );
  }

  if (size.w <= 0 || size.h <= 0) return <View style={StyleSheet.absoluteFill} onLayout={onLayout} />;

  const box = guideBox(kind, size.w, size.h, imageWidth, imageHeight);
  const color = ok ? AppColors.greenTop : '#FFFFFF';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
        {/* 표준 관심영역 = 분석에 실제로 들어가는 정사각형 */}
        <Rect
          x={box.x}
          y={box.y}
          width={box.side}
          height={box.side}
          rx={box.side * 0.08}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="10 8"
          opacity={0.9}
        />
        {kind === 'face' ? (
          <>
            {/* 얼굴 자리를 알려주는 타원 — 사각형만 있으면 얼굴을 어디까지 채워야 할지 알기 어렵다.
                성인 얼굴 비례(가로 ≈ 세로의 0.74)에 맞춘 크기다. */}
            <Ellipse
              cx={box.x + box.side / 2}
              cy={box.y + box.side / 2}
              rx={box.side * 0.37}
              ry={box.side * 0.5}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              opacity={0.55}
            />
            {/* 눈높이 선 — 배율과 상하 위치를 한 번에 맞출 수 있는 가장 쉬운 기준점이다.
                얼굴 중심(코 높이)보다 위쪽에 눈이 오므로 그 자리에 긋는다. */}
            <Line
              x1={box.x + box.side * 0.2}
              y1={box.y + box.side * 0.4}
              x2={box.x + box.side * 0.8}
              y2={box.y + box.side * 0.4}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 6"
              opacity={0.55}
            />
          </>
        ) : (
          <>
            {/*
              몸통 가이드는 어깨선과 골반선 두 줄이다. 사각형 안에 몸통이 "들어오기만" 하면 되는
              얼굴과 달리, 몸통은 **어깨와 골반이 각각 어느 높이에 와야 하는지**가 곧 배율이다 —
              자를 내는 랜드마크 모델이 프레이밍에 민감해서 그 높이가 회차마다 같아야 한다.

              두 선의 간격은 관심영역(1.6s) 안에서 v가 차지하는 비율이다: v ≈ 1.07s이므로
              1.07 / 1.6 ≈ 0.67 → 위아래로 각각 16.5%씩 여백이 남는다.
            */}
            <Line
              x1={box.x + box.side * 0.1}
              y1={box.y + box.side * 0.165}
              x2={box.x + box.side * 0.9}
              y2={box.y + box.side * 0.165}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 6"
              opacity={0.55}
            />
            <Line
              x1={box.x + box.side * 0.2}
              y1={box.y + box.side * 0.835}
              x2={box.x + box.side * 0.8}
              y2={box.y + box.side * 0.835}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 6"
              opacity={0.55}
            />
          </>
        )}
      </Svg>
    </View>
  );
}

/**
 * 화면 위 표준 관심영역 사각형 (고스트가 없을 때만 쓴다).
 * 부위마다 크기가 다르므로(SCALE_SPEC) 종류를 함께 받는다.
 *
 * 프레임 좌표의 목표(FACE_TARGET · faceRoiOf의 3.0배)를 cover 변환으로 화면에 옮긴다.
 * 프레임 크기를 아직 모르면(첫 틱 이전) 화면 자체를 프레임으로 친다 — 종횡비가 비슷하므로
 * 잠깐 보이는 가이드가 크게 어긋나지 않는다.
 */
function guideBox(kind: ScaleKind, screenW: number, screenH: number, imageW: number, imageH: number) {
  const w = imageW > 0 ? imageW : screenW;
  const h = imageH > 0 ? imageH : screenH;

  // cover: 짧은 쪽이 화면을 채우도록 늘리고 넘치는 만큼을 반씩 잘라낸다
  const scale = Math.max(screenW / w, screenH / h);
  const offsetX = (screenW - w * scale) / 2;
  const offsetY = (screenH - h * scale) / 2;

  // 사각형은 게이트가 겨냥하는 것과 **같은 계산**(standardRoi)에서 가져온다 — 여기서 따로
  // 만들면 언젠가 어긋나고, 그러면 가이드에 맞춰도 셔터가 안 열린다
  const roi = standardRoi(kind, w, h);
  return { x: offsetX + roi.x * scale, y: offsetY + roi.y * scale, side: roi.width * scale };
}
