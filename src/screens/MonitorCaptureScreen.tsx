import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { AppColors } from '../theme';
import { useMonitoring } from '../context/MonitoringContext';
import type { SkImage } from '@shopify/react-native-skia';
import { withSkImage } from '../ai/skiaPixels';
import { normalizeOrientation } from '../ai/imageOrientation';
import { humanError } from '../ai/errorText';
import { endProfile, note, span, spanAsync, startProfile } from '../ai/profile';
import { detectScaleFrame, isScaleAvailable, preloadScaleModel } from '../ai/scaleDetect';
import { roiOf, type ScaleFrame, type ScaleFraming, type ScaleKind } from '../ai/scaleFrame';
import { buildScaleGhost, type ScaleGhost } from '../ai/scaleGhost';
import { scaleKindOf } from '../monitoring/bodyParts';
import ScaleGuideOverlay from '../components/ScaleGuideOverlay';
import {
  evaluateAreaEligibility,
  evaluateFrame,
  GATE,
  measureImageQuality,
} from '../monitoring/frameQuality';
import { useCaptureVoice } from '../monitoring/captureVoice';
import {
  baselineFromCapture,
  computeColorNormalization,
  IDENTITY_COLOR_NORM,
  newId,
  scoreConfidence,
} from '../monitoring/postProcess';
import {
  AreaRejectCode,
  Baseline,
  CapturePath,
  ColorNormalization,
  FrameEvaluation,
  MonitorSession,
  MonitorTarget,
  SessionConfidence,
} from '../monitoring/types';
import { DUMP_RESULTS, makeDumpBaseline, makeDumpConfidence } from '../exam/dumpAnalysis';

/**
 * 자동 셔터의 목표 점수 — 기다린 시간에 따라 내려간다.
 *
 * 고정 하한(0.7) 하나만 두면 그 값을 못 넘기는 환경에서 셔터가 **영영 열리지 않는다.** 조명이
 * 어둡거나 손이 계속 흔들리는 자리에서 실제로 그랬고, 사용자 눈에는 앱이 고장 난 것으로 보인다.
 *
 * 그래서 "얼마나 좋아야 하는가"를 시간의 함수로 둔다. 처음에는 좋은 장면을 노리다가, 그런
 * 장면이 오지 않으면 기대를 낮추고, 끝에는 **지금까지 본 것 중 가장 나은 한 장**을 그냥 찍는다.
 * 마지막 칸의 목표가 0이라는 것이 이 표의 핵심이다 — 자동 촬영은 반드시 끝난다.
 *
 * 대신 그렇게 찍힌 사진은 'fallback'으로 표시되어 신뢰도에서 그 사실을 말한다(scoreConfidence).
 * 막지 않기로 한 이상, 낮은 품질은 숨기는 것이 아니라 기록하는 쪽이 옳다.
 */
const SHUTTER_TARGETS: readonly { until: number; target: number }[] = [
  { until: 4000, target: GATE.autoShutterSoftScore }, // 0.70 — 좋은 장면을 노린다
  { until: 7000, target: 0.55 },
  { until: 10000, target: 0.4 },
  { until: Infinity, target: 0 }, // 그때까지 중 최선을 채택 (capturePath='fallback')
];

/**
 * 화면에 부위가 들어온 뒤 자동 촬영을 아예 하지 않는 시간.
 *
 * 사용자가 카메라를 부위에 **갖다 대는 동작 자체**에 시간이 걸린다. 그 사이에도 피부는 이미
 * 화면에 들어와 있으므로, 조건만 보면 찍을 수 있는 프레임이 나온다 — 그리고 실제로 그렇게
 * 찍혔다. 사용자가 "여기를 찍겠다"고 자리를 잡기도 전에 촬영이 끝나 버리면, 자동 촬영이
 * 빠른 것이 아니라 **틀린 곳을 찍는 것**이다.
 *
 * 조건으로는 이 시간을 대신할 수 없다. 갖다 대는 도중에도 초점이 맞고 피부가 가득한 순간은
 * 얼마든지 있기 때문이다. 오직 시간만이 "아직 자리를 잡는 중"을 표현할 수 있다.
 */
const SETTLE_MS = 1800;
/**
 * 이 시간이 지나면 정지·초점 조건을 내려놓고 그때까지 중 최선을 찍는다.
 *
 * 아래 두 조건(멈췄는가·초점이 잡혔는가)은 자동 촬영을 다시 막을 수 있는 힘을 가진다.
 * 그래서 반드시 끝나는 지점이 함께 있어야 한다 — 이 값이 없으면 손떨림이 심한 사용자나
 * 초점이 잘 안 잡히는 환경에서 예전처럼 영영 안 찍히는 상태로 돌아간다.
 */
const AUTO_DEADLINE_MS = 10000;
/**
 * 후보로 담기 위한 최소 정지도.
 *
 * 정지를 점수로만 두었더니 **움직이는 중에 찍히는** 문제가 생겼다. 점수는 "그중 어느 것이
 * 나은가"는 말해도 "이건 아직 찍을 때가 아니다"는 말하지 못한다 — 움직이는 프레임만 있는
 * 구간에서는 움직이는 프레임이 이긴다. 그래서 담는 단계로 되돌린다.
 *
 * 0.95가 아니라 0.93인 것은 틱 주기가 900ms에서 450ms로 줄었기 때문이다. 비교 간격이 절반이면
 * 같은 손동작에도 상관도가 올라가므로, 같은 엄격도를 유지하려면 오히려 값을 낮춰야 한다.
 */
const CANDIDATE_STABILITY = 0.93;
/**
 * 이 아래로 떨어지면 **다른 장면으로 옮겨 가는 중**이라고 본다 (frameQuality의 STABILITY_FLOOR와 같은 값).
 *
 * 잔떨림과 자리 이동을 갈라야 하는 이유: 팔을 2초쯤 대고 있다가 다리로 옮기면, 그 사이 프레임은
 * 후보로 담기지 않지만 **팔에서 담아 둔 후보가 버퍼에 그대로 남아 있다.** 다리에서 멈추는
 * 순간 그중 하나가 최고점으로 뽑히면, 사용자는 다리를 겨누고 있는데 팔 사진이 찍힌다.
 * 그래서 이 선 아래로 떨어지면 모은 후보를 버리고 자리 잡는 시간도 처음부터 다시 준다.
 */
const SCENE_CHANGED_STABILITY = 0.8;
/**
 * 초점이 다 잡혔는지 — 이번 프레임의 선명도가 **이 구간에서 본 최고치**의 몇 배 이상인가.
 *
 * 절대 임계값(GATE.focusMin)으로는 이걸 판정할 수 없다. 그 값이 아직 캘리브레이션 전이라
 * 오토포커스가 도는 중의 흐릿한 프레임도 가볍게 넘기기 때문이다. 반면 "지금 이 장면에서
 * 도달했던 최고 선명도"는 기기·피사체·조명과 무관하게 항상 옳은 기준이다 — 초점이 맞았을 때
 * 어떤 값이 나오는지를 그 자리에서 직접 관측한 것이라서다.
 *
 * SETTLE_MS 동안 최고치가 먼저 쌓이고, 그 뒤부터 이 조건이 실제로 작동한다. 순서가 중요하다:
 * 최고치를 모으기 전에 이 조건을 걸면 첫 흐릿한 프레임이 스스로 기준이 되어 늘 통과한다.
 */
const FOCUS_SETTLED_RATIO = 0.8;
/**
 * 넓이를 재는 자리에서 자동 촬영이 넓이 자격에 붙들려 있을 때, 이만큼 지나면 화면에 말한다.
 *
 * 이 안내가 없으면 안 된다. 넓이 자격은 **마감(AUTO_DEADLINE_MS)이 지나도 풀리지 않는** 유일한
 * 조건이라, 얼굴이 제대로 안 담기면 자동 촬영이 정말로 영영 열리지 않는다. 그 상태에서 화면이
 * 아무 말도 하지 않으면 사용자는 앱이 고장 났다고 판단한다 — 실제로는 "얼굴을 더 담으면 넓이까지
 * 기록되고, 지금 이대로 찍고 싶으면 버튼을 누르면 된다"는 두 갈래가 다 열려 있는데도.
 */
const AREA_HINT_AFTER_MS = 4000;
/** 채택 후보로 들고 있는 최근 프레임 수 — 가장 좋은 한 장을 고르기 위한 창 */
const MAX_CANDIDATES = 5;
/**
 * 프리뷰 판정 주기.
 *
 * 900ms에서 내렸다. 정지 판정(stability)이 **직전 틱과의 비교**라 이 주기가 곧 비교 간격인데,
 * 0.9초 동안 근접 촬영에서 손이 가만히 있기를 기대하는 것은 무리였다 — 같은 손떨림이라도
 * 간격이 절반이면 상관도가 크게 올라간다. 덤으로 화면 반응과 촬영까지 걸리는 시간도 절반이 된다.
 */
