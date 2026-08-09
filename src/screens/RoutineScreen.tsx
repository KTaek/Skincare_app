import React, { useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { AppColors, cardDecoration } from '../theme';
import { RoutineRow } from '../components/widgets';
import { CareItem, CareKind, cycleLabel } from '../models';
import { useRoutines } from '../context/RoutineContext';

/** 접었을 때 보여주는 줄 수 — 나머지는 "더보기"로 펼친다 */
const COLLAPSED_COUNT = 3;

/**
 * 루틴 탭 — 일상 루틴과 사용 제품을 따로 관리한다.
 *
 * 두 목록은 같은 모양(이름 · 시각 · PUSH 알람 · 오늘 했는지)을 쓰지만, 제품에만 "사용 주기"가
 * 붙는다. 홈의 "오늘의 피부 케어"는 이 둘을 시각 순으로 섞어서 보여주고, 상세 결과 화면의
 * "사용한 제품"은 여기 등록한 제품 목록에서 그날 쓴 것을 가져간다.
 */
export default function RoutineScreen({ navigation }: { navigation: any }) {
  const { routinesForOffset, allProductsForOffset, toggleForOffset, add, remove } = useRoutines();
  const [sheet, setSheet] = useState<CareKind | null>(null);
  const [expanded, setExpanded] = useState<Record<CareKind, boolean>>({ routine: false, product: false });

  const routines = routinesForOffset(0);
  // 관리 목록이라 오늘 쓰지 않는 주기의 제품도 함께 보여준다 (체크만 못 하게 막는다)
  const products = allProductsForOffset(0);
  const todays = [...routines, ...products.filter((p) => p.due)];
  const allDone = todays.length > 0 && todays.every((i) => i.done);

  const toggleExpanded = (kind: CareKind) => setExpanded((e) => ({ ...e, [kind]: !e[kind] }));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>루틴</Text>
        <View style={{ height: 4 }} />
        <Text style={styles.subtitle}>일상 루틴과 사용 제품을 추가하고 관리해요</Text>
        <View style={{ height: 16 }} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <AddButton emoji="🌻" label="루틴 추가" onPress={() => setSheet('routine')} />
          <AddButton emoji="💊" label="제품 추가" onPress={() => setSheet('product')} />
        </View>

        <View style={{ height: 22 }} />
        <CareSection
          title="일상 루틴"
          emptyText={"아직 등록한 루틴이 없어요.\n위의 '루틴 추가'로 시작해보세요."}
          items={routines}
          expanded={expanded.routine}
          onToggleExpanded={() => toggleExpanded('routine')}
          onToggle={(key) => toggleForOffset(0, key)}
          onDelete={(id) => remove('routine', id)}
        />

        <View style={{ height: 22 }} />
        <CareSection
          title="사용 제품"
          emptyText={"아직 등록한 제품이 없어요.\n위의 '제품 추가'로 시작해보세요."}
          items={products}
          expanded={expanded.product}
          onToggleExpanded={() => toggleExpanded('product')}
          onToggle={(key) => toggleForOffset(0, key)}
          onDelete={(id) => remove('product', id)}
        />

        {allDone && (
          <View style={styles.stampWrap}>
            <Image
              source={require('../../assets/stamps/well-done.png')}
              style={styles.stampImage}
              resizeMode="contain"
            />
          </View>
        )}
      </ScrollView>

      <AddCareSheet
        kind={sheet}
        onClose={() => setSheet(null)}
        onSave={(kind, draft) => {
          add(kind, draft);
          setSheet(null);
        }}
      />
    </View>
  );
}

/** ➕ 🌻 루틴 추가 / ➕ 💊 제품 추가 */
function AddButton({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.addBtn} onPress={onPress}>
      <MaterialIcons name="add" size={17} color="#16320A" />
      <Text style={styles.addBtnEmoji}>{emoji}</Text>
      <Text style={styles.addBtnText}>{label}</Text>
    </Pressable>
  );
}

