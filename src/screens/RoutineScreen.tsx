import React, { useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { AppColors, cardDecoration } from '../theme';
import { RoutineRow } from '../components/widgets';
import { useRoutines } from '../context/RoutineContext';

/** 홈의 "루틴" 화살표로만 들어오는, 탭 바 밖의 화면 — 그래서 직접 뒤로가기 버튼을 둔다 */
export default function RoutineScreen({ navigation }: { navigation: any }) {
  const { sorted, add, remove, toggle } = useRoutines();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [showPicker, setShowPicker] = useState(false);

  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const allDone = sorted.length > 0 && sorted.every((r) => r.done);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    add(trimmed, timeStr);
    setName('');
    setShowForm(false);
  };

  const onTimeChange = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowPicker(Platform.OS === 'ios'); // iOS는 인라인 유지, Android는 닫힘
    if (selected) setTime(selected);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: AppColors.bg }} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.topBarTitle}>루틴 추가</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>관리 루틴과 실행 시각을 자유롭게 등록하세요</Text>
        <View style={{ height: 16 }} />

        {!showForm && (
          <Pressable style={styles.addBtn} onPress={() => setShowForm(true)}>
            <MaterialIcons name="add" size={18} color="#16320A" />
            <View style={{ width: 7 }} />
            <Text style={styles.addBtnText}>루틴 추가</Text>
          </Pressable>
        )}

        {showForm && (
          <View style={[cardDecoration(), styles.form]}>
            <Text style={styles.fieldLabel}>루틴 이름</Text>
            <View style={{ height: 6 }} />
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={30}
              placeholder="예: 세라마이드 보습제 바르기"
              placeholderTextColor={AppColors.sub}
              style={styles.input}
            />
            <View style={{ height: 8 }} />
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
            <View style={{ height: 14 }} />
            <View style={{ flexDirection: 'row' }}>
              <Pressable style={[styles.formBtn, styles.cancelBtn]} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </Pressable>
              <View style={{ width: 10 }} />
              <Pressable style={[styles.formBtn, styles.saveBtn]} onPress={save}>
                <Text style={styles.saveBtnText}>저장</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={{ height: 16 }} />

        <View style={[cardDecoration(), sorted.length === 0 ? { padding: 30 } : { paddingHorizontal: 18 }]}>
          {sorted.length === 0 ? (
            <Text style={styles.emptyText}>아직 등록한 루틴이 없어요.{'\n'}위의 '루틴 추가'로 시작해보세요.</Text>
          ) : (
            sorted.map((r, i) => (
              <RoutineRow
                key={r.id}
                routine={r}
                last={i === sorted.length - 1}
                onToggle={() => toggle(r.id)}
                onDelete={() => remove(r.id)}
              />
            ))
          )}
        </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 16, fontWeight: '700', color: AppColors.ink },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 15,
    backgroundColor: AppColors.greenTop,
  },
  addBtnText: { fontSize: 15, fontWeight: '700', color: '#16320A' },
  form: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
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
  formBtn: { flex: 1, padding: 12, borderRadius: 12, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#F1F3F6' },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: '#555555' },
  saveBtn: { backgroundColor: AppColors.greenTop },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#16320A' },
  emptyText: { textAlign: 'center', fontSize: 14, color: AppColors.sub, lineHeight: 21 },
  stampWrap: { alignItems: 'center', marginTop: 18 },
  stampImage: { width: 240, height: 240, opacity: 0.95, transform: [{ rotate: '-12deg' }] },
});
