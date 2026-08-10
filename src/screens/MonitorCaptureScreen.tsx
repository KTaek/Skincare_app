import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { evaluateFrame, GATE, measureImageQuality } from '../monitoring/frameQuality';
import { useCaptureVoice } from '../monitoring/captureVoice';
import {
  baselineFromCapture,
  computeColorNormalization,
  IDENTITY_COLOR_NORM,
  newId,
  scoreConfidence,
} from '../monitoring/postProcess';
import {
  ColorNormalization,
  FrameEvaluation,
  MonitorSession,
  MonitorTarget,
  SessionConfidence,
} from '../monitoring/types';
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

/** 사진이 어디서 왔는지 — 리뷰 화면의 "다시" 버튼이 카메라로 갈지 앨범으로 갈지가 여기서 갈린다 */
type PhotoSource = 'camera' | 'album';

/** 촬영 후보 한 장. 품질 판정에 실패해도 사진은 살리므로 evaluation은 없을 수 있다. */
interface Candidate {
  uri: string;
  evaluation: FrameEvaluation | null;
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

  const baseline = target.baseline;

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
      };

      addSession(
        created,
        DUMP_RESULTS
          ? makeDumpBaseline(sessionId, chosen.uri)
          : chosen.evaluation
            ? baselineFromCapture(sessionId, chosen.uri, chosen.evaluation.metrics)
            : undefined,
      );
      setSession(created);
      setPhase('review');
    },
    [addSession, baseline, target.id],
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
      if (!DUMP_RESULTS) {
        try {
          evaluation = await withSkImage(uri, (img) => evaluateFrame(measureImageQuality(img), baseline));
        } catch (e: any) {
          // 품질을 못 재도 촬영 자체는 살린다 — 다만 왜 못 쟀는지는 남긴다.
          // 앨범 사진은 형식이 제각각(스크린샷·다운로드·특이한 컬러프로파일)이라 여기 걸리기 쉽고,
          // 조용히 삼키면 원인 모를 50점짜리 기록만 남는다.
          const msg = e?.message ?? String(e);
          console.warn('[capture] 품질 측정 실패:', msg);
          setMeasureError(msg);
        }
      }
      finalize({ uri, evaluation });
    },
    [baseline, finalize],
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

        // 게이트가 모델을 쓰지 않으므로 여기서는 픽셀만 읽으면 된다 —
        // 예전에는 매 틱 512×512 세그 추론이 돌았지만 이제 필요 없다
        const metrics = await withSkImage(photo.uri, (img) => measureImageQuality(img));
        const prev = prevSig.current;
        prevSig.current = metrics.signature;
        const evaluation = evaluateFrame(metrics, baseline, prev);
        if (cancelled.current) return;
        setLive(evaluation);
        setLiveError(null);

        // 비교할 직전 프레임이 없으면 정지 여부를 판정할 수 없다 —
        // 첫 틱만으로 자동 촬영이 나가는 일이 없도록 이번 판은 표시만 하고 넘긴다
        if (!prev) return;

        if (evaluation.hardPass) {
          missStreak.current = 0;
          setArmed(true);
        } else if (++missStreak.current >= 2) {
          setArmed(false);
        }

        if (evaluation.hardPass && evaluation.softScore >= GATE.autoShutterSoftScore) {
          if (windowStart.current == null) windowStart.current = Date.now();
          candidates.current.push({ uri: photo.uri, evaluation });
        }

        const started = windowStart.current;
        if (started == null || candidates.current.length === 0) return;

        const softOf = (c: Candidate) => c.evaluation?.softScore ?? 0;
        const best = candidates.current.reduce((a, b) => (softOf(b) > softOf(a) ? b : a));
        const windowOver = Date.now() - started >= BEST_FRAME_WINDOW_MS;
        if (softOf(best) >= GATE.excellentSoftScore || windowOver || candidates.current.length >= MAX_CANDIDATES) {
          cancelled.current = true;
          setSource('camera');
          setPhase('processing');
          // 판정 프레임은 skipProcessing으로 찍어 EXIF 방향이 반영돼 있지 않다.
          // 채택이 확정된 이 한 장만 바로잡는다 (매 프레임 하면 너무 비싸다).
          finalize({ ...best, uri: await normalizeOrientation(best.uri) });
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
  }, [mode, phase, permission?.granted, cameraReady, facing, baseline, finalize]);

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
          매 틱 바뀌던 판정 안내는 소리로 옮겼다(useCaptureVoice). 여기는 촬영 내내 그대로인
          한 줄만 남긴다 — 계속 바뀌는 글은 카메라를 대고 있는 자세에서 어차피 읽히지 않는다.
        */}
        <Text style={styles.hint}>가이드라인에 맞춰 촬영하면 분석 정확도가 높아져요</Text>

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
  rejectText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: AppColors.sev3, textAlign: 'center' },
  processingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  processingSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
});