const TICK_MS = 450;
/**
 * 판정용 한 컷을 이만큼 기다려도 안 오면 그 판은 포기한다.
 *
 * takePictureAsync가 영영 응답하지 않는 경우가 있는데(카메라가 아직 덜 살아난 순간에 부르면
 * 그렇다), 그러면 busy 플래그가 켜진 채로 남아 판정 루프가 통째로 멈춰 버린다. 한 판을 버리는
 * 건 다음 주기에 다시 찍으면 그만이라 값이 싸다.
 */
const FRAME_TIMEOUT_MS = 4000;

/** 약속이 제때 안 오면 거절로 끝낸다 — 걸린 채로 남는 것보다 실패가 낫다 */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} 응답 없음 (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 사진이 어디서 왔는지 — 리뷰 화면의 "다시" 버튼이 카메라로 갈지 앨범으로 갈지가 여기서 갈린다 */
type PhotoSource = 'camera' | 'album';

/**
 * 프레임 한 장을 재는 한 자리 — 자 검출 → 관심영역 → 품질 측정 → 판정 순서다.
 *
 * 이 순서인 이유: 자가 있는 자리에서는 품질도 **분석에 실제로 들어갈 영역**에서 재야 하기
 * 때문이다. 프레임 전체로 재면 뒤쪽 창문이 하얗게 날아갔다는 이유로 노출 게이트가 막고, 배경이
 * 넓다는 이유로 피부 게이트가 영영 안 열린다 — 정작 분석에 들어가는 것은 얼굴뿐인데도.
 *
 * 자를 못 찾으면 관심영역 없이 프레임 전체를 재고, 정렬 판정만 "찾지 못함"이 된다.
 */
async function analyzeFrame(
  image: SkImage,
  /** 이 자리가 무엇을 자로 쓰는지. null이면 넓이를 재지 않는 자리라 자를 찾지 않는다 */
  kind: ScaleKind | null,
  baseline?: Baseline,
  prevSignature?: Float32Array | null,
  /** 화면에 깔린 지난 사진의 구도 — 있으면 정렬 목표가 표준 도형이 아니라 그 사진이 된다 */
  ghostFraming?: ScaleFraming,
): Promise<{ evaluation: FrameEvaluation; scale: ScaleFrame | null; width: number; height: number }> {
  const width = image.width();
  const height = image.height();

  // 자 검출은 모델 추론(얼굴 128px 또는 몸통 224+256px)이고, 품질 측정은 픽셀 통계다 —
  // 성격이 달라 갈라 잰다. 넓이를 재지 않는 자리(바로 스캔)에서는 앞쪽이 통째로 없다.
  const scale = kind ? await spanAsync(`자 검출(${kind})`, () => detectScaleFrame(image, kind)) : null;
  const roi = scale ? roiOf(scale, width, height) : undefined;

  const metrics = span('품질 측정(픽셀 통계)', () => measureImageQuality(image, { roi }));
  const evaluation = evaluateFrame(
    metrics,
    baseline,
    prevSignature,
    kind
      ? {
          kind,
          frame: scale,
          imageWidth: width,
          imageHeight: height,
          /*
            고스트가 깔려 있으면 **그 사진의 구도가 목표**다. 화면에 지난 사진을 깔아 두고 맞추라고
            하면서 게이트는 표준 도형을 재면, 사용자가 눈으로 맞춘 바로 그 순간에 판정이 실패한다.
            고스트가 없으면(첫 촬영·못 읽은 경우) 예전처럼 표준 도형이 목표다.
          */
          framing: ghostFraming,
          reference: baseline?.scale,
        }
      : undefined,
  );
  return { evaluation, scale, width, height };
}

/** 촬영 후보 한 장. 품질 판정에 실패해도 사진은 살리므로 evaluation은 없을 수 있다. */
interface Candidate {
  uri: string;
  evaluation: FrameEvaluation | null;
  /** 이 프레임에서 찾은 자 — 분석 단계가 관심영역과 면적 정규화에 쓴다 */
  scale?: ScaleFrame | null;
}

type Phase = 'preview' | 'processing' | 'review';

/**
 * 품질을 재지 못한 촬영의 신뢰도.
 * 점수를 억지로 매기지 않고 중간값에 경고를 달아, 이 기록이 "측정되지 않았다"는 사실을 남긴다.
 */
const UNMEASURED_CONFIDENCE: SessionConfidence = {
  score: 50,
  tier: 'medium',
  breakdown: { focus: 0, exposure: 0, skin: 0, color: 0 },
  warnings: ['촬영 품질을 측정하지 못했어요 — 이 기록은 참고만 해주세요'],
  usable: true,
};

/**
 * 촬영 단계 — **자동 셔터는 반드시 열린다.** 조건은 "찍을지"가 아니라 "언제 찍을지"만 정한다.
 *
 * 예전에는 품질 셋(피부·초점·노출)과 정렬 넷이 **한 순간에 동시에** 참이어야 셔터가 열렸다.
 * 하나하나는 타당한 조건이었지만 곱이 문제였다 — 각각 80%씩 통과해도 아홉 개면 한 틱당 13%이고,
 * 그 위에 권장 점수 하한이 하나 더 있었다. 실기기에서 자동 촬영이 사실상 되지 않은 원인은
 * 임계값이 아니라 이 구조였다.
 *
 * 지금 구조는 이렇다:
 *
 *   · 막는 것 — SAFETY 셋뿐이다(피부 20% · 렌즈 가림 · 암흑). "피부 사진이 아닌 것"만 걸러낸다.
 *   · 기다리는 것 — 자리를 잡을 틈(SETTLE_MS) 동안은 아무리 좋은 프레임이 와도 찍지 않고,
 *     그 뒤로도 **멈췄고 초점이 잡힌** 프레임만 후보로 담는다. 이 둘은 점수로 대신할 수 없다 —
 *     점수는 "어느 것이 나은가"만 말하지 "아직 때가 아니다"를 말하지 못해서, 움직이는 프레임만
 *     있는 구간에서는 움직이는 프레임이 이겨 버린다(실제로 그렇게 찍혔다).
 *   · 고르는 것 — 담긴 후보 중 가장 좋은 한 장을 채택한다.
 *   · 언제 — 목표 점수가 시간에 따라 내려간다(SHUTTER_TARGETS). AUTO_DEADLINE_MS가 지나면
 *     정지·초점 조건까지 내려놓고 그때까지 중 최선을 찍는다.
 *
 * 예외가 하나 있다. **넓이를 재는 자리(얼굴)에서는 넓이까지 기록될 프레임만 자동으로 찍고,
 * 이 조건은 시간이 지나도 풀리지 않는다.** 다른 조건들과 성격이 다르기 때문이다 — 흔들림이나
 * 초점은 "조금 나쁜 사진"을 만들 뿐이지만, 얼굴이 덜 담긴 사진은 넓이 추이에서 통째로 빠진다.
 * 넓이를 보려고 얼굴을 등록한 사용자에게 "찍히긴 했는데 넓이는 없다"를 반복해 주는 것은
 * 자동 촬영이 제 일을 못 한 것이다. 그래서 그 자리에서는 자동 촬영이 끝나지 않을 수 있고,
 * 그렇기 때문에 붙들려 있다는 사실을 화면이 말한다(AREA_HINT_AFTER_MS) — 수동 셔터는 늘 열려 있다.
 *
 * 정렬(얼굴 가이드)도 셔터를 막지 않는다. 배율·위치·기울기는 넓이를 d·v로 나누는 순간 계산에서
 * 사라지므로 애초에 측정의 자격이 아니었고(evaluateAreaEligibility의 같은 주석), 기울기는 이제
 * 분석 단계에서 되돌린다(extractNormalizedRGB의 rotation). 가이드 도형은 유도용으로 남는다 —
 * 맞추면 더 좋은 사진이 되지만, 안 맞아도 찍힌다.
 *
 * 막던 것을 점수로 바꾼 대가는 신뢰도에서 치른다. 낮은 품질로 찍혔다는 사실, 목표에 못 미친 채
 * 시간이 다 되어 찍혔다는 사실이 전부 기록에 남는다(scoreConfidence의 capturePath).
 * 피부가 적게 담긴 사진은 분류 입력을 피부 쪽으로 좁혀(skinCropOf) 촬영이 아니라 후처리에서
 * 해결하고, 조명 차이는 게인으로 흡수한다(computeColorNormalization).
 *
 * 갤러리에서 고르는 길은 앞 단계(CaptureSourceScreen)에서 갈라진다. source='album'으로 들어오면
 * 카메라를 아예 켜지 않고 앨범만 연다 — 고를 사진에는 가이드가 낄 자리가 없기 때문이다.
 *
 * 기준 사진을 프리뷰에 겹쳐 보여주던 고스트는 걷어냈다 — 반투명하게 깔린 지난 사진이 지금 피부와
 * 섞여 보여서, 정작 무엇을 찍고 있는지 알아보기 어려웠다. 기준 사진은 촬영 뒤 확인 화면에서
 * 나란히 비교하는 쪽이 낫다 (조명 보정의 기준으로는 계속 쓰인다).
 *
 * 후처리는 사진을 다시 쓰지 않는다 — 조명 보정은 게인 숫자로만 남겨 분석 직전 텐서에 적용하고,
 * 사용자가 보는 기록은 찍은 그대로다. 품질 판정이 실패해도 사진은 그대로 살려서 결과로 넘어간다.
 */
export default function MonitorCaptureScreen({
  target,
  source: initialSource,
  measureArea = true,
  ghostUri,
  onCancel,
  onComplete,
}: {
  target: MonitorTarget;
  /** 앞 단계(촬영 방법)에서 고른 방식 — 'album'이면 카메라를 켜지 않고 바로 갤러리를 연다 */
  source: PhotoSource;
  /**
   * 이 촬영에서 병변 넓이를 잴지. 기본은 잰다(부위가 허락하면).
   *
   * 부위만으로 판단할 수 없는 경우가 하나 있어서 밖에서 받는다 — 바로 스캔은 기록으로 남지 않아
   * 견줄 회차가 영영 없는데, 임시 대상의 부위는 다른 자리로 잡혀 있다.
   */
  measureArea?: boolean;
  /**
   * 프리뷰에 반투명하게 깔 지난 사진 — **이어서 기록할 때 그 폴더의 첫 사진**이다.
   *
   * 첫 사진을 쓰는 것이 중요하다. 매번 직전 사진을 목표로 삼으면 회차마다 허용 오차만큼 밀린
   * 구도가 다음 목표가 되어 서서히 흘러간다(drift). 첫 사진 하나로 고정하면 모든 회차가 같은
   * 자리로 수렴한다.
   */
  ghostUri?: string | null;
  onCancel: () => void;
  /** 후처리까지 끝난 사진을 상위 흐름(분석·기록 저장)으로 넘긴다 */
  onComplete: (processedUri: string, session: MonitorSession) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('preview');
  const [live, setLive] = useState<FrameEvaluation | null>(null);
  /**
   * 가이드 박스·셔터의 "조건 충족" 표시. live.hardPass를 그대로 쓰면 경계선에 걸친 프레임에서
   * 0.9초마다 초록↔흰색이 뒤집혀 깜빡인다. 켜질 때는 바로, 꺼질 때는 두 번 연속 실패해야
   * 꺼지도록 비대칭 히스테리시스를 준다.
   */
  const [armed, setArmed] = useState(false);
  /** 판정 루프가 계속 실패할 때 그 사실을 화면에 드러낸다 — 조용히 멈춰 있는 것이 제일 나쁘다 */
  const [liveError, setLiveError] = useState<string | null>(null);
  /**
   * 넓이 자격 때문에 자동 촬영이 한동안 열리지 않고 있는지.
   *
   * 이 조건은 시간이 지나도 풀리지 않으므로, 사용자에게 지금 무엇이 필요한지와
   * 그냥 찍는 길이 있다는 것을 함께 알려야 한다.
   */
  const [areaHeld, setAreaHeld] = useState(false);
  const missStreak = useRef(0);
  /** 직전 틱 프레임의 지문 — 화면이 멈췄는지는 프레임 사이에만 있는 정보라 여기 들고 있어야 한다 */
  const prevSig = useRef<Float32Array | null>(null);
  /** 등·목 뒤처럼 혼자 찍기 어려운 자리는 전면 카메라로 거울처럼 보며 찍는다 */
  const [facing, setFacing] = useState<CameraType>('back');
  /**
   * 네이티브 카메라가 다 살아났는지. 이게 켜지기 전에 takePictureAsync를 부르면 안 된다
   * (expo-camera 문서도 onCameraReady를 기다리라고 못박아 두고 있다) — 처음 들어왔을 때
   * 판정 루프가 통째로 죽어 있던 원인이 이것이었다.
   */
  const [cameraReady, setCameraReady] = useState(false);
  const [session, setSession] = useState<MonitorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 이번 사진의 출처 — 리뷰 화면이 "다시 촬영"과 "앨범에서 다시 고르기"를 갈라 보여준다 */
  const [source, setSource] = useState<PhotoSource>(initialSource);
  /**
   * 지금 어느 방식으로 찍고 있는지. 보통은 앞 단계에서 고른 그대로지만, 앨범 사진이 계속
   * 품질에 걸릴 때 확인 화면에서 카메라로 갈아탈 수 있어서 여기서 따로 들고 있는다.
   */
  const [mode, setMode] = useState<PhotoSource>(initialSource);
  /** 품질을 재지 못한 사유. 조용히 50점 기록으로 남기지 않고 리뷰 화면에 드러낸다 */
  const [measureError, setMeasureError] = useState<string | null>(null);
  /** 음성 안내 — 조용한 곳에서 찍을 때를 위해 끌 수 있다 */
  const [soundOn, setSoundOn] = useState(true);
  /**
   * 프리뷰에 깔린 지난 사진과 그 구도. 자를 읽지 못하면 null이고, 그때는 표준 가이드로 돌아간다.
   *
   * 구도를 못 읽은 사진을 그림만 깔아 두면 **사용자는 눈대중으로 맞추는데 게이트는 다른 자리를
   * 잰다.** 그래서 그림과 목표는 언제나 함께 오거나 함께 없다.
   */
  const [ghost, setGhost] = useState<ScaleGhost | null>(null);
  /**
   * 고스트를 화면에 겹칠지. **끌 수 있어야 한다** — 이 앱이 예전에 고스트를 통째로 걷어낸 이유가
   * "반투명하게 깔린 지난 사진이 지금 피부와 섞여 보여서 무엇을 찍는지 알아보기 어렵다"였다.
   * 옅게 깔고 끌 수 있게 두면 그 문제는 사용자가 그 자리에서 해결할 수 있다.
   */
  const [ghostOn, setGhostOn] = useState(true);

  /**
   * 판정 결과 안내는 화면 대신 소리로 나간다. 매 틱마다 부르지만 같은 말을 반복하지 않도록
   * 거르는 건 useCaptureVoice 쪽이 맡는다.
   */
  const speakGuide = useCaptureVoice(soundOn && mode === 'camera' && phase === 'preview');
  useEffect(() => {
    speakGuide(liveError ? '자동 판정이 멈췄어요. 아래 버튼을 눌러 직접 촬영해주세요' : live?.hint);
  }, [live, liveError, speakGuide]);

  const cameraRef = useRef<CameraView>(null);
  const candidates = useRef<Candidate[]>([]);
  const windowStart = useRef<number | null>(null);
  /** 지금 구간에서 도달한 최고 선명도 — 초점이 아직 오르는 중인지 판정하는 기준 (FOCUS_SETTLED_RATIO) */
  const bestSharpness = useRef(0);
  /** 넓이 자격 때문에 자동 촬영이 붙들리기 시작한 시각 — 오래 끌면 화면에 알린다 */
  const areaBlockedSince = useRef<number | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const { addSession } = useMonitoring();

  const baseline = target.baseline;

  /**
   * 검출 모델을 쓸 수 없다고 판명됐는지 (웹 미리보기, 번들 누락, 출력 규격 불일치).
   *
   * 상태로 들고 있어야 하는 이유: 모델 로딩 실패는 렌더 중이 아니라 나중에 드러난다. 그때
   * 화면이 다시 그려지지 않으면 자 측정이 켜진 채로 남아 — 검출은 매번 실패하므로 —
   * "보이지 않아요"만 띄우며 자동 셔터가 영영 열리지 않는다. 기능 하나가 없는 것과 촬영이
   * 막히는 것은 무게가 전혀 다른 실패다.
   */
  const [scaleBroken, setScaleBroken] = useState(false);
  /**
   * 이 자리에서 정렬·면적 측정을 무엇을 자로 삼아 켤지 (지금은 얼굴 / 안 켬).
   * 모델을 못 불러오면 조용히 예전 그대로 동작한다 — 넓이 기능이 없다고 촬영이 막히면 안 된다.
   */
  const scaleKind: ScaleKind | null =
    DUMP_RESULTS || scaleBroken || !measureArea ? null : scaleKindOf(target.part);
  /** 마지막 판정 프레임의 크기 — 화면 가이드를 프레임 좌표와 맞추는 데 쓴다 */
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  /*
    이어서 기록할 때 넘어온 첫 사진에서 구도를 읽어 둔다 — 그림을 깔고 정렬 목표로도 쓴다.
    넓이를 재는 자리(얼굴·몸통)에서만 의미가 있다: 자가 없으면 구도를 잴 방법이 없고,
    맞출 목표 없이 사진만 깔면 화면과 판정이 서로 다른 곳을 가리키게 된다.
  */
  useEffect(() => {
    if (!ghostUri || !scaleKind) {
      setGhost(null);
      return;
    }
    let alive = true;
    buildScaleGhost(ghostUri, scaleKind).then((g) => {
      if (alive) setGhost(g);
    });
    return () => {
      alive = false;
    };
  }, [ghostUri, scaleKind]);

  // 넓이를 재는 자리에 들어오면 검출 모델을 미리 올려 둔다 — 첫 틱이 모델 로딩을 기다리지 않도록.
  // 못 올리면 그 자리에서 자 측정을 끈다 (실패를 판정 루프까지 끌고 가지 않는다).
  useEffect(() => {
    if (!scaleKind) return;
    preloadScaleModel(scaleKind).then(() => {
      if (!isScaleAvailable(scaleKind)) setScaleBroken(true);
    });
  }, [scaleKind]);

  /**
   * 고른 사진을 이번 세션으로 확정한다. 여기서는 실패할 수 있는 일을 하지 않는다 —
   * 촬영을 마친 뒤에 흐름이 막히는 일이 없어야 하기 때문이다.
   */
  const finalize = useCallback(
    (
      chosen: Candidate,
      capturePath: CapturePath,
      /**
       * 넓이 자격을 판정할 때 쓸 판정 결과 — 방향을 바로잡은 이미지에서 다시 잰 것이다.
       *
       * 품질 점수(chosen.evaluation)와 갈라 두는 이유: 그쪽은 여러 후보 중 이 한 장을 고른
       * 근거이고 정지도(직전 프레임과의 비교)를 담고 있어서, 한 장만 다시 재면 그 정보가
       * 사라진다. 반대로 넓이 자격은 **좌표가 맞는 이미지**에서 재야만 의미가 있다.
       * 없으면 예전처럼 촬영 프레임의 판정을 그대로 쓴다.
       */
      areaEval?: FrameEvaluation,
    ) => {
      const sessionId = newId('sess');
      // 조명 보정 게인 — 사진은 그대로 두고, 분석 모델에 넣을 때만 적용한다
      const colorNorm: ColorNormalization = chosen.evaluation
        ? computeColorNormalization(chosen.evaluation.metrics, baseline)
        : IDENTITY_COLOR_NORM;

      const confidence = DUMP_RESULTS
        ? makeDumpConfidence(sessionId)
        : chosen.evaluation
          ? scoreConfidence(chosen.evaluation, colorNorm, baseline, capturePath)
          : UNMEASURED_CONFIDENCE;

      /*
        넓이를 회차 간 비교해도 되는 촬영인지는 여기서 확정한다 — 정렬·조명은 촬영 시점의
        정보라 나중에 사진만 보고는 알 수 없다. 넓이를 재는 자리가 아니면 아예 판단하지 않는다.
      */
      const forArea = areaEval ?? chosen.evaluation;
      const areaEligible = scaleKind && forArea ? evaluateAreaEligibility(forArea, baseline) : undefined;

      const created: MonitorSession = {
        id: sessionId,
        targetId: target.id,
        capturedAt: new Date(),
        rawUri: chosen.uri,
        // 촬영본이 곧 기록 사진이다 — 후처리는 픽셀이 아니라 게인으로만 남는다
        processedUri: chosen.uri,
        confidence,
        softScore: chosen.evaluation?.softScore ?? 0,
        capturePath,
        colorNorm,
        scale: chosen.scale ?? undefined,
        areaEligible,
      };

      addSession(
        created,
        DUMP_RESULTS
          ? makeDumpBaseline(sessionId, chosen.uri)
          : chosen.evaluation
            ? baselineFromCapture(sessionId, chosen.uri, chosen.evaluation.metrics, {
                scale: chosen.scale,
                facing: scaleKind ? facing : undefined,
                // 이 사진에 부위가 담긴 정도 — 다음 회차가 맞춰야 할 구도의 기준이 된다
                covered: areaEligible?.covered,
                /*
                  이 사진의 촬영 배율 — 몸통에서 다음 회차가 맞춰야 할 거리의 기준이다.
                  넓이 자격 판정과 같은 프레임에서 재야 하므로 forArea의 frameSize를 쓴다.
                */
                sOfMinSide:
                  chosen.scale && forArea && forArea.frameSize.width > 0
                    ? chosen.scale.s / Math.min(forArea.frameSize.width, forArea.frameSize.height)
                    : undefined,
              })
            : undefined,
      );
      setSession(created);
      setPhase('review');
      // 확인 화면이 뜨는 지점 = 첫 번째 기다림의 끝. 다음 기다림(분석)은 "계속"을 누른 뒤다.
      endProfile({ 자: chosen.scale ? scaleKind : '없음', 경로: capturePath, 신뢰도: confidence.score });
    },
    [addSession, baseline, scaleKind, facing, target.id],
  );

  /**
   * 사진 한 장(수동 셔터 또는 앨범)을 이번 세션으로 확정한다.
   * 자동 촬영 루프가 끼어들지 못하도록 먼저 멈추고, 품질 판정이 실패해도 사진은 그대로 살린다.
   */
  const commitPhoto = useCallback(
    async (rawUri: string, src: PhotoSource) => {
      cancelled.current = true;
      setSource(src);
      setError(null);
      setMeasureError(null);
      setPhase('processing');
      /*
        사진 한 장이 파이프라인에 들어오는 지점. 여기부터 확인 화면이 뜰 때까지가 첫 번째 기다림이고,
        그 뒤 "계속"을 누르면 두 번째 기다림(분석)이 시작된다 — 사이에 사람이 버튼을 누르는 시간이
        끼므로 하나의 총합으로 재면 안 되고, 계측도 둘로 갈라 둔다.
      */
      startProfile(`촬영 후처리 (${src === 'album' ? '앨범' : '카메라'})`);
      note(scaleKind ? `자=${scaleKind}` : '자 없음(넓이 미측정)');
      // 방향을 먼저 바로잡는다 — 이 uri가 곧 기록 사진이자 분석 입력이다
      const uri = await spanAsync('EXIF 방향 보정(재인코딩)', () => normalizeOrientation(rawUri));
      let evaluation: FrameEvaluation | null = null;
      let scale: ScaleFrame | null = null;
      if (!DUMP_RESULTS) {
        try {
          // 자를 함께 찾는다 — 이 값이 있어야 분석이 관심영역만 보고 넓이를 정규화할 수 있다
          const measured = await spanAsync('품질 판정 + 자 검출', () =>
            withSkImage(uri, async (img) => analyzeFrame(img, scaleKind, baseline, null, ghost?.framing)),
          );
          evaluation = measured.evaluation;
          scale = measured.scale;
        } catch (e: any) {
          // 품질을 못 재도 촬영 자체는 살린다 — 다만 왜 못 쟀는지는 남긴다.
          // 앨범 사진은 형식이 제각각(스크린샷·다운로드·특이한 컬러프로파일)이라 여기 걸리기 쉽고,
          // 조용히 삼키면 원인 모를 50점짜리 기록만 남는다.
          setMeasureError(humanError(e, '품질을 재지 못했어요'));
        }
      }
      finalize({ uri, evaluation, scale }, src === 'album' ? 'album' : 'manual');
    },
    [baseline, scaleKind, finalize, ghost],
  );

  const shootNow = useCallback(async () => {
    // 카메라가 다 뜨기 전에 누르면 응답이 오지 않는다 — 잠깐 뒤에 다시 누르면 된다
    const camera = cameraRef.current;
    if (!camera || !cameraReady) return;
    try {
      const photo = await withTimeout(
        camera.takePictureAsync({ quality: 0.9, shutterSound: false }),
        FRAME_TIMEOUT_MS,
        '카메라',
      );
      if (photo) await commitPhoto(photo.uri, 'camera');
    } catch (e: any) {
      setError(humanError(e, '사진을 찍지 못했어요'));
      setPhase('review');
    }
  }, [commitPhoto, cameraReady]);

  const pickFromAlbum = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    await commitPhoto(picked.assets[0].uri, 'album');
  }, [commitPhoto]);

  /**
   * 갤러리를 고르고 들어왔으면 화면을 띄우자마자 앨범을 연다 — 버튼을 한 번 더 누르게 할 이유가 없다.
   * 고르지 않고 닫으면 아래 안내 화면이 남아서 다시 열거나 뒤로 갈 수 있다 (그래서 한 번만 연다).
   */
  const albumOpened = useRef(false);
  useEffect(() => {
    if (mode !== 'album' || phase !== 'preview' || albumOpened.current) return;
    albumOpened.current = true;
    pickFromAlbum();
  }, [mode, phase, pickFromAlbum]);

  /**
   * 프리뷰(CameraView)는 phase가 'preview'일 때만 화면에 있다. 확인·처리 단계로 넘어갔다
   * 돌아오면 카메라가 새로 붙으므로, 준비 신호도 그때마다 다시 받아야 한다.
   */
  useEffect(() => {
    if (phase !== 'preview') setCameraReady(false);
  }, [phase]);

  /** 프리뷰를 주기적으로 찍어 품질을 판정하고, 조건이 되면 자동으로 확정한다 */
  useEffect(() => {
    // dump 모드에서는 판정할 모델이 없으므로 자동 셔터 루프를 아예 돌리지 않는다 (수동 촬영·앨범만 쓴다)
    if (DUMP_RESULTS) return;
    if (mode !== 'camera') return; // 갤러리에서 고르는 흐름에는 판정할 프리뷰가 없다
    if (phase !== 'preview' || !permission?.granted) return;
    // 카메라가 다 살아난 뒤에 시작한다 — 그 전에 찍으면 응답이 오지 않아 루프가 멈춰 버린다
    if (!cameraReady) return;
    cancelled.current = false;
    // 카메라를 바꾸면 이전 카메라로 모아 둔 후보는 버린다
    candidates.current = [];
    windowStart.current = null;
    bestSharpness.current = 0;
    areaBlockedSince.current = null;
    missStreak.current = 0;
    setAreaHeld(false);
    prevSig.current = null;
    setArmed(false);
    setLiveError(null);

    const tick = async () => {
      if (busy.current || cancelled.current) return;
      busy.current = true;
      try {
        const camera = cameraRef.current;
        if (!camera) return;
        /*
          판정 프레임을 항상 기록용 화질로 찍는다.

          예전에는 조건을 통과하기 전까지 0.4로 찍다가 통과한 뒤에만 0.85로 올렸다 — 채택될 수
          있는 프레임이 그때부터였기 때문이다. 지금은 **safe인 프레임이면 무엇이든 채택될 수
          있으므로** 그 구분이 성립하지 않는다. 낮은 화질로 찍은 판정용 프레임이 그대로 기록
          사진이 되는 일만은 없어야 한다.
        */
        const photo = await withTimeout(
          camera.takePictureAsync({ quality: 0.85, skipProcessing: true, shutterSound: false }),
          FRAME_TIMEOUT_MS,
          '카메라',
        );
        if (!photo || cancelled.current) return;

        /*
          피부·초점·노출 게이트는 모델을 쓰지 않으므로 픽셀만 읽으면 된다 (예전에는 매 틱
          512×512 세그 추론이 돌았지만 그 게이트는 걷어냈다). 넓이를 재는 자리에서만 128px 얼굴
          검출이 하나 붙는데, 걷어낸 세그와 비교하면 입력이 16분의 1이라 틱 주기에 부담이 없다.
        */
        const prev = prevSig.current;
        const measured = await withSkImage(photo.uri, (img) =>
          analyzeFrame(img, scaleKind, baseline, prev, ghost?.framing),
        );
        const { evaluation } = measured;
        prevSig.current = evaluation.metrics.signature;
        if (cancelled.current) return;
        // 모델이 도중에 못 쓰게 됐으면(출력 규격 불일치 등) 여기서 알아채고 자 측정을 끈다
        if (scaleKind && !isScaleAvailable(scaleKind)) setScaleBroken(true);
        setFrameSize((f) =>
          f.w === measured.width && f.h === measured.height ? f : { w: measured.width, h: measured.height },
        );
        setLive(evaluation);
        setLiveError(null);

        // 비교할 직전 프레임이 없으면 정지 여부를 판정할 수 없다 —
        // 첫 틱만으로 자동 촬영이 나가는 일이 없도록 이번 판은 표시만 하고 넘긴다
        if (!prev) return;

        /*
          화면의 초록 표시. **셔터가 열렸다는 뜻이 아니다** — 셔터는 safe이기만 하면 이미 열려
          있다. 이건 "지금 찍으면 좋은 사진"이라는 표시라, 품질과 정렬을 모두 본다. 사용자가
          자세를 맞추는 데 쓰는 신호는 여전히 필요하고, 다만 그것이 촬영의 전제조건은 아니다.
        */
        const good = evaluation.hardPass && (evaluation.align?.ok ?? true);
        if (good) {
          missStreak.current = 0;
          setArmed(true);
        } else if (++missStreak.current >= 2) {
          setArmed(false);
        }

        /*
          촬영할 수 없는 프레임이면 여태 모은 것을 버리고 시계도 되돌린다.

          시계를 되돌리는 것이 중요하다. 목표 점수는 기다린 시간에 따라 내려가는데, 그 시간이
          **찍을 수 있는 상태로 버틴 시간**이 아니라 화면에 들어온 뒤의 절대 시간이면 이런 일이
          생긴다: 카메라를 켠 채 10초 동안 딴 데를 보다가 피부에 갖다 대는 순간, 목표는 이미
          0으로 내려가 있어서 **첫 프레임이 그대로 찍힌다.** 사용자는 자세를 잡을 새도 없었는데
          앱은 "충분히 기다렸다"고 판단한 것이다. 모아 둔 후보도 다른 장면이라 쓸 수 없다.
        */
        if (!evaluation.safe) {
          candidates.current = [];
          windowStart.current = null;
          bestSharpness.current = 0;
          areaBlockedSince.current = null;
          setAreaHeld(false);
          return;
        }
        // 다른 자리로 옮겨 가는 중이면 여태 모은 것은 **다른 부위의 사진**이라 쓸 수 없다.
        // 초점 기준도 그 자리의 것이므로 함께 버리고, 자리 잡는 시간을 처음부터 다시 준다.
        if (evaluation.stability < SCENE_CHANGED_STABILITY) {
          candidates.current = [];
          windowStart.current = null;
          bestSharpness.current = 0;
          return;
        }

        if (windowStart.current == null) windowStart.current = Date.now();
        // 이 구간에서 도달한 최고 선명도 — 초점이 다 잡혔는지를 재는 자기 자신의 기준이 된다
        bestSharpness.current = Math.max(bestSharpness.current, evaluation.metrics.sharpness);

        const elapsed = Date.now() - windowStart.current;
        const pastDeadline = elapsed >= AUTO_DEADLINE_MS;

        /*
          아직 찍을 때가 아닌 프레임은 후보로도 담지 않는다.

          점수만으로는 이걸 표현할 수 없다 — 움직이는 프레임밖에 없는 구간에서는 움직이는
          프레임이 이기고, 그게 그대로 채택된다. "부위에 갖다 대는 중"과 "초점이 도는 중"은
          더 나은 후보를 고를 문제가 아니라 **아직 기다릴 문제**다.

          다만 이 둘은 자동 촬영을 다시 막을 수 있으므로, 마감 뒤에는 내려놓는다.
        */
        const still = evaluation.stability >= CANDIDATE_STABILITY;
        const focusSettled = evaluation.metrics.sharpness >= bestSharpness.current * FOCUS_SETTLED_RATIO;
        if (!pastDeadline && !(still && focusSettled)) return;

        /*
          넓이를 재는 자리(지금은 얼굴)에서는 **넓이까지 기록될 프레임만** 자동으로 찍는다.

          이 조건만은 마감이 지나도 풀리지 않는다. 다른 조건들과 성격이 다르기 때문이다 —
          흔들림이나 초점은 "조금 나쁜 사진"을 만들 뿐이라 그럴 바엔 찍는 게 낫지만, 얼굴이
          덜 담긴 사진은 **넓이 추이에서 통째로 빠진다.** 넓이를 보려고 얼굴을 등록한 사용자에게
          "찍히긴 했는데 넓이는 없다"를 반복해서 주는 것은 자동 촬영이 일을 안 한 것이다.

          대신 두 가지를 반드시 함께 둔다: 수동 셔터는 언제나 열려 있고, 이 조건에 붙들려 있다는
          사실을 화면이 말한다(AREA_HINT_AFTER_MS). 그러지 않으면 조용히 멈춘 앱이 된다.

          ⚠️ 여기서 보는 프레임은 EXIF 방향이 반영되기 전이라, 최종 판정(방향을 바로잡은 뒤 다시
             재는 것)과 covered가 조금 다를 수 있다. 이건 어디까지나 **미리보기 판정**이고,
             기록에 남는 자격은 finalize가 정한다.
        */
        const areaReady =
          !scaleKind || evaluateAreaEligibility(evaluation, baseline, { quiet: true }).ok;
        if (!areaReady) {
          if (areaBlockedSince.current == null) areaBlockedSince.current = Date.now();
          if (Date.now() - areaBlockedSince.current >= AREA_HINT_AFTER_MS) setAreaHeld(true);
          return;
        }
        areaBlockedSince.current = null;
        setAreaHeld(false);

        candidates.current.push({ uri: photo.uri, evaluation, scale: measured.scale });
        // 최근 것만 들고 있는다 — 오래된 프레임은 지금 사용자가 잡고 있는 자세와 다르다
        if (candidates.current.length > MAX_CANDIDATES) candidates.current.shift();

        // 자리를 잡을 틈. 이 시간 안에는 아무리 좋은 프레임이 와도 찍지 않는다 —
        // 갖다 대는 도중에도 좋은 프레임은 나오고, 그건 사용자가 겨냥한 자리가 아니다.
        if (elapsed < SETTLE_MS) return;

        const target = SHUTTER_TARGETS.find((t) => elapsed < t.until)?.target ?? 0;

        const softOf = (c: Candidate) => c.evaluation?.softScore ?? 0;
        const best = candidates.current.reduce((a, b) => (softOf(b) > softOf(a) ? b : a));
        // 아주 좋은 장면은 목표와 무관하게 즉시 확정한다 — 더 기다려서 나아질 것이 없다
        const excellent = softOf(best) >= GATE.excellentSoftScore;
        if (!excellent && softOf(best) < target) return;

        cancelled.current = true;
        setSource('camera');
        setPhase('processing');
        // 판정 프레임은 skipProcessing으로 찍어 EXIF 방향이 반영돼 있지 않다.
        // 채택이 확정된 이 한 장만 바로잡는다 (매 프레임 하면 너무 비싸다).
        const uri = await normalizeOrientation(best.uri);

        /*
          방향을 바로잡은 **뒤에** 자를 다시 찾는다.

          판정 루프가 보는 프레임은 EXIF 방향이 픽셀에 반영되기 전이라, 세로로 든 폰에서는
          가로로 누워 있다(Skia는 EXIF를 적용하지 않는다). 그 상태에서 찾은 얼굴 좌표를 방향이
          바로잡힌 사진에 그대로 쓰면 **ROI가 90° 어긋난 자리에 놓인다** — 분석은 얼굴이 아닌
          곳을 잘라 보고, 넓이 자격도 엉뚱한 프레임 크기로 판정된다. 수동 촬영 경로가 멀쩡했던
          것은 그쪽이 방향을 먼저 바로잡고 재기 때문이다(commitPhoto). 이제 두 경로가 같아진다.

          다시 재지 못하면 예전 값을 그대로 쓴다 — 좌표가 어긋날 수는 있어도, 여기서 실패로
          되돌리면 방금 찍은 사진이 통째로 사라진다.
        */
        let scale = best.scale;
        let areaEval: FrameEvaluation | undefined;
        if (scaleKind) {
          try {
            const aligned = await withSkImage(uri, (img) =>
              analyzeFrame(img, scaleKind, baseline, null, ghost?.framing),
            );
            scale = aligned.scale;
            areaEval = aligned.evaluation;
          } catch (e: any) {
            console.warn('[capture] 방향 보정 뒤 자를 다시 찾지 못했어요', e?.message ?? e);
          }
        }

        /*
          'fallback'은 **채택된 사진이 원래 노리던 품질에 못 미친다**는 뜻이다. 경과 시간으로
          가르지 않는다 — 8초쯤 걸렸어도 마지막에 좋은 장면이 잡혔다면 그건 정상 촬영이고,
          그 사진에 낮은 신뢰도를 씌우면 기록이 사실과 달라진다.
        */
        finalize(
          { ...best, uri, scale },
          softOf(best) < GATE.autoShutterSoftScore ? 'fallback' : 'auto',
          areaEval,
        );
      } catch (e: any) {
        // 한 프레임 실패는 다음 주기에 다시 시도하지만, 조용히 삼키지는 않는다.
        // 예전에는 여기서 통째로 삼켜서 — Skia 서피스 고갈처럼 계속 실패하는 상황일 때
        // 판정 패널이 영영 멈춰 있는데도 아무 단서가 남지 않았다.
        // 화면에는 한 줄만 — 프리뷰 위에 자바 스택이 뜨면 카메라가 통째로 가려진다 (errorText.ts)
        if (!cancelled.current) setLiveError(humanError(e, '판정을 하지 못했어요'));
      } finally {
        busy.current = false;
      }
    };

    const id = setInterval(tick, TICK_MS);
    tick();
    return () => {
      cancelled.current = true;
      clearInterval(id);
    };
  }, [mode, phase, permission?.granted, cameraReady, facing, baseline, scaleKind, finalize, ghost]);

  /** 확인 화면에서 다시 찍기 — 앨범으로 들어왔더라도 여기서는 카메라로 갈아탄다 */
  const retake = () => {
    setMode('camera');
    candidates.current = [];
    windowStart.current = null;
    bestSharpness.current = 0;
    areaBlockedSince.current = null;
    cancelled.current = false;
    missStreak.current = 0;
    setAreaHeld(false);
    prevSig.current = null;
    setArmed(false);
    setLiveError(null);
    setMeasureError(null);
    setSession(null);
    setError(null);
    setLive(null);
    setPhase('preview');
  };

  if (phase === 'processing') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={AppColors.greenTop} />
        <View style={{ height: 16 }} />
        <Text style={styles.processingTitle}>사진을 확인하는 중...</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.processingSub}>촬영 품질을 재고 있어요</Text>
      </View>
    );
  }

  if (phase === 'review') {
    return (
      <ReviewView
        target={target}
        scaleKind={scaleKind}
        session={session}
        error={error}
        source={source}
        measureError={measureError}
        onPickAgain={pickFromAlbum}
        onRetake={retake}
        onContinue={() => session && onComplete(session.processedUri, session)}
      />
    );
  }

  /*
    갤러리에서 고르기 — 카메라를 켜지 않는다. 화면에 들어오면 앨범이 바로 열리고, 고르지 않고
    닫았을 때 남는 화면이 이것이다 (다시 열거나 뒤로 갈 수 있게).
  */
  if (mode === 'album') {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialIcons name="photo-library" size={40} color="rgba(255,255,255,0.7)" />
        <View style={{ height: 14 }} />
        <Text style={styles.permText}>갤러리에서 사진을 골라주세요</Text>
        <View style={{ height: 18 }} />
        <Pressable style={styles.primaryBtn} onPress={pickFromAlbum}>
          <Text style={styles.primaryBtnText}>갤러리 열기</Text>
        </Pressable>
        <View style={{ height: 12 }} />
        <Pressable style={styles.tertiaryBtn} onPress={() => setMode('camera')}>
          <Text style={styles.switchModeText}>카메라로 촬영하기</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onCancel}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    );
  }

  // 카메라 권한은 카메라로 찍을 때만 필요하다 (갤러리는 위에서 이미 끝난다)
  if (!permission?.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialIcons name="photo-camera" size={40} color="rgba(255,255,255,0.7)" />
        <View style={{ height: 14 }} />
        <Text style={styles.permText}>모니터링 촬영을 하려면{'\n'}카메라 접근 권한이 필요해요</Text>
        <View style={{ height: 18 }} />
        <Pressable style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>권한 허용하기</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onCancel}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
        {/*
          animateShutter는 기본값이 true라, 판정 루프가 0.9초마다 takePictureAsync를 부를 때마다
          셔터 애니메이션이 터져 화면이 계속 깜빡였다. 판정용 촬영은 사용자에게 "찍었다"고
          알릴 일이 없으므로 끈다 — 실제 촬영 피드백은 화면이 확인/결과 단계로 넘어가는 것으로 충분하다.
        */}
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          // 카메라를 못 띄우면 판정 루프도 영영 못 돈다 — 조용히 회색 막대만 두지 않고 알린다
          onMountError={(e: any) => setLiveError(humanError(e, '카메라를 열지 못했어요'))}
        />

        {/*
          넓이를 재는 자리에서만 나오는 가이드 도형.

          사용자가 맞춰야 하는 사각형이 곧 분석에 들어가는 영역이고, 정렬 게이트가 겨냥하는 목표도
          같은 자리다(둘 다 scaleFrame의 standardRoi를 쓴다) — 화면과 판정이 다른 곳을 보면
          "초록인데 왜 안 찍히지"가 된다.

          지난 사진을 반투명하게 깔던 고스트는 이 앱에서 걷어냈다(위 화면 주석). 그래서 목표는
          항상 이 표준 도형이고, 그만큼 정렬 게이트도 첫 사진의 구도가 아니라 표준 구도를 잰다.
        */}
        {/*
          지난 사진을 그대로 반투명하게 깐다. 잘라내거나 윤곽선을 뽑지 않는다 — 맞춰야 할 대상이
          지난 사진 그 자체이고, 화면에 보이는 그림과 게이트가 재는 대상이 같아야 한다
          (정렬 목표도 이 사진의 구도다 — 위 analyzeFrame의 ghostFraming).

          전면 카메라는 프리뷰가 좌우로 뒤집혀 보이므로 고스트도 같이 뒤집는다. 안 그러면
          거울에 비친 몸과 뒤집히지 않은 지난 사진을 맞추라고 요구하게 된다.
        */}
        {ghost && ghostOn && (
          <Image
            source={{ uri: ghost.uri }}
            style={[
              StyleSheet.absoluteFill,
              styles.ghost,
              facing === 'front' && { transform: [{ scaleX: -1 }] },
            ]}
            resizeMode="cover"
          />
        )}

        {/*
          가이드 도형은 고스트가 없을 때만 그린다. 둘을 함께 두면 맞출 목표가 둘이 되는데,
          정작 판정이 겨냥하는 것은 하나뿐이라 사용자는 반드시 틀린 쪽을 맞추게 된다.
        */}
        {scaleKind && !(ghost && ghostOn) && (
          <ScaleGuideOverlay
            kind={scaleKind}
            imageWidth={frameSize.w}
            imageHeight={frameSize.h}
            mirrored={facing === 'front'}
            ok={!!live?.align?.ok}
          />
        )}

        {/*
          매 틱 바뀌던 판정 안내는 소리로 옮겼다(useCaptureVoice). 여기는 촬영 내내 그대로인
          한 줄만 남긴다 — 계속 바뀌는 글은 카메라를 대고 있는 자세에서 어차피 읽히지 않는다.
        */}
        {/*
          넓이 자격에 붙들려 있으면 그 사실을 여기서 말한다 — 이 조건은 기다린다고 풀리지 않으므로
          **무엇을 하면 되는지**와 **그냥 찍는 길**을 함께 줘야 한다. 둘 중 하나만 주면,
          사용자는 영영 안 찍히는 화면 앞에서 기다리거나 넓이를 포기하게 된다.
        */}
        <Text style={[styles.hint, areaHeld && styles.hintHeld]}>
          {areaHeld
            ? `${scaleKind === 'face' ? '얼굴' : '양 어깨'}가 더 담겨야 넓이까지 기록돼요 — 조금 더 멀리서 잡거나, 아래 버튼을 눌러 그냥 찍어도 돼요`
            : ghost && ghostOn
              ? '지난 사진에 겹쳐 맞추면 넓이 변화를 정확히 볼 수 있어요'
              : scaleKind === 'face'
                ? '가이드에 얼굴을 맞추면 병변 넓이 변화까지 함께 볼 수 있어요'
                : scaleKind === 'torso'
                  ? '양 어깨가 들어오게 맞추면 병변 넓이 변화까지 함께 볼 수 있어요'
                  : '가이드라인에 맞춰 촬영하면 분석 정확도가 높아져요'}
        </Text>

        <Pressable style={styles.closeBtn} onPress={onCancel}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>

        {/* 음성 안내를 끄면 화면에는 막대만 남는다 — 조용해야 하는 자리를 위해 */}
        <Pressable style={[styles.soundBtn, soundOn && styles.soundBtnOn]} onPress={() => setSoundOn((v) => !v)}>
          <MaterialIcons name={soundOn ? 'volume-up' : 'volume-off'} size={16} color="#FFFFFF" />
          <Text style={styles.soundBtnText}>음성 {soundOn ? 'ON' : 'OFF'}</Text>
        </Pressable>

        {/*
          겹쳐 보기를 끌 수 있어야 한다 — 이 앱이 예전에 고스트를 통째로 걷어낸 이유가 바로
          "지난 사진이 지금 피부와 섞여 보여 무엇을 찍는지 알아보기 어렵다"였다. 끄면 가이드
          도형으로 돌아가고, 정렬 목표는 그대로 지난 사진의 구도를 유지한다.
        */}
        {ghost && (
          <Pressable
            style={[styles.ghostBtn, ghostOn && styles.soundBtnOn]}
            onPress={() => setGhostOn((v) => !v)}
          >
            <MaterialIcons name={ghostOn ? 'layers' : 'layers-clear'} size={16} color="#FFFFFF" />
            <Text style={styles.soundBtnText}>겹쳐 보기 {ghostOn ? 'ON' : 'OFF'}</Text>
          </Pressable>
        )}

        {/*
          필수 조건 셋을 이름표 + 막대로 보여준다. 채워진 정도가 "얼마나 왔는지",
          색이 "통과했는지"다. 개발용 원시 측정값(선명도·정지·채널포화 …)은 걷어냈다 —
          숫자는 사용자가 할 수 있는 일을 알려주지 못한다.
        */}
        {!DUMP_RESULTS && (
          <View style={styles.statusPanel}>
            {liveError && <Text style={styles.statusError}>판정 실패 · {liveError}</Text>}
            <View style={styles.gaugeRow}>
              <GateBar label="피부" value={live?.gauges.skin} ok={live?.hard.skin} />
              <GateBar label="초점" value={live?.gauges.focus} ok={live?.hard.focus} />
              <GateBar label="노출" value={live?.gauges.exposure} ok={live?.hard.exposure} />
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        {/*
          "조건이 맞으면 찍힌다"고 더 이상 말하지 않는다 — 사실이 아니게 됐고, 그 말은 사용자를
          기다리게 만든다. 지금 하는 일은 좋은 순간을 고르는 것뿐이라 그렇게만 말한다.
        */}
        <Text style={styles.bottomHint}>
          {armed
            ? '좋은 상태예요 — 잠깐 그대로 멈춰주세요'
            : '부위에 대고 잠깐 멈추면 자동으로 찍혀요. 직접 눌러도 돼요'}
        </Text>
        <View style={styles.bottomRow}>
          <Pressable
            style={styles.smallBtn}
            onPress={() => {
              // 카메라를 바꾸면 네이티브가 다시 올라온다 — 준비될 때까지 판정을 멈춘다
              setCameraReady(false);
              setFacing((f) => (f === 'back' ? 'front' : 'back'));
            }}
          >
            <MaterialIcons name="flip-camera-android" size={20} color="#FFFFFF" />
            <Text style={styles.smallBtnText}>{facing === 'back' ? '후면' : '전면'}</Text>
          </Pressable>
          {/* 조건이 맞으면 앱이 알아서 누르고, 그 전에도 직접 누를 수 있다 */}
          <Pressable
            style={[styles.shutter, armed && styles.shutterArmed, !cameraReady && styles.shutterWaiting]}
            onPress={shootNow}
            disabled={!cameraReady}
          >
            {/* 이 버튼이 하는 일은 늘 같다(직접 촬영) — 초록 테두리가 "지금 상태가 좋다"를 말한다.
                예전의 '자동 촬영' 문구는 버튼이 모드를 바꾸는 것처럼 읽혀서 걷어냈다. */}
            <Text style={[styles.shutterText, armed && styles.shutterTextArmed]}>
              {!cameraReady ? '준비 중' : '촬영'}
            </Text>
          </Pressable>
          {/* 오른쪽은 비워 둔다 — 셔터가 화면 가운데에 오도록 (앨범 버튼이 있던 자리) */}
          <View style={styles.smallBtnSpacer} />
        </View>
      </View>
    </View>
  );
}

