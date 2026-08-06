// Phase 4 — 병변 면적 추적 촬영 플로우 (온디바이스)
// 부위 선택 → 원거리(면적, 고스트 오버레이) → 근거리(중증도, 고스트 오버레이) → 측정/품질/저장.
// 고스트 오버레이: 같은 부위의 직전 사진을 반투명으로 겹쳐 비슷한 구도로 유도(거리 불변성 확보 장치).
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView,
  StatusBar, Image, ActivityIndicator, Dimensions, PanResponder, Pressable,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { measureAreaOnDevice, diagnoseOnDevice, cropToBox, alignSignalsOnDevice, imageSignature } from '../utils/ondevice';
import { evaluateQuality, qualityFlagKeys, qualitySummary } from '../utils/quality';
import {
  CAPTURE, siteLabel, saveSession, getLatestSessionForSite, getSiteBaseline, softDeleteSession,
} from '../utils/tracking';
import { AppColors, cardShadow } from '../appTheme';
import LandmarkPicker from '../components/LandmarkPicker';
import { recordAreaMeasurement } from '../folders/store';
import { folderNameOf } from '../folders/targets';

// 추적 부위 목록 — 좌/우·앞/뒤를 구분해 저장(합산 금지). 필요시 확장.
const PARTS = ['얼굴', '목', '가슴', '배', '등', '팔(안쪽)', '팔(바깥)', '팔꿈치', '손', '허벅지', '무릎', '종아리', '발'];
const SIDES = [
  { key: '좌', label: '좌' }, { key: '우', label: '우' },
  { key: '앞', label: '앞' }, { key: '뒤', label: '뒤' },
  { key: null, label: '구분없음' },
];
const OPACITIES = [
  { v: 0, label: '없음' }, { v: 0.3, label: '약' }, { v: 0.5, label: '중' }, { v: 0.7, label: '강' },
];
// 박스 크기(짧은변 대비): 소50 / 중70 / 대90 — 슬라이더는 왼→오 = 소→대
const BOX_STEPS = [
  { v: 0.5, label: '소' }, { v: 0.7, label: '중' }, { v: 0.9, label: '대' },
];
const ALIGN_TOL = 0.45;   // 정렬 허용(baseline 대비 ±45%) — 완화: 맞추기 쉽게
const MIN_LESION_PX = 800; // 1회차 자동촬영 기준: 병변∩피부 픽셀(512그리드)이 이 이상이면 담긴 것으로 간주
const COMP_THRESH = 0.5;   // 구도 일치 임계(첫 사진과의 흑백 상관도, -1~1)
function sigCorr(a, b) { if (!a || !b || a.length !== b.length) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// 3단계 박스 크기 슬라이더 (네이티브 의존 없이 PanResponder)
function BoxSlider({ value, onChange }) {
  const steps = BOX_STEPS, n = steps.length;
  const [w, setW] = React.useState(0);
  const wRef = useRef(0);
  const valRef = useRef(value); valRef.current = value;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const idx = Math.max(0, steps.findIndex(s => s.v === value));
  const setFromX = (x) => {
    const ww = wRef.current; if (ww <= 0) return;
    const r = Math.max(0, Math.min(1, x / ww));
    const i = Math.round(r * (n - 1));
    if (steps[i].v !== valRef.current) onChangeRef.current(steps[i].v);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
    onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
  })).current;
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.opLabel}>박스</Text>
      <View style={styles.sliderTrackWrap}
        onLayout={(e) => { const ww = e.nativeEvent.layout.width; wRef.current = ww; setW(ww); }}
        {...pan.panHandlers}>
        <View style={styles.sliderTrack} />
        {steps.map((s, i) => (
          <View key={i} style={[styles.sliderTick, { left: (w * i) / (n - 1) - 3 }]} />
        ))}
        {w > 0 && <View style={[styles.sliderKnob, { left: (w * idx) / (n - 1) - 11 }]} />}
      </View>
      <Text style={styles.sliderVal}>{steps[idx].label}</Text>
    </View>
  );
}

