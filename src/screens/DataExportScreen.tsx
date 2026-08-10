import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { useFolders } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo } from '../folders/theme';
import { plainSiteLabel } from '../models';
import { useProfile } from '../context/ProfileContext';
import { EXPORT_FIELDS, ExportField, ExportRecord, exportRecordsPdf } from '../records/pdfExport';

/**
 * 데이터 다운로드 — 기록을 PDF 보고서로 내보낸다.
 *
 * 두 단계로 나눈 이유는 고를 것이 성격이 다른 둘이기 때문이다.
 *   1단계 — 어떤 **기록**을 넣을지 (날짜 단위, 폴더별로 묶어서 보여준다)
 *   2단계 — 그 기록에서 어떤 **항목**을 넣을지 (이미지·지표·메모)
 * 한 화면에 다 두면 체크박스가 뒤섞여 무엇을 고르는 중인지 알기 어렵다.
 */

type Step = 'records' | 'fields';

/** 폴더 하나 + 그 안의 기록들 */
type FolderGroup = { id: string; name: string; records: any[] };

const keyOf = (folderId: string, recordId: any) => `${folderId}:${recordId}`;

const fmtDate = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}.${m}.${d}`;
};

export default function DataExportScreen({ navigation }: { navigation: any }) {
  const folders = useFolders();
  const { healthConnected } = useProfile();
  const [step, setStep] = useState<Step>('records');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // 처음에는 전부 켜 둔다 — 빼고 싶은 것만 끄는 쪽이 하나씩 켜는 것보다 손이 덜 간다
  const [fields, setFields] = useState<Set<ExportField>>(() => new Set(EXPORT_FIELDS.map((f) => f.key)));
  const [busy, setBusy] = useState(false);

  const groups = useMemo<FolderGroup[]>(
    () =>
      folders
        .filter((f: any) => f.records.length > 0)
        .map((f: any) => ({ id: f.id, name: plainSiteLabel(f.name), records: [...f.records].reverse() })),
    [folders],
  );

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleFolder = (g: FolderGroup) => {
    const keys = g.records.map((r) => keyOf(g.id, r.id));
    const allOn = keys.every((k) => picked.has(k));
    setPicked((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const toggleField = (key: ExportField) =>
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const makePdf = async () => {
    const entries: ExportRecord[] = [];
    groups.forEach((g) =>
      g.records.forEach((r) => {
        if (picked.has(keyOf(g.id, r.id))) entries.push({ folderId: g.id, folderName: g.name, record: r });
      }),
    );
    setBusy(true);
    try {
      const { shared, uri } = await exportRecordsPdf(entries, [...fields], { healthConnected });
      if (!shared) Alert.alert('PDF를 만들었어요', `이 기기에서는 공유를 쓸 수 없어 파일로만 남겼어요.\n${uri}`);
    } catch (e: any) {
      Alert.alert('PDF를 만들지 못했어요', e?.message ?? '알 수 없는 오류가 발생했어요');
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0) {
    return (
      <View style={[styles.root, styles.center]}>
        <MaterialIcons name="picture-as-pdf" size={40} color={AppColors.sub} />
        <View style={{ height: 10 }} />
        <Text style={styles.emptyText}>내보낼 기록이 아직 없어요</Text>
      </View>
    );
  }

  /* ── 1단계: 어떤 기록을 넣을지 ─────────────────────────────────────── */
  if (step === 'records') {
    const total = groups.reduce((n, g) => n + g.records.length, 0);
    const allOn = picked.size === total && total > 0;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <StepHeader step="1 / 2" title="어떤 기록을 내보낼까요?" caption="날짜별로 고를 수 있어요" />

          <Pressable
            style={styles.selectAll}
            onPress={() =>
              setPicked(allOn ? new Set() : new Set(groups.flatMap((g) => g.records.map((r) => keyOf(g.id, r.id)))))
            }
          >
            <Text style={styles.selectAllText}>{allOn ? '전체 해제' : `전체 선택 (${total}건)`}</Text>
          </Pressable>

          {groups.map((g) => {
            const keys = g.records.map((r) => keyOf(g.id, r.id));
            const on = keys.filter((k) => picked.has(k)).length;
            return (
              <View key={g.id} style={[cardDecoration(16), styles.card]}>
                <Pressable style={styles.folderHead} onPress={() => toggleFolder(g)}>
                  <Text style={styles.folderName} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={styles.folderCount}>
                    {on}/{g.records.length}
                  </Text>
                  <CheckBox on={on === g.records.length} partial={on > 0 && on < g.records.length} />
                </Pressable>

                {g.records.map((r) => {
                  const k = keyOf(g.id, r.id);
                  const skin = DISPLAY_SCALE.iga(r.iga);
                  return (
                    <Pressable key={k} style={styles.recordRow} onPress={() => toggle(k)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.recordDate}>{fmtDate(r.date)}</Text>
                        <Text style={[styles.recordBand, { color: skinConditionInfo(skin).color }]}>
                          피부 종합 상태 {Math.round(skin)} · {skinConditionInfo(skin).ko}
                        </Text>
                      </View>
                      <CheckBox on={picked.has(k)} />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>

        <Footer
          label={`다음 (${picked.size}건)`}
          disabled={picked.size === 0}
          onPress={() => setStep('fields')}
        />
      </View>
    );
  }

  /* ── 2단계: 어떤 항목을 넣을지 ────────────────────────────────────── */
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <StepHeader
          step="2 / 2"
          title="무엇을 포함할까요?"
          caption={`기록 ${picked.size}건에 이 항목들이 들어가요`}
        />

        <View style={[cardDecoration(16), styles.card]}>
          {EXPORT_FIELDS.map((f, i) => (
            <Pressable
              key={f.key}
              style={[styles.fieldRow, i !== 0 && styles.fieldRowDivided]}
              onPress={() => toggleField(f.key)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <Text style={styles.fieldCaption}>{f.caption}</Text>
              </View>
              <CheckBox on={fields.has(f.key)} />
            </Pressable>
          ))}
        </View>

        {fields.has('sleep') && !healthConnected && (
          <View style={styles.noteBox}>
            <MaterialIcons name="info-outline" size={15} color={AppColors.greenMuted} />
            <Text style={styles.noteText}>
              스마트워치를 연동하지 않아 수면 점수는 "미기재"로 나가요.
            </Text>
          </View>
        )}
      </ScrollView>

      <Footer
        label={busy ? undefined : 'PDF 만들기'}
        busy={busy}
        disabled={fields.size === 0}
        onPress={makePdf}
        onBack={() => setStep('records')}
      />
    </View>
  );
}

function StepHeader({ step, title, caption }: { step: string; title: string; caption: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.step}>{step}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

function CheckBox({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <View style={[styles.check, (on || partial) && styles.checkOn]}>
      {(on || partial) && (
        <MaterialIcons name={partial ? 'remove' : 'check'} size={15} color="#16320A" />
      )}
    </View>
  );
}

function Footer({
  label,
  disabled,
  busy,
  onPress,
  onBack,
}: {
  label?: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.footer}>
      {onBack && (
        <Pressable style={styles.backBtn} onPress={onBack} disabled={busy}>
          <Text style={styles.backBtnText}>이전</Text>
        </Pressable>
      )}
      <Pressable
        style={[styles.primaryBtn, (disabled || busy) && styles.primaryBtnOff]}
        onPress={onPress}
        disabled={disabled || busy}
      >
        {busy ? <ActivityIndicator color="#16320A" /> : <Text style={styles.primaryBtnText}>{label}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AppColors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: AppColors.sub },
  body: { padding: 20, paddingBottom: 24 },

  step: { fontSize: 12, fontWeight: '700', color: AppColors.sub },
  title: { fontSize: 20, fontWeight: '800', color: AppColors.ink, marginTop: 4 },
  caption: { fontSize: 13, color: AppColors.sub, marginTop: 4 },

  selectAll: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 6 },
  selectAllText: { fontSize: 13, fontWeight: '700', color: AppColors.greenMuted },

  card: { paddingHorizontal: 16, paddingVertical: 6, marginBottom: 12 },
  folderHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  folderName: { flex: 1, fontSize: 15, fontWeight: '800', color: AppColors.ink },
  folderCount: { fontSize: 12, fontWeight: '700', color: AppColors.sub },

  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: AppColors.line,
    gap: 8,
  },
  recordDate: { fontSize: 13.5, fontWeight: '700', color: AppColors.ink },
  recordBand: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 8 },
  fieldRowDivided: { borderTopWidth: 1, borderTopColor: AppColors.line },
  fieldLabel: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  fieldCaption: { fontSize: 11.5, color: AppColors.sub, marginTop: 2 },

  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#C9CED6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: AppColors.greenTop, borderColor: AppColors.greenTop },

  noteBox: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: '#EAF3DF',
    borderRadius: 12,
    padding: 12,
  },
  noteText: { flex: 1, fontSize: 12, color: AppColors.greenMuted, lineHeight: 17 },

  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  backBtn: {
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  primaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: AppColors.greenTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnOff: { backgroundColor: '#D8DEE6' },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
});
