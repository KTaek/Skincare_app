import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { plainSiteLabel } from '../models';
import { useFolders } from '../folders/store';
import { useMonitoring } from '../context/MonitoringContext';
import { MonitorTarget } from '../monitoring/types';

/**
 * 피부 촬영 탭의 첫 화면 — 이번에 무엇을 할지 고른다.
 *
 *   이어서 기록하기   : 지켜보던 자리에 오늘 기록을 더한다 (가려움 문진 → 촬영 → 결과)
 *   신규 증상 기록하기: 새 자리를 등록하고 처음부터 기록한다 (부위 → 면 → 가려움 문진 → 촬영 → 결과)
 *   피부 바로 스캔    : 문진도 등록도 없이 지금 피부만 찍고 분석 결과만 본다
 *
 * 이어서 기록하는 경우가 훨씬 잦아서 왼쪽(먼저)에 두고, 고르는 즉시 **다음 페이지로 넘어가지 않고**
 * 바로 아래에 최근 기록 목록을 펼친다 — 자리를 고르러 한 화면 더 들어갔다 나오는 게 이 흐름에서
 * 가장 자주 반복되는 낭비였다.
 */
export default function ExamStartScreen({
  initialPick = null,
  onNewExam,
  onQuickScan,
  onFollowUp,
}: {
  /** 홈의 버튼으로 들어오면 그 선택지를 미리 고른 상태로 연다 */
  initialPick?: 'new' | 'followUp' | 'quick' | null;
  onNewExam: () => void;
  onQuickScan: () => void;
  onFollowUp: (folderId: string, target: MonitorTarget) => void;
}) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<'new' | 'followUp' | 'quick' | null>(initialPick);
  const [pickedFolderId, setPickedFolderId] = useState<string | null>(null);
  const folders = useFolders();
  const { findTarget } = useMonitoring();

  /**
   * 이어서 기록할 수 있는 자리 = 촬영 대상(MonitorTarget)이 살아 있는 폴더. 대상이 없으면 같은
   * 구도로 다시 찍도록 유도할 기준(baseline)도 없다. 최근에 기록한 자리가 위로 오게 정렬한다.
   */
  const candidates = useMemo(
    () =>
      folders
        .map((f: any) => ({ folder: f, target: f.targetId ? findTarget(f.targetId) : undefined }))
        .filter((c: any) => !!c.target)
        .map((c: any) => ({ ...c, last: c.folder.records[c.folder.records.length - 1] }))
        .sort((a: any, b: any) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0)),
    [folders, findTarget],
  );

  const selected = candidates.find((c: any) => c.folder.id === pickedFolderId);
  const canProceed = picked === 'new' || picked === 'quick' || (picked === 'followUp' && !!selected);

  const proceed = () => {
    if (picked === 'new') onNewExam();
    else if (picked === 'quick') onQuickScan();
    else if (selected) onFollowUp(selected.folder.id, selected.target);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>피부 촬영</Text>
      </View>
      <Text style={styles.step}>오늘은 무엇을 할까요?</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {/* 자주 쓰는 쪽(이어서 기록)을 왼쪽에 둔다 */}
          <ChoiceCard
            icon="timeline"
            title={'이어서\n기록하기'}
            caption="경과 기록 파일에 오늘의 상태를 이어서 기록해요"
            selected={picked === 'followUp'}
            onPress={() => setPicked('followUp')}
          />
          <ChoiceCard
            icon="add-a-photo"
            title={'신규 증상\n기록하기'}
            caption="새로운 부위와 증상을 등록해요"
            selected={picked === 'new'}
            onPress={() => setPicked('new')}
          />
        </View>

        {/* 이어서 기록하기를 고르면 다음 페이지로 넘어가지 않고 여기서 바로 자리를 고른다 */}
        {picked === 'followUp' && (
          <>
            <View style={{ height: 18 }} />
            <Text style={styles.listLabel}>최근 기록</Text>
            <View style={{ height: 8 }} />
            {candidates.length === 0 ? (
              <View style={[cardDecoration(), styles.emptyCard]}>
                <MaterialIcons name="folder-open" size={28} color={AppColors.sub} />
                <View style={{ height: 8 }} />
                <Text style={styles.emptyTitle}>이어서 기록할 자리가 아직 없어요</Text>
                <Text style={styles.emptyHint}>
                  신규 증상을 기록한 뒤 결과 화면에서 "경과 관찰에 연동"을 누르면{'\n'}그 자리가 여기에 쌓여요
                </Text>
              </View>
            ) : (
              candidates.map(({ folder, target, last }: any) => (
                <SiteRow
                  key={folder.id}
                  name={siteName(target)}
                  date={last ? last.date.split('-').join('.') : '기록 없음'}
                  selected={pickedFolderId === folder.id}
                  onPress={() => setPickedFolderId(folder.id)}
                />
              ))
            )}
          </>
        )}

        <View style={{ height: 12 }} />
        {/* 문진도 등록도 없이 지금 피부만 찍어보는 길 — 다른 둘과 같이 고른 뒤 "선택"으로 넘어간다 */}
        <Pressable
          style={[cardDecoration(), styles.quickCard, picked === 'quick' && styles.choiceCardSelected]}
          onPress={() => setPicked('quick')}
        >
          <View style={[styles.quickIcon, picked === 'quick' && styles.choiceIconSelected]}>
            <MaterialIcons
              name="center-focus-strong"
              size={22}
              color={picked === 'quick' ? '#16320A' : AppColors.ink}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle}>피부 바로 스캔</Text>
            <Text style={styles.quickCaption}>피부를 빠르게 촬영하고 분석 결과를 확인해요</Text>
            {/* 고르기 전부터 보이게 둔다 — 촬영을 마치고 나서 "저장이 안 된다"를 알면 이미 늦다 */}
            <Text style={styles.noticeText}>피부 바로 스캔 기능으로 촬영한 사진은 저장되지 않아요</Text>
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
          disabled={!canProceed}
          onPress={proceed}
        >
          <Text style={[styles.nextBtnText, !canProceed && styles.nextBtnTextDisabled]}>선택</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 목록에 쓰는 이름 — 좌우 구분은 떼고 "{부위} {진단명}" 한 줄로 (예: "팔 건선") */
