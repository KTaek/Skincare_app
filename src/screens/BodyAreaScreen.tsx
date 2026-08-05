import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { BodyRegion } from '../models';
import Body2DView from '../components/Body2DView';

export default function BodyAreaScreen({
  onBack,
  onChooseCamera,
  onChooseGallery,
  onSwitchToMonitoring,
}: {
  onBack: () => void;
  onChooseCamera: (region: BodyRegion) => void;
  onChooseGallery: (region: BodyRegion) => void;
  /** 같은 자리를 반복 촬영하는 모니터링 흐름으로 전환 */
  onSwitchToMonitoring?: () => void;
}) {
  const [region, setRegion] = useState<BodyRegion | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  // 시트가 닫히는 애니메이션이 끝나기 전에 카메라/갤러리 같은 네이티브 UI를 띄우면
  // iOS에서 조용히 무시되는 경우가 있어, 닫힘이 완전히 끝난 뒤(onDismiss)에 실행한다.
  const closeSheetThen = (action: () => void) => {
    pendingAction.current = action;
    setSheetVisible(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>신체 영역</Text>
      </View>

      {onSwitchToMonitoring && (
        <View style={styles.modeRow}>
          <View style={[styles.modeBtn, styles.modeBtnActive]}>
            <Text style={[styles.modeBtnText, styles.modeBtnTextActive]}>일반 촬영</Text>
          </View>
          <Pressable style={styles.modeBtn} onPress={onSwitchToMonitoring}>
            <Text style={styles.modeBtnText}>모니터링 촬영</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.viewerArea}>
        <Body2DView onMarked={setRegion} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.caption}>인체 그림에 점을 표시하여 피부 병변의 위치를 알려주세요.</Text>
        <View style={{ height: 18 }} />
        <Pressable
          style={[styles.nextBtn, !region && styles.nextBtnDisabled]}
          disabled={!region}
          onPress={() => setSheetVisible(true)}
        >
          <Text style={[styles.nextBtnText, !region && styles.nextBtnTextDisabled]}>다음</Text>
        </Pressable>
      </View>

      <Modal
        visible={sheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetVisible(false)}
        onDismiss={() => {
          const action = pendingAction.current;
          pendingAction.current = null;
          action?.();
        }}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetVisible(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>이미지 소스를 선택하세요</Text>
            <View style={{ height: 10 }} />
            <Pressable
              style={styles.sheetItem}
              onPress={() => region && closeSheetThen(() => onChooseCamera(region))}
            >
              <Text style={styles.sheetItemText}>카메라</Text>
            </Pressable>
            <View style={styles.sheetDivider} />
            <Pressable
              style={styles.sheetItem}
              onPress={() => region && closeSheetThen(() => onChooseGallery(region))}
            >
              <Text style={styles.sheetItemText}>사진 갤러리</Text>
            </Pressable>
            <View style={{ height: 10 }} />
            <Pressable style={styles.sheetCancel} onPress={() => setSheetVisible(false)}>
              <Text style={styles.sheetCancelText}>취소</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  viewerArea: { flex: 1 },
  modeRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 8,
    padding: 3,
    borderRadius: 12,
    backgroundColor: '#F1F3F6',
  },
  modeBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#FFFFFF' },
  modeBtnText: { fontSize: 13, fontWeight: '700', color: AppColors.sub },
  modeBtnTextActive: { color: AppColors.ink },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  caption: { fontSize: 14, fontWeight: '600', color: AppColors.ink, textAlign: 'center' },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,28,0.35)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  sheetTitle: { fontSize: 13, color: AppColors.sub, textAlign: 'center' },
  sheetItem: { paddingVertical: 16, alignItems: 'center' },
  sheetItemText: { fontSize: 17, fontWeight: '600', color: AppColors.greenMuted },
  sheetDivider: { height: 1, backgroundColor: AppColors.line },
  sheetCancel: { paddingVertical: 16, alignItems: 'center', backgroundColor: '#F1F3F6', borderRadius: 14 },
  sheetCancelText: { fontSize: 17, fontWeight: '700', color: AppColors.ink },
});
