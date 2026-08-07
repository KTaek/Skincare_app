import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { AppColors } from '../theme';
import { analyzeLocal } from '../ai/analyzeLocal';
import { classifyDisease, preloadDiseaseModel } from '../ai/diseaseModel';
import { preloadModels } from '../ai/tfliteService';
import { GRADE_NAMES_KO } from '../ai/labels';
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
 * 카메라 탭 — 검사 한 건의 전체 흐름을 붙들고 있는 화면.
 *
 *   ① 시작 화면에서 "신규 검사 / 경과 이어서 기록"을 고르고
 *   ② ExamFlow가 (부위 → 질환 → 가려움 문진 →) 가이드 촬영까지 진행한 뒤
 *   ③ 여기서 온디바이스 분석을 돌리고
 *   ④ ExamResultScreen이 검사 종류에 맞는 깊이로 결과를 보여준다.
 *
 * 질환 분류 모델은 "신규 검사 + 전문의 진단 이력 없음"일 때만 돌린다 — 진단명이 이미 있거나
 * 이미 지켜보는 자리를 다시 찍는 경우엔 질환을 새로 맞힐 이유가 없다.
 */
type Stage = 'start' | 'flow' | 'analyzing' | 'result' | 'error';

export default function CameraScreen({ navigation, route }: { navigation: any; route?: any }) {
  const [stage, setStage] = useState<Stage>('start');
  const [kind, setKind] = useState<ExamKind>('new');
  const [followUp, setFollowUp] = useState<{ folderId: string; target: MonitorTarget } | null>(null);
  const [capture, setCapture] = useState<ExamCapture | null>(null);
  const [analysis, setAnalysis] = useState<ExamAnalysis | null>(null);
  const [sleepScore, setSleepScore] = useState<number | null>(null);
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
    setKind('new');
    setFollowUp(null);
    setCapture(null);
    setAnalysis(null);
    setSleepScore(null);
    setLinkedFolder(null);
    setError(null);
  }, []);

  // 카메라 탭이 다시 열릴 때마다 초기화
  useFocusEffect(
    useCallback(() => {
      // 기록 탭의 "신규 검사 시작하기"로 들어오면 시작 화면을 건너뛰고 바로 신규 검사로 들어간다
      const startNew = routeRef.current?.params?.mode === 'new';
      if (startNew) navigation.setParams({ mode: undefined });
      reset();
      if (startNew) {
        setKind('new');
        setStage('flow');
      }
      setGuarded(false);
    }, [reset, setGuarded, navigation]),
  );

  // 저장하지 않은 결과가 떠 있는 동안에는 다른 탭으로 못 빠져나가게 보호
  React.useEffect(() => {
    setGuarded(stage === 'result');
  }, [stage, setGuarded]);

  /** 촬영이 끝나면 온디바이스 분석을 돌리고 결과 화면으로 넘어간다 */
  const runAnalysis = useCallback(
    async (cap: ExamCapture) => {
      setCapture(cap);
      setStage('analyzing');
      try {
        // dump 모드에서는 모델을 부르지 않고 지어낸 값으로 결과 화면을 채운다.
        // 세션 id를 씨앗으로 써서 같은 촬영이면 항상 같은 숫자가 나온다.
        const local = DUMP_RESULTS ? makeDumpLocalResult(cap.session.id) : await analyzeLocal(cap.photoUri);

        // 의사 진단이 있거나 경과 이어서 기록이면 질환 분류 모델은 건너뛴다
        const skipDisease = cap.kind === 'followUp' || !!cap.target.diagnosis?.diagnosed;
        let diseases: ExamAnalysis['diseases'] = null;
        if (!skipDisease) {
          const predictions = DUMP_RESULTS
            ? makeDumpDiseases(cap.session.id)
            : await classifyDisease(cap.photoUri);
          diseases = predictions.slice(0, 3);
          // 추정한 이름을 대상에 붙여 둔다 — 폴더 이름과 기록의 질환명이 여기서 나온다
          const top = predictions[0];
          if (top) {
            setDiagnosis(cap.target.id, {
              diagnosed: false,
              disease: top.label,
              source: 'model',
              score: top.score,
              photoUri: cap.photoUri,
            });
          }
        }

        // 경과 이어서 기록은 이미 이어붙일 폴더가 정해져 있으므로 바로 오늘 기록으로 남긴다
        if (cap.kind === 'followUp' && cap.folderId) {
          const written = recordExam({
            folderId: cap.folderId,
            ...toFolderMetrics(local),
            itchVas: cap.itchVas,
            photoUri: cap.photoUri,
          });
          const folder = getFolder(cap.folderId);
          if (folder) setLinkedFolder({ id: folder.id, name: folder.name });
          setSleepScore(written?.hasSleepSource ? written.record.sleepScore : null);
        }

        setAnalysis({ local, diseases });
        setStage('result');
      } catch (e: any) {
        setError(e?.message ?? '알 수 없는 오류가 발생했어요');
        setStage('error');
      }
    },
    [setDiagnosis],
  );

  /**
   * 신규 검사 결과로 이 자리의 경과 기록 폴더를 만들고 오늘 기록을 넣는다.
   * 다른 자리의 폴더에 끼워 넣는 선택지는 두지 않는다 — 폴더 하나는 자리 하나를 계속 따라가야
   * 추이 비교가 의미가 있기 때문이다. (같은 자리를 또 검사하면 ensureFolder가 그 폴더를 돌려준다)
   */
  const linkToFolder = useCallback(() => {
    if (!capture || !analysis) return;
    const target = findTarget(capture.target.id) ?? capture.target;
    const id = ensureFolder({
      targetId: target.id,
      name: folderNameOf(target.label, target.diagnosis?.disease),
    });
    const written = recordExam({
      folderId: id,
      ...toFolderMetrics(analysis.local),
      itchVas: capture.itchVas,
      photoUri: capture.photoUri,
    });
    const folder = getFolder(id);
    if (folder) setLinkedFolder({ id: folder.id, name: folder.name });
    setSleepScore(written?.hasSleepSource ? written.record.sleepScore : null);
  }, [capture, analysis, findTarget]);

  const openFolder = useCallback(
    (folderId: string) => {
      setGuarded(false);
      navigation.navigate('MonitoringFolder', { folderId });
    },
    [navigation, setGuarded],
  );

  const saveAndGoToRecords = useCallback(() => {
    if (capture && analysis) {
      const target = findTarget(capture.target.id) ?? capture.target;
      const igaName = GRADE_NAMES_KO[analysis.local.igaGradeName] ?? analysis.local.igaGradeName;
      addRecord({
        date: new Date(),
        disease: target.diagnosis?.disease ?? igaName,
        sev: analysis.local.severity,
        itch: capture.itchVas != null ? `${capture.itchVas} / 10` : '등록 안함',
        region: PART_TO_REGION[target.part],
        photoUri: capture.photoUri,
        siteLabel: target.label,
        confidence: capture.session.confidence.score,
      });
    }
    setGuarded(false);
    navigation.navigate('Records');
  }, [capture, analysis, findTarget, addRecord, navigation, setGuarded]);

  if (stage === 'start') {
    return (
      <ExamStartScreen
        onNewExam={() => {
          setKind('new');
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
        sleepScore={sleepScore}
        linkedFolder={linkedFolder}
        onLink={linkToFolder}
        onOpenFolder={openFolder}
        onSave={saveAndGoToRecords}
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
          <Text style={styles.title}>병변을 분석하는 중...</Text>
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
