import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { AppColors } from '../theme';
import { useMonitoring } from '../context/MonitoringContext';
import { detectLesionShape, LesionDetection } from '../monitoring/lesionShape';
import { evaluateFrame, GATE, measureImageQuality } from '../monitoring/frameQuality';
import { baselineFromResult, FIELD_OF_VIEW_FACTOR, newId, postProcessCapture } from '../monitoring/postProcess';
import { FrameEvaluation, MonitorSession, MonitorTarget, PostProcessResult } from '../monitoring/types';

/** 필수 조건이 충족된 뒤, 더 나은 프레임을 노리며 기다리는 시간 */
const BEST_FRAME_WINDOW_MS = 1200;
/** 그 사이에 최대 몇 장까지 후보로 담을지 */
const MAX_CANDIDATES = 3;
/** 프리뷰 판정 주기 */
const TICK_MS = 900;

interface Candidate {
  uri: string;
  detection: LesionDetection;
  evaluation: FrameEvaluation;
}

type Phase = 'preview' | 'processing' | 'review';

/**
 * 3단계 — 가이드에 "대충" 맞으면 자동으로 찍고, 나머지는 후처리가 흡수한다.
 *
 * 필수 조건(초점·프레이밍·노출·후처리 하한선)이 모두 충족되면 셔터가 열리고,
 * 그 순간부터 짧은 창(BEST_FRAME_WINDOW_MS) 동안 후보 프레임을 모아 권장 조건 점수가 가장 높은 장면을 채택한다.
 * 사용자는 완벽하게 맞출 필요가 없고, 앱이 그중 제일 나은 순간을 고른다.
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
  const [result, setResult] = useState<PostProcessResult | null>(null);
  const [session, setSession] = useState<MonitorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const cameraRef = useRef<CameraView>(null);
  const candidates = useRef<Candidate[]>([]);
  const windowStart = useRef<number | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const { addSession } = useMonitoring();

  const baseline = target.baseline;

  const finalize = useCallback(
    async (chosen: Candidate) => {
      setPhase('processing');
      try {
        const sessionId = newId('sess');
        const post = await postProcessCapture({
          detection: chosen.detection,
          evaluation: chosen.evaluation,
          baseline,
          sessionId,
        });
        const created: MonitorSession = {
          id: sessionId,
          targetId: target.id,
          capturedAt: new Date(),
          rawUri: chosen.uri,
          processedUri: post.processedUri,
          confidence: post.confidence,
          softScore: chosen.evaluation.softScore,
        };
        addSession(
          created,
          baselineFromResult(sessionId, post, chosen.detection.shape, chosen.evaluation.metrics.brightness),
        );
        setResult(post);
        setSession(created);
        setPhase('review');
      } catch (e: any) {
        setError(e?.message ?? '후처리 중 문제가 생겼어요');
        setPhase('review');
      }
    },
    [addSession, baseline, target.id],
  );

  /** 프리뷰를 주기적으로 찍어 품질을 판정하고, 조건이 되면 자동으로 확정한다 */
  useEffect(() => {
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

        const best = candidates.current.reduce((a, b) => (b.evaluation.softScore > a.evaluation.softScore ? b : a));
        const windowOver = Date.now() - started >= BEST_FRAME_WINDOW_MS;
        if (best.evaluation.softScore >= GATE.excellentSoftScore || windowOver || candidates.current.length >= MAX_CANDIDATES) {
          cancelled.current = true;
          await finalize(best);
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
    setResult(null);
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
        <Text style={styles.processingTitle}>사진을 정렬하고 색을 맞추는 중...</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.processingSub}>이전 촬영과 같은 구도·같은 색 기준으로 변환하고 있어요</Text>
      </View>
    );
  }

  if (phase === 'review') {
    return (
      <ReviewView
        target={target}
        result={result}
        session={session}
        error={error}
        onRetake={retake}
        onContinue={() => result && session && onComplete(result.processedUri, session)}
      />
    );
  }

  const armed = live?.hardPass ?? false;

  // 가이드 박스는 후처리가 잘라낼 화각과 같은 크기로 그린다.
  // 그래야 "박스를 채우면 지난번과 같은 거리" 라는 안내가 실제 결과와 일치한다.
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

        {/* 이전 기준 사진을 반투명하게 겹쳐 같은 구도로 유도 */}
        {baseline && (
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

        <Text style={styles.hint}>{live?.hint ?? '병변이 보이도록 카메라를 비춰주세요'}</Text>

        <Pressable style={styles.closeBtn} onPress={onCancel}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>

        <View style={styles.statusPanel}>
          <Text style={styles.statusTitle}>필수</Text>
          <View style={styles.chipRow}>
            <GateChip label="초점" ok={live?.hard.focus} />
            <GateChip label="구도" ok={live?.hard.framing} />
            <GateChip label="노출" ok={live?.hard.exposure} />
            <GateChip label="보정 가능" ok={live?.hard.recoverable} />
          </View>
          <View style={{ height: 8 }} />
          <Text style={styles.statusTitle}>권장 (못 맞춰도 후처리가 보정해요)</Text>
          <View style={styles.chipRow}>
            <SoftBar label="정렬" value={live?.soft.alignment} />
            <SoftBar label="거리" value={live?.soft.distance} />
            <SoftBar label="각도" value={live?.soft.angle} />
            <SoftBar label="밝기" value={live?.soft.brightness} />
          </View>
        </View>
      </View>

      <View style={styles.bottomBar}>
        <Pressable style={styles.smallBtn} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
          <MaterialIcons name="flip-camera-android" size={22} color="#FFFFFF" />
          <Text style={styles.smallBtnText}>{facing === 'back' ? '후면' : '전면'}</Text>
        </Pressable>
        {/* 셔터는 조건이 맞으면 앱이 알아서 누른다 — 여기는 상태 표시만 한다 */}
        <View style={[styles.shutter, armed && styles.shutterArmed]}>
          <Text style={[styles.shutterText, armed && styles.shutterTextArmed]}>
            {armed ? '촬영 중' : '대기'}
          </Text>
        </View>
        <View style={styles.smallBtn}>
          <Text style={styles.scoreText}>{live ? `${Math.round(live.softScore * 100)}%` : '--'}</Text>
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
  result,
  session,
  error,
  onRetake,
  onContinue,
}: {
  target: MonitorTarget;
  result: PostProcessResult | null;
  session: MonitorSession | null;
  error: string | null;
  onRetake: () => void;
  onContinue: () => void;
}) {
  if (error || !result || !session) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialIcons name="error-outline" size={36} color="#FF6B6B" />
        <View style={{ height: 12 }} />
        <Text style={styles.processingTitle}>후처리에 실패했어요</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.processingSub}>{error ?? '결과를 만들지 못했어요'}</Text>
        <View style={{ height: 18 }} />
        <Pressable style={styles.primaryBtn} onPress={onRetake}>
          <Text style={styles.primaryBtnText}>다시 촬영</Text>
        </Pressable>
      </View>
    );
  }

  const { confidence } = result;
  const tierColor =
    confidence.tier === 'high' ? AppColors.sev1 : confidence.tier === 'medium' ? AppColors.sev2 : AppColors.sev3;
  const tierLabel = confidence.tier === 'high' ? '신뢰도 높음' : confidence.tier === 'medium' ? '신뢰도 보통' : '신뢰도 낮음';

  return (
    <View style={styles.reviewRoot}>
      <Text style={styles.reviewTitle}>{target.label}</Text>
      <Text style={styles.reviewSub}>
        {result.registration.isBaseline ? '이 사진이 앞으로의 비교 기준이 돼요' : '이전 기준에 맞춰 정렬·색보정했어요'}
      </Text>

      <View style={styles.reviewImages}>
        {target.baseline && !result.registration.isBaseline && (
          <View style={styles.reviewImageBox}>
            <Image source={{ uri: target.baseline.processedUri }} style={styles.reviewImage} />
            <Text style={styles.reviewImageCaption}>기준</Text>
          </View>
        )}
        <View style={styles.reviewImageBox}>
          <Image source={{ uri: result.processedUri }} style={styles.reviewImage} />
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
      {!confidence.usable && (
        <Text style={styles.rejectText}>후처리로도 충분히 보정되지 않았어요. 다시 촬영하는 걸 권해요.</Text>
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

  bottomBar: {
    height: 130,
    backgroundColor: '#14171C',
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
  scoreText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
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