/** 목록 카드 하나 — 3줄까지만 보여주고 나머지는 "더보기"로 펼친다 */
function CareSection({
  title,
  emptyText,
  items,
  expanded,
  onToggleExpanded,
  onToggle,
  onDelete,
}: {
  title: string;
  emptyText: string;
  items: CareItem[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggle: (key: string) => void;
  onDelete: (id: number) => void;
}) {
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const hidden = items.length - visible.length;

  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ height: 10 }} />
      <View style={[cardDecoration(), items.length === 0 ? { padding: 28 } : { paddingHorizontal: 18 }]}>
        {items.length === 0 ? (
          <Text style={styles.emptyText}>{emptyText}</Text>
        ) : (
          visible.map((item, i) => (
            <RoutineRow
              key={item.key}
              item={item}
              last={i === visible.length - 1}
              // 오늘 주기가 아닌 제품은 체크할 수 없다 — 대신 흐리게 표시된다
              onToggle={item.due ? () => onToggle(item.key) : undefined}
              onDelete={() => onDelete(item.id)}
            />
          ))
        )}
      </View>
      {items.length > COLLAPSED_COUNT && (
        <Pressable style={styles.moreRow} onPress={onToggleExpanded}>
          <MaterialIcons name={expanded ? 'expand-less' : 'search'} size={15} color={AppColors.sub} />
          <Text style={styles.moreText}>{expanded ? '접기' : `더보기 (${hidden}개)`}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** 루틴/제품 추가 시트 — 화면 트리 안의 절대위치 View로 덮는다 (RN Modal은 웹 미리보기에서 프레임 밖으로 나간다) */
function AddCareSheet({
  kind,
  onClose,
  onSave,
}: {
  kind: CareKind | null;
  onClose: () => void;
  onSave: (kind: CareKind, draft: { name: string; time: string; push: boolean; cycleDays: number }) => void;
}) {
  const [name, setName] = useState('');
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [showPicker, setShowPicker] = useState(false);
  const [push, setPush] = useState<boolean | null>(null);
  const [cycleDays, setCycleDays] = useState(1);

  // 시트를 닫을 때마다 입력을 비워, 다음에 열면 항상 빈 폼으로 시작한다
  const close = () => {
    setName('');
    setPush(null);
    setCycleDays(1);
    setShowPicker(false);
    onClose();
  };

  if (!kind) return null;

  const isProduct = kind === 'product';
  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const canSave = !!name.trim() && push != null;

  const onTimeChange = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowPicker(Platform.OS === 'ios'); // iOS는 인라인 유지, Android는 닫힘
    if (selected) setTime(selected);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {isProduct ? '💊 제품 추가' : '🌻 루틴 추가'}
            </Text>
            <Pressable onPress={close} hitSlop={10}>
              <MaterialIcons name="close" size={20} color={AppColors.sub} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>{isProduct ? '제품 이름' : '루틴 이름'}</Text>
            <View style={{ height: 6 }} />
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={30}
              placeholder={isProduct ? '예: BT4 Complex' : '예: 미지근한 물로 샤워하기'}
              placeholderTextColor={AppColors.sub}
              style={styles.input}
            />

            <View style={{ height: 14 }} />
            <Text style={styles.fieldLabel}>실행 시각</Text>
            <View style={{ height: 6 }} />
            <Pressable style={styles.timeField} onPress={() => setShowPicker(true)}>
              <MaterialIcons name="schedule" size={18} color={AppColors.sub} />
              <View style={{ width: 8 }} />
              <Text style={styles.timeText}>{timeStr}</Text>
            </Pressable>
            {showPicker && (
              <DateTimePicker value={time} mode="time" is24Hour display="spinner" onChange={onTimeChange} />
            )}

            {isProduct && (
              <>
                <View style={{ height: 14 }} />
                <Text style={styles.fieldLabel}>사용 주기</Text>
                <View style={{ height: 6 }} />
                <View style={styles.cycleField}>
                  <Text style={styles.cycleEmoji}>📅</Text>
                  <Text style={styles.cycleValue}>
                    {cycleDays}일
                    <Text style={styles.cycleHint}>  · {cycleLabel(cycleDays)}</Text>
                  </Text>
                  <View style={{ flex: 1 }} />
                  <StepBtn icon="remove" onPress={() => setCycleDays((c) => Math.max(1, c - 1))} />
                  <View style={{ width: 8 }} />
                  <StepBtn icon="add" onPress={() => setCycleDays((c) => Math.min(30, c + 1))} />
                </View>
              </>
            )}

            <View style={{ height: 14 }} />
            <Text style={styles.fieldLabel}>PUSH 알람 수신 여부</Text>
            <View style={{ height: 6 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ChoiceBtn label="예" active={push === true} onPress={() => setPush(true)} />
              <ChoiceBtn label="아니오" active={push === false} onPress={() => setPush(false)} />
            </View>

            <View style={{ height: 20 }} />
            <Pressable
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              disabled={!canSave}
              onPress={() => {
                onSave(kind, { name: name.trim(), time: timeStr, push: push === true, cycleDays });
                setName('');
                setPush(null);
                setCycleDays(1);
                setShowPicker(false);
              }}
            >
              <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>저장</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function StepBtn({
  icon,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.stepBtn} onPress={onPress} hitSlop={6}>
      <MaterialIcons name={icon} size={18} color={AppColors.greenMuted} />
    </Pressable>
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
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },

  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 15,
    backgroundColor: AppColors.greenTop,
  },
  addBtnEmoji: { fontSize: 14, marginHorizontal: 4 },
  addBtnText: { fontSize: 14.5, fontWeight: '800', color: '#16320A' },

  emptyText: { textAlign: 'center', fontSize: 14, color: AppColors.sub, lineHeight: 21 },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 10,
  },
  moreText: { fontSize: 12.5, fontWeight: '700', color: AppColors.sub },

  stampWrap: { alignItems: 'center', marginTop: 18 },
  stampImage: { width: 220, height: 220, opacity: 0.95, transform: [{ rotate: '-12deg' }] },

  // ---- 추가 시트 ----
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
  timeField: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: AppColors.line,
  },
  timeText: { fontSize: 15, color: AppColors.ink },

  cycleField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: AppColors.line,
  },
  cycleEmoji: { fontSize: 15, marginRight: 8 },
  cycleValue: { fontSize: 15, fontWeight: '800', color: AppColors.ink },
  cycleHint: { fontSize: 12.5, fontWeight: '600', color: AppColors.sub },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF5E4',
    alignItems: 'center',
    justifyContent: 'center',
  },

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
