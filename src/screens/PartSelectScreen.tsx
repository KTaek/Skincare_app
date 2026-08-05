import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import Body3DView from '../components/Body3DView';
import { BodyModelId } from '../three/humanModel';
import { Vec3 } from '../three/geom3d';
import { GROUP_LABELS, GROUP_OF_PART, GROUP_PARTS, PartGroupId, spotFromNormal } from '../monitoring/bodyParts';
import { useMonitoring } from '../context/MonitoringContext';

/** 1단계 — 3D 모델을 돌려가며 탭해서 관찰할 부위(큰 덩어리)를 고른다 */
export default function PartSelectScreen({
  modelId,
  onBack,
  onNext,
}: {
  modelId: BodyModelId;
  onBack: () => void;
  /** spotId — 여기서 탭한 면을 다음 화면에서 그대로 골라 둔다 */
  onNext: (group: PartGroupId, spotId: string) => void;
}) {
  const [pick, setPick] = useState<{ group: PartGroupId; point: Vec3; spotId: string } | null>(null);
  const { targets } = useMonitoring();
  const insets = useSafeAreaInsets();

  const monitoredParts = useMemo(() => targets.map((t) => t.part), [targets]);
  const highlightParts = useMemo(() => (pick ? GROUP_PARTS[pick.group] : []), [pick]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>부위 선택</Text>
      </View>
      <Text style={styles.step}>1 / 3 · 드래그해서 돌리고, 탭해서 부위를 고르세요</Text>

      <View style={styles.viewer}>
        <Body3DView
          modelId={modelId}
          highlightParts={highlightParts}
          monitoredParts={monitoredParts}
          marker={pick?.point ?? null}
          onPick={(hit) => {
            const group = GROUP_OF_PART[hit.part];
            setPick({ group, point: hit.point, spotId: spotFromNormal(group, hit.normal).id });
          }}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.selectionText}>
          {pick ? GROUP_LABELS[pick.group] : '부위를 선택해주세요'}
        </Text>
        {pick && monitoredParts.some((p) => GROUP_OF_PART[p] === pick.group) && (
          <Text style={styles.repeatNote}>이미 모니터링 중인 부위예요 — 이어서 촬영하면 이전 기준에 맞춰 정렬돼요</Text>
        )}
        <View style={{ height: 12 }} />
        <Pressable
          style={[styles.nextBtn, !pick && styles.nextBtnDisabled]}
          disabled={!pick}
          onPress={() => pick && onNext(pick.group, pick.spotId)}
        >
          <Text style={[styles.nextBtnText, !pick && styles.nextBtnTextDisabled]}>이 부위로 선택</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  step: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: AppColors.sub },
  viewer: { flex: 1, minHeight: 320 },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 4 },
  selectionText: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: AppColors.ink },
  repeatNote: { textAlign: 'center', fontSize: 11, color: AppColors.greenMuted, marginTop: 6 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
