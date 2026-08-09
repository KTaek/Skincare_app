import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import Body3DView from '../components/Body3DView';
import { BodyModelId } from '../three/humanModel';
import { Vec3 } from '../three/geom3d';
import { BodySpot } from '../monitoring/bodyParts';
import {
  COARSE_GROUPS,
  COARSE_OF_PART,
  COARSE_SPOTS,
  CoarseGroupId,
  PARTS_OF_COARSE,
  coarseDisplayName,
} from '../monitoring/bodyParts';

/**
 * 부위 선택 — 머리 · 몸통 · 팔 · 다리 네 덩어리 중 하나만 고른다.
 *
 * 예전에는 여기서 큰 덩어리를 고른 뒤 다음 화면에서 다시 세부 면(상완 앞 / 팔오금 / 손등 …)까지
 * 골라야 했는데, 매번 찍을 때마다 거치는 단계치고 너무 잘게 나뉘어 있었다. 지금은 3D를 탭하거나
 * 아래 칩을 눌러 한 번만 고르면 끝난다. 좌우도 나누지 않는다 — 시간이 지나면 어느 쪽이었는지
 * 기억하지 못해서 목록에서 구분이 도움이 되지 않는다.
 */
export default function PartSelectScreen({
  modelId,
  stepLabel = '1 / 2',
  onBack,
  onNext,
}: {
  modelId: BodyModelId;
  /** 흐름마다 단계 수가 달라서 부모가 넘겨준다 (예: "1 / 2") */
  stepLabel?: string;
  onBack: () => void;
  onNext: (spot: BodySpot) => void;
}) {
  const [group, setGroup] = useState<CoarseGroupId | null>(null);
  const [marker, setMarker] = useState<Vec3 | null>(null);
  const insets = useSafeAreaInsets();

  const highlightParts = useMemo(() => (group ? PARTS_OF_COARSE[group] : []), [group]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>부위 선택</Text>
      </View>
      <Text style={styles.step}>{stepLabel} · 드래그해서 돌리고, 탭해서 부위를 고르세요</Text>

      <View style={styles.viewer}>
        <Body3DView
          modelId={modelId}
          highlightParts={highlightParts}
          marker={marker}
          onPick={(hit) => {
            setGroup(COARSE_OF_PART[hit.part]);
            setMarker(hit.point);
          }}
        />
      </View>

      {/* 3D를 정확히 누르기 어려운 부위(등·엉덩이 등)를 위해 같은 선택지를 칩으로도 둔다 */}
      <View style={styles.chipRow}>
        {COARSE_GROUPS.map((g) => {
          const selected = group === g;
          return (
            <Pressable
              key={g}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => {
                setGroup(g);
                setMarker(null);
              }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {coarseDisplayName(g)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.selectionText}>
          {group ? coarseDisplayName(group) : '부위를 선택해주세요'}
        </Text>
        <View style={{ height: 12 }} />
        <Pressable
          style={[styles.nextBtn, !group && styles.nextBtnDisabled]}
          disabled={!group}
          onPress={() => group && onNext(COARSE_SPOTS[group])}
        >
          <Text style={[styles.nextBtnText, !group && styles.nextBtnTextDisabled]}>이 부위로 선택</Text>
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
  viewer: { flex: 1, minHeight: 280 },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipSelected: { borderColor: AppColors.greenTop, backgroundColor: AppColors.greenTop },
  chipText: { fontSize: 13, fontWeight: '700', color: AppColors.ink },
  chipTextSelected: { color: '#16320A' },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 12 },
  selectionText: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: AppColors.ink },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
