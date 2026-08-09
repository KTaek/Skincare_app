import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';

/** 사진을 어디서 가져올지 */
export type CaptureSource = 'camera' | 'album';

/**
 * 촬영 방법 선택 — 촬영 화면에 들어가기 직전 단계.
 *
 * 예전에는 카메라 화면 안에 "앨범" 버튼이 같이 있었다. 그런데 그 둘은 하는 일이 아주 다르다 —
 * 카메라는 가이드(피부·초점·노출 판정과 음성 안내)를 받으며 그 자리에서 찍는 흐름이고, 앨범은
 * 이미 찍어 둔 사진을 고르는 흐름이라 가이드가 낄 자리가 없다. 가이드를 켜 놓고 판정을 돌리다가
 * 앨범으로 빠지는 건 그때까지의 안내를 통째로 버리는 셈이라, 아예 들어가기 전에 고르게 했다.
 */
export default function CaptureSourceScreen({
  stepLabel,
  onBack,
  onPick,
}: {
  /** 흐름마다 단계 수가 달라서 부모가 넘겨준다 (바로 스캔처럼 단계가 없으면 생략) */
  stepLabel?: string;
  onBack: () => void;
  onPick: (source: CaptureSource) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>촬영 방법</Text>
      </View>
      {stepLabel != null && <Text style={styles.step}>{stepLabel}</Text>}

      <View style={styles.body}>
        <Text style={styles.question}>사진을 어떻게{'\n'}가져올까요?</Text>
        <View style={{ height: 26 }} />

        <SourceCard
          icon="photo-camera"
          title="카메라로 촬영"
          caption="피부·초점·노출을 봐주고 음성으로 안내해요"
          accent
          onPress={() => onPick('camera')}
        />
        <View style={{ height: 12 }} />
        <SourceCard
          icon="photo-library"
          title="갤러리에서 선택"
          caption="이미 찍어 둔 사진을 고를게요"
          onPress={() => onPick('album')}
        />

        <View style={{ height: 18 }} />
        <Text style={styles.note}>
          같은 자리를 계속 지켜보려면 카메라 촬영이 더 정확해요. 갤러리 사진은 촬영 품질을 재지
          못할 수 있어요.
        </Text>
      </View>
    </View>
  );
}

function SourceCard({
  icon,
  title,
  caption,
  accent,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  caption: string;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cardDecoration(18), styles.card, accent && styles.cardAccent]} onPress={onPress}>
      <View style={[styles.iconBox, accent && styles.iconBoxAccent]}>
        <MaterialIcons name={icon} size={24} color={accent ? '#16320A' : AppColors.greenMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardCaption}>{caption}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={AppColors.sub} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  step: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: AppColors.sub },

  body: { flex: 1, paddingHorizontal: 24, paddingTop: 30 },
  question: { fontSize: 22, fontWeight: '800', color: AppColors.ink, lineHeight: 31 },

  card: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  cardAccent: { borderWidth: 1.5, borderColor: AppColors.greenTop },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    marginRight: 14,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxAccent: { backgroundColor: AppColors.greenTop },
  cardTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  cardCaption: { fontSize: 12.5, color: AppColors.sub, marginTop: 3 },

  note: { fontSize: 12, color: AppColors.sub, lineHeight: 18 },
});
