import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SkImage } from '@shopify/react-native-skia';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { AppColors } from '../theme';
import { useMonitoring } from '../context/MonitoringContext';
import { withSkImage } from '../ai/skiaPixels';
import { useImageAspect } from '../components/imageAspect';
import { normalizeOrientation } from '../ai/imageOrientation';
import { evaluateAreaEligibility, evaluateFrame, GATE, measureImageQuality } from '../monitoring/frameQuality';
import { useCaptureVoice } from '../monitoring/captureVoice';
import {
  baselineFromCapture,
  computeColorNormalization,
  IDENTITY_COLOR_NORM,
  newId,
  scoreConfidence,
} from '../monitoring/postProcess';
import {
  Baseline,
  ColorNormalization,
  FrameEvaluation,
  MonitorSession,
  MonitorTarget,
  SessionConfidence,
} from '../monitoring/types';
import { detectFace, isFaceDetectionAvailable, preloadFaceModel } from '../ai/faceDetector';
import { faceFrameOfDetection, faceRoiOf, type FaceFrame, type FaceFraming } from '../ai/faceFrame';
import { buildFaceGhost, type FaceGhost } from '../ai/faceGhost';
import FaceGuideOverlay from '../components/FaceGuideOverlay';
import { supportsAreaTracking } from '../monitoring/bodyParts';
import { getFolderByTarget } from '../folders/store';
import { DUMP_RESULTS, makeDumpBaseline, makeDumpConfidence } from '../exam/dumpAnalysis';

/** 필수 조건이 충족된 뒤, 더 나은 프레임을 노리며 기다리는 시간 */
const BEST_FRAME_WINDOW_MS = 1200;
/** 그 사이에 최대 몇 장까지 후보로 담을지 */
const MAX_CANDIDATES = 3;
/** 프리뷰 판정 주기 */
const TICK_MS = 900;
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

/**
 * 프레임 한 장을 재는 한 자리 — 얼굴 검출 → 관심영역 → 품질 측정 → 판정 순서다.
 *
 * 이 순서인 이유: 얼굴 자리에서는 품질도 **분석에 실제로 들어갈 영역**에서 재야 하기 때문이다.
 * 프레임 전체로 재면 뒤쪽 창문이 하얗게 날아갔다는 이유로 노출 게이트가 막고, 배경이 넓다는
 * 이유로 피부 게이트가 영영 안 열린다 — 정작 분석에 들어가는 것은 얼굴뿐인데도.
 *
 * 얼굴을 못 찾으면 관심영역 없이 예전 그대로 프레임 전체를 재고, 정렬 판정만 "얼굴 없음"이 된다.
 */
async function analyzeFrame(
  image: SkImage,
  faceMode: boolean,
  baseline?: Baseline,
  prevSignature?: Float32Array | null,
  /** 화면에 깔린 지난 사진의 구도 — 이번 촬영이 겨냥할 목표다 (없으면 표준 프레이밍) */
  framing?: FaceFraming,
): Promise<{ evaluation: FrameEvaluation; face: FaceFrame | null; width: number; height: number }> {
  const width = image.width();
  const height = image.height();

  const face = faceMode ? faceFrameOfDetection(await detectFace(image)) : null;
  const roi = face ? faceRoiOf(face, width, height) : undefined;

  const metrics = measureImageQuality(image, { roi });
  const evaluation = evaluateFrame(
    metrics,
    baseline,
    prevSignature,
    faceMode
      ? {
          frame: face,
          imageWidth: width,
          imageHeight: height,
          framing,
          // 자세(d/v)는 화면에 깔린 그 사진과 견준다 — 구도와 자세의 기준이 다른 사진이면
          // "고스트에 맞췄는데 자세가 틀렸다"는 말이 나올 수 있다
          reference: framing ?? baseline?.face,
        }
      : undefined,
  );
  return { evaluation, face, width, height };
}

