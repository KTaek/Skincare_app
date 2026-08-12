import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { BodyInfo, useProfile } from '../context/ProfileContext';

const HNS_URL = 'https://www.hnsbiolab.com';
const SHOP_URL = 'https://www.hnsbiolab.com/shop';
const FEEDBACK_MAIL = 'mailto:support@hnsbiolab.com?subject=%EA%B1%B4%EC%9D%98%EC%82%AC%ED%95%AD';

type Sheet = 'name' | 'body' | null;

/**
 * "내 정보" 탭 — 프로필과 앱 설정, 그리고 회사/약관 링크 모음.
 *
 * Samsung Health 연동 스위치가 여기 있는 게 중요하다: 수면 점수는 앱이 재는 값이 아니라
 * 스마트워치에서 넘어오는 값이라, 연동을 끄면 홈·결과·상세 화면의 수면 점수가 전부
 * "미기재"로 바뀐다.
 */
export default function ProfileScreen({ navigation }: { navigation: any }) {
  const { name, body, healthConnected, setHealthConnected, pushEnabled, setPushEnabled } = useProfile();
  const [sheet, setSheet] = useState<Sheet>(null);

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('링크를 열 수 없어요', url));
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }}
      >
        <Text style={styles.title}>내 정보</Text>
        <View style={{ height: 16 }} />

        {/* 내 프로필 */}
        <View style={[cardDecoration(), styles.profileCard]}>
          <View style={styles.avatar}>
            <MaterialIcons name="person" size={30} color={AppColors.greenMuted} />
          </View>
          <View style={{ width: 14 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileCaption}>내 프로필</Text>
            <View style={{ height: 3 }} />
            <Text style={styles.profileName}>{name}</Text>
            <View style={{ height: 5 }} />
            <Text style={styles.profileBody}>
              {body.age}세 · {body.sex === 'male' ? '남성' : '여성'} · {body.height}cm · {body.weight}kg
            </Text>
          </View>
        </View>

        <SectionLabel text="프로필" />
        <Card>
          <Row icon="badge" label="이름 수정" value={name} onPress={() => setSheet('name')} />
          <Row
            icon="straighten"
            label="신체정보 수정"
            value={`${body.height}cm · ${body.weight}kg`}
            onPress={() => setSheet('body')}
            last
          />
        </Card>

        <SectionLabel text="알림" />
        <Card>
          <Row
            icon="notifications-none"
            label="푸시 알림"
            value={pushEnabled ? '받는 중' : '받지 않음'}
            valueAccent={pushEnabled}
            trailing={<Switch on={pushEnabled} onPress={() => setPushEnabled(!pushEnabled)} />}
            last
          />
        </Card>
        {/* 끈 상태를 그냥 두지 않고 무엇이 달라지는지 말한다 — 루틴 화면에서 알림 표시가
            사라지는 이유를 여기서 알 수 있어야 한다 */}
        {!pushEnabled && (
          <View style={styles.noteBox}>
            <MaterialIcons name="info-outline" size={16} color={AppColors.greenMuted} />
            <Text style={styles.noteText}>
              알림을 끄면 루틴·제품 시간이 되어도 알려주지 않아요. 기록은 그대로 쌓입니다.
            </Text>
          </View>
        )}

        <SectionLabel text="데이터" />
        <Card>
          <Row
            icon="watch"
            label="Samsung Health 연동"
            value={healthConnected ? '연동됨' : '연동 안함'}
            valueAccent={healthConnected}
            trailing={<Switch on={healthConnected} onPress={() => setHealthConnected(!healthConnected)} />}
          />
          <Row
            icon="picture-as-pdf"
            label="데이터 다운로드"
            value="PDF 보고서"
            onPress={() => navigation.navigate('DataExport')}
            last
          />
        </Card>
        {!healthConnected && (
          <View style={styles.noteBox}>
            <MaterialIcons name="info-outline" size={16} color={AppColors.greenMuted} />
            <Text style={styles.noteText}>
              스마트워치를 연동하지 않으면 상세 결과의 수면 점수는 "미기재"로 남아요.
            </Text>
          </View>
        )}

        <SectionLabel text="약관 · 정책" />
        <Card>
          <Row
            icon="lock-outline"
            label="개인정보처리방침"
            onPress={() => openUrl(`${HNS_URL}/privacy`)}
          />
          <Row
            icon="description"
            label="서비스 이용약관"
            onPress={() => openUrl(`${HNS_URL}/terms`)}
            last
          />
        </Card>

        <SectionLabel text="About Us" />
        <Card>
          <Row emoji="🔎" label="H&S Biolab" value="사이트로 이동" onPress={() => openUrl(HNS_URL)} />
          <Row emoji="💊" label="보습제 구매 사이트" onPress={() => openUrl(SHOP_URL)} />
          <Row emoji="📝" label="건의사항 메일 보내기" onPress={() => openUrl(FEEDBACK_MAIL)} last />
        </Card>

        <View style={{ height: 18 }} />
        <Text style={styles.footer}>
          ** 해당 앱은 치료와 진단을 하지 않습니다. 의심이 들 경우 전문의에게 상담하세요. **
        </Text>
      </ScrollView>

      <NameSheet visible={sheet === 'name'} onClose={() => setSheet(null)} />
      <BodySheet visible={sheet === 'body'} onClose={() => setSheet(null)} />
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <>
      <View style={{ height: 22 }} />
      <Text style={styles.sectionLabel}>{text}</Text>
      <View style={{ height: 10 }} />
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={[cardDecoration(), { paddingHorizontal: 16 }]}>{children}</View>;
}

