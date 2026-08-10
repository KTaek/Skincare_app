import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { AppColors } from '../theme';
import { CoarseGroupId } from '../monitoring/bodyParts';

// 정면으로 서 있는 몸 윤곽을 4덩어리(머리·몸통·팔·다리) 벡터 도형으로 직접 그린다 — 이미지
// 파일 없이 코드로만 그려서, 어느 플랫폼에서도 선명하고 별도 에셋 로딩이 필요 없다.
// 327×949 좌표계를 쓴다(임의로 잡은 캔버스 크기일 뿐, 실제 픽셀과는 무관).
const VIEWBOX_W = 327;
const VIEWBOX_H = 949;

// 어느 부위를 고르든 항상 이 초록 하나로 칠한다 — 앱 다른 곳(선택된 칩 등)과 같은 강조색을 써서
// "부위마다 색이 다르다"는 인상을 주지 않는다.
const HIGHLIGHT_COLOR = AppColors.greenTop;
const BODY_COLOR = '#C6CBD3';
const OUTLINE_COLOR = '#8A8F98';
const MARKER_COLOR = AppColors.greenDeep;

/**
 * 네 덩어리(머리·몸통·팔·다리)를 각각 닫힌 도형 하나로 그린다 — 팔·다리는 좌우 두 개를 한
 * path에 M...Z M...Z로 이어붙여, 강조할 때 좌우가 항상 같이 물든다(좌우를 나누지 않는
 * COARSE_GROUPS와 맞춘 것).
 * 탭 판정(classifyGroup)도 이 도형과 정확히 같은 경계 규칙을 쓴다:
 *   - 머리: y < NECK_Y
 *   - 다리: y ≥ LEG_SPLIT_Y (가랑이에서 두 다리로 갈라지는 지점)
 *   - 그 사이(어깨~엉덩이 높이)는 중심선(CX)에서 TORSO_HALF_WIDTH(y) 안쪽이면 몸통, 바깥쪽이면 팔
 */
const HEAD_PATH =
  'M133,10 L122,21 L118,32 L117,62 L114,67 L115,91 L123,100 L128,117 L135,126 L135,135 L123,149 L99,164 L225,164 L197,146 L189,135 L189,126 L199,111 L201,99 L209,91 L211,79 L210,68 L207,63 L207,38 L204,25 L194,12 L174,4 L151,4 Z';
const TORSO_PATH =
  'M96,165 L88,170 L75,296 L87,422 L74,478 L72,577 L157,577 L160,558 L165,559 L167,577 L254,577 L253,478 L240,422 L244,339 L246,333 L246,318 L251,314 L252,296 L239,170 L227,165 Z';
const ARM_PATH =
  'M87,170 L64,178 L41,193 L28,215 L21,247 L22,306 L20,350 L15,368 L13,387 L13,475 L7,522 L10,548 L13,557 L39,577 L44,574 L44,567 L33,551 L33,531 L40,531 L44,547 L49,553 L53,553 L57,547 L57,536 L52,520 L51,503 L44,486 L44,471 L54,440 L62,404 L70,311 L75,310 L74,296 Z M240,171 L253,296 L252,314 L254,315 L259,383 L267,428 L280,470 L280,486 L273,503 L272,520 L267,536 L267,548 L270,553 L275,553 L280,547 L284,532 L289,531 L291,533 L290,554 L280,567 L280,574 L285,577 L311,557 L314,549 L317,521 L311,480 L311,385 L304,350 L302,295 L303,247 L296,215 L283,193 L270,183 Z';
const LEG_PATH =
  'M70,578 L73,624 L78,654 L83,670 L86,695 L83,773 L96,833 L96,846 L102,875 L101,901 L83,927 L83,934 L86,938 L98,942 L135,941 L140,939 L146,931 L144,911 L136,890 L136,854 L141,805 L143,801 L140,717 L146,674 L149,666 L157,578 Z M167,578 L173,649 L184,717 L181,799 L188,851 L188,888 L178,919 L178,931 L184,939 L189,941 L226,942 L236,939 L241,934 L241,927 L223,901 L222,872 L225,864 L228,833 L241,772 L238,692 L251,624 L254,578 Z';

const REGION_PATHS: Record<CoarseGroupId, string> = {
  head: HEAD_PATH,
  torso: TORSO_PATH,
  arm: ARM_PATH,
  leg: LEG_PATH,
};

