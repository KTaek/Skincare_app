import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { useFolders } from '../folders/store';
import { useMonitoring } from '../context/MonitoringContext';
import { MonitorTarget } from '../monitoring/types';

/**
 * 카메라 탭의 첫 화면 — 이번에 무슨 검사를 할지 고른다.
 *
 *   신규 검사        : 부위 선택 → 질환 등록 → 가려움 문진 → 카메라 → 결과
 *   경과 이어서 기록 : (지켜보던 자리를 골라) 가려움 문진 → 카메라 → 결과
 *
 * "경과 이어서 기록"은 이어 붙일 자리가 있어야 의미가 있으므로, 모니터링 폴더 중에서 촬영
 * 대상(MonitorTarget)이 살아 있는 것만 후보로 보여준다 — 대상이 없으면 같은 구도로 다시 찍도록
 * 유도할 기준(baseline)도 없다.
 */
export default function ExamStartScreen({
  onNewExam,
  onFollowUp,
}: {
  onNewExam: () => void;
  onFollowUp: (folderId: string, target: MonitorTarget) => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'choice' | 'folder'>('choice');
  /** 카드를 누르면 고르기만 하고, 실제 진행은 아래 "선택" 버튼이 한다 */
  const [picked, setPicked] = useState<'new' | 'followUp' | null>(null);
  const folders = useFolders();
  const { findTarget } = useMonitoring();

  const candidates = useMemo(
    () =>
      folders
        .map((f: any) => ({ folder: f, target: f.targetId ? findTarget(f.targetId) : undefined }))
        .filter((c: any) => !!c.target),
    [folders, findTarget],
  );

  if (step === 'folder') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep('choice')}>
            <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>경과 이어서 기록</Text>
        </View>
        <Text style={styles.step}>이어서 기록할 자리를 골라주세요</Text>

        <ScrollView contentContainerStyle={styles.listBody}>
          {candidates.length === 0 ? (
            <View style={[cardDecoration(), styles.emptyCard]}>
              <MaterialIcons name="folder-open" size={30} color={AppColors.sub} />
              <View style={{ height: 10 }} />
              <Text style={styles.emptyTitle}>이어서 기록할 자리가 아직 없어요</Text>
              <Text style={styles.emptyHint}>
                신규 검사를 마친 뒤 결과 화면에서 "경과 기록에 연동"을 누르면{'\n'}그 자리가 여기에 쌓여요
              </Text>
            </View>
          ) : (
            candidates.map(({ folder, target }: any) => {
              const last = folder.records[folder.records.length - 1];
              return (
                <Pressable
                  key={folder.id}
                  style={[cardDecoration(), styles.folderCard]}
                  onPress={() => onFollowUp(folder.id, target)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.folderName} numberOfLines={1}>
                      {folder.name}
                    </Text>
                    <Text style={styles.folderMeta}>
                      촬영 {folder.records.length}회
                      {last ? ` · 최근 ${last.date.split('-').join('.')}` : ''}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={AppColors.sub} />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.backBtn} />
        <Text style={styles.headerTitle}>카메라</Text>
      </View>
      <Text style={styles.step}>어떤 검사를 할까요?</Text>

      <ScrollView contentContainerStyle={styles.choiceBody}>
        <ChoiceCard
          icon="add-a-photo"
          title="신규 검사"
          caption="부위와 질환을 등록하고 처음부터 검사해요"
          selected={picked === 'new'}
          onPress={() => setPicked('new')}
        />
        <View style={{ height: 14 }} />
        <ChoiceCard
          icon="timeline"
          title="경과 이어서 기록"
          caption="관리하던 부위에 이어서 기록해요"
          selected={picked === 'followUp'}
          onPress={() => setPicked('followUp')}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !picked && styles.nextBtnDisabled]}
          disabled={!picked}
          onPress={() => (picked === 'new' ? onNewExam() : setStep('folder'))}
        >
          <Text style={[styles.nextBtnText, !picked && styles.nextBtnTextDisabled]}>선택</Text>
        </Pressable>
      </View>
    </View>
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
  caption: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cardDecoration(), styles.choiceCard, selected && styles.choiceCardSelected]} onPress={onPress}>
      <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
        <MaterialIcons name={icon} size={26} color={selected ? '#16320A' : AppColors.ink} />
      </View>
      {/* 아이콘과 글자 사이를 넉넉히 비워, 제목·설명이 카드 아래쪽에 자리잡게 한다 */}
      <View style={{ height: 34 }} />
      <Text style={styles.choiceTitle}>{title}</Text>
      <View style={{ height: 8 }} />
      <Text style={styles.choiceCaption}>{caption}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  step: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: AppColors.sub },

  choiceBody: { paddingHorizontal: 24, paddingTop: 26, paddingBottom: 24 },
  choiceCard: { padding: 22, paddingBottom: 26, borderWidth: 1.5, borderColor: 'transparent' },
  choiceCardSelected: { borderColor: AppColors.greenTop },
  choiceIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconSelected: { backgroundColor: AppColors.greenTop },
  choiceTitle: { fontSize: 23, fontWeight: '800', color: AppColors.ink },
  choiceCaption: { fontSize: 15, color: AppColors.sub, lineHeight: 22 },

  listBody: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  folderCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20, marginBottom: 12 },
  folderName: { fontSize: 19, fontWeight: '800', color: AppColors.ink },
  folderMeta: { fontSize: 14, color: AppColors.sub, fontWeight: '600', marginTop: 8 },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },

  emptyCard: { padding: 26, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: AppColors.ink },
  emptyHint: { fontSize: 12, color: AppColors.sub, textAlign: 'center', lineHeight: 18, marginTop: 8 },
});