/**
 * 이 자리의 경과 관찰 폴더에서 **첫** 촬영 사진.
 *
 * 폴더 기록은 앱을 껐다 켜도 남지만 baseline은 메모리에만 있어서(MonitoringContext 주석 참고),
 * 지난 얼굴을 보여주려면 여기까지 봐야 한다. 그것만 보면 고스트가 거의 뜨지 않는다 — 어제 찍고
 * 오늘 다시 들어온 사람이 정확히 그 경우다.
 *
 * 마지막이 아니라 첫 기록을 쓰는 이유: 이 사진의 구도가 곧 정렬 목표가 되기 때문이다. 매번 직전
 * 사진을 목표로 삼으면 회차마다 허용 오차(배율 ±20%, 위치 5%)만큼 밀린 구도가 다음 목표가 되어
 * 구도가 서서히 흘러간다. 목표를 첫 사진 하나로 고정하면 열 번째 촬영도 첫 사진과 견줄 수 있다.
 *
 * 폴더가 없거나(첫 촬영) 사진이 없으면 undefined.
 */
function baselineFolderPhoto(targetId: string): string | undefined {
  return getFolderByTarget(targetId)?.records?.[0]?.photo?.uri;
}

/** 사진이 어디서 왔는지 — 리뷰 화면의 "다시" 버튼이 카메라로 갈지 앨범으로 갈지가 여기서 갈린다 */
type PhotoSource = 'camera' | 'album';

/** 촬영 후보 한 장. 품질 판정에 실패해도 사진은 살리므로 evaluation은 없을 수 있다. */
interface Candidate {
  uri: string;
  evaluation: FrameEvaluation | null;
  /** 이 프레임에서 찾은 얼굴 기하 — 분석 단계가 관심영역과 면적 정규화에 쓴다 */
  face?: FaceFrame | null;
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
  warnings: ['촬영 품질을 측정하지 못했어요 — 신뢰도 점수는 참고만 해주세요'],
  usable: true,
};

