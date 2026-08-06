import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppColors, cardDecoration } from '../theme';
import { classifyDisease, DiseasePrediction, preloadDiseaseModel } from '../ai/diseaseModel';

/** 문진 결과 — 모니터링 대상에 함께 저장된다 */
export interface IntakeResult {
  /** 피부과 전문의 진단을 받은 적이 있는지 */
  diagnosed: boolean;
  /** 질환명 (진단받았으면 사용자가 고른 이름, 아니면 모델이 분류한 이름) */
  disease: string;
  /** 이름의 출처 */
  source: 'self' | 'model';
  /** 모델 분류일 때의 확률 (0~1) */
  score?: number;
  /** 모델 분류에 쓴 사진 */
  photoUri?: string;
}

/** 사용자가 직접 고를 수 있는 질환 — 분류 모델의 클래스와 같은 집합에 "직접 입력"을 더한 것 */
const DIAGNOSES = ['건선', '여드름', '아토피피부염', '주사', '지루', '직접 입력'];

type Step = 'ask' | 'pick' | 'photo';

/**
 * 모니터링 등록 첫 단계 — 진단 이력을 묻는 문진.
 *
 * 진단을 받았다면 질환명을 직접 고르고, 받은 적이 없다면 사진 한 장을 찍어
 * 온디바이스 질환 분류 모델(EfficientNet-B0, 6-way)로 추정한다.
 * 어느 쪽이든 결과는 부위 선택(3D) 앞 단계에서 확정된다.
 */
