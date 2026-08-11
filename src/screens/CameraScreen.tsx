import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { AppColors } from '../theme';
import { analyzeLocal, normalSkinResult, unsupportedDiseaseResult, LocalAnalysisResult } from '../ai/analyzeLocal';
import { classifyDisease, preloadDiseaseModel } from '../ai/diseaseModel';
import { preloadModels } from '../ai/tfliteService';
import { GRADE_NAMES_KO, SEVERITY_SUPPORTED_DISEASE } from '../ai/labels';
import { DUMP_RESULTS, makeDumpDiseases, makeDumpLocalResult } from '../exam/dumpAnalysis';
import { useRecords } from '../context/RecordsContext';
import { useLeaveGuard } from '../context/LeaveGuardContext';
import { useMonitoring } from '../context/MonitoringContext';
import { PART_TO_REGION } from '../monitoring/bodyParts';
import { MonitorTarget } from '../monitoring/types';
import { ensureFolder, getFolder, recordExam } from '../folders/store';
import { folderNameOf } from '../folders/targets';
import { ExamAnalysis, ExamCapture, ExamKind } from '../exam/examTypes';
import { toFolderMetrics } from '../exam/examMetrics';
import ExamStartScreen from './ExamStartScreen';
import ExamFlow from './ExamFlow';
import ExamResultScreen from './ExamResultScreen';

/**
 * 피부 촬영 탭 — 기록 한 건의 전체 흐름을 붙들고 있는 화면.
 *
 *   ① 시작 화면에서 "이어서 기록하기 / 신규 증상 기록하기 / 피부 바로 스캔"을 고르고
 *   ② ExamFlow가 (부위 → 가려움 문진 →) 가이드 촬영까지 진행한 뒤
 *   ③ 여기서 온디바이스 분석을 돌리고
 *   ④ ExamResultScreen이 셋 모두 같은 구성으로 결과를 보여준다.
 *
 * 질환 분류 모델은 이미 지켜보는 자리를 다시 찍을 때(이어서 기록)와 사용자가 진단명을 직접
 * 넣어 둔 자리에서는 돌리지 않는다 — 그 경우엔 이름을 새로 맞힐 이유가 없다.
 *
 * 질환 분류를 먼저 끝내고, 1순위가 "정상"이면 세그멘테이션·중증도 모델(analyzeLocal)은 돌리지
 * 않는다 — 이미 정상 피부라고 판단된 사진에 그 모델까지 돌리면 잡음을 병변처럼 읽을 수 있어서,
 * 대신 normalSkinResult로 "이상 없음"(피부 종합 상태 100점, 세부 증상 전부 없음)을 바로 확정한다.
 */
type Stage = 'start' | 'flow' | 'analyzing' | 'result' | 'error';