function siteName(target: MonitorTarget): string {
  return [plainSiteLabel(target.label), target.diagnosis?.disease].filter(Boolean).join(' ');
}

/** 몸 아이콘 - 진단명 - 최종입력일자 한 줄 */
function SiteRow({
  name,
  date,
  selected,
  onPress,
}: {
  name: string;
  date: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cardDecoration(14), styles.siteRow, selected && styles.siteRowSelected]} onPress={onPress}>
      <View style={[styles.siteIcon, selected && styles.siteIconSelected]}>
        <MaterialIcons name="accessibility-new" size={20} color={selected ? '#16320A' : AppColors.greenMuted} />
      </View>
      <Text style={styles.siteName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.siteDate}>{date}</Text>
      <MaterialIcons name="chevron-right" size={20} color={AppColors.sub} />
    </Pressable>
  );
}

function ChoiceCard({
  icon,
  title,
  caption,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  caption?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cardDecoration(), styles.choiceCard, selected && styles.choiceCardSelected]} onPress={onPress}>
      <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
        <MaterialIcons name={icon} size={22} color={selected ? '#16320A' : AppColors.ink} />
      </View>
      <View style={{ height: 12 }} />
      <Text style={styles.choiceTitle}>{title}</Text>
      {caption != null && (
        <>
          <View style={{ height: 6 }} />
          <Text style={styles.choiceCaption}>{caption}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AppColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: AppColors.ink },
  step: { textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: AppColors.sub, marginTop: 2 },

  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  choiceCard: { flex: 1, padding: 16, borderWidth: 1.5, borderColor: 'transparent' },
  choiceCardSelected: { borderColor: AppColors.greenTop },
  choiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconSelected: { backgroundColor: AppColors.greenTop },
  choiceTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink, lineHeight: 21 },
  choiceCaption: { fontSize: 12, color: AppColors.sub, lineHeight: 17 },

  listLabel: { fontSize: 13, fontWeight: '800', color: AppColors.sub, paddingLeft: 2 },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  siteRowSelected: { borderColor: AppColors.greenTop },
  siteIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: '#F1F5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  siteIconSelected: { backgroundColor: AppColors.greenTop },
  siteName: { flex: 1, fontSize: 15, fontWeight: '800', color: AppColors.ink },
  siteDate: { fontSize: 12, fontWeight: '600', color: AppColors.sub },

  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  quickCaption: { fontSize: 12, color: AppColors.sub, lineHeight: 17, marginTop: 4 },

  noticeText: { fontSize: 11.5, fontWeight: '600', color: AppColors.sub, lineHeight: 17, marginTop: 4 },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },

  emptyCard: { padding: 24, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: AppColors.ink },
  emptyHint: { fontSize: 12, color: AppColors.sub, textAlign: 'center', lineHeight: 18, marginTop: 8 },
});
