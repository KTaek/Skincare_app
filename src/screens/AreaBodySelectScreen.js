// 병변 면적 추적 진입 2단계 — minji의 3D 인체모형을 돌려/탭해서 부위를 고른다.
// 20개 세부부위 + 앞/뒤 면을 8부위(얼굴/몸통/왼팔/오른팔/왼다리/오른다리/등/등밑에다리)로 묶는다.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import Body3DView from '../components/Body3DView';
import {
  AREA_REGION_LABELS,
  AREA_REGION_PARTS,
  AREA_REGION_BODY_SITE,
  classifyAreaRegion,
} from '../monitoring/areaRegions';

export default function AreaBodySelectScreen({ navigation, route }) {
  const intake = route?.params?.intake;
  // pick: { region: AreaRegionId, point: Vec3 }
  const [pick, setPick] = useState(null);
  const insets = useSafeAreaInsets();

  const highlightParts = useMemo(
    () => (pick ? AREA_REGION_PARTS[pick.region] : []),
    [pick]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>부위 선택</Text>
      </View>
      <Text style={styles.step}>드래그해서 돌리고, 탭해서 부위를 고르세요</Text>

      <View style={styles.viewer}>
        <Body3DView
          modelId="adultMale"
          highlightParts={highlightParts}
          marker={pick?.point ?? null}
          onPick={(hit) => {
            const region = classifyAreaRegion(hit.part, hit.facing);
            setPick({ region, point: hit.point });
          }}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.selectionText}>
          {pick ? AREA_REGION_LABELS[pick.region] : '부위를 선택해주세요'}
        </Text>
        <View style={{ height: 12 }} />
        <Pressable
          style={[styles.nextBtn, !pick && styles.nextBtnDisabled]}
          disabled={!pick}
          onPress={() =>
            pick &&
            // 여기부터 SkinAI2 — 선택 부위를 body_site로 넘겨 규격 촬영으로 이어진다.
            navigation.navigate('TrackingFlow', {
              body_site: AREA_REGION_BODY_SITE[pick.region],
              intake,
            })
          }
        >
          <Text style={[styles.nextBtnText, !pick && styles.nextBtnTextDisabled]}>
            이 부위 촬영하기
          </Text>
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
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