/**
 * 촬영 단계 — 가이드에 "대충" 맞으면 자동으로 찍고, 나머지는 후처리가 흡수한다.
 *
 * 필수 조건은 셋뿐이고 사용자 동작과 1:1로 대응한다 — 피부(가까이/멀리) · 초점(잠깐 멈추기) ·
 * 노출(각도 살짝). 셋이 모두 충족되면 셔터가 열리고, 그 순간부터 짧은 창(BEST_FRAME_WINDOW_MS)
 * 동안 후보 프레임을 모아 권장 점수가 가장 높은 장면을 채택한다.
 *
 * 초점 게이트에는 "정지했는가"가 함께 들어 있다. 밝은 곳에서는 흔들리는 손도 또렷하게 찍히므로
 * 한 장의 선명도만으로는 움직임을 걸러낼 수 없어, 직전 틱 프레임과의 상관도를 함께 본다.
 *
 * 거리·각도를 지난번과 맞추라는 요구는 없앴다 — 면적 측정을 걷어내면서 필요가 사라졌다.
 * 구도(병변 위치·크기) 게이트도 없앴다 — 병변이 없는 정상 피부는 통과할 수 없고, 병변이
 * 작아지면(호전) 오히려 게이트에 걸리는 기준이었다.
 * 조명 차이는 후처리(computeColorNormalization)가 게인으로 흡수하고, 증상이 여러 곳에
 * 흩어진 경우도 analyzeLocal이 덩어리별로 나눠 보므로 사용자에게 시키지 않는다.
 *
 * 자동 셔터를 기다리지 않고 직접 찍을 수도 있다(수동 셔터). 필수 조건을 못 넘긴 프레임은
 * scoreConfidence가 신뢰도 상한을 씌우므로, 품질이 낮은 기록이 추세를 흔들지는 않는다.
 *
 * 갤러리에서 고르는 길은 앞 단계(CaptureSourceScreen)에서 갈라진다. source='album'으로 들어오면
 * 카메라를 아예 켜지 않고 앨범만 연다 — 고를 사진에는 가이드가 낄 자리가 없기 때문이다.
 *
 * ── 얼굴 자리에서만 켜지는 것 ────────────────────────────────────────────
 *
 * 얼굴을 찍을 때는 위의 셋에 **정렬**이 더해지고, 프리뷰에 지난 사진의 고스트가 얹힌다.
 * 목적은 하나다 — 병변 넓이를 회차 간 비교할 수 있게 만드는 것.
 *
 * 그 전에 왜 다른 자리에서는 못 하는지부터. 넓이를 비교하려면 "같은 배율로 찍었는가"를 알아야
 * 하고, 그 기준은 시간에 따라 변하지 않는 것이어야 한다(게이트 원칙 3). 병변 자체는 변하므로
 * 기준이 될 수 없다 — 예전 구도 게이트가 걷어내진 이유가 그것이다. 얼굴 골격은 변하지 않는다.
 * 그래서 얼굴에서만, 양눈과 입 세 점을 자로 삼아 넓이를 잰다(ai/faceFrame.ts).
 *
 * 정렬 판정은 **자동 셔터만 막고 촬영을 막지 않는다.** 어긋나게 찍힌 사진도 등급 판정에는 아무
 * 문제가 없다. 그리고 정렬이 어긋났다고 해서 넓이까지 못 쓰게 되는 것도 아니다 — 배율·위치·
 * 기울기는 넓이를 d·v로 나누는 순간 계산에서 사라지기 때문이다. 넓이를 실제로 못 쓰게 만드는
 * 것은 자세·해상도·조명뿐이고, 그 판단은 evaluateAreaEligibility가 따로 한다.
 *
 * 이 구분 덕분에 **앨범에서 고른 사진도 넓이를 잰다.** 가이드를 볼 기회가 없어 구도는 당연히
 * 어긋나 있지만, 정면이고 얼굴이 충분히 크고 조명이 비슷하면 그 사진의 넓이는 지난 회차와
 * 견줄 자격이 있다.
 *
 * 고스트는 **첫 촬영 사진을 화면 전체에 반투명하게 깐 것**이다. 사용자는 지금 얼굴을 거기 겹쳐
 * 맞추기만 하면 된다. 도형으로 "얼굴을 이만큼 크게 여기에 두라"고 말하는 것보다 직접적이고,
 * 지난번에 어떻게 찍었는지까지 함께 보여준다.
 *
 * 여기서 지켜야 하는 것 하나: **화면에 깔린 사진과 게이트의 목표가 같은 사진이어야 한다.**
 * 정렬 목표(alignTargetFor)는 이 사진에서 잰 구도를 그대로 쓴다 — 화면에는 지난 사진을 깔아
 * 두고 게이트는 다른 자리를 재면, 눈으로 겹친 바로 그 순간에 판정이 실패한다.
 *
 * 목표로 삼는 사진은 항상 **첫 사진**이다. 매번 직전 사진에 맞추면 회차마다 허용 오차만큼 밀린
 * 구도가 다음 목표가 되어 서서히 흘러간다(drift). 첫 사진에 고정하면 열 번째 촬영도 첫 사진과
 * 같은 구도다. 첫 촬영에는 맞출 사진이 없으므로 그때만 표준 가이드 도형이 나온다.
 *
 * 얼굴 자리에서는 카메라(전/후면)를 기준 사진과 같은 것으로 잠근다. 전면과 후면은 화각이 달라
 * 같은 거리에서도 원근 왜곡이 다르고 좌우 반전 여부도 제각각이라, 카메라가 바뀌면 고스트가
 * 맞지 않을 뿐 아니라 넓이 비교 자체가 성립하지 않는다.
 *
 * 후처리는 사진을 다시 쓰지 않는다 — 조명 보정은 게인 숫자로만 남겨 분석 직전 텐서에 적용하고,
 * 사용자가 보는 기록은 찍은 그대로다. 품질 판정이 실패해도 사진은 그대로 살려서 결과로 넘어간다.
 */