function Row({
  icon,
  emoji,
  label,
  value,
  valueAccent,
  trailing,
  onPress,
  last,
}: {
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  emoji?: string;
  label: string;
  value?: string;
  valueAccent?: boolean;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: AppColors.line }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.rowIcon}>
        {emoji != null ? (
          <Text style={{ fontSize: 15 }}>{emoji}</Text>
        ) : (
          <MaterialIcons name={icon ?? 'chevron-right'} size={18} color={AppColors.greenMuted} />
        )}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {value != null && (
        <Text style={[styles.rowValue, valueAccent && { color: AppColors.greenMuted, fontWeight: '800' }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {trailing ?? (onPress ? <MaterialIcons name="chevron-right" size={20} color={AppColors.sub} /> : null)}
    </Pressable>
  );
}

function Switch({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.switch, on && styles.switchOn]} hitSlop={6}>
      <View style={[styles.knob, on && styles.knobOn]} />
    </Pressable>
  );
}

/** 아래에서 올라오는 공통 시트 껍데기 (RN Modal은 웹 미리보기에서 폰 프레임 밖으로 나간다) */
function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialIcons name="close" size={20} color={AppColors.sub} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function NameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { name, setName } = useProfile();
  const [draft, setDraft] = useState(name);

  // 시트가 열릴 때마다 지금 이름에서 시작한다
  React.useEffect(() => {
    if (visible) setDraft(name);
  }, [visible, name]);

  return (
    <Sheet visible={visible} title="이름 수정" onClose={onClose}>
      <Text style={styles.fieldLabel}>이름</Text>
      <View style={{ height: 6 }} />
      <TextInput
        value={draft}
        onChangeText={setDraft}
        maxLength={20}
        placeholder="이름을 입력해주세요"
        placeholderTextColor={AppColors.sub}
        style={styles.input}
      />
      <View style={{ height: 20 }} />
      <Pressable
        style={[styles.saveBtn, !draft.trim() && styles.saveBtnDisabled]}
        disabled={!draft.trim()}
        onPress={() => {
          setName(draft);
          onClose();
        }}
      >
        <Text style={[styles.saveBtnText, !draft.trim() && styles.saveBtnTextDisabled]}>저장</Text>
      </Pressable>
    </Sheet>
  );
}

function BodySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { body, setBody } = useProfile();
  const [draft, setDraft] = useState<BodyInfo>(body);

  React.useEffect(() => {
    if (visible) setDraft(body);
  }, [visible, body]);

  const numField = (key: 'height' | 'weight' | 'age', label: string, unit: string) => (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ height: 6 }} />
      <View style={styles.numRow}>
        <TextInput
          value={String(draft[key])}
          onChangeText={(t) => setDraft((d) => ({ ...d, [key]: Number(t.replace(/[^0-9]/g, '')) || 0 }))}
          keyboardType="number-pad"
          maxLength={3}
          style={[styles.input, { flex: 1 }]}
        />
        <Text style={styles.unitText}>{unit}</Text>
      </View>
      <View style={{ height: 14 }} />
    </>
  );

  return (
    <Sheet visible={visible} title="신체정보 수정" onClose={onClose}>
      {numField('height', '키', 'cm')}
      {numField('weight', '몸무게', 'kg')}
      {numField('age', '나이', '세')}
      <Text style={styles.fieldLabel}>성별</Text>
      <View style={{ height: 6 }} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(['male', 'female'] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.choice, draft.sex === s && styles.choiceActive]}
            onPress={() => setDraft((d) => ({ ...d, sex: s }))}
          >
            <Text style={[styles.choiceText, draft.sex === s && styles.choiceTextActive]}>
              {s === 'male' ? '남성' : '여성'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ height: 20 }} />
      <Pressable
        style={styles.saveBtn}
        onPress={() => {
          setBody(draft);
          onClose();
        }}
      >
        <Text style={styles.saveBtnText}>저장</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  sectionLabel: { fontSize: 12.5, fontWeight: '800', color: AppColors.sub, paddingLeft: 2 },

  profileCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 18 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F1F5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCaption: { fontSize: 11.5, fontWeight: '600', color: AppColors.sub },
  profileName: { fontSize: 20, fontWeight: '800', color: AppColors.ink },
  profileBody: { fontSize: 12.5, color: AppColors.sub },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    marginRight: 11,
    backgroundColor: '#F4F6F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: AppColors.ink },
  rowValue: { fontSize: 12.5, color: AppColors.sub, marginRight: 6, maxWidth: 140 },

  switch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#DADDE2',
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: AppColors.greenTop },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  knobOn: { alignSelf: 'flex-end' },

  noteBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#F4FBEC',
    borderRadius: 12,
    padding: 13,
    marginTop: 10,
  },
  noteText: { flex: 1, fontSize: 11.5, color: AppColors.greenMuted, lineHeight: 17 },

  footer: { fontSize: 10.5, color: AppColors.sub, textAlign: 'center', lineHeight: 16 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: AppColors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '86%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.line,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26 },

  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: AppColors.sub },
  input: {
    fontSize: 15,
    color: AppColors.ink,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: AppColors.line,
  },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitText: { fontSize: 14, fontWeight: '700', color: AppColors.sub, width: 26 },

  choice: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
  },
  choiceActive: { borderColor: AppColors.greenTop, backgroundColor: AppColors.greenTop },
  choiceText: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  choiceTextActive: { color: '#16320A' },

  saveBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#E7E9EC' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  saveBtnTextDisabled: { color: AppColors.sub },
});
