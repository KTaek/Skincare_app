import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { AppColors } from '../theme';
import { useMonitoring } from '../context/MonitoringContext';
import { detectLesionShape, LesionDetection, LesionShape } from '../monitoring/lesionShape';
import { evaluateFrame, GATE, measureImageQuality } from '../monitoring/frameQuality';
import { FIELD_OF_VIEW_FACTOR, newId, scoreConfidence } from '../monitoring/postProcess';
import {
  Baseline,
  FrameEvaluation,
  ImageQualityMetrics,
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

/** 촬영 후보 한 장. 품질 판정에 실패해도 사진은 살리므로 detection/evaluation은 없을 수 있다. */
interface Candidate {
  uri: string;
  detection: LesionDetection | null;
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
  breakdown: { focus: 0, exposure: 0, framing: 0, registration: 0, color: 0 },
  warnings: ['촬영 품질을 측정하지 못했어요 — 신뢰도 점수는 참고만 해주세요'],
  usable: true,
};

/** 이번 촬영을 이 자리의 기준(baseline)으로 삼는다 — 다음 촬영의 고스트·거리·각도 안내가 여기서 나온다 */
function baselineFromCapture(
  sessionId: string,
  uri: string,
  shape: LesionShape,
  metrics: ImageQualityMetrics,
): Baseline {
  return {
    sessionId,
    processedUri: uri,
    orientation: shape.orientation,
    radiusNorm: shape.radiusPx / Math.min(shape.imageWidth, shape.imageHeight),
    // 색 정규화를 하지 않으므로 실제로 쓰이지는 않는다 — 프레임의 채널 평균만 기록해 둔다
    colorStats: { mean: metrics.channelMeans, std: [0.1, 0.1, 0.1] },
    brightness: metrics.brightness,
  };
}

/**
 * 촬영 단계 — 가이드에 "대충" 맞으면 자동으로 찍고, 나머지는 후처리가 흡수한다.
 *
 * 필수 조건(초점·프레이밍·노출·후처리 하한선)이 모두 충족되면 셔터가 열리고,
 * 그 순간부터 짧은 창(BEST_FRAME_WINDOW_MS) 동안 후보 프레임을 모아 권장 조건 점수가 가장 높은 장면을 채택한다.
 * 사용자는 완벽하게 맞출 필요가 없고, 앱이 그중 제일 나은 순간을 고른다.
 *
 * 자동 셔터를 기다리지 않고 직접 찍을 수도 있고(수동 셔터), 이미 찍어 둔 사진을 앨범에서 고를
 * 수도 있다. 필수 조건을 못 넘긴 프레임은 scoreConfidence가 신뢰도 상한을 씌우므로, 품질이
 * 낮은 기록이 추세를 흔들지는 않는다.
 *
 * 이전에 찍은 기준 사진이 있으면 프리뷰 위에 반투명하게 겹쳐(고스트) 같은 구도를 유도한다.
 *
 * ⚠️ 정합·색보정(postProcessCapture)은 지금 꺼져 있다 — 실기기에서 Skia 오프스크린 렌더가
 * 실패해 촬영이 통째로 막히는 문제가 있어, 촬영본을 그대로 쓰고 흐름이 절대 끊기지 않게 했다.
 * 품질 판정(detectLesionShape/evaluateFrame)이 실패해도 사진은 그대로 살려서 결과로 넘어간다.
 * 후처리를 되살릴 때는 finalize에서 postProcessCapture를 다시 호출하면 된다.
 */
export default function MonitorCaptureScreen({
  target,
  onCancel,
  onComplete,
}: {
  target: MonitorTarget;
  onCancel: () => void;
  /** 후처리까지 끝난 사진을 상위 흐름(분석·기록 저장)으로 넘긴다 */
  onComplete: (processedUri: string, session: MonitorSession) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('preview');
  const [live, setLive] = useState<FrameEvaluation | null>(null);
  /** 등·목 뒤처럼 혼자 찍기 어려운 자리는 전면 카메라로 거울처럼 보며 찍는다 */
  const [facing, setFacing] = useState<CameraType>('back');
  const [session, setSession] = useState<MonitorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  /** 기준 사진 겹쳐보기(고스트) — 병변 자체를 가려서 오히려 맞추기 어려울 때 잠깐 끌 수 있다 */
  const [ghostOn, setGhostOn] = useState(true);

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
      const confidence = DUMP_RESULTS
        ? makeDumpConfidence(sessionId)
        : chosen.evaluation
          ? scoreConfidence(
              chosen.evaluation,
              // 정합을 하지 않으므로 "손대지 않은" 변환으로 점수만 계산한다
              { scale: 1, rotationRad: 0, translation: { x: 0, y: 0 }, isBaseline: !baseline },
              [1, 1, 1],
              baseline,
            )
          : UNMEASURED_CONFIDENCE;

      const created: MonitorSession = {
        id: sessionId,
        targetId: target.id,
        capturedAt: new Date(),
        rawUri: chosen.uri,
        // 후처리가 꺼져 있어 촬영본이 곧 결과 사진이다
        processedUri: chosen.uri,
        confidence,
        softScore: chosen.evaluation?.softScore ?? 0,
      };

      addSession(
        created,
        DUMP_RESULTS
          ? makeDumpBaseline(sessionId, chosen.uri)
          : chosen.detection && chosen.evaluation
            ? baselineFromCapture(sessionId, chosen.uri, chosen.detection.shape, chosen.evaluation.metrics)
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
    async (uri: string) => {
      cancelled.current = true;
      setPhase('processing');
      let detection: LesionDetection | null = null;
      let evaluation: FrameEvaluation | null = null;
      if (!DUMP_RESULTS) {
        try {
          detection = await detectLesionShape(uri);
          evaluation = evaluateFrame(measureImageQuality(detection.image), detection.shape, baseline);
        } catch {
          // 품질을 못 재도 촬영 자체는 살린다 — 신뢰도만 "측정 못 함"으로 남는다
        }
      }
      finalize({ uri, detection, evaluation });
    },
    [baseline, finalize],
  );

  const shootNow = useCallback(async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (photo) await commitPhoto(photo.uri);
    } catch (e: any) {
      setError(e?.message ?? '사진을 찍지 못했어요');
      setPhase('review');
    }
  }, [commitPhoto]);

  const pickFromAlbum = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    await commitPhoto(picked.assets[0].uri);
  }, [commitPhoto]);

  /** 프리뷰를 주기적으로 찍어 품질을 판정하고, 조건이 되면 자동으로 확정한다 */
  useEffect(() => {
    // dump 모드에서는 판정할 모델이 없으므로 자동 셔터 루프를 아예 돌리지 않는다 (수동 촬영·앨범만 쓴다)
    if (DUMP_RESULTS) return;
    if (phase !== 'preview' || !permission?.granted) return;
    cancelled.current = false;
    // 카메라를 바꾸면 이전 카메라로 모아 둔 후보는 버린다
    candidates.current = [];
    windowStart.current = null;

    const tick = async () => {
      if (busy.current || cancelled.current) return;
      busy.current = true;
      try {
        // 필수 조건을 이미 통과한 상태에서는 그대로 채택할 수 있도록 화질을 올려 찍는다
        const armed = windowStart.current != null;
        const photo = await cameraRef.current?.takePictureAsync({
          quality: armed ? 0.85 : 0.4,
          skipProcessing: true,
          shutterSound: false,
        });
        if (!photo || cancelled.current) return;

        const detection = await detectLesionShape(photo.uri);
        const metrics = measureImageQuality(detection.image);
        const evaluation = evaluateFrame(metrics, detection.shape, baseline);
        if (cancelled.current) return;
        setLive(evaluation);

        if (evaluation.hardPass && evaluation.softScore >= GATE.autoShutterSoftScore) {
          if (windowStart.current == null) windowStart.current = Date.now();
          candidates.current.push({ uri: photo.uri, detection, evaluation });
        }

        const started = windowStart.current;
        if (started == null || candidates.current.length === 0) return;

        const softOf = (c: Candidate) => c.evaluation?.softScore ?? 0;
        const best = candidates.current.reduce((a, b) => (softOf(b) > softOf(a) ? b : a));
        const windowOver = Date.now() - started >= BEST_FRAME_WINDOW_MS;
        if (softOf(best) >= GATE.excellentSoftScore || windowOver || candidates.current.length >= MAX_CANDIDATES) {
          cancelled.current = true;
          finalize(best);
        }
      } catch {
        // 한 프레임 실패는 무시하고 다음 주기에 다시 시도
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
  }, [phase, permission?.granted, facing, baseline, finalize]);

  const retake = () => {
    candidates.current = [];
    windowStart.current = null;
    cancelled.current = false;
    setSession(null);
    setError(null);
    setLive(null);
    setPhase('preview');
  };

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
        isBaseline={!baseline}
        error={error}
        onRetake={retake}
        onContinue={() => session && onComplete(session.processedUri, session)}
      />
    );
  }

  const armed = live?.hardPass ?? false;

  // 가이드 박스는 기준 촬영의 병변 크기로 정한 화각과 같은 크기로 그린다.
  // 그래야 "박스를 채우면 지난번과 같은 거리"라는 안내가 실제와 맞는다.
  const shortSide = Math.min(previewSize.width, previewSize.height);
  const guideSize = shortSide
    ? baseline
      ? Math.max(120, Math.min(shortSide * 0.92, 2 * FIELD_OF_VIEW_FACTOR * baseline.radiusNorm * shortSide))
      : shortSide * 0.7
    : 250;

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }} onLayout={(e) => setPreviewSize(e.nativeEvent.layout)}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

        {/* 이전 기준 사진을 반투명하게 겹쳐(고스트) 같은 구도로 유도 */}
        {baseline && ghostOn && (
          <View pointerEvents="none" style={styles.guideWrap}>
            <Image
              source={{ uri: baseline.processedUri }}
              style={[styles.ghost, { width: guideSize, height: guideSize }]}
              resizeMode="contain"
            />
          </View>
        )}
        <View pointerEvents="none" style={styles.guideWrap}>
          <View style={[styles.guide, { width: guideSize, height: guideSize }, armed && styles.guideArmed]} />
        </View>

        <Text style={styles.hint}>
          {live?.hint ?? (baseline ? '지난 사진과 같은 자리가 보이도록 맞춰주세요' : '병변이 가이드 안에 들어오도록 맞춰주세요')}
        </Text>

        <Pressable style={styles.closeBtn} onPress={onCancel}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>

        {/* 고스트 촬영 토글 — 기준 사진이 있을 때만 의미가 있다 */}
        {baseline && (
          <Pressable style={[styles.ghostBtn, ghostOn && styles.ghostBtnOn]} onPress={() => setGhostOn((v) => !v)}>
            <MaterialIcons name={ghostOn ? 'layers' : 'layers-clear'} size={16} color="#FFFFFF" />
            <Text style={styles.ghostBtnText}>고스트 {ghostOn ? 'ON' : 'OFF'}</Text>
          </Pressable>
        )}

        {/* 품질 판정 패널은 모델이 살아 있을 때만 의미가 있다 */}
        {!DUMP_RESULTS && (
          <View style={styles.statusPanel}>
            <Text style={styles.statusTitle}>필수</Text>
            <View style={styles.chipRow}>
              <GateChip label="초점" ok={live?.hard.focus} />
              <GateChip label="구도" ok={live?.hard.framing} />
              <GateChip label="노출" ok={live?.hard.exposure} />
              <GateChip label="거리·각도" ok={live?.hard.recoverable} />
            </View>
            <View style={{ height: 8 }} />
            <Text style={styles.statusTitle}>
              권장 {live ? `${Math.round(live.softScore * 100)}%` : '--'} (못 맞춰도 촬영은 돼요)
            </Text>
            <View style={styles.chipRow}>
              <SoftBar label="정렬" value={live?.soft.alignment} />
              <SoftBar label="거리" value={live?.soft.distance} />
              <SoftBar label="각도" value={live?.soft.angle} />
              <SoftBar label="밝기" value={live?.soft.brightness} />
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        <Text style={styles.bottomHint}>
          {armed
            ? '조건이 맞았어요 — 가장 좋은 순간을 골라 자동으로 찍는 중'
            : '가운데 버튼을 눌러 촬영하거나, 앨범에서 사진을 고르세요'}
        </Text>
        <View style={styles.bottomRow}>
          <Pressable style={styles.smallBtn} onPress={pickFromAlbum}>
            <MaterialIcons name="photo-library" size={20} color="#FFFFFF" />
            <Text style={styles.smallBtnText}>앨범</Text>
          </Pressable>
          {/* 조건이 맞으면 앱이 알아서 누르고, 그 전에도 직접 누를 수 있다 */}
          <Pressable style={[styles.shutter, armed && styles.shutterArmed]} onPress={shootNow}>
            <Text style={[styles.shutterText, armed && styles.shutterTextArmed]}>
              {armed ? '자동 촬영' : '촬영'}
            </Text>
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
            <MaterialIcons name="flip-camera-android" size={20} color="#FFFFFF" />
            <Text style={styles.smallBtnText}>{facing === 'back' ? '후면' : '전면'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function GateChip({ label, ok }: { label: string; ok?: boolean }) {
  const color = ok == null ? 'rgba(255,255,255,0.25)' : ok ? AppColors.sev1 : AppColors.sev3;
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function SoftBar({ label, value }: { label: string; value?: number }) {
  const v = value ?? 0;
  return (
    <View style={styles.softItem}>
      <Text style={styles.softLabel}>{label}</Text>
      <View style={styles.softTrack}>
        <View style={[styles.softFill, { width: `${Math.round(v * 100)}%` }]} />
      </View>
    </View>
  );
}

function ReviewView({
  target,
  session,
  isBaseline,
  error,
  onRetake,
  onContinue,
}: {
  target: MonitorTarget;
  session: MonitorSession | null;
  /** 이 자리에 기준 사진이 아직 없어서 이번 촬영이 기준이 되는 경우 */
  isBaseline: boolean;
  error: string | null;
  onRetake: () => void;
  onContinue: () => void;
}) {
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
  const tierColor =
    confidence.tier === 'high' ? AppColors.sev1 : confidence.tier === 'medium' ? AppColors.sev2 : AppColors.sev3;
  const tierLabel = confidence.tier === 'high' ? '신뢰도 높음' : confidence.tier === 'medium' ? '신뢰도 보통' : '신뢰도 낮음';

  return (
    <View style={styles.reviewRoot}>
      <Text style={styles.reviewTitle}>{target.label}</Text>
      <Text style={styles.reviewSub}>
        {isBaseline ? '이 사진이 앞으로의 비교 기준이 돼요' : '지난 기준 사진과 나란히 비교해보세요'}
      </Text>

      <View style={styles.reviewImages}>
        {target.baseline && !isBaseline && (
          <View style={styles.reviewImageBox}>
            <Image source={{ uri: target.baseline.processedUri }} style={styles.reviewImage} />
            <Text style={styles.reviewImageCaption}>기준</Text>
          </View>
        )}
        <View style={styles.reviewImageBox}>
          <Image source={{ uri: session.processedUri }} style={styles.reviewImage} />
          <Text style={styles.reviewImageCaption}>이번 촬영</Text>
        </View>
      </View>

      <View style={[styles.confidenceBadge, { backgroundColor: tierColor }]}>
        <Text style={styles.confidenceText}>
          {tierLabel} · {confidence.score}점
        </Text>
      </View>

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
        <Text style={styles.rejectText}>촬영 품질이 낮아요. 다시 촬영하는 걸 권해요.</Text>
      )}

      <View style={{ flex: 1 }} />
      <Pressable style={styles.primaryBtnLight} onPress={onContinue}>
        <Text style={styles.primaryBtnText}>이 사진으로 분석하기</Text>
      </Pressable>
      <View style={{ height: 10 }} />
      <Pressable style={styles.secondaryBtn} onPress={onRetake}>
        <Text style={styles.secondaryBtnText}>다시 촬영</Text>
      </Pressable>
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

  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guide: { borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 26 },
  guideArmed: { borderColor: AppColors.greenTop },
  ghost: { opacity: 0.35, borderRadius: 26 },
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
  statusTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
    marginBottom: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  chipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  softItem: { flex: 1, marginRight: 8 },
  softLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginBottom: 3 },
  softTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  softFill: { height: 4, backgroundColor: AppColors.greenTop },

  ghostBtn: {
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
  ghostBtnOn: { backgroundColor: 'rgba(147,210,88,0.35)' },
  ghostBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  bottomBar: { height: 140, backgroundColor: '#14171C', justifyContent: 'center', paddingBottom: 6 },
  bottomHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center', marginBottom: 10 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
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
  shutterText: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.75)' },
  shutterTextArmed: { color: '#FFFFFF' },

  reviewRoot: { flex: 1, backgroundColor: AppColors.bg, padding: 20, paddingTop: 28 },
  reviewTitle: { fontSize: 20, fontWeight: '800', color: AppColors.ink, textAlign: 'center' },
  reviewSub: { fontSize: 13, color: AppColors.sub, textAlign: 'center', marginTop: 6 },
  reviewImages: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  reviewImageBox: { alignItems: 'center', marginHorizontal: 6 },
  reviewImage: { width: 150, height: 150, borderRadius: 14, backgroundColor: '#14171C' },
  reviewImageCaption: { fontSize: 12, color: AppColors.sub, marginTop: 6, fontWeight: '600' },
  confidenceBadge: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 18 },
  confidenceText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  warnBox: { marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14 },
  warnText: { fontSize: 13, color: AppColors.ink, lineHeight: 20 },
  rejectText: { marginTop: 10, fontSize: 13, fontWeight: '700', color: AppColors.sev3, textAlign: 'center' },
  processingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  processingSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
});