export default function MonitorCaptureScreen({
  target,
  source: initialSource,
  onCancel,
  onComplete,
}: {
  target: MonitorTarget;
  /** 앞 단계(촬영 방법)에서 고른 방식 — 'album'이면 카메라를 켜지 않고 바로 갤러리를 연다 */
  source: PhotoSource;
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

  const baseline = target.baseline;

  /**
   * 검출 모델을 쓸 수 없다고 판명됐는지 (웹 미리보기, 번들 누락, 출력 규격 불일치).
   *
   * 상태로 들고 있어야 하는 이유: 모델 로딩 실패는 렌더 중이 아니라 나중에 드러난다. 그때
   * 화면이 다시 그려지지 않으면 얼굴 모드가 켜진 채로 남아 — 검출은 매번 실패하므로 —
   * "얼굴이 보이지 않아요"만 띄우며 자동 셔터가 영영 열리지 않는다. 기능 하나가 없는 것과
   * 촬영이 막히는 것은 무게가 전혀 다른 실패다.
   */
  const [faceBroken, setFaceBroken] = useState(false);

  /**
   * 이 자리에서 얼굴 정렬·면적 측정을 켤지.
   *
   * 얼굴 자리이면서 검출 모델을 쓸 수 있어야 한다. 모델을 못 불러오면 조용히 예전 그대로
   * 동작한다 — 얼굴 기능이 없다고 촬영이 막히면 안 된다.
   */
  const faceMode = supportsAreaTracking(target.part) && !DUMP_RESULTS && !faceBroken;
  /**
   * 프리뷰에 겹칠 지난 사진. 사진 한 장마다 한 번만 만든다.
   * Baseline에 저장하지 않는 이유: 화면에서만 쓰는 그림이고, 저장해 두면 지난 사진이 바뀔 때
   * 같이 갱신할 자리를 하나 더 만들게 된다.
   */
  const [ghost, setGhost] = useState<FaceGhost | null>(null);
  /** 마지막 판정 프레임의 크기 — 화면 가이드를 프레임 좌표와 맞추는 데 쓴다 */
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  /**
   * 기준 사진과 같은 카메라로 잠근다. 전면/후면은 화각이 달라 같은 거리에서도 원근 왜곡이
   * 다르고, 저장본의 좌우 반전 여부도 제각각이다 — 카메라가 바뀌면 넓이 비교가 성립하지 않는다.
   */
  const facingLocked = faceMode && !!baseline?.facing;
  useEffect(() => {
    if (facingLocked && baseline?.facing && baseline.facing !== facing) setFacing(baseline.facing);
  }, [facingLocked, baseline?.facing, facing]);

  // 얼굴 자리에 들어오면 검출 모델을 미리 올려 둔다 — 첫 틱이 모델 로딩을 기다리지 않도록.
  // 못 올리면 그 자리에서 얼굴 모드를 끈다 (실패를 판정 루프까지 끌고 가지 않는다).
  useEffect(() => {
    if (!faceMode) return;
    preloadFaceModel().then(() => {
      if (!isFaceDetectionAvailable()) setFaceBroken(true);
    });
  }, [faceMode]);

  /**
   * 고스트로 쓸 지난 사진.
   *
   * 기준 세션(baseline)이 있으면 그걸 쓰고, 없으면 폴더의 첫 기록 사진을 쓴다 — 둘 다 "이 자리를
   * 처음 찍은 사진"이라는 같은 것을 가리킨다(baselineFolderPhoto 주석 참고).
   *
   * 이 사진은 화면에 깔리는 그림이면서 **동시에 정렬 목표**다. 둘이 같은 사진이어야 사용자가
   * 눈으로 겹친 순간에 게이트도 통과한다.
   */
  const referenceUri = baseline?.processedUri ?? baselineFolderPhoto(target.id);

  // 지난 사진에서 고스트를 만든다. 실패하면 null로 두고 표준 가이드 도형만 그린다
  useEffect(() => {
    if (!faceMode || !referenceUri) {
      setGhost(null);
      return;
    }
    let alive = true;
    buildFaceGhost(referenceUri).then((g) => {
      if (alive) setGhost(g);
    });
    return () => {
      alive = false;
    };
  }, [faceMode, referenceUri]);

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
  const busy = useRef(false);
  const cancelled = useRef(false);
  const { addSession } = useMonitoring();

  /**
   * 고른 사진을 이번 세션으로 확정한다. 여기서는 실패할 수 있는 일을 하지 않는다 —
   * 촬영을 마친 뒤에 흐름이 막히는 일이 없어야 하기 때문이다.
   */
  const finalize = useCallback(
    (chosen: Candidate) => {
      const sessionId = newId('sess');
      // 조명 보정 게인 — 사진은 그대로 두고, 분석 모델에 넣을 때만 적용한다
      const colorNorm: ColorNormalization = chosen.evaluation
        ? computeColorNormalization(chosen.evaluation.metrics, baseline)
        : IDENTITY_COLOR_NORM;

      const confidence = DUMP_RESULTS
        ? makeDumpConfidence(sessionId)
        : chosen.evaluation
          ? scoreConfidence(chosen.evaluation, colorNorm, baseline)
          : UNMEASURED_CONFIDENCE;

      // 넓이를 회차 간 비교해도 되는 촬영인지는 여기서 확정한다 — 정렬·조명은 촬영 시점의
      // 정보라 나중에 사진만 보고는 알 수 없다. 얼굴 자리가 아니면 아예 판단하지 않는다.
      const areaEligible =
        faceMode && chosen.evaluation ? evaluateAreaEligibility(chosen.evaluation, baseline) : undefined;

      const created: MonitorSession = {
        id: sessionId,
        targetId: target.id,
        capturedAt: new Date(),
        rawUri: chosen.uri,
        // 촬영본이 곧 기록 사진이다 — 후처리는 픽셀이 아니라 게인으로만 남는다
        processedUri: chosen.uri,
        confidence,
        softScore: chosen.evaluation?.softScore ?? 0,
        colorNorm,
        face: chosen.face ?? undefined,
        areaEligible,
      };

      addSession(
        created,
        DUMP_RESULTS
          ? makeDumpBaseline(sessionId, chosen.uri)
          : chosen.evaluation
            ? baselineFromCapture(sessionId, chosen.uri, chosen.evaluation.metrics, {
                face: chosen.face,
                facing: faceMode ? facing : undefined,
              })
            : undefined,
      );
      setSession(created);
      setPhase('review');
    },
    [addSession, baseline, faceMode, facing, target.id],
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
      // 방향을 먼저 바로잡는다 — 이 uri가 곧 기록 사진이자 분석 입력이다
      const uri = await normalizeOrientation(rawUri);
      let evaluation: FrameEvaluation | null = null;
      let face: FaceFrame | null = null;
      if (!DUMP_RESULTS) {
        try {
          // 프리뷰가 겨냥한 것과 **같은 목표**로 재야 한다. 이걸 빠뜨리면 고스트에 정확히 맞추고
          // 직접 셔터를 눌러도 표준 자리를 기준으로 판정돼 "어긋났다"가 된다.
          const measured = await withSkImage(uri, async (img) =>
            analyzeFrame(img, faceMode, baseline, null, ghost?.framing),
          );
          evaluation = measured.evaluation;
          face = measured.face;
        } catch (e: any) {
          // 품질을 못 재도 촬영 자체는 살린다 — 다만 왜 못 쟀는지는 남긴다.
          // 앨범 사진은 형식이 제각각(스크린샷·다운로드·특이한 컬러프로파일)이라 여기 걸리기 쉽고,
          // 조용히 삼키면 원인 모를 50점짜리 기록만 남는다.
          const msg = e?.message ?? String(e);
          console.warn('[capture] 품질 측정 실패:', msg);
          setMeasureError(msg);
        }
      }
      finalize({ uri, evaluation, face });
    },
    [baseline, faceMode, ghost?.framing, finalize],
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
      setError(e?.message ?? '사진을 찍지 못했어요');
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
    missStreak.current = 0;
    prevSig.current = null;
    setArmed(false);
    setLiveError(null);

    const tick = async () => {
      if (busy.current || cancelled.current) return;
      busy.current = true;
      try {
        // 필수 조건을 이미 통과한 상태에서는 그대로 채택할 수 있도록 화질을 올려 찍는다
        const armed = windowStart.current != null;
        const camera = cameraRef.current;
        if (!camera) return;
        const photo = await withTimeout(
          camera.takePictureAsync({ quality: armed ? 0.85 : 0.4, skipProcessing: true, shutterSound: false }),
          FRAME_TIMEOUT_MS,
          '카메라',
        );
        if (!photo || cancelled.current) return;

        /*
          피부·초점·노출 게이트는 모델을 쓰지 않으므로 픽셀만 읽으면 된다 (예전에는 매 틱
          512×512 세그 추론이 돌았지만 그 게이트는 걷어냈다). 얼굴 자리에서만 128px 얼굴 검출이
          하나 붙는데, 걷어낸 세그와 비교하면 입력이 16분의 1이라 틱 주기에 부담이 되지 않는다.
        */
        const prev = prevSig.current;
        const measured = await withSkImage(photo.uri, (img) =>
          analyzeFrame(img, faceMode, baseline, prev, ghost?.framing),
        );
        const { evaluation } = measured;
        prevSig.current = evaluation.metrics.signature;
        if (cancelled.current) return;
        // 모델이 도중에 못 쓰게 됐으면(출력 규격 불일치 등) 여기서 알아채고 얼굴 모드를 끈다
        if (faceMode && !isFaceDetectionAvailable()) setFaceBroken(true);
        setFrameSize((s) => (s.w === measured.width && s.h === measured.height ? s : { w: measured.width, h: measured.height }));
        setLive(evaluation);
        setLiveError(null);

        // 비교할 직전 프레임이 없으면 정지 여부를 판정할 수 없다 —
        // 첫 틱만으로 자동 촬영이 나가는 일이 없도록 이번 판은 표시만 하고 넘긴다
        if (!prev) return;

        // 얼굴 자리에서는 정렬까지 맞아야 셔터가 열린다. 어긋난 채로 자동 촬영이 나가면 그
        // 사진의 넓이는 추세에서 빠지는데, 사용자는 앱이 알아서 잘 찍었다고 믿게 된다.
        const ready = evaluation.hardPass && (evaluation.align?.ok ?? true);

        if (ready) {
          missStreak.current = 0;
          setArmed(true);
        } else if (++missStreak.current >= 2) {
          setArmed(false);
        }

        if (ready && evaluation.softScore >= GATE.autoShutterSoftScore) {
          if (windowStart.current == null) windowStart.current = Date.now();
          candidates.current.push({ uri: photo.uri, evaluation, face: measured.face });
        }

        const started = windowStart.current;
        if (started == null || candidates.current.length === 0) return;

        const softOf = (c: Candidate) => c.evaluation?.softScore ?? 0;
        const best = candidates.current.reduce((a, b) => (softOf(b) > softOf(a) ? b : a));
        const windowOver = Date.now() - started >= BEST_FRAME_WINDOW_MS;
        if (softOf(best) >= GATE.excellentSoftScore || windowOver || candidates.current.length >= MAX_CANDIDATES) {
          /*
            채택된 한 장을 **다른 두 경로(수동 셔터·앨범)와 똑같이** 확정한다.

            예전에는 여기서 방향만 바로잡고(normalizeOrientation) 판정 결과는 틱에서 잰 것을
            그대로 썼는데, 그게 틀렸다. 판정 프레임은 skipProcessing으로 찍혀 EXIF 방향이 픽셀에
            반영돼 있지 않다(expo 문서가 "90°·180°·270° 회전 가능"이라고 못박아 두었다). 즉
            틱에서 잰 얼굴 좌표는 **눕혀진 프레임의 좌표**인데, 기록으로 남는 사진은 바로 세운
            것이다. 그 얼굴 좌표로 관심영역을 잘라내면 얼굴이 아닌 엉뚱한 자리를 분할하게 되고,
            거기서 나온 넓이는 아무 의미가 없다.

            그래서 방향을 바로잡은 뒤 **그 사진에서 다시 잰다.** 후보를 고르는 데 쓴 틱 판정은
            "어느 프레임이 제일 나은가"를 정하는 용도였고, 기록에 남을 판정은 실제로 기록될 그
            사진에서 나와야 한다. 촬영이 끝난 뒤 한 번 더 재는 값이라 비용도 한 번뿐이다.
          */
          await commitPhoto(best.uri, 'camera');
        }
      } catch (e: any) {
        // 한 프레임 실패는 다음 주기에 다시 시도하지만, 조용히 삼키지는 않는다.
        // 예전에는 여기서 통째로 삼켜서 — Skia 서피스 고갈처럼 계속 실패하는 상황일 때
        // 판정 패널이 영영 멈춰 있는데도 아무 단서가 남지 않았다.
        const msg = e?.message ?? String(e);
        console.warn('[capture] 프레임 판정 실패:', msg);
        if (!cancelled.current) setLiveError(msg);
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
  }, [mode, phase, permission?.granted, cameraReady, facing, baseline, faceMode, ghost?.framing, commitPhoto]);

  /** 확인 화면에서 다시 찍기 — 앨범으로 들어왔더라도 여기서는 카메라로 갈아탄다 */
  const retake = () => {
    setMode('camera');
    candidates.current = [];
    windowStart.current = null;
    cancelled.current = false;
    missStreak.current = 0;
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
        {/*
          앨범 사진에는 가이드가 없으므로 고르기 전에 조건을 알려준다. 넓이는 얼굴 크기로
          정규화되니 거리·구도는 상관없다 — 정면이고, 얼굴이 크게 나왔고, 조명이 비슷하면 된다.
        */}
        {faceMode && (
          <Text style={styles.albumHint}>
            정면을 보고 얼굴이 크게 나온 사진이면{'\n'}병변 넓이 변화도 함께 볼 수 있어요{'\n'}
            (거리나 구도는 달라도 괜찮아요)
          </Text>
        )}
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
          onMountError={(e: any) => setLiveError(e?.message ?? '카메라를 열지 못했어요')}
        />

        {/*
          얼굴 자리에서만 나오는 가이드. 사용자가 맞춰야 하는 사각형이 곧 분석에 들어가는
          영역이고, 정렬 게이트가 겨냥하는 목표도 같은 자리다 — 화면과 판정이 다른 곳을 보면
          "초록인데 왜 안 찍히지"가 된다.
        */}
        {faceMode && (
          <FaceGuideOverlay
            imageWidth={frameSize.w}
            imageHeight={frameSize.h}
            ghostUri={ghost?.uri}
            mirrored={facing === 'front'}
            ok={!!live?.align?.ok}
          />
        )}

        {/*
          매 틱 바뀌던 판정 안내는 소리로 옮겼다(useCaptureVoice). 여기는 촬영 내내 그대로인
          한 줄만 남긴다 — 계속 바뀌는 글은 카메라를 대고 있는 자세에서 어차피 읽히지 않는다.
        */}
        <Text style={styles.hint}>
          {!faceMode
            ? '가이드라인에 맞춰 촬영하면 분석 정확도가 높아져요'
            : ghost
              ? '이전 사진(반투명)에 맞춰 같은 구도로 촬영하세요'
              : '가이드에 얼굴을 맞추면 병변 넓이 변화까지 함께 볼 수 있어요'}
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
              {/* 정렬은 얼굴 자리에서만 나온다 — 다른 자리에는 맞출 기준(자)이 없다 */}
              {faceMode && <GateBar label="정렬" value={live?.align?.gauge} ok={live?.align?.ok} />}
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        <Text style={styles.bottomHint}>
          {armed
            ? '조건이 맞았어요 — 가장 좋은 순간을 골라 자동으로 찍는 중'
            : '조건이 맞으면 자동으로 찍혀요. 가운데 버튼을 눌러 직접 찍어도 돼요'}
        </Text>
        <View style={styles.bottomRow}>
          {/*
            얼굴 자리에서 기준 사진이 이미 있으면 카메라를 바꿀 수 없다. 전면과 후면은 화각이
            달라 같은 거리에서도 원근 왜곡이 다르고 좌우 반전 여부도 제각각이라, 카메라를 바꾸면
            넓이 비교가 성립하지 않는다 — 막지 않으면 사용자는 그 사실을 알 길이 없다.
          */}
          <Pressable
            style={[styles.smallBtn, facingLocked && styles.smallBtnLocked]}
            disabled={facingLocked}
            onPress={() => {
              // 카메라를 바꾸면 네이티브가 다시 올라온다 — 준비될 때까지 판정을 멈춘다
              setCameraReady(false);
              setFacing((f) => (f === 'back' ? 'front' : 'back'));
            }}
          >
            <MaterialIcons
              name={facingLocked ? 'lock' : 'flip-camera-android'}
              size={20}
              color={facingLocked ? 'rgba(255,255,255,0.5)' : '#FFFFFF'}
            />
            <Text style={styles.smallBtnText}>{facing === 'back' ? '후면' : '전면'}</Text>
          </Pressable>
          {/* 조건이 맞으면 앱이 알아서 누르고, 그 전에도 직접 누를 수 있다 */}
          <Pressable
            style={[styles.shutter, armed && styles.shutterArmed, !cameraReady && styles.shutterWaiting]}
            onPress={shootNow}
            disabled={!cameraReady}
          >
            <Text style={[styles.shutterText, armed && styles.shutterTextArmed]}>
              {!cameraReady ? '준비 중' : armed ? '자동 촬영' : '촬영'}
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

function ReviewView({
  target,
  session,
  error,
  source,
  measureError,
  onPickAgain,
  onRetake,
  onContinue,
}: {
  target: MonitorTarget;
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
  // 확인 화면은 "이 사진으로 분석해도 되나"를 묻는 자리다 — 여기서 잘라 보여주면 사용자는
  // 잘린 화면을 기준으로 판단하게 된다. 원본 비율 그대로 보여주고 자르지 않는다.
  const photoAspect = useImageAspect(session?.processedUri);
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
        <Image
          source={{ uri: session.processedUri }}
          style={[styles.reviewImage, { aspectRatio: photoAspect ?? 1 }]}
          resizeMode="contain"
        />

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
          넓이를 쟀는지 여부를 양쪽 다 말한다.

          못 쟀을 때만 말하면 사용자는 "말이 없으면 잘 된 것"인지 "원래 안 재는 것"인지 알 수
          없다. 특히 앨범에서 고른 사진은 가이드를 본 적이 없어서 스스로 판단할 근거가 전혀 없다 —
          이 사진이 추세에 들어갔는지는 지금 이 화면에서만 알 수 있고, 나중에는 다시 못 고친다.
        */}
        {session.areaEligible &&
          (session.areaEligible.ok ? (
            <Text style={styles.okText}>병변 넓이도 함께 기록돼요 — 지난 회차와 견줄 수 있어요</Text>
          ) : (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>• {session.areaEligible.reason}</Text>
              <Text style={styles.warnText}>
                • 이 사진의 등급·증상 판정은 그대로 기록돼요. 넓이 변화 그래프에서만 빠집니다.
              </Text>
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
  albumHint: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
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
  smallBtnLocked: { backgroundColor: 'rgba(255,255,255,0.07)' },
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
  // aspectRatio는 사진의 실제 비율로 덧붙인다. 세로로 긴 사진이 버튼을 밀어내지 않도록
  // flexShrink를 열어 두었다 — 줄어들어도 contain이라 잘리지 않고 여백만 생긴다.
  reviewImage: { width: '100%', borderRadius: 20, backgroundColor: '#14171C', flexShrink: 1 },
  warnBox: { marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14 },
  warnText: { fontSize: 13, color: AppColors.ink, lineHeight: 20 },
  okText: { marginTop: 12, fontSize: 13, fontWeight: '600', color: AppColors.sub, textAlign: 'center' },
  rejectText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: AppColors.sev3, textAlign: 'center' },
  processingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  processingSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
});