/**
 * 네 덩어리를 합친 몸 전체의 바깥 윤곽선 — 팔·다리·몸통 사이 안쪽 경계(겨드랑이·가랑이 등)에는
 * 선을 긋지 않고, 이 바깥 테두리 하나만 그린다. 안쪽 경계까지 다 그으면 조각조각 이어붙인
 * 종이인형처럼 보여서, 실제 사람 몸 그림처럼 테두리 하나로만 보이게 한다.
 */
const OUTLINE_PATH =
  'M151,4 L139,7 L130,12 L122,21 L117,37 L117,62 L114,67 L115,91 L123,100 L128,117 L135,126 L133,139 L123,149 L104,162 L76,175 L64,178 L43,191 L33,204 L26,221 L21,247 L22,306 L20,350 L15,368 L13,387 L13,475 L7,522 L10,548 L13,557 L39,577 L44,574 L44,567 L33,551 L33,531 L40,531 L44,547 L49,553 L53,553 L57,547 L57,536 L52,520 L51,503 L44,486 L44,471 L54,440 L62,404 L70,311 L76,311 L80,340 L81,368 L83,373 L84,409 L83,424 L81,426 L70,475 L70,586 L75,638 L83,670 L86,695 L83,773 L96,833 L96,846 L102,875 L101,901 L83,927 L83,934 L86,938 L98,942 L126,942 L140,939 L146,931 L144,911 L136,890 L136,854 L141,805 L143,801 L140,717 L151,649 L159,559 L164,558 L167,571 L175,665 L183,703 L184,717 L181,799 L188,851 L188,888 L178,919 L178,931 L184,939 L189,941 L226,942 L236,939 L241,934 L241,927 L223,901 L222,872 L225,864 L228,833 L241,772 L238,692 L251,624 L256,529 L254,475 L241,423 L240,412 L241,374 L246,318 L249,314 L254,315 L262,404 L270,440 L280,470 L280,486 L273,503 L272,520 L267,536 L267,548 L270,553 L275,553 L280,547 L284,532 L289,531 L291,533 L290,554 L280,567 L280,574 L284,577 L309,560 L314,549 L317,517 L311,480 L311,385 L304,350 L302,295 L303,247 L296,215 L290,203 L280,190 L260,178 L247,175 L220,162 L191,140 L189,126 L199,111 L201,99 L209,91 L211,79 L210,68 L207,63 L207,38 L204,25 L194,12 L185,7 L174,4 Z';

/** 목 전체(턱 밑~어깨 시작 전)를 머리 쪽에 둔다 — 머리/몸통 경계선이 목이 아니라 어깨 위에 걸린다 */
const NECK_Y = 165;
const LEG_SPLIT_Y = 578;
const CX = 163.5;
/**
 * (y, 중심에서 몸통 가장자리까지 거리) 제어점 — 그 사이는 직선 보간.
 * 어깨선(NECK_Y)에서 곧장 어깨 너비만큼 넓어지게 잡았다 — 좁게 시작하면 어깨가 통째로
 * 팔 쪽으로 넘어가 버린다.
 */
const TORSO_HALF_WIDTH: [number, number][] = [
  [165, 75],
  [300, 89],
  [420, 77],
  [480, 90],
  [578, 92],
];

