import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';

/** 문진 결과 — 모니터링 대상에 함께 저장된다 */
export interface IntakeResult {
  /** 피부과 전문의 진단을 받은 적이 있는지 */
  diagnosed: boolean;
  /** 진단받았을 때 사용자가 고른(또는 직접 적은) 질환명. 진단 이력이 없으면 비어 있다 */
  disease?: string;
  /** 이름의 출처 — 이 화면에서 나오는 건 항상 사용자가 고른 이름이다 */
  source: 'self';
}

/** 사용자가 직접 고를 수 있는 질환 — 분류 모델의 클래스와 같은 집합에 "직접 입력"을 더한 것 */
const DIAGNOSES = ['건선', '여드름', '아토피피부염', '주사', '지루', '직접 입력'];

/**
 * 질환 등록 — 신규 검사의 두 번째 단계(부위 선택 다음).
 *
 * 진단 이력이 있으면 질환명을 직접 고르고, 거기서 검사가 끝날 때까지 **질환 분류 모델은 아예
 * 돌리지 않는다**. 사람이 확정한 진단명을 모델 추정으로 덮어쓸 이유가 없기 때문이다.
 * 진단 이력이 없으면 여기서는 아무것도 고르지 않고 넘어가고, 촬영한 사진으로 결과 화면에서
 * 질환 Top3를 추정한다.
 */
export default function MonitorIntakeScreen({
  stepLabel,
  onBack,
  onDone,
}: {
  stepLabel: string;
  onBack: () => void;
  onDone: (result: IntakeResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [diagnosed, setDiagnosed] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState('');

  const selfName = picked === '직접 입력' ? custom.trim() : picked ?? '';
  const canProceed = diagnosed === false || (diagnosed === true && !!selfName);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>질환 등록</Text>
      </View>
      <Text style={styles.step}>{stepLabel}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.question}>피부과 전문의에게{'\n'}진단 받은 적이 있습니까?</Text>
        <View style={{ height: 16 }} />
        <View style={styles.choiceRow}>
          <ChoiceBtn label="예" active={diagnosed === true} onPress={() => setDiagnosed(true)} />
          <ChoiceBtn label="아니오" active={diagnosed === false} onPress={() => setDiagnosed(false)} />
        </View>

        {diagnosed === true && (
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
            <View style={{ height: 14 }} />
            <Text style={styles.caption}>
              진단명을 등록하면 질환 분류는 건너뛰고, 촬영 사진으로 중증도만 확인해요.
            </Text>
          </>
        )}

        {diagnosed === false && (
          <>
            <View style={{ height: 26 }} />
            <View style={styles.noteBox}>
              <MaterialIcons name="info-outline" size={18} color={AppColors.greenMuted} />
              <Text style={styles.noteText}>
                등록할 진단명이 없으니, 이따 촬영한 사진으로 질환을 추정해 결과 화면에서 상위 3개를
                보여드릴게요. 진단이 아니라 참고용이에요.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
          disabled={!canProceed}
          onPress={() =>
            onDone(
              diagnosed
                ? { diagnosed: true, disease: selfName, source: 'self' }
                : { diagnosed: false, source: 'self' },
            )
          }
        >
          <Text style={[styles.nextBtnText, !canProceed && styles.nextBtnTextDisabled]}>다음</Text>
        </Pressable>
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

  noteBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F4FBEC',
    borderRadius: 14,
    padding: 16,
  },
  noteText: { flex: 1, fontSize: 12.5, color: AppColors.greenMuted, lineHeight: 19 },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
