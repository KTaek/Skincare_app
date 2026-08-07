import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import Body3DView, { BodyPick } from '../components/Body3DView';
import { BodyModelId } from '../three/humanModel';
import {
  BodySpot,
  CONTEXT_PARTS,
  GROUP_LABELS,
  GROUP_OF_PART,
  GROUP_PARTS,
  PartGroupId,
  spotFromNormal,
  spotRows,
  SPOTS_OF_GROUP,
  viewDirection,
  viewName,
} from '../monitoring/bodyParts';

/**
 * 2단계 — 고른 부위를 따로 떼어 3D로 보여주고, 그 안에서 실제로 촬영할 면을 고른다.
 * 3D를 직접 탭해도 되고 아래 상자를 눌러도 된다 (상자를 누르면 그 면이 보이도록 모델이 돌아간다).
 */
export default function SpotSelectScreen({
  modelId,
  group,
  initialSpotId,
  stepLabel = '2 / 4',
  onBack,
  onNext,
}: {
  modelId: BodyModelId;
  group: PartGroupId;
  /** 앞 화면에서 탭한 면 */
  initialSpotId?: string;
  /** 흐름마다 단계 수가 달라서 부모가 넘겨준다 (예: "2 / 4") */
  stepLabel?: string;
  onBack: () => void;
  onNext: (spot: BodySpot) => void;
}) {
  const spots = SPOTS_OF_GROUP[group];
  const rows = useMemo(() => spotRows(group), [group]);
  const [spotId, setSpotId] = useState<string>(
    initialSpotId && spots.some((s) => s.id === initialSpotId) ? initialSpotId : spots[0].id,
  );
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [side, setSide] = useState('앞');
  const onViewChange = useCallback((rot: { yaw: number; pitch: number }) => {
    setSide(viewName(rot.yaw, rot.pitch));
  }, []);
  // 인접 부위를 탭한 건 무시한다 (여기서는 고른 부위 안에서만 면을 바꾼다).
  // 드래그 중 PanResponder가 다시 만들어지지 않도록 identity를 고정해 둔다.
  const onPick = useCallback(
    (hit: BodyPick) => {
      if (GROUP_OF_PART[hit.part] !== group) return;
      setSpotId(spotFromNormal(group, hit.normal, hit.part).id);
    },
    [group],
  );

  const spot = useMemo(() => spots.find((s) => s.id === spotId) ?? spots[0], [spots, spotId]);
  const groupParts = GROUP_PARTS[group];
  const contextParts = CONTEXT_PARTS[group];
  // 고른 부위 + 이어지는 인접 부위를 함께 그려 어디인지 알아볼 수 있게 한다
  const visibleParts = useMemo(() => [...groupParts, ...contextParts], [groupParts, contextParts]);
  // 상자에서 고른 면을 3D에서도 빨갛게 — 모델은 그 면이 보이는 각도로 돌아간다
  const faceHighlight = useMemo(
    () => ({ parts: spot.highlight, direction: viewDirection(spot.view) }),
    [spot],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>{GROUP_LABELS[group]}</Text>
      </View>
      <Text style={styles.step}>{stepLabel} · 촬영할 면을 골라주세요</Text>

      {/* 3D는 화면의 1/3 정도만 쓰고, 남는 공간의 한가운데에 놓는다 (상자는 아래에 붙는다) */}
      <View style={styles.viewerArea}>
        <View style={[styles.viewer, { height: Math.max(180, Math.min(280, screenH * 0.3)) }]}>
          <Text style={styles.sideBadge}>{side}에서 보는 중</Text>
          <Body3DView
            modelId={modelId}
            visibleParts={visibleParts}
            focusParts={groupParts}
            framePadding={1.5}
            onViewChange={onViewChange}
            contextParts={contextParts}
            faceHighlight={faceHighlight}
            view={spot.view}
            onPick={onPick}
          />
        </View>
      </View>

      <View style={styles.boxes}>
        {rows.map((row, i) => (
          <View key={i} style={styles.boxRow}>
            {row.map((s) => {
              const active = s.id === spot.id;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.box, active && styles.boxActive]}
                  onPress={() => setSpotId(s.id)}
                >
                  <Text
                    style={[styles.boxText, active && styles.boxTextActive]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.selectionText}>{spot.label}</Text>
        <View style={{ height: 12 }} />
        <Pressable style={styles.nextBtn} onPress={() => onNext(spot)}>
          <Text style={styles.nextBtnText}>이 부위로 촬영</Text>
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
  viewerArea: { flex: 1, justifyContent: 'center' },
  viewer: { alignSelf: 'stretch' },
  sideBadge: {
    position: 'absolute',
    top: 6,
    left: 18,
    zIndex: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#F1F3F6',
    fontSize: 12,
    fontWeight: '700',
    color: AppColors.sub,
  },
  boxes: { paddingHorizontal: 18, paddingTop: 10 },
  boxRow: { flexDirection: 'row' },
  box: {
    flex: 1, // 한 줄 안에서 균등 분할 — 줄마다 상자 수가 달라도 폭이 맞는다
    marginHorizontal: 5,
    marginVertical: 5,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
  },
  boxActive: { borderColor: AppColors.greenTop, backgroundColor: AppColors.greenTop },
  boxText: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  boxTextActive: { color: '#16320A' },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  selectionText: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: AppColors.ink },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
});