function torsoHalfWidthAt(y: number): number {
  if (y <= TORSO_HALF_WIDTH[0][0]) return TORSO_HALF_WIDTH[0][1];
  const last = TORSO_HALF_WIDTH[TORSO_HALF_WIDTH.length - 1];
  if (y >= last[0]) return last[1];
  for (let i = 0; i < TORSO_HALF_WIDTH.length - 1; i++) {
    const [y0, w0] = TORSO_HALF_WIDTH[i];
    const [y1, w1] = TORSO_HALF_WIDTH[i + 1];
    if (y >= y0 && y <= y1) return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return last[1];
}

/**
 * 그림 실루엣의 좌우 바깥 경계 — 8px 간격으로 뽑아 둔 표본이다. 탭이 몸 그림 밖 여백을
 * 눌렀는지(무시) 안인지 가리는 용도라, 촘촘할 필요 없이 이 정도 간격으로도 충분하다.
 */
const ENVELOPE: [number, number, number][] = [
  [8, 138, 187], [16, 126, 198], [24, 121, 203], [32, 118, 206], [40, 117, 207], [48, 117, 207],
  [56, 117, 207], [64, 115, 208], [72, 114, 210], [80, 114, 210], [88, 115, 209], [96, 119, 205],
  [104, 124, 200], [112, 126, 198], [120, 130, 194], [128, 135, 189], [136, 134, 190], [144, 128, 196],
  [152, 117, 207], [160, 106, 218], [168, 91, 233], [176, 70, 254], [184, 53, 271], [192, 43, 281],
  [200, 36, 288], [208, 31, 293], [216, 28, 296], [224, 26, 298], [232, 23, 301], [240, 23, 301],
  [248, 21, 303], [256, 21, 303], [264, 21, 303], [272, 21, 303], [280, 22, 302], [288, 22, 302],
  [296, 22, 303], [304, 22, 303], [312, 21, 303], [320, 21, 303], [328, 20, 303], [336, 20, 304],
  [344, 20, 304], [352, 19, 305], [360, 18, 306], [368, 15, 309], [376, 15, 309], [384, 14, 310],
  [392, 13, 311], [400, 13, 311], [408, 13, 311], [416, 13, 311], [424, 13, 311], [432, 13, 311],
  [440, 13, 311], [448, 13, 311], [456, 13, 311], [464, 13, 311], [472, 13, 311], [480, 12, 311],
  [488, 12, 312], [496, 11, 313], [504, 9, 314], [512, 8, 316], [520, 7, 317], [528, 8, 316],
  [536, 9, 315], [544, 10, 314], [552, 12, 312], [560, 15, 309], [568, 26, 298], [576, 37, 287],
  [584, 70, 254], [592, 71, 253], [600, 72, 252], [608, 72, 251], [616, 73, 251], [624, 73, 251],
  [632, 75, 249], [640, 76, 248], [648, 78, 246], [656, 80, 245], [664, 81, 243], [672, 83, 241],
  [680, 83, 240], [688, 85, 239], [696, 86, 238], [704, 86, 238], [712, 86, 238], [720, 85, 239],
  [728, 85, 239], [736, 84, 240], [744, 83, 241], [752, 83, 241], [760, 83, 241], [768, 83, 241],
  [776, 84, 240], [784, 86, 238], [792, 86, 238], [800, 88, 236], [808, 90, 234], [816, 91, 233],
  [824, 94, 230], [832, 95, 229], [840, 96, 228], [848, 97, 227], [856, 99, 225], [864, 99, 225],
  [872, 101, 222], [880, 102, 222], [888, 102, 222], [896, 102, 222], [904, 99, 225], [912, 93, 230],
  [920, 88, 236], [928, 83, 241], [936, 84, 240],
];
/** 탭 판정을 너그럽게 — 실루엣 가장자리에 살짝 못 미치게 눌러도 고르게 해 준다 */
const TAP_MARGIN = 10;

function envelopeAt(y: number): [number, number] {
  const clamped = Math.max(ENVELOPE[0][0], Math.min(ENVELOPE[ENVELOPE.length - 1][0], y));
  for (let i = 0; i < ENVELOPE.length - 1; i++) {
    const [y0, min0, max0] = ENVELOPE[i];
    const [y1, min1, max1] = ENVELOPE[i + 1];
    if (clamped >= y0 && clamped <= y1) {
      const t = y1 === y0 ? 0 : (clamped - y0) / (y1 - y0);
      return [min0 + (min1 - min0) * t, max0 + (max1 - max0) * t];
    }
  }
  const [, min0, max0] = ENVELOPE[ENVELOPE.length - 1];
  return [min0, max0];
}

/** viewBox 좌표(vx, vy) → 네 덩어리 중 하나 (그림 밖 여백이면 null) */
function classifyGroup(vx: number, vy: number): CoarseGroupId | null {
  const [xMin, xMax] = envelopeAt(vy);
  if (vx < xMin - TAP_MARGIN || vx > xMax + TAP_MARGIN) return null;
  if (vy < ENVELOPE[0][0] - TAP_MARGIN || vy > ENVELOPE[ENVELOPE.length - 1][0] + TAP_MARGIN) return null;
  if (vy < NECK_Y) return 'head';
  if (vy >= LEG_SPLIT_Y) return 'leg';
  return Math.abs(vx - CX) <= torsoHalfWidthAt(vy) ? 'torso' : 'arm';
}

export interface BodyPoint2D {
  x: number;
  y: number;
}

/**
 * 부위 선택용 2D 몸 그림 — 네 덩어리를 각자의 도형으로 그리고, 지금 고른 덩어리만 채움색을
 * 초록으로 바꾼다(나머지는 옅은 회색). 그림과 탭 판정이 같은 좌표계·같은 경계를 그대로 공유해서
 * 그림 위 어디를 눌러도 눈에 보이는 그 부위가 정확히 골라진다.
 */
export default function Body2DView({
  highlightGroup,
  marker,
  onPick,
}: {
  /** 지금 선택된 덩어리 — 좌우를 나누지 않으므로 팔/다리는 양쪽 다 이 색으로 칠한다 */
  highlightGroup?: CoarseGroupId | null;
  /** 마지막으로 탭한 위치(뷰 좌표) — 칩으로 골랐을 때는 부모가 null로 지운다 */
  marker?: BodyPoint2D | null;
  onPick: (group: CoarseGroupId, point: BodyPoint2D) => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const wrapRef = useRef<View>(null);
  // 화면 절대좌표(pageX/Y) 기준 그림의 위치·크기 — locationX/Y는 RN Web에서 aspectRatio로
  // 감싼 레이어 때문에 그림 실제 위치와 어긋나는 경우가 있어서, ItchSurveyScreen의
  // VasSlider와 같은 방식(measureInWindow + pageX/Y)으로 직접 계산한다.
  const geom = useRef({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (!marker) return;
    pulse.setValue(1);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.5, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [marker, pulse]);

  const measureWrap = () => {
    wrapRef.current?.measureInWindow((x, y, width, height) => {
      geom.current = { x, y, width, height };
    });
  };

  const onPress = (e: { nativeEvent: { pageX: number; pageY: number } }) => {
    const { x, y, width, height } = geom.current;
    if (width === 0 || height === 0) return;
    const localX = e.nativeEvent.pageX - x;
    const localY = e.nativeEvent.pageY - y;
    const vx = (localX / width) * VIEWBOX_W;
    const vy = (localY / height) * VIEWBOX_H;
    const group = classifyGroup(vx, vy);
    if (!group) return;
    onPick(group, { x: localX, y: localY });
  };

  return (
    <View style={styles.container}>
      <View ref={wrapRef} style={styles.figureWrap} onLayout={measureWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onPress}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
            {/* 1) 바탕: 몸 전체를 도형 하나로 채운다. 네 덩어리를 각자 도형으로 이어붙이면(예전 방식)
                맞닿는 경계에서 안티에일리어싱 때문에 실선처럼 보이는 실금이 생겨서, 안 보이는
                덩어리 넷 대신 이 도형 하나로만 바탕을 채운다. */}
            <Path d={OUTLINE_PATH} fill={BODY_COLOR} />
            {/* 2) 고른 덩어리만 그 도형으로 덮어 칠한다 — 바탕과 넉넉히 겹치므로 실금이 생기지 않는다 */}
            {highlightGroup && <Path d={REGION_PATHS[highlightGroup]} fill={HIGHLIGHT_COLOR} />}
            {/* 3) 바깥 테두리선은 맨 위에 한 번만 — 안쪽 경계(겨드랑이·가랑이 등)에는 선을 긋지 않는다 */}
            <Path d={OUTLINE_PATH} fill="none" stroke={OUTLINE_COLOR} strokeWidth={2.5} strokeLinejoin="round" />
          </Svg>
        </Pressable>

        {marker && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.marker,
              { left: marker.x - 9, top: marker.y - 9, transform: [{ scale: pulse }] },
            ]}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 이 그림은 세로로 아주 긴 비율(327:949)이라, 예전처럼 "폭의 62%"로 잡으면 화면에 따라
  // 세로가 이 칸보다 훨씬 길어져 아래 칩·버튼과 겹친다. 대신 세로를 이 칸 높이 기준으로 잡고
  // (100%보다 조금 작게 — 그림이 칸에 꽉 차 보이지 않도록) 가로는 aspectRatio로 따라오게 해서,
  // 어떤 화면에서도 넘치지 않고 딱 들어맞는 쪽(보통 세로)에 맞춰 줄어든다.
  figureWrap: { height: '92%', maxWidth: '100%', aspectRatio: VIEWBOX_W / VIEWBOX_H },
  marker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: MARKER_COLOR,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
