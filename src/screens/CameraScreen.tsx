import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle } from 'react-native-svg';
import { AppColors } from '../theme';
import { detectBboxLocal, analyzeLocal, LesionBox, LocalAnalysisResult } from '../ai/analyzeLocal';
import { preloadModels } from '../ai/tfliteService';
import { SIGN_NAMES_KO, GRADE_NAMES_KO } from '../ai/labels';
import { TOTAL_MODEL_SIZE_MB } from '../ai/modelInfo';
import { BodyRegion } from '../models';
import { useRecords } from '../context/RecordsContext';
import { useLeaveGuard } from '../context/LeaveGuardContext';
import { SevBadge } from '../components/widgets';
import BodyAreaScreen from './BodyAreaScreen';

type CamState = 'bodyArea' | 'ready' | 'rating' | 'analyzing' | 'result' | 'error';

export default function CameraScreen({ navigation }: { navigation: any }) {
  const [state, setState] = useState<CamState>('bodyArea');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [lesionBox, setLesionBox] = useState<LesionBox | null>(null);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [bodyRegion, setBodyRegion] = useState<BodyRegion | null>(null);
  const [itchLevel, setItchLevel] = useState<number | null>(null);
  const [result, setResult] = useState<LocalAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { addRecord } = useRecords();
  const { setGuarded, guardedAction } = useLeaveGuard();

  // 화면 진입 시 tflite 모델을 미리 로드해 첫 촬영 분석 지연을 줄인다
  React.useEffect(() => {
    preloadModels();
  }, []);

  // 카메라 탭이 다시 열릴 때마다 초기화 (Flutter의 reset() 대응)
  useFocusEffect(
    useCallback(() => {
      setState('bodyArea');
      setPhotoUri(null);
      setFacing('back');
      setBodyRegion(null);
      setItchLevel(null);
      setResult(null);
      setError(null);
      setGuarded(false);
    }, [setGuarded]),
  );

  // 저장하지 않은 분석 결과가 떠 있는 동안에는 다른 탭으로 못 빠져나가게 보호
  React.useEffect(() => {
    setGuarded(state === 'result');
  }, [state, setGuarded]);

  // 카메라를 켜놓은 동안 주기적으로 사진을 찍어 병변 위치 박스를 갱신
  React.useEffect(() => {
    if (state !== 'ready') {
      setLesionBox(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const photo = await cameraRef.current?.takePictureAsync({
          quality: 0.3,
          skipProcessing: true,
          shutterSound: false,
        });
        if (photo && !cancelled) {
          const box = await detectBboxLocal(photo.uri);
          if (!cancelled) setLesionBox(box);
        }
      } catch {
        // 한 번 실패해도 다음 주기에 다시 시도
      } finally {
        inFlight = false;
      }
    };

    const id = setInterval(tick, 1200);
    tick();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state]);

  const capture = async () => {
    const photo = await cameraRef.current?.takePictureAsync();
    if (!photo) return;
    setPhotoUri(photo.uri);
    setState('rating');
  };

  const flipCamera = () => {
    setLesionBox(null);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  };

  const pickFromGallery = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setPhotoUri(picked.assets[0].uri);
    setState('rating');
  };

  const analyze = async (uri: string, level: number) => {
    setItchLevel(level);
    setState('analyzing');
    try {
      const analysis = await analyzeLocal(uri);
      setResult(analysis);
      setState('result');
    } catch (e: any) {
      setError(e?.message ?? '알 수 없는 오류가 발생했어요');
      setState('error');
    }
  };

  const goHome = () => navigation.navigate('Home');

  const saveAndGoToRecords = () => {
    if (result) {
      addRecord({
        date: new Date(),
        disease: GRADE_NAMES_KO[result.igaGradeName] ?? result.igaGradeName,
        sev: result.severity,
        itch: `${itchLevel ?? '-'} / 10`,
        region: bodyRegion ?? undefined,
        photoUri: photoUri ?? undefined,
      });
    }
    setGuarded(false);
    navigation.navigate('Records');
  };

  if (state === 'bodyArea') {
    return (
      <BodyAreaScreen
        onBack={goHome}
        onChooseCamera={async (region) => {
          setBodyRegion(region);
          if (!permission?.granted) {
            const res = await requestPermission();
            if (!res.granted) return;
          }
          setState('ready');
        }}
        onChooseGallery={(region) => {
          setBodyRegion(region);
          pickFromGallery();
        }}
      />
    );
  }

  if (state === 'ready' && !permission?.granted) {
    return (
      <View style={[styles.container, styles.permissionContainer]}>
        <MaterialIcons name="photo-camera" size={40} color="rgba(255,255,255,0.7)" />
        <View style={{ height: 14 }} />
        <Text style={styles.permissionText}>병변 사진을 촬영하려면{'\n'}카메라 접근 권한이 필요해요</Text>
        <View style={{ height: 20 }} />
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>카메라 권한 허용하기</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={() => setState('bodyArea')}>
          <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    );
  }

  if (state === 'rating' && photoUri) {
    return (
      <RatingScreen onCancel={() => setState('ready')} onConfirm={(level) => analyze(photoUri, level)} />
    );
  }

  if (state === 'result' && result && photoUri) {
    return (
      <ResultScreen
        photoUri={photoUri}
        result={result}
        itchLevel={itchLevel}
        onSave={saveAndGoToRecords}
        onClose={() => guardedAction(goHome)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }} onLayout={(e) => setViewSize(e.nativeEvent.layout)}>
        {state === 'ready' ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
        ) : (
          <View style={StyleSheet.absoluteFill} />
        )}

        {state === 'ready' && lesionBox && viewSize.width > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.lesionBox,
              {
                left: (lesionBox.x / lesionBox.imageWidth) * viewSize.width,
                top: (lesionBox.y / lesionBox.imageHeight) * viewSize.height,
                width: (lesionBox.width / lesionBox.imageWidth) * viewSize.width,
                height: (lesionBox.height / lesionBox.imageHeight) * viewSize.height,
              },
            ]}
          />
        )}

        {/* 가이드 프레임 */}
        <View style={styles.center}>
          <View style={styles.guide} />
        </View>
        <Text style={styles.guideText}>병변이 프레임 안에 들어오도록 맞춰주세요</Text>
        {state !== 'ready' && (
          <Pressable style={styles.closeBtn} onPress={() => setState('bodyArea')}>
            <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
          </Pressable>
        )}

        {state !== 'ready' && (
          <View style={styles.overlay}>
            {state === 'analyzing' && <Analyzing />}
            {state === 'error' && <ErrorView message={error} onRetry={() => setState('ready')} />}
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        {state === 'ready' && (
          <View style={styles.bottomBarRow}>
            <Pressable style={styles.galleryBtn} onPress={() => setState('bodyArea')}>
              <MaterialIcons name="chevron-left" size={24} color="#FFFFFF" />
            </Pressable>
            <Pressable style={styles.shutter} onPress={capture} />
            <Pressable style={styles.galleryBtn} onPress={flipCamera}>
              <MaterialIcons name="flip-camera-ios" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function Analyzing({
  title = '병변을 분석하는 중...',
  subtitle = '기기에서 AI 모델이 이미지를 확인하고 있어요',
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <View style={{ alignItems: 'center' }}>
      <ActivityIndicator size="large" color={AppColors.greenTop} />
      <View style={{ height: 18 }} />
      <Text style={styles.analyzingTitle}>{title}</Text>
      <View style={{ height: 8 }} />
      <Text style={styles.analyzingSub}>{subtitle}</Text>
    </View>
  );
}

function itchSeverity(n: number) {
  if (n <= 3) return { color: AppColors.sev1, label: '약한 가려움' };
  if (n <= 7) return { color: AppColors.sev2, label: '보통 가려움' };
  return { color: AppColors.sev3, label: '심한 가려움' };
}

interface SurveyQuestion {
  question: string;
  options: string[];
}

/** 각 옵션의 점수는 배열 인덱스(0~4)와 동일. 기준 시간은 "최근 24시간" */
const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    question: '최근 24시간 동안 가장 심했던 가려움은 어느 정도였나요?',
    options: [
      '거의 없었다',
      '약간 신경 쓰이는 정도였다',
      '참을 수는 있지만 계속 느껴졌다',
      '꽤 불편했고 긁고 싶었다',
      '참기 어려울 정도로 심했다',
    ],
  },
  {
    question: '하루 중 가려움을 느낀 시간이 얼마나 되었나요?',
    options: ['거의 없었다', '30분 미만', '30분~2시간', '2~6시간', '하루 중 대부분'],
  },
  {
    question: '최근 24시간 동안 피부를 긁은 빈도는 어느 정도였나요?',
    options: [
      '거의 긁지 않았다',
      '가끔 긁었다',
      '하루에 여러 번 긁었다',
      '자주 긁었고 멈추기 어려웠다',
      '계속 긁게 되었거나 상처가 날 정도였다',
    ],
  },
  {
    question: '가려움 때문에 잠에 영향을 받았나요?',
    options: [
      '전혀 영향 없었다',
      '잠들기 전 조금 신경 쓰였다',
      '잠드는 데 방해가 되었다',
      '자다가 깬 적이 있었다',
      '잠을 제대로 못 잤다',
    ],
  },
  {
    question: '가려움 때문에 공부, 일, 외출, 집중에 방해가 되었나요?',
    options: [
      '전혀 방해되지 않았다',
      '조금 신경 쓰였다',
      '집중이 가끔 끊겼다',
      '일상생활에 꽤 방해가 되었다',
      '활동을 줄이거나 쉬어야 했다',
    ],
  },
  {
    question: '가려운 부위가 얼마나 넓었나요?',
    options: [
      '한 부위에만 작게 있었다',
      '1~2개 부위에 있었다',
      '여러 부위에 있었다',
      '팔/다리/몸통 등 넓게 있었다',
      '전신에 가깝게 느껴졌다',
    ],
  },
  {
    question: '긁은 뒤 피부 변화가 있었나요?',
    options: [
      '변화 없음',
      '약간 붉어짐',
      '긁은 자국이 남음',
      '상처/딱지/진물이 있음',
      '피부가 두꺼워지거나 색소침착이 뚜렷함',
    ],
  },
];

const SURVEY_MAX_SCORE = SURVEY_QUESTIONS.length * 4;

function RatingScreen({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (itchLevel: number) => void }) {
  const total = SURVEY_QUESTIONS.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(total).fill(null));

  const selectAnswer = (score: number) => {
    const next = [...answers];
    next[step] = score;
    setAnswers(next);

    if (step < total - 1) {
      setStep(step + 1);
      return;
    }
    const totalScore = next.reduce<number>((sum, a) => sum + (a ?? 0), 0);
    const itchScore = Math.round((totalScore / SURVEY_MAX_SCORE) * 10);
    onConfirm(itchScore);
  };

  const goBack = () => {
    if (step > 0) {
      setStep(step - 1);
    } else {
      onCancel();
    }
  };

  const question = SURVEY_QUESTIONS[step];
  const progress = (step + 1) / total;

  return (
    <View style={styles.resultRoot}>
      <View style={styles.surveyHeader}>
        <Pressable style={styles.surveyBackBtn} onPress={goBack}>
          <MaterialIcons name="chevron-left" size={26} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.surveyProgressText}>
          {step + 1} / {total}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.surveyBody}>
        <Text style={styles.surveyQuestion}>{question.question}</Text>
        <View style={{ height: 22 }} />
        {question.options.map((opt, idx) => (
          <Pressable key={idx} style={styles.optionCard} onPress={() => selectAnswer(idx)}>
            <Text style={styles.optionText}>{opt}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** 진단율/점수를 보여주는 원형 게이지 */
function RingPercent({
  percent,
  color,
  size = 56,
  label,
}: {
  percent: number;
  color: string;
  size?: number;
  label?: string;
}) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={AppColors.line} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringText}>{label ?? `${percent.toFixed(0)}%`}</Text>
    </View>
  );
}

const GRADE_COLOR: Record<string, string> = {
  None: AppColors.sub,
  Mild: AppColors.sev1,
  Moderate: AppColors.sev2,
  Severe: AppColors.sev3,
};

function SignGradeRow({ sign, gradeName }: { sign: string; gradeName: string }) {
  const color = GRADE_COLOR[gradeName] ?? AppColors.sub;
  return (
    <View style={[styles.rankCard, styles.signRow]}>
      <Text style={styles.rankLabel}>{SIGN_NAMES_KO[sign as keyof typeof SIGN_NAMES_KO] ?? sign}</Text>
      <View style={[styles.signGradeBadge, { backgroundColor: color }]}>
        <Text style={styles.signGradeBadgeText}>{GRADE_NAMES_KO[gradeName] ?? gradeName}</Text>
      </View>
    </View>
  );
}

function ResultScreen({
  photoUri,
  result,
  itchLevel,
  onSave,
  onClose,
}: {
  photoUri: string;
  result: LocalAnalysisResult;
  itchLevel: number | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const sev = itchSeverity(itchLevel ?? 0);
  const presentSigns = result.signs.filter((s) => s.grade > 0);
  const inferenceInfoText = `추론 ${Math.round(result.inferenceTimeMs)}ms · 모델 ${TOTAL_MODEL_SIZE_MB.toFixed(1)}MB`;

  return (
    <View style={styles.resultRoot}>
      <Image source={{ uri: photoUri }} style={styles.resultPhoto} />
      <Pressable style={styles.closeBtn} onPress={onClose}>
        <MaterialIcons name="close" size={20} color="#FFFFFF" />
      </Pressable>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.resultScrollContent}>
        <View style={styles.resultKickerRow}>
          <Text style={styles.resultKicker}>AI 분석 결과 (관찰된 소견)</Text>
          <Text style={styles.inferenceTimeText}>{inferenceInfoText}</Text>
        </View>
        <View style={{ height: 14 }} />
        {presentSigns.length > 0 ? (
          presentSigns.map((s) => <SignGradeRow key={s.sign} sign={s.sign} gradeName={s.gradeName} />)
        ) : (
          <Text style={styles.noSignsText}>뚜렷하게 관찰되는 소견이 없어요</Text>
        )}

        <View style={{ height: 18 }} />
        <Text style={styles.resultKicker}>종합 중증도 (IGA: {result.igaGradeName})</Text>
        <View style={{ height: 10 }} />
        <SevBadge sev={result.severity} prefix="중증도" />

        {itchLevel != null && (
          <>
            <View style={{ height: 8 }} />
            <Text style={styles.resultKicker}>가려움 정도</Text>
            <View style={{ height: 14 }} />
            <View style={styles.itchSummaryRow}>
              <RingPercent percent={(itchLevel / 10) * 100} color={sev.color} size={64} label={`${itchLevel}/10`} />
              <View style={{ width: 14 }} />
              <View style={[styles.itchSevBadge, { backgroundColor: sev.color }]}>
                <Text style={styles.itchSevBadgeText}>{sev.label}</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.resultFooter}>
        <Pressable style={styles.resultBtn} onPress={onSave}>
          <Text style={styles.resultBtnText}>결과 저장하고 기록 보기</Text>
        </Pressable>
        <View style={{ height: 12 }} />
        <Text style={styles.disclaimer}>
          ** 해당 앱은 치료와 진단을 하지 않습니다. 의심이 들 경우 전문의에게 상담하세요. **
        </Text>
      </View>
    </View>
  );
}

function ErrorView({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <MaterialIcons name="error-outline" size={36} color="#FF6B6B" />
      <View style={{ height: 14 }} />
      <Text style={styles.analyzingTitle}>분석에 실패했어요</Text>
      <View style={{ height: 8 }} />
      <Text style={styles.analyzingSub}>{message ?? '기기에서 분석을 완료하지 못했어요'}</Text>
      <View style={{ height: 18 }} />
      <Pressable style={styles.permissionBtn} onPress={onRetry}>
        <Text style={styles.permissionBtnText}>다시 시도하기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14171C' },
  permissionContainer: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  permissionText: { color: '#FFFFFF', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  permissionBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13 },
  permissionBtnText: { fontSize: 15, fontWeight: '700', color: '#16320A' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  guide: { width: 240, height: 240, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 24 },
  guideText: {
    position: 'absolute',
    top: 80,
    left: 30,
    right: 30,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#14171C',
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  analyzingSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  lesionBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#3CE26B',
    borderRadius: 4,
  },
  bottomBar: { height: 150, backgroundColor: '#14171C', alignItems: 'center', justifyContent: 'center' },
  bottomBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 40,
  },
  galleryBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#FFFFFF',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.15)',
  },

  resultRoot: { flex: 1, backgroundColor: AppColors.bg },
  resultPhoto: { width: '100%', height: 280, backgroundColor: '#14171C' },

  surveyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  surveyBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  surveyProgressText: { fontSize: 13, fontWeight: '700', color: AppColors.sub, marginRight: 16 },
  progressTrack: {
    height: 4,
    marginHorizontal: 16,
    borderRadius: 2,
    backgroundColor: AppColors.line,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: AppColors.greenTop, borderRadius: 2 },
  surveyBody: { padding: 24, paddingTop: 28 },
  surveyQuestion: { fontSize: 20, fontWeight: '800', color: AppColors.ink, lineHeight: 28 },
  optionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppColors.line,
    padding: 16,
    marginBottom: 12,
  },
  optionText: { fontSize: 15, fontWeight: '600', color: AppColors.ink },
  itchSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  itchSevBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  itchSevBadgeText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  resultScrollContent: { padding: 20 },
  resultKicker: { fontSize: 13, fontWeight: '600', color: AppColors.sub },
  resultKickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inferenceTimeText: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  noSignsText: { fontSize: 14, color: AppColors.sub, paddingVertical: 8 },
  rankLabel: { fontSize: 15, fontWeight: '600', color: AppColors.ink, flexShrink: 1 },
  rankCard: {
    ...cardRow(),
    backgroundColor: '#FFFFFF',
  },
  signRow: { justifyContent: 'space-between' },
  signGradeBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  signGradeBadgeText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  ringText: { position: 'absolute', fontSize: 13, fontWeight: '700', color: AppColors.ink },
  resultFooter: { padding: 20, paddingTop: 0 },
  resultBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, padding: 15 },
  resultBtnText: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#16320A' },
  disclaimer: { fontSize: 10, color: AppColors.sub, textAlign: 'center' },
});

function cardRow() {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  };
}