export default function CameraScreen({ navigation, route }: { navigation: any; route?: any }) {
  const [stage, setStage] = useState<Stage>('start');
  const [kind, setKind] = useState<ExamKind>('new');
  /** 홈에서 들어왔을 때 시작 화면에 미리 골라 둘 선택지 */
  const [startPick, setStartPick] = useState<'new' | 'followUp' | 'quick' | null>(null);
  const [followUp, setFollowUp] = useState<{ folderId: string; target: MonitorTarget } | null>(null);
  const [capture, setCapture] = useState<ExamCapture | null>(null);
  const [analysis, setAnalysis] = useState<ExamAnalysis | null>(null);
  const [linkedFolder, setLinkedFolder] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { addRecord } = useRecords();
  const { setGuarded, guardedAction } = useLeaveGuard();
  const { findTarget, setDiagnosis } = useMonitoring();

  // 화면 진입 시 모델을 미리 로드해 첫 분석 지연을 줄인다.
  // dump 모드에서는 모델을 쓰지 않으므로 불러오지도 않는다 — 큰 모델 3개를 동시에 만들다가
  // 메모리 할당이 실패하던 것이 지금 모델이 안 뜨는 원인이기도 하다.
  React.useEffect(() => {
    if (DUMP_RESULTS) return;
    preloadModels();
    preloadDiseaseModel();
  }, []);

  // 라우트 파라미터는 ref로 읽는다 — 의존성에 넣으면 아래 초기화 효과가 다시 돌면서 단계가 되돌아간다
  const routeRef = React.useRef(route);
  routeRef.current = route;

  const reset = useCallback(() => {
    setStage('start');
    setStartPick(null);
    setKind('new');
    setFollowUp(null);
    setCapture(null);
    setAnalysis(null);
    setLinkedFolder(null);
    setError(null);
  }, []);

  // 카메라 탭이 다시 열릴 때마다 초기화
  useFocusEffect(
    useCallback(() => {
      // 홈/기록 탭의 버튼으로 들어오면 시작 화면의 선택 단계를 건너뛰거나 미리 골라 둔다
      const mode = routeRef.current?.params?.mode;
      if (mode) navigation.setParams({ mode: undefined });
      reset();
      if (mode === 'new') {
        setKind('new');
        setStage('flow');
      } else if (mode === 'quick') {
        // 홈 카드에 이미 "저장되지 않는다"는 안내가 붙어 있어서 바로 촬영으로 들어간다
        setKind('quick');
        setStage('flow');
      } else if (mode === 'followUp') {
        setStartPick('followUp');
      }
      setGuarded(false);
    }, [reset, setGuarded, navigation]),
  );

  // 분석 결과 자체는 자동으로 저장되므로(saveExamRecord) 더 이상 붙잡을 이유가 없다.
  // 남은 건 신규 기록의 "경과 관찰에 연동" 하나뿐이라 — 그걸 누르지 않고 나가면 폴더가 만들어지지
  // 않는다 — 아직 연동하지 않은 신규 결과에서만 확인창을 띄운다.
  React.useEffect(() => {
    setGuarded(stage === 'result' && kind === 'new' && !linkedFolder);
  }, [stage, kind, linkedFolder, setGuarded]);

  /**
   * 이번 분석을 기록으로 남긴다. 결과 화면이 뜨는 순간 자동으로 불린다.
   *
   * 대상의 진단명은 방금 setDiagnosis로 갱신했을 수 있는데 그 값은 다음 렌더에야 보이므로,
   * 이번 분석이 알아낸 이름(predicted)을 인자로 받아 쓴다.
   */
  const saveExamRecord = useCallback(
    (cap: ExamCapture, local: LocalAnalysisResult, predicted?: string) => {
      const igaName = GRADE_NAMES_KO[local.igaGradeName] ?? local.igaGradeName;
      addRecord({
        date: new Date(),
        disease: cap.target.diagnosis?.disease ?? predicted ?? igaName,
        sev: local.severity,
        itch: cap.itchVas != null ? `${cap.itchVas} / 10` : '등록 안함',
        region: PART_TO_REGION[cap.target.part],
        photoUri: cap.photoUri,
        siteLabel: cap.target.label,
        confidence: cap.session.confidence.score,
      });
    },
    [addRecord],
  );

  /** 촬영이 끝나면 온디바이스 분석을 돌리고 결과 화면으로 넘어간다 */
  const runAnalysis = useCallback(
    async (cap: ExamCapture) => {
      setCapture(cap);
      setStage('analyzing');
      try {
        // 촬영 후처리가 계산해 둔 조명 보정 게인 — 사진은 그대로 두고 모델 입력에만 적용한다.
        // 기준 세션이거나 조명을 추정하지 못한 촬영에서는 [1,1,1]이라 아무 효과가 없다.
        const colorGain = cap.session.colorNorm?.gain;

        // 진단명을 직접 넣어 둔 자리이거나 이어서 기록이면 질환 분류 모델은 건너뛴다
        const skipDisease = cap.kind === 'followUp' || !!cap.target.diagnosis?.diagnosed;
        let diseases: ExamAnalysis['diseases'] = null;
        let predictedDisease: string | undefined;
        // 이 촬영에서 최종적으로 쓰는 진단명 — 새로 분류했으면 그 이름, 건너뛰었으면 이미 알던 이름
        let diseaseName: string | undefined = cap.target.diagnosis?.disease;
        // 질환 분류 1순위가 "정상"이면 세그멘테이션·중증도 모델(analyzeLocal)은 돌리지 않고
        // 바로 "이상 없음"으로 확정한다 — 그래서 질환 분류를 먼저 끝내 둔다.
        let isNormalSkin = false;
        if (!skipDisease) {
          const predictions = DUMP_RESULTS
            ? makeDumpDiseases(cap.session.id)
            : await classifyDisease(cap.photoUri, colorGain);
          diseases = predictions.slice(0, 3);
          // 추정한 이름을 대상에 붙여 둔다 — 폴더 이름과 기록의 질환명이 여기서 나온다
          const top = predictions[0];
          if (top) {
            predictedDisease = top.label;
            diseaseName = top.label;
            isNormalSkin = top.key === '정상';
            setDiagnosis(cap.target.id, {
              diagnosed: false,
              disease: top.label,
              source: 'model',
              score: top.score,
              photoUri: cap.photoUri,
            });
          }
        }

        // 4가지 증상·IGA 모델(Stage2)은 아토피피부염 채점 기준으로 학습돼 있어서, 다른 질환에는
        // 근거가 없다 — "정상"은 예외로, 병변이 없다는 뜻이라 어떤 질환이든 항상 유효하다.
        const isAtopic = diseaseName === SEVERITY_SUPPORTED_DISEASE;
        const severitySupported = isNormalSkin || isAtopic;

        // dump 모드에서는 모델을 부르지 않고 지어낸 값으로 결과 화면을 채운다.
        // 세션 id를 씨앗으로 써서 같은 촬영이면 항상 같은 숫자가 나온다.
        const local = DUMP_RESULTS
          ? makeDumpLocalResult(cap.session.id)
          : isNormalSkin
            ? await normalSkinResult(cap.photoUri)
            : isAtopic
              /*
                촬영 때 찾아 둔 자를 함께 넘긴다. 이게 있으면 분할이 **관심영역만** 보고(사진
                전체를 512로 누르지 않는다) 병변 넓이를 부위 크기로 나눈 지수까지 나온다 —
                회차 간 비교가 되는 유일한 넓이다. 없으면 예전과 똑같이 사진 전체를 분석한다.
              */
              ? await analyzeLocal(cap.photoUri, { colorGain, scale: cap.session.scale })
              /*
                아토피가 아닌 질환 — **부위 표시와 넓이는 그대로 하고 등급만 비운다.**
                자(scale)도 함께 넘겨야 관심영역을 크롭하고 넓이 지수가 나온다: 넓이 추이는
                질환 이름과 무관하게 성립하고, 사용자는 앱이 무엇을 보고 판단했는지 볼 수 있어야 한다.
              */
              : await unsupportedDiseaseResult(cap.photoUri, colorGain, cap.session.scale);

        // 경과 이어서 기록은 이미 이어붙일 폴더가 정해져 있으므로 바로 오늘 기록으로 남긴다
        if (cap.kind === 'followUp' && cap.folderId) {
          recordExam({
            folderId: cap.folderId,
            // 가이드와 어긋나게 찍혔으면 넓이만 빼고 나머지는 그대로 남긴다
            ...toFolderMetrics(local, cap.session.areaEligible),
            itchVas: cap.itchVas,
            photoUri: cap.photoUri,
          });
          const folder = getFolder(cap.folderId);
          if (folder) setLinkedFolder({ id: folder.id, name: folder.name });
        }

        // 분석이 끝나는 순간 결과를 남긴다 — 예전에는 결과 화면의 "결과 저장하고 기록 보기"를
        // 눌러야 저장됐는데, 그 버튼을 못 누르고 나가면 방금 찍은 것이 통째로 사라졌다.
        // 저장은 앱이 알아서 하고, 버튼은 어디로 갈지만 고르게 한다.
        if (cap.kind !== 'quick') saveExamRecord(cap, local, predictedDisease);

        setAnalysis({ local, diseases, severitySupported });
        setStage('result');
      } catch (e: any) {
        setError(e?.message ?? '알 수 없는 오류가 발생했어요');
        setStage('error');
      }
    },
    [setDiagnosis, saveExamRecord],
  );

  /**
   * 신규 증상 기록 결과로 이 자리의 경과 관찰 폴더를 만들고 오늘 기록을 넣는다.
   * 다른 자리의 폴더에 끼워 넣는 선택지는 두지 않는다 — 폴더 하나는 자리 하나를 계속 따라가야
   * 경과 비교가 의미가 있기 때문이다. (같은 자리를 또 찍으면 ensureFolder가 그 폴더를 돌려준다)
   *
   * 결과 화면의 "경과 폴더 생성" 버튼이 누른 그 자리에서 바로 폴더로 넘어가야 해서, 만든(또는
   * 이미 있던) 폴더 id를 그대로 돌려준다.
   */
  const linkToFolder = useCallback((): string => {
    if (!capture || !analysis) return ''; // 결과 화면이 떠 있는 동안만 눌리므로 실제로는 항상 값이 있다
    const target = findTarget(capture.target.id) ?? capture.target;
    const id = ensureFolder({
      targetId: target.id,
      name: folderNameOf(target.label, target.diagnosis?.disease),
      disease: target.diagnosis?.disease,
    });
    recordExam({
      folderId: id,
      ...toFolderMetrics(analysis.local, capture.session.areaEligible),
      itchVas: capture.itchVas,
      photoUri: capture.photoUri,
    });
    const folder = getFolder(id);
    if (folder) setLinkedFolder({ id: folder.id, name: folder.name });
    return id;
  }, [capture, analysis, findTarget]);

  const openFolder = useCallback(
    (folderId: string) => {
      setGuarded(false);
      navigation.navigate('MonitoringFolder', { folderId });
    },
    [navigation, setGuarded],
  );

  /** 저장은 이미 끝나 있다(saveExamRecord) — 여기서는 기록 탭으로 넘어가기만 한다 */
  const goToRecords = useCallback(() => {
    setGuarded(false);
    navigation.navigate('Records');
  }, [navigation, setGuarded]);

  if (stage === 'start') {
    return (
      <ExamStartScreen
        initialPick={startPick}
        onNewExam={() => {
          setKind('new');
          setFollowUp(null);
          setStage('flow');
        }}
        onQuickScan={() => {
          setKind('quick');
          setFollowUp(null);
          setStage('flow');
        }}
        onFollowUp={(folderId, target) => {
          setKind('followUp');
          setFollowUp({ folderId, target });
          setStage('flow');
        }}
      />
    );
  }

  if (stage === 'flow') {
    return (
      <ExamFlow
        kind={kind}
        target={followUp?.target}
        folderId={followUp?.folderId}
        onExit={reset}
        onCaptured={runAnalysis}
      />
    );
  }

  if (stage === 'result' && capture && analysis) {
    return (
      <ExamResultScreen
        capture={capture}
        analysis={analysis}
        linkedFolder={linkedFolder}
        onLink={linkToFolder}
        onOpenFolder={openFolder}
        onOpenRecords={goToRecords}
        onClose={() => guardedAction(() => navigation.navigate('Home'))}
      />
    );
  }

  return (
    <View style={styles.container}>
      {stage === 'analyzing' ? (
        <>
          <ActivityIndicator size="large" color={AppColors.greenTop} />
          <View style={{ height: 18 }} />
          <Text style={styles.title}>피부를 분석하는 중...</Text>
          <View style={{ height: 8 }} />
          <Text style={styles.sub}>기기에서 AI 모델이 이미지를 확인하고 있어요</Text>
        </>
      ) : (
        <>
          <MaterialIcons name="error-outline" size={36} color="#FF6B6B" />
          <View style={{ height: 14 }} />
          <Text style={styles.title}>분석에 실패했어요</Text>
          <View style={{ height: 8 }} />
          <Text style={styles.sub}>{error ?? '기기에서 분석을 완료하지 못했어요'}</Text>
          <View style={{ height: 18 }} />
          <Pressable style={styles.retryBtn} onPress={() => setStage('flow')}>
            <Text style={styles.retryBtnText}>다시 촬영하기</Text>
          </Pressable>
          <Pressable style={styles.closeBtn} onPress={reset}>
            <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14171C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
  retryBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13 },
  retryBtnText: { fontSize: 15, fontWeight: '700', color: '#16320A' },
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
});