export default function TrackingFlowScreen({ navigation, route }) {
  const preset = route?.params?.body_site || null;   // 인체도에서 넘어온 부위(있으면 부위선택 건너뜀)
  const intake = route?.params?.intake || null;      // 사전문진 결과(질환명) — 모니터링 폴더 이름에 사용
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  const [step, setStep] = useState(preset ? 'overview' : 'site');   // site | overview | detail | processing | done
  const [part, setPart] = useState(null);
  const [side, setSide] = useState(null);
  const [bodySite, setBodySite] = useState(preset);

  // 프리셋 부위면 첫 사진(baseline)을 고스트·기준으로 로드 (최신이 아니라 baseline → 드리프트 방지)
  useEffect(() => {
    if (!preset) return;
    getSiteBaseline(preset).then((b) => {
      setGhostOverview(b?.overview_photo_path || null);
      setOpacity(b ? 0.5 : 0);
      if (b?.box_frac) setBoxFrac(b.box_frac);                 // 기준 세션 박스 크기 유지
      baselineOccRef.current = b?.skin_occupancy ?? null;
      baselineLesionRef.current = b?.lesion_pixels ?? null;
      if (b?.overview_photo_path) imageSignature(b.overview_photo_path, 32).then((s) => { baselineSigRef.current = s; }).catch(() => {});
      setBaseReady(true);   // baseline 로드 끝 → 라이브 루프가 hasBaseline을 다시 계산(2회차+ 자동촬영 활성화)
    });
  }, []);

  const [ghostOverview, setGhostOverview] = useState(null);   // 직전 원거리 사진 uri
  const [ghostDetail, setGhostDetail] = useState(null);       // 직전 근거리 사진 uri
  const [opacity, setOpacity] = useState(0.5);
  const [boxFrac, setBoxFrac] = useState(0.7);                // 규격 박스 크기(짧은변 대비): 소0.5/중0.7/대0.9
  const [facing, setFacing] = useState('back');              // 'back' | 'front'(셀카) — 몸통 등 자가촬영용
  const [busy, setBusy] = useState(false);
  const [baseReady, setBaseReady] = useState(false);         // baseline 비동기 로드 완료 → 라이브 루프 재평가 트리거
  const [cue, setCue] = useState(null);                      // null | 'ok' | 'near' | 'far' (라이브 방향 큐)
  const baselineOccRef = useRef(null);                       // baseline 피부 점유율
  const baselineLesionRef = useRef(null);                    // baseline 병변 픽셀(거리 큐 기준)
  const okCountRef = useRef(0);                              // 연속 정렬 카운트(자동촬영용)
  const prevLesionRef = useRef(null);                        // 직전 틱 병변 픽셀(ref 부위 안정성 판정)
  const baselineSigRef = useRef(null);                       // 첫 사진 시그니처(구도 일치 판별)

  const [overviewUri, setOverviewUri] = useState(null);
  const [detailUri, setDetailUri] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);         // { measure, severity, flags, saved, areaRef }
  const [capturedBoxUri, setCapturedBoxUri] = useState(null);   // ref 부위: 기준 표시용 크롭 이미지
  const [landmarkPts, setLandmarkPts] = useState([]);           // 기준 양 끝 탭(512 좌표)
  const [lmWrap, setLmWrap] = useState({ w: 0, h: 0 });

  // 카메라 권한 자동 요청 (없으면 셔터가 안 눌리는 것처럼 보임)
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission]);

  // 라이브 방향 큐 + 자동촬영 — 병변 크기(거리) 기준 baseline 대비 판정.
  // 병변이 작게 보이면 '더 가까이', 크게 보이면 '더 멀리', ±30% 이내면 '정렬' → 연속 2회면 자동 촬영.
  useEffect(() => {
    // 자동촬영 트리거는 병변 크기로(대략 프레이밍용). ref 부위도 켬 — 최종 면적은 촬영 후 랜드마크 탭으로 보정하므로 무방.
    if (step !== 'overview') { setCue(null); okCountRef.current = 0; prevLesionRef.current = null; return; }
    const baseLesion = baselineLesionRef.current, baseOcc = baselineOccRef.current;
    const hasBaseline = baseLesion != null || baseOcc != null;
    const isRefRegion = !!(bodySite && bodySite.ref);
    let cancelled = false, inFlight = false;
    const tick = async () => {
      if (inFlight || cancelled || busy || !cameraRef.current) return;
      inFlight = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false });
        if (!photo || cancelled) return;
        const boxUri = await cropToBox(photo.uri, boxFrac);
        const sig = await alignSignalsOnDevice(boxUri);
        if (cancelled) return;
        // 구도 일치: 첫 사진 시그니처와 상관도 (baseline 있을 때만 게이트)
        let compOK = true;
        if (baselineSigRef.current) {
          const curSig = await imageSignature(boxUri, 32);
          if (cancelled) return;
          compOK = sigCorr(curSig, baselineSigRef.current) >= COMP_THRESH;
        }
        let status;
        if (!hasBaseline) {
          // 1회차(기준 없음): 자동촬영 안 함(기준 사진은 신중히) — 담김 여부만 안내
          status = sig.lesion_on_skin >= MIN_LESION_PX ? 'ready' : 'searching';
        } else if (isRefRegion) {
          // 배꼽/유두 기준 부위: 거리 비교 없이 "담김 + 안정적(정지)"이면 자동 촬영
          const cur = sig.lesion_on_skin, prev = prevLesionRef.current;
          prevLesionRef.current = cur;
          if (cur < MIN_LESION_PX) status = 'searching';
          else if (prev != null && prev > 0 && Math.abs(cur - prev) / prev < 0.15) status = 'ok';
          else status = 'hold';   // 담겼지만 아직 흔들림 → 잠시 유지
        } else {
          // 일반 부위: 병변 크기 기준 거리 큐(병변 거의 없으면 피부점유율 폴백)
          let rel;
          if (baseLesion && baseLesion > 50) rel = (sig.lesion_on_skin - baseLesion) / baseLesion;
          else if (baseOcc && baseOcc > 0) rel = (sig.skin_occupancy - baseOcc) / baseOcc;
          else rel = 0;
          status = Math.abs(rel) <= ALIGN_TOL ? 'ok' : (rel < 0 ? 'near' : 'far');
        }
        // 구도가 첫 사진과 다르면 자동촬영 막고 안내 (2회차+에서만)
        if (status === 'ok' && hasBaseline && !compOK) status = 'mismatch';
        setCue(status);
        if (status === 'ok') {   // 'ok'는 baseline이 있는 2회차+에서만 → 자동 촬영
          okCountRef.current += 1;
          if (okCountRef.current >= 2 && !busy) { okCountRef.current = 0; shoot(); }
        } else {
          okCountRef.current = 0;
        }
      } catch (e) { /* 다음 주기 재시도 */ } finally { inFlight = false; }
    };
    const t = setTimeout(tick, 900);
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearTimeout(t); clearInterval(id); okCountRef.current = 0; prevLesionRef.current = null; };
  }, [step, boxFrac, busy, facing, baseReady]);   // baseReady: baseline 로드 후 hasBaseline 재평가 / facing: 카메라 전환 시 재시작

  // 부위 확정 → 첫 사진(baseline)을 고스트·기준으로 로드 후 원거리 단계로
  const confirmSite = async () => {
    if (!part) return;
    const bs = { part, side };
    setBodySite(bs);
    const b = await getSiteBaseline(bs);
    setGhostOverview(b?.overview_photo_path || null);
    setOpacity(b ? 0.5 : 0);             // 첫 촬영이면 오버레이 없음
    if (b?.box_frac) setBoxFrac(b.box_frac);
    baselineOccRef.current = b?.skin_occupancy ?? null;
    baselineLesionRef.current = b?.lesion_pixels ?? null;
    baselineSigRef.current = b?.overview_photo_path ? await imageSignature(b.overview_photo_path, 32).catch(() => null) : null;
    setBaseReady(true);
    setStep('overview');
  };

  // 단일 규격 촬영: ref(랜드마크) 부위면 기준표시 단계로, 아니면 바로 측정
  const shoot = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      setOverviewUri(photo.uri);
      if (bodySite && bodySite.ref) {
        const boxUri = await cropToBox(photo.uri, boxFrac);
        setCapturedBoxUri(boxUri); setLandmarkPts([]); setStep('landmark');
      } else {
        setStep('processing');
        processAll(photo.uri);
      }
    } finally { setBusy(false); }
  };

  // 한 장에서: 피부/병변 세그 → 면적(area_ratio) + 병변 bbox 크롭 → 중증도. 품질검증 후 저장.
  const processAll = async (photoUri) => {
    try {
      setStatus('규격 박스 크롭...');
      const boxUri = await cropToBox(photoUri, boxFrac);   // 가이드 박스 영역만 잘라 분석(해상도↑, 분모 표준화)
      setStatus('면적 측정 중...');
      const measure = await measureAreaOnDevice(boxUri, setStatus);
      setStatus('중증도 평가 중...');
      const diag = await diagnoseOnDevice(boxUri, true, setStatus);   // 박스 크롭의 병변 bbox로 중증도
      const baseline = await getSiteBaseline(bodySite);   // 저장 전이라 '직전 기준'
      const flags = evaluateQuality(measure, baseline);
      const saved = await saveSession({
        body_site: bodySite,
        overviewUri: boxUri, detailUri: null,             // 박스 크롭 이미지를 저장(측정과 일치)
        lesion_pixels: measure.lesion_on_skin,
        bodypart_pixels: measure.bodypart_pixels,
        area_ratio: measure.area_ratio, measure_mode: 'skin',
        severity_scores: diag?.severity || null,
        quality_flags: qualityFlagKeys(flags),
        skin_occupancy: measure.skin_occupancy,
        laplacian_var: measure.laplacian_var,
        box_frac: boxFrac,
      });
      // 실측 면적%·중증도를 모니터링 기록으로 남긴다 → 홈·기록·모니터링 상세에 실제 값 반영
      try {
        recordAreaMeasurement({
          name: folderNameOf(bodySite?.part, intake?.disease),
          areaPct: measure.area_ratio,
          severity: diag?.severity || [],
          photoUri: boxUri,
        });
      } catch (e) { /* 기록 실패가 측정 결과 표시를 막지 않도록 무시 */ }
      setResult({ measure, severity: diag?.severity || [], flags, saved, mode: 'skin', value: measure.area_ratio });
      setStep('done');
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  // 기준(랜드마크) 대비 측정 — area = 병변면적 ÷ 기준면적 (거리불변). refArea: 배꼽 원 면적(512² px)
  const processAllRef = async (boxUri, refArea) => {
    setStep('processing');
    try {
      setStatus('면적 측정 중...');
      const measure = await measureAreaOnDevice(boxUri, setStatus);
      setStatus('중증도 평가 중...');
      const diag = await diagnoseOnDevice(boxUri, true, setStatus);
      const areaRef = refArea > 0 ? Math.round((measure.lesion_on_skin / refArea) * 10) / 10 : null;   // 병변=배꼽면적의 N배
      const baseline = await getSiteBaseline(bodySite);
      const flags = evaluateQuality(measure, baseline);
      const saved = await saveSession({
        body_site: bodySite, overviewUri: boxUri, detailUri: null,
        lesion_pixels: measure.lesion_on_skin, bodypart_pixels: measure.bodypart_pixels,
        area_ratio: areaRef, measure_mode: 'ref', ref_name: bodySite.ref, landmark_px: Math.round(refArea),
        severity_scores: diag?.severity || null, quality_flags: qualityFlagKeys(flags),
        skin_occupancy: measure.skin_occupancy, laplacian_var: measure.laplacian_var, box_frac: boxFrac,
      });
      // 기준물(배꼽/양안) 모드여도 모니터링 기록엔 피부 대비 면적%(measure.area_ratio)를 남겨 단위 일관성 유지
      try {
        recordAreaMeasurement({
          name: folderNameOf(bodySite?.part, intake?.disease),
          areaPct: measure.area_ratio,
          severity: diag?.severity || [],
          photoUri: boxUri,
        });
      } catch (e) { /* 기록 실패 무시 */ }
      setResult({ measure, severity: diag?.severity || [], flags, saved, mode: 'ref', value: areaRef });
      setStep('done');
    } catch (e) { setError(e?.message || String(e)); }
  };

  // 기준 표시 이미지 탭 → 512 좌표로 저장(최대 2점, 3번째면 리셋)
  const onLandmarkTap = (e) => {
    if (lmWrap.w <= 0) return;
    const { locationX, locationY } = e.nativeEvent;
    const p = { x: (locationX / lmWrap.w) * 512, y: (locationY / lmWrap.h) * 512 };
    setLandmarkPts((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  };
  const confirmLandmark = () => {
    if (landmarkPts.length < 2 || !capturedBoxUri) return;
    const dx = landmarkPts[0].x - landmarkPts[1].x, dy = landmarkPts[0].y - landmarkPts[1].y;
    processAllRef(capturedBoxUri, Math.hypot(dx, dy));
  };

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={styles.permBox}>
        <Text style={styles.permText}>카메라 권한이 필요합니다</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>권한 허용</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- 부위 선택 ----
  if (step === 'site') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
        <Header title="면적 추적 · 부위 선택" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={styles.label}>부위</Text>
          <View style={styles.chips}>
            {PARTS.map(p => (
              <TouchableOpacity key={p} onPress={() => setPart(p)}
                style={[styles.chip, part === p && styles.chipOn]}>
                <Text style={[styles.chipTxt, part === p && styles.chipTxtOn]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>방향(좌/우·앞/뒤)</Text>
          <View style={styles.chips}>
            {SIDES.map(s => (
              <TouchableOpacity key={String(s.key)} onPress={() => setSide(s.key)}
                style={[styles.chip, side === s.key && styles.chipOn]}>
                <Text style={[styles.chipTxt, side === s.key && styles.chipTxtOn]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.note}>
            좌/우, 앞/뒤는 각각 별도로 기록됩니다(합쳐 평균내지 않음). 같은 부위를 매번 같은 방향으로 촬영하세요.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, !part && styles.primaryBtnOff]}
            disabled={!part} onPress={confirmSite}>
            <Text style={styles.primaryTxt}>
              {part ? `"${siteLabel({ part, side })}" 촬영 시작` : '부위를 선택하세요'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- 촬영 (단일 규격 촬영, 정사각 프리뷰 = 크롭 영역 일치) ----
  if (step === 'overview') {
    const ghost = ghostOverview;
    return (
      <View style={styles.black}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => (preset ? navigation.goBack() : setStep('site'))}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{siteLabel(bodySite)} · 규격 촬영</Text>
            <TouchableOpacity onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}>
              <Ionicons name="camera-reverse" size={26} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* 정사각형 프리뷰: 보이는 대로 = 찍히는 대로 (박스=실제 크롭 영역) */}
          <View style={styles.camCenter}>
            <View style={styles.cameraWrap}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
              {/* 라이브 방향 큐 (baseline 있을 때만) */}
              {cue && (
                <View style={[styles.alignBadge, (cue === 'ok' || cue === 'ready' || cue === 'hold') ? styles.alignOk : styles.alignWarn]} pointerEvents="none">
                  <Ionicons
                    name={cue === 'ok' ? 'checkmark-circle' : cue === 'ready' ? 'checkmark-circle'
                      : cue === 'hold' ? 'hourglass' : cue === 'mismatch' ? 'sync-outline'
                      : cue === 'searching' ? 'scan-circle'
                      : cue === 'near' ? 'add-circle' : 'remove-circle'}
                    size={16} color="#fff" />
                  <Text style={styles.alignTxt}>
                    {cue === 'ok'
                      ? (bodySite && bodySite.ref
                          ? `${bodySite.ref} 포함 · 유지됨 — 움직이지 마세요 (자동 촬영)`
                          : '정렬됨 — 움직이지 마세요 (자동 촬영 중)')
                      : cue === 'ready' ? '병변 잘 담김 — 셔터를 눌러 기준 사진 촬영'
                      : cue === 'mismatch' ? '이전 구도에 맞춰주세요 (구도 다름)'
                      : cue === 'hold' ? (bodySite && bodySite.ref ? `${bodySite.ref} 포함해 잠시 그대로 유지` : '잠시 그대로 유지')
                      : cue === 'searching' ? (bodySite && bodySite.ref ? `${bodySite.ref}·병변을 프레임에 담아주세요` : '병변을 박스 안에 크게 담아주세요')
                      : cue === 'near' ? '더 가까이 (병변이 작게 보임)'
                      : '더 멀리 (병변이 크게 보임)'}
                  </Text>
                </View>
              )}
              {/* 규격 가이드 프레임 (안에 고스트 오버레이 정렬) */}
              <View style={styles.frameOverlay} pointerEvents="none">
                <View style={[styles.guideFrame, { width: `${Math.round(boxFrac * 100)}%` }]}>
                  {ghost && opacity > 0 && (
                    <Image source={{ uri: ghost }} style={StyleSheet.absoluteFill}
                      resizeMode="cover" opacity={opacity} />
                  )}
                  <View style={[styles.corner, styles.tl]} />
                  <View style={[styles.corner, styles.tr]} />
                  <View style={[styles.corner, styles.bl]} />
                  <View style={[styles.corner, styles.br]} />
                </View>
              </View>
            </View>
          </View>

          <View style={styles.controls}>
            <Text style={styles.guideText}>병변부를 가이드 박스에 가득 채워 촬영</Text>
            {ghost
              ? <Text style={styles.guideSub}>이전 사진에 맞춰 같은 위치·거리로</Text>
              : <Text style={styles.guideSub}>첫 촬영 — 이 규격이 이후 기준</Text>}
            {preset?.ref && <Text style={styles.guideSub}>기준: {preset.ref}가 프레임에 들어오게 (크기 기준)</Text>}

            <BoxSlider value={boxFrac} onChange={setBoxFrac} />

            {ghost && (
              <View style={styles.opRow}>
                <Text style={styles.opLabel}>겹쳐보기</Text>
                {OPACITIES.map(o => (
                  <TouchableOpacity key={o.v} onPress={() => setOpacity(o.v)}
                    style={[styles.opChip, opacity === o.v && styles.opChipOn]}>
                    <Text style={[styles.opTxt, opacity === o.v && styles.opTxtOn]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.shutterWrap}>
              <TouchableOpacity style={styles.shutter} disabled={busy} onPress={() => shoot()} />
              {busy && <ActivityIndicator color="#fff" style={{ marginTop: 10 }} />}
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---- 기준(랜드마크) 표시 (ref 부위) ----
  if (step === 'landmark') {
    return (
      <LandmarkPicker
        uri={capturedBoxUri}
        refName={bodySite?.ref}
        mode={bodySite?.ref_mode || 'circle'}
        onBack={() => setStep('overview')}
        onConfirm={(refArea) => processAllRef(capturedBoxUri, refArea)}
      />
    );
  }

  // ---- 처리 중 / 오류 ----
  if (step === 'processing') {
    if (error) {
      return (
        <SafeAreaView style={styles.safe}>
          <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
          <Header title="측정 오류" onBack={() => navigation.goBack()} />
          <View style={styles.center}>
            <Ionicons name="alert-circle" size={44} color={AppColors.sev3} />
            <Text style={styles.errTxt}>{error}</Text>
            <TouchableOpacity style={styles.primaryBtn}
              onPress={() => { setError(null); processAll(detailUri); }}>
              <Text style={styles.primaryTxt}>다시 시도</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.ghostTxt}>나가기</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
        <Header title="측정 중" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={AppColors.greenMuted} />
          <Text style={styles.status}>{status || '처리 중...'}</Text>
          <Text style={styles.statusSub}>최초 1회는 모델 로딩으로 최대 20초까지 걸릴 수 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---- 완료 ----
  const q = result ? qualitySummary(result.flags) : { ok: true, text: '' };
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
      <Header title="측정 기록됨" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{siteLabel(bodySite)}</Text>
          {result?.measure?.overlayUri && (
            <Image source={{ uri: result.measure.overlayUri }} style={styles.overlay} resizeMode="cover" />
          )}
          <View style={styles.rowBig}>
            <Text style={styles.bigLabel}>병변 면적</Text>
            <Text style={styles.bigVal}>
              {result?.value != null ? `${Math.round(result.value)}%` : '-'}
            </Text>
          </View>
          <Text style={styles.measureOnly}>
            {result?.mode === 'ref'
              ? `「${bodySite?.ref}」 크기를 기준으로 한 병변 면적입니다. (참고용, 거리불변)`
              : `피부 면적 대비 병변 면적입니다. (참고용 측정값)`}
          </Text>

          {result?.severity?.length > 0 && (
            <View style={styles.sevBox}>
              {result.severity.map(s => (
                <View key={s.key} style={styles.sevRow}>
                  <Text style={styles.sevName}>{s.name}</Text>
                  <Text style={styles.sevVal}>{s.grade_ko}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.qBox, { backgroundColor: q.ok ? '#EAF5DF' : '#FDF3DD' }]}>
            <Text style={[styles.qTitle, { color: q.ok ? AppColors.greenMuted : '#B26A00' }]}>
              {q.ok ? '✅ 측정 품질 양호' : `⚠️ 품질 경고 ${result.flags.length}건 (기록은 저장됨)`}
            </Text>
            {result?.flags?.map((f, i) => <Text key={i} style={styles.qLine}>· {f.msg}</Text>)}
          </View>
        </View>

        <TouchableOpacity style={styles.primaryBtn}
          onPress={() => navigation.replace('TrackingSiteDetail', { body_site: bodySite })}>
          <Text style={styles.primaryTxt}>추이 보기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn}
          onPress={() => navigation.replace('TrackingBody')}>
          <Text style={styles.ghostTxt}>다른 부위 촬영</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn}
          onPress={async () => {
            if (result?.saved?.id) await softDeleteSession(result.saved.id);
            navigation.replace('TrackingBody');
          }}>
          <Text style={styles.discardTxt}>잘못 찍었어요 · 이 기록 삭제</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, onBack }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
      ) : <View style={{ width: 26 }} />}
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 26 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bg },
  black: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: AppColors.greenDeep, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.greenDeep, marginTop: 8, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1,
          borderColor: AppColors.line, backgroundColor: AppColors.card },
  chipOn: { backgroundColor: AppColors.greenTop, borderColor: AppColors.greenTop },
  chipTxt: { color: AppColors.ink, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: AppColors.greenDeep, fontWeight: '800' },
  note: { fontSize: 12, color: AppColors.sub, lineHeight: 18, marginTop: 8, marginBottom: 20 },
  primaryBtn: { backgroundColor: AppColors.greenTop, borderRadius: 20, paddingVertical: 15,
                alignItems: 'center', marginTop: 8, ...cardShadow },
  primaryBtnOff: { backgroundColor: AppColors.navInactive },
  primaryTxt: { color: AppColors.greenDeep, fontSize: 15, fontWeight: '800' },
  ghostBtn: { paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  ghostTxt: { color: AppColors.greenMuted, fontSize: 14, fontWeight: '600' },
  discardTxt: { color: AppColors.sev3, fontSize: 14, fontWeight: '600' },
  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: AppColors.greenDeep },
  permText: { color: '#fff', fontSize: 16, marginBottom: 16 },
  permBtn: { backgroundColor: '#fff', padding: 12, borderRadius: 12 },
  permBtnText: { color: AppColors.greenDeep, fontWeight: '700' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  topTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  camCenter: { flex: 1, justifyContent: 'center', backgroundColor: '#000' },
  cameraWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#000', overflow: 'hidden' },
  controls: { alignItems: 'center', paddingTop: 10, paddingBottom: 16 },
  alignBadge: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
                gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, zIndex: 5 },
  alignOk: { backgroundColor: 'rgba(46,160,67,0.92)' },
  alignWarn: { backgroundColor: 'rgba(226,83,63,0.92)' },
  alignTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingHorizontal: 24, alignSelf: 'stretch' },
  sliderTrackWrap: { flex: 1, height: 34, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  sliderTick: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)', top: 14 },
  sliderKnob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', top: 6,
                borderWidth: 2, borderColor: 'rgba(0,0,0,0.15)' },
  sliderVal: { color: '#fff', fontSize: 14, fontWeight: '800', width: 26, textAlign: 'center' },
  frameOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guideFrame: { width: '78%', aspectRatio: 1, borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.35)', borderRadius: 14 },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#fff', borderWidth: 3 },
  tl: { top: -2, left: -2, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  tr: { top: -2, right: -2, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  bl: { bottom: -2, left: -2, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  br: { bottom: -2, right: -2, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  guideBox: { alignItems: 'center', marginBottom: 14, paddingHorizontal: 24 },
  guideText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  guideSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 6, textAlign: 'center' },
  opRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  opLabel: { color: '#fff', fontSize: 12, marginRight: 4 },
  opChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)' },
  opChipOn: { backgroundColor: AppColors.greenTop },
  opTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  opTxtOn: { color: AppColors.greenDeep },
  shutterWrap: { alignItems: 'center', paddingBottom: 30 },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff',
             borderWidth: 4, borderColor: AppColors.greenTop },
  lmTitle: { fontSize: 15, fontWeight: '800', color: AppColors.ink, textAlign: 'center' },
  lmSub: { fontSize: 12, color: AppColors.sub, textAlign: 'center', marginTop: 5 },
  lmImgWrap: { width: '92%', aspectRatio: 1, alignSelf: 'center', marginTop: 12,
               backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
  lmDot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#E8A33D',
           borderWidth: 2, borderColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  status: { color: AppColors.ink, fontSize: 14 },
  statusSub: { color: AppColors.sub, fontSize: 12, marginTop: 2, textAlign: 'center', paddingHorizontal: 30 },
  errTxt: { color: AppColors.sev3, fontSize: 13, textAlign: 'center', paddingHorizontal: 30, lineHeight: 19 },
  card: { backgroundColor: AppColors.card, borderRadius: 20, padding: 16, marginBottom: 14, ...cardShadow },
  cardTitle: { fontSize: 16, fontWeight: '700', color: AppColors.ink, marginBottom: 12 },
  overlay: { width: '100%', aspectRatio: 1, borderRadius: 14, marginBottom: 12, backgroundColor: '#000' },
  rowBig: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bigLabel: { fontSize: 14, color: AppColors.ink, fontWeight: '600' },
  bigVal: { fontSize: 28, fontWeight: '800', color: AppColors.greenMuted },
  measureOnly: { fontSize: 12, color: AppColors.sub, marginTop: 4 },
  sevBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: AppColors.line, paddingTop: 10 },
  sevRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  sevName: { color: AppColors.sub, fontSize: 13 },
  sevVal: { color: AppColors.ink, fontSize: 13, fontWeight: '700' },
  qBox: { marginTop: 14, padding: 12, borderRadius: 12 },
  qTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  qLine: { fontSize: 12, color: '#5A4A2A', lineHeight: 18 },
});