export default function MonitorIntakeScreen({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: (result: IntakeResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('ask');
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState('');

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [predictions, setPredictions] = useState<DiseasePrediction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 사진 단계로 갈 가능성이 있으므로 모델을 미리 준비한다
  useEffect(() => {
    preloadDiseaseModel();
  }, []);

  const runClassification = async (uri: string) => {
    setPhotoUri(uri);
    setPredictions(null);
    setError(null);
    setBusy(true);
    try {
      setPredictions(await classifyDisease(uri));
    } catch (e: any) {
      setError(e?.message ?? '질환을 분류하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('카메라 권한이 필요해요');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!res.canceled && res.assets[0]) await runClassification(res.assets[0].uri);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('사진 접근 권한이 필요해요');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!res.canceled && res.assets[0]) await runClassification(res.assets[0].uri);
  };

  const selfName = picked === '직접 입력' ? custom.trim() : picked ?? '';
  const top = predictions?.[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (step === 'ask' ? onBack() : setStep('ask'))}
        >
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>모니터링 등록</Text>
      </View>
      <Text style={styles.step}>사전 문진</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.question}>피부과 전문의에게{'\n'}진단 받은 적이 있습니까?</Text>
        <View style={{ height: 16 }} />
        <View style={styles.choiceRow}>
          <ChoiceBtn label="예" active={step === 'pick'} onPress={() => setStep('pick')} />
          <ChoiceBtn label="아니오" active={step === 'photo'} onPress={() => setStep('photo')} />
        </View>

        {step === 'pick' && (
          <>
            <View style={{ height: 26 }} />
            <Text style={styles.question}>진단 받은 질환 명을 선택하세요</Text>
            <View style={{ height: 14 }} />
            <View style={styles.grid}>
              {DIAGNOSES.map((d) => (
                <Pressable
                  key={d}
                  style={[styles.gridBox, picked === d && styles.gridBoxActive]}
                  onPress={() => setPicked(d)}
                >
                  <Text style={[styles.gridText, picked === d && styles.gridTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>
            {picked === '직접 입력' && (
              <>
                <View style={{ height: 12 }} />
                <TextInput
                  style={styles.input}
                  value={custom}
                  onChangeText={setCustom}
                  placeholder="질환 명을 입력해주세요"
                  placeholderTextColor={AppColors.sub}
                />
              </>
            )}
          </>
        )}

        {step === 'photo' && (
          <>
            <View style={{ height: 26 }} />
            <Text style={styles.question}>병변 사진을 한 장 찍어주세요</Text>
            <View style={{ height: 4 }} />
            <Text style={styles.caption}>사진으로 질환을 추정해 드려요. 진단이 아니라 참고용이에요.</Text>
            <View style={{ height: 14 }} />

            {photoUri && <Image source={{ uri: photoUri }} style={styles.photo} />}

            <View style={styles.choiceRow}>
              <SmallBtn icon="photo-camera" label="사진 촬영" onPress={takePhoto} />
              <SmallBtn icon="photo-library" label="앨범에서 선택" onPress={pickPhoto} />
            </View>

            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color={AppColors.greenMuted} />
                <View style={{ height: 8 }} />
                <Text style={styles.caption}>질환을 분류하는 중...</Text>
              </View>
            )}

            {error && (
              <>
                <View style={{ height: 12 }} />
                <Text style={styles.error}>{error}</Text>
              </>
            )}

            {predictions && (
              <>
                <View style={{ height: 16 }} />
                <View style={[cardDecoration(), styles.resultCard]}>
                  {predictions.slice(0, 3).map((p, i) => (
                    <View key={p.key} style={styles.resultRow}>
                      <Text style={[styles.resultLabel, i === 0 && styles.resultLabelTop]}>{p.label}</Text>
                      <View style={styles.resultTrack}>
                        <View
                          style={[
                            styles.resultFill,
                            { width: `${Math.round(p.score * 100)}%` },
                            i === 0 && styles.resultFillTop,
                          ]}
                        />
                      </View>
                      <Text style={styles.resultScore}>{Math.round(p.score * 100)}%</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'pick' && (
          <NextBtn
            disabled={!selfName}
            label="다음"
            onPress={() => onDone({ diagnosed: true, disease: selfName, source: 'self' })}
          />
        )}
        {step === 'photo' && (
          <NextBtn
            disabled={!top}
            label={top ? `"${top.label}"(으)로 진행` : '다음'}
            onPress={() =>
              top &&
              onDone({
                diagnosed: false,
                disease: top.label,
                source: 'model',
                score: top.score,
                photoUri: photoUri ?? undefined,
              })
            }
          />
        )}
        {step === 'ask' && <NextBtn disabled label="다음" onPress={() => {}} />}
      </View>
    </View>
  );
}

function ChoiceBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SmallBtn({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.smallBtn} onPress={onPress}>
      <MaterialIcons name={icon} size={18} color={AppColors.ink} />
      <View style={{ width: 6 }} />
      <Text style={styles.smallBtnText}>{label}</Text>
    </Pressable>
  );
}

function NextBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.nextBtn, disabled && styles.nextBtnDisabled]} disabled={disabled} onPress={onPress}>
      <Text style={[styles.nextBtnText, disabled && styles.nextBtnTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  step: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: AppColors.sub },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },

  question: { fontSize: 18, fontWeight: '800', color: AppColors.ink, lineHeight: 26 },
  caption: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },

  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
  },
  choiceActive: { borderColor: AppColors.greenTop, backgroundColor: AppColors.greenTop },
  choiceText: { fontSize: 16, fontWeight: '700', color: AppColors.ink },
  choiceTextActive: { color: '#16320A' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridBox: {
    width: '47%',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
  },
  gridBoxActive: { borderColor: AppColors.greenTop, backgroundColor: AppColors.greenTop },
  gridText: { fontSize: 14.5, fontWeight: '700', color: AppColors.ink },
  gridTextActive: { color: '#16320A' },
  input: {
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppColors.ink,
  },

  photo: { width: '100%', height: 200, borderRadius: 14, marginBottom: 14, backgroundColor: '#F1F3F6' },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#F1F3F6',
  },
  smallBtnText: { fontSize: 13.5, fontWeight: '700', color: AppColors.ink },
  busy: { alignItems: 'center', paddingVertical: 22 },
  error: { fontSize: 13, color: '#D9534F', textAlign: 'center' },

  resultCard: { padding: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  resultLabel: { width: 84, fontSize: 13, color: AppColors.sub },
  resultLabelTop: { fontWeight: '800', color: AppColors.ink },
  resultTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#EEF0F3', overflow: 'hidden' },
  resultFill: { height: 8, borderRadius: 4, backgroundColor: '#C9D2DC' },
  resultFillTop: { backgroundColor: AppColors.greenTop },
  resultScore: { width: 42, textAlign: 'right', fontSize: 12.5, fontWeight: '700', color: AppColors.ink },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