/**
 * 필수 게이트 하나를 막대로. 채워진 정도는 "얼마나 왔는지", 색은 "통과했는지"다.
 * 아직 판정 전이면(value·ok 둘 다 없음) 회색으로 비워 둔다.
 *
 * 이름표는 남긴다 — 세 막대 중 어느 것이 모자란지는 이름이 있어야 알 수 있다.
 * 걷어낸 건 그 아래 붙어 있던 원시 측정값(선명도 0.586, 피부 65.9% …)뿐이다.
 */
function GateBar({ label, value, ok }: { label: string; value?: number; ok?: boolean }) {
  const v = value ?? 0;
  const color = ok == null ? 'rgba(255,255,255,0.3)' : ok ? AppColors.greenTop : AppColors.sev3;
  return (
    <View style={styles.gaugeItem}>
      <Text style={[styles.gaugeLabel, ok && styles.gaugeLabelOk]}>{label}</Text>
      <View style={styles.gaugeTrack}>
        <View style={[styles.gaugeFill, { width: `${Math.round(v * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

/**
 * 넓이가 빠진 이유별로 사용자가 할 수 있는 일 한 줄.
 *
 * **고칠 수 있는 것만 말한다.** 이유마다 손쓸 방법이 전혀 다른데 한 문장으로 뭉뚱그리면,
 * 사용자는 될 리 없는 일을 몇 번씩 반복하게 된다. (null이면 위 두 줄로 충분한 경우다)
 */
const AREA_ADVICE_FACE: Record<AreaRejectCode, string | null> = {
  noFace: '얼굴이 사진에 작게 나왔거나 다른 사람이 함께 찍혔으면 얼굴이 크게 나오도록 다시 찍어주세요.',
  // 이마 끝이 조금 잘린 정도는 이제 통과한다 — 여기 걸린 것은 볼이나 턱처럼 병변이 있는 살이
  // 상당히 빠진 사진이라, "조금 더 멀리"가 실제로 통하는 조언이다
  cropped: '조금 더 멀리서 얼굴이 더 많이 담기도록 찍어주세요 — 볼이나 턱이 빠지면 그쪽 병변이 빠집니다.',
  framingChanged: '지난번과 비슷한 거리에서 찍어주세요 — 담긴 정도가 달라지면 넓이가 변한 것처럼 보여요.',
  partialBody: null,
  pose: '정면을 보고 다시 찍어주세요 — 고개 각도는 사진을 고쳐서 되돌릴 수 없어요.',
  lighting: null,
};

const AREA_ADVICE_TORSO: Record<AreaRejectCode, string | null> = {
  noFace: '양 어깨가 화면에 들어오게 찍어주세요 — 몸통만 크게 담기면 사람을 못 찾을 수 있어요.',
  cropped: '조금 더 멀리서 몸통이 더 많이 담기도록 찍어주세요.',
  framingChanged: '지난번과 비슷한 거리에서 찍어주세요 — 담긴 정도가 달라지면 넓이가 변한 것처럼 보여요.',
  partialBody: '양 어깨가 화면 안에 들어오게 조금 더 멀리서 찍어주세요 — 골반까지는 필요 없어요.',
  pose: '몸을 정면으로 두고 다시 찍어주세요 — 튼 각도는 사진을 고쳐서 되돌릴 수 없어요.',
  lighting: null,
};

/**
 * 부위에 맞는 조언을 고른다.
 *
 * 예전에는 표 하나를 부위와 무관하게 썼다. 그래서 **몸통을 찍었는데 "얼굴이 크게 나오도록
 * 다시 찍어주세요"가 뜨고**, 사용자 눈에는 얼굴 로직이 그대로 돌고 있는 것처럼 보였다.
 * 판정 자체는 부위를 따라가고 있었는데 문구만 얼굴에 박혀 있었던 것이다 — 화면이 거짓말을 하면
 * 그 아래 무엇이 옳게 돌아가든 소용이 없다.
 */
function areaAdviceOf(code: AreaRejectCode, kind: ScaleKind | null): string | null {
  return (kind === 'torso' ? AREA_ADVICE_TORSO : AREA_ADVICE_FACE)[code];
}

function ReviewView({
  target,
  scaleKind,
  session,
  error,
  source,
  measureError,
  onPickAgain,
  onRetake,
  onContinue,
}: {
  target: MonitorTarget;
  /**
   * 이 자리가 무엇을 자로 쓰는지. **session.scale에서 읽으면 안 된다** — 그쪽은 자를 찾았을
   * 때만 채워지므로, 정작 조언이 가장 필요한 "자를 못 찾음"에서 언제나 비어 있다.
   */
  scaleKind: ScaleKind | null;
  session: MonitorSession | null;
  error: string | null;
  /** 앨범에서 고른 사진이면 "다시"의 목적지가 카메라가 아니라 앨범이어야 한다 */
  source: PhotoSource;
  /** 품질을 재지 못한 사유 (있으면 그대로 보여준다) */
  measureError: string | null;
  onPickAgain: () => void;
  onRetake: () => void;
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const fromAlbum = source === 'album';
  const againLabel = fromAlbum ? '앨범에서 다시 고르기' : '다시 촬영';
  const onAgain = fromAlbum ? onPickAgain : onRetake;
  // 사진을 아예 얻지 못한 경우(카메라/앨범 자체가 실패)만 여기로 온다 —
  // 판정이나 보정이 실패했다고 촬영이 막히지는 않는다.
  if (error || !session) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialIcons name="error-outline" size={36} color="#FF6B6B" />
        <View style={{ height: 12 }} />
        <Text style={styles.processingTitle}>사진을 가져오지 못했어요</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.processingSub}>{error ?? '다시 한 번 촬영해주세요'}</Text>
        <View style={{ height: 18 }} />
        <Pressable style={styles.primaryBtn} onPress={onRetake}>
          <Text style={styles.primaryBtnText}>다시 촬영</Text>
        </Pressable>
      </View>
    );
  }

  const { confidence } = session;

  return (
    <View style={[styles.reviewRoot, { paddingTop: insets.top + 14 }]}>
      <Text style={styles.reviewTitle}>{target.label}</Text>

      {/*
        제목과 아래 버튼 사이의 남는 자리를 이 덩어리가 다 차지하고, 사진을 그 한가운데 둔다.
        사진 한 장만 크게 보여주는 이유는 이 화면이 물을 것이 "이번 사진이 잘 나왔나" 하나뿐이기
        때문이다 — 지난 사진과의 비교는 경과 관찰 폴더에서 크게 볼 수 있다.
      */}
      <View style={styles.reviewBody}>
        <Image source={{ uri: session.processedUri }} style={styles.reviewImage} resizeMode="cover" />

        {measureError && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>• 이 사진은 품질을 측정하지 못했어요 ({measureError})</Text>
            <Text style={styles.warnText}>
              • {fromAlbum ? '다른 사진을 골라보시거나 직접 촬영해주세요' : '다시 촬영해주세요'}
            </Text>
          </View>
        )}

        {confidence.warnings.length > 0 && (
          <View style={styles.warnBox}>
            {confidence.warnings.map((w) => (
              <Text key={w} style={styles.warnText}>
                • {w}
              </Text>
            ))}
          </View>
        )}

        {/*
          넓이를 쟀는지 여부를 **양쪽 다** 말한다.

          못 쟀을 때만 말하면 사용자는 "말이 없으면 잘 된 것"인지 "원래 안 재는 것"인지 알 수
          없다. 특히 앨범에서 고른 사진은 가이드를 볼 기회가 없어 스스로 판단할 근거가 전혀 없다 —
          이 사진이 추세에 들어갔는지는 지금 이 화면에서만 알 수 있고, 나중에는 못 고친다.
        */}
        {session.areaEligible &&
          (session.areaEligible.ok ? (
            <Text style={styles.okText}>
              병변 넓이도 함께 기록돼요 — 지난 회차와 견줄 수 있어요
              {session.areaEligible.lowRes
                ? '\n(원본 해상도가 낮아 값이 조금 흔들릴 수 있어요)'
                : ''}
            </Text>
          ) : (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>• {session.areaEligible.reason}</Text>
              <Text style={styles.warnText}>
                • 이 사진의 등급·증상 판정은 그대로 기록돼요. 넓이 변화 그래프에서만 빠집니다.
              </Text>
              {session.areaEligible.code && areaAdviceOf(session.areaEligible.code, scaleKind) && (
                <Text style={styles.warnText}>
                  • {areaAdviceOf(session.areaEligible.code, scaleKind)}
                </Text>
              )}
            </View>
          ))}

        {/* 품질이 낮아도 진행은 막지 않는다 — 권하기만 하고 선택은 사용자에게 맡긴다 */}
        {!confidence.usable && (
          <Text style={styles.rejectText}>
            촬영 품질이 낮아요. {fromAlbum ? '다른 사진을 고르는' : '다시 촬영하는'} 걸 권해요.
          </Text>
        )}
      </View>

      <Pressable style={styles.primaryBtnLight} onPress={onContinue}>
        <Text style={styles.primaryBtnText}>이 사진으로 분석하기</Text>
      </Pressable>
      <View style={{ height: 10 }} />
      <Pressable style={styles.secondaryBtn} onPress={onAgain}>
        <Text style={styles.secondaryBtnText}>{againLabel}</Text>
      </Pressable>
      {/* 앨범 사진이 계속 게이트에 걸릴 때 카메라로 빠져나갈 길은 남겨 둔다 */}
      {fromAlbum && (
        <Pressable style={styles.tertiaryBtn} onPress={onRetake}>
          <Text style={styles.tertiaryBtnText}>카메라로 촬영하기</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14171C' },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  permText: { color: '#FFFFFF', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  primaryBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13 },
  primaryBtnLight: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#16320A' },
  secondaryBtn: { backgroundColor: '#F1F3F6', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  tertiaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  tertiaryBtnText: { fontSize: 14, fontWeight: '600', color: AppColors.sub },

  hint: {
    position: 'absolute',
    top: 70,
    left: 24,
    right: 24,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  /** 자동 촬영이 붙들려 있을 때 — 배경을 깔아 "지금 읽어야 하는 줄"로 만든다 */
  hintHeld: {
    backgroundColor: 'rgba(20,23,28,0.6)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    lineHeight: 20,
  },
  closeBtn: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    backgroundColor: 'rgba(20,23,28,0.55)',
    borderRadius: 16,
    padding: 12,
  },
  statusError: { color: AppColors.sev3, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  gaugeRow: { flexDirection: 'row' },
  gaugeItem: { flex: 1, marginHorizontal: 4 },
  gaugeLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginBottom: 5 },
  gaugeLabelOk: { color: '#FFFFFF' },
  gaugeTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  gaugeFill: { height: 6, borderRadius: 3 },

  /**
   * 지난 사진의 불투명도.
   *
   * 0.35에서 올렸다 — 그 정도로는 윤곽이 잘 안 보여 맞출 것이 없었다. 반대 방향의 실패도
   * 분명하다: 진하게 깔면 지금 피부가 안 보이고, 그것이 예전에 이 기능을 통째로 걷어내게 만든
   * 이유였다. 그래서 **끌 수 있게 해 둔 채로**(겹쳐 보기 ON/OFF) 겹쳐 맞출 만큼만 올린다.
   */
  ghost: { opacity: 0.62 },
  ghostBtn: {
    position: 'absolute',
    right: 16,
    top: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  soundBtn: {
    position: 'absolute',
    right: 16,
    top: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  soundBtnOn: { backgroundColor: 'rgba(147,210,88,0.35)' },
  soundBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  bottomBar: { height: 140, backgroundColor: '#14171C', justifyContent: 'center', paddingBottom: 6 },
  switchModeText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  bottomHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center', marginBottom: 10 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
  smallBtnSpacer: { width: 56, height: 56 },
  smallBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginTop: 2 },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  shutterArmed: { borderColor: AppColors.greenTop, backgroundColor: 'rgba(147,210,88,0.25)' },
  shutterWaiting: { opacity: 0.45 },
  shutterText: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.75)' },
  shutterTextArmed: { color: '#FFFFFF' },

  reviewRoot: { flex: 1, backgroundColor: AppColors.bg, padding: 20 },
  reviewTitle: { fontSize: 20, fontWeight: '800', color: AppColors.ink, textAlign: 'center' },
  reviewBody: { flex: 1, justifyContent: 'center' },
  reviewImage: { width: '100%', aspectRatio: 1, borderRadius: 20, backgroundColor: '#14171C' },
  warnBox: { marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14 },
  warnText: { fontSize: 13, color: AppColors.ink, lineHeight: 20 },
  rejectText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: AppColors.sev3, textAlign: 'center' },
  /** 넓이가 함께 기록됐다는 확인 — 경고와 같은 자리에 두되 색으로 성격을 가른다 */
  okText: { marginTop: 10, fontSize: 12.5, color: AppColors.greenMuted, lineHeight: 19, fontWeight: '600' },
  processingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  processingSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
});
