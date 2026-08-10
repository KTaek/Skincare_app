import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Rect } from 'react-native-svg';
import { AppColors } from '../theme';
import {
  monitoringColors as mc,
  monitoringCard,
  ITCH_SEGMENTS,
  SKIN_SEGMENTS,
  SYMPTOM_SEGMENTS_BASE,
} from '../folders/theme';
import { folderNameOf } from '../folders/targets';
import { plainSiteLabel } from '../models';
import { LesionBox } from '../ai/analyzeLocal';
import { GRADE_NAMES_KO } from '../ai/labels';
import { ExamAnalysis, ExamCapture } from '../exam/examTypes';
import { DUMP_RESULTS } from '../exam/dumpAnalysis';
import { igaDisplayValue, itchDisplayValue, SIGN_DISPLAY, SIGN_ORDER, signDisplayValue } from '../exam/examMetrics';
import { useMonitoring } from '../context/MonitoringContext';
import { MetricCard, MetricRow } from '../components/MetricCard';
import UsedProductsCard from '../components/UsedProductsCard';

/** 사용자가 직접 고를 수 있는 진단명 — 분류 모델의 클래스와 같은 집합에 "직접 입력"을 더한 것 */
const DIAGNOSES = ['아토피피부염', '건선', '여드름', '주사', '지루', '직접 입력'];

/**
 * 피부 촬영 분석 결과 화면.
 *
 *   신규·바로 스캔 — 사진 → 진단명 → 피부 종합 상태 → 증상 4종 → 가려움 → 사용한 제품
 *   이어서 기록   — 사진 → 피부 종합 상태 → 증상 4종 → 가려움
 *
 * 이어서 기록에서 진단명·사용한 제품 카드를 뺀 건, 이미 정해진 자리를 다시 찍는 것이라 매번
 * 다시 물을 것이 아니기 때문이다 — 진단명은 상단 제목에 이미 붙어 있고, 바꿀 일이 생기면 그
 * 폴더에서 고치는 게 맞다.
 *
 * 수면 점수는 여기에 없다. 이 단계에서 측정하는 값이 아니라 스마트워치에서 넘어오는 값이라,
 * 촬영 결과에 끼워 넣으면 이번 촬영으로 잰 값처럼 읽힌다.
 *
 * 결과는 이 화면이 뜨기 전에 이미 저장돼 있다(CameraScreen.saveExamRecord) — 버튼은 저장이
 * 아니라 "어디로 갈지"만 고른다.
 */
export default function ExamResultScreen({
  capture,
  analysis,
  linkedFolder,
  onLink,
  onOpenFolder,
  onOpenRecords,
  onClose,
}: {
  capture: ExamCapture;
  analysis: ExamAnalysis;
  linkedFolder: { id: string; name: string } | null;
  /** 이 자리로 경과 관찰 폴더를 만들고 이번 기록을 첫 기록으로 넣는다 */
  onLink: () => void;
  onOpenFolder: (folderId: string) => void;
  /** 기록 탭으로 넘어간다 (저장은 이미 끝나 있다) */
  onOpenRecords: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { findTarget, setDiagnosis } = useMonitoring();
  const isQuick = capture.kind === 'quick';
  const isNew = capture.kind === 'new';
  const isFollowUp = capture.kind === 'followUp';

  const { session } = capture;
  // 진단명을 결과 화면에서 고칠 수 있어서, 대상은 항상 저장소의 최신 상태를 읽는다
  const target = findTarget(capture.target.id) ?? capture.target;
  const disease = target.diagnosis?.disease;
  const skinValue = igaDisplayValue(analysis.local.igaGrade);

  const [editing, setEditing] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose}>
          <MaterialIcons name="close" size={22} color={AppColors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>피부 분석 결과</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {[isQuick ? '바로 스캔' : plainSiteLabel(target.label), disease].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <ConfidencePill score={session.confidence.score} tier={session.confidence.tier} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {DUMP_RESULTS && (
          <View style={styles.dumpNotice}>
            <MaterialIcons name="science" size={16} color={mc.greenDeep} />
            <Text style={styles.dumpNoticeText}>
              화면 확인용 예시 값이에요 — 기기에서 분석 모델을 실행하지 않았습니다
            </Text>
          </View>
        )}

        <PhotoPair uri={capture.photoUri} bbox={analysis.local.bbox} />

        {/* 이어서 기록은 이미 이름이 정해진 자리라 진단명을 다시 묻지 않는다 */}
        {!isFollowUp && (
          <DiseaseCard
            predictions={analysis.diseases}
            disease={disease}
            selfEntered={target.diagnosis?.source === 'self'}
            // 바로 스캔은 지켜보는 자리가 아니라 진단명을 붙여 둘 곳이 없다
            onEdit={isQuick ? undefined : () => setEditing(true)}
          />
        )}

        <MetricCard
          label="피부 종합 상태"
          value={skinValue}
          unit="/100"
          segments={SKIN_SEGMENTS}
          foot={`IGA ${GRADE_NAMES_KO[analysis.local.igaGradeName] ?? analysis.local.igaGradeName}`}
        />

        <SymptomCard analysis={analysis} />

        {capture.itchVas != null && (
          <MetricCard label="가려움" value={itchDisplayValue(capture.itchVas)} unit="/100" segments={ITCH_SEGMENTS} />
        )}

        {isNew && <UsedProductsCard date={new Date()} />}

        {isNew && (
          <LinkSection
            siteLabel={target.label}
            disease={disease}
            linkedFolder={linkedFolder}
            onLink={onLink}
            onOpenFolder={onOpenFolder}
          />
        )}

        {!isNew && !isQuick && linkedFolder && (
          <Pressable style={styles.openFolderBtn} onPress={() => onOpenFolder(linkedFolder.id)}>
            <MaterialIcons name="timeline" size={18} color={AppColors.greenMuted} />
            <Text style={styles.openFolderText}>“{linkedFolder.name}” 추이 보기</Text>
          </Pressable>
        )}

        {session.confidence.warnings.length > 0 && (
          <View style={[monitoringCard(), styles.card]}>
            <Text style={styles.cardLabel}>촬영 품질 참고</Text>
            {session.confidence.warnings.map((w) => (
              <Text key={w} style={styles.warnText}>
                • {w}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {/* 저장은 이미 끝났다는 걸 알려 준다 — 누를 것이 없어졌으니 말로라도 확인시켜 줘야 한다 */}
        {!isQuick && (
          <>
            <View style={styles.savedRow}>
              <MaterialIcons name="check-circle" size={15} color={mc.sev1} />
              <Text style={styles.savedText}>이번 결과는 기록에 저장됐어요</Text>
            </View>
            <View style={{ height: 10 }} />
          </>
        )}
        <Pressable style={styles.saveBtn} onPress={isQuick ? onClose : onOpenRecords}>
          <Text style={styles.saveBtnText}>{isQuick ? '닫기' : '기록 보기'}</Text>
        </Pressable>
        <View style={{ height: 10 }} />
        <Text style={styles.disclaimer}>
          ** 해당 앱은 치료와 진단을 하지 않습니다. 의심이 들 경우 전문의에게 상담하세요. **
        </Text>
      </View>

      <DiagnosisSheet
        visible={editing}
        current={target.diagnosis?.source === 'self' ? disease : undefined}
        onClose={() => setEditing(false)}
        onSave={(name) => {
          setDiagnosis(target.id, {
            diagnosed: true,
            disease: name,
            source: 'self',
            photoUri: capture.photoUri,
          });
          setEditing(false);
        }}
      />
    </View>
  );
}

/** 촬영·후처리 신뢰도 배지 — 낮은 기록은 추세에서 가중치를 낮춰야 하므로 결과에도 계속 달고 다닌다 */
function ConfidencePill({ score, tier }: { score: number; tier: 'high' | 'medium' | 'low' }) {
  const color = tier === 'high' ? mc.sev1 : tier === 'medium' ? mc.sev2 : mc.sev3;
  return (
    <View style={[styles.confPill, { backgroundColor: color }]}>
      <Text style={styles.confPillText}>신뢰도 {score}</Text>
    </View>
  );
}

/**
 * 진단명 카드.
 *
 * 촬영 전에 "진단 받은 적 있나요?"를 묻던 단계를 없앴다 — 진단명을 안다고 이 앱이 하는 일이
 * 달라지지 않는데 매번 거쳐야 하는 관문이 되어 있었다. 대신 사진으로 추정한 상위 3개를 여기서
 * 보여주고, 이미 아는 진단명이 있으면 그때 고쳐 넣게 한다.
 */
function DiseaseCard({
  predictions,
  disease,
  selfEntered,
  onEdit,
}: {
  predictions: ExamAnalysis['diseases'];
  disease?: string;
  selfEntered: boolean;
  onEdit?: () => void;
}) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.diseaseHead}>
        <Text style={styles.cardLabel}>진단명</Text>
        <View style={{ flex: 1 }} />
        {onEdit && (
          <Pressable style={styles.editBtn} onPress={onEdit} hitSlop={6}>
            <MaterialIcons name="edit" size={14} color={AppColors.greenMuted} />
            <Text style={styles.editBtnText}>{selfEntered ? '수정' : '직접 입력'}</Text>
          </Pressable>
        )}
      </View>

      {selfEntered ? (
        <>
          <Text style={styles.registeredName}>{disease}</Text>
          <Text style={styles.metricFoot}>직접 입력한 진단명이에요. 이 이름으로 경과를 이어서 봅니다.</Text>
        </>
      ) : predictions && predictions.length > 0 ? (
        <>
          {predictions.map((p, i) => (
            <View key={p.key} style={[styles.diseaseRow, i === 0 && styles.diseaseRowTop]}>
              <RingPercent
                percent={p.score * 100}
                color={i === 0 ? mc.greenTop : mc.navInactive}
                size={i === 0 ? 46 : 40}
              />
              <Text style={[styles.diseaseName, i === 0 && styles.diseaseNameTop]} numberOfLines={1}>
                {p.label}
              </Text>
            </View>
          ))}
          <Text style={styles.metricFoot}>
            사진으로 추정한 참고용 결과예요. 이미 진단받은 이름이 있으면 직접 입력해주세요.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.registeredName}>{disease ?? '미입력'}</Text>
          <Text style={styles.metricFoot}>진단받은 이름을 알고 있으면 직접 입력해주세요.</Text>
        </>
      )}
    </View>
  );
}

/** 4가지 증상을 카드 하나에 모아 보여준다 */
function SymptomCard({ analysis }: { analysis: ExamAnalysis }) {
  const byKey = useMemo(
    () => Object.fromEntries(analysis.local.signs.map((s) => [s.sign, s])),
    [analysis],
  );
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>4가지 증상</Text>
      {SIGN_ORDER.map((sign, i) => {
        const found = byKey[sign];
        // signDisplayValue는 원래(낮을수록 좋음) 스케일이라, 다른 카드처럼 "높을수록 좋음"으로
        // 보여주려면 100에서 뺀다 — SYMPTOM_SEGMENTS_BASE도 이미 그 방향으로 정의돼 있다.
        // (값이 없으면 원래 스케일에서 0 = 정상으로 보고, 뒤집은 값도 100 = 정상으로 남는다)
        const raw = found ? signDisplayValue(sign, found.grade) : 0;
        const value = 100 - raw;
        return (
          <MetricRow
            key={sign}
            label={SIGN_DISPLAY[sign].label}
            value={value}
            unit="/100"
            segments={SYMPTOM_SEGMENTS_BASE}
            first={i === 0}
          />
        );
      })}
    </View>
  );
}

/** 촬영 이미지 원본 + 증상 위치 오버레이 — 상세 결과 화면의 사진 카드와 같은 배치 */
function PhotoPair({ uri, bbox }: { uri: string; bbox: LesionBox }) {
  return (
    <View style={[monitoringCard(), styles.photoCard]}>
      <View style={styles.photoRow}>
        <View style={styles.photoCol}>
          <Image source={{ uri }} style={styles.photo} />
          <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
        </View>
        <View style={styles.photoCol}>
          <View style={styles.photo}>
            <Image source={{ uri }} style={StyleSheet.absoluteFill} />
            <Svg width="100%" height="100%" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
              <Rect
                x={(bbox.x / bbox.imageWidth) * 100}
                y={(bbox.y / bbox.imageHeight) * 100}
                width={(bbox.width / bbox.imageWidth) * 100}
                height={(bbox.height / bbox.imageHeight) * 100}
                rx={2}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={2}
                strokeDasharray="5,3"
              />
            </Svg>
          </View>
          <Text style={styles.photoCaption}>증상 부위 표시</Text>
        </View>
      </View>
    </View>
  );
}

/** 신규 기록 결과로 이 자리의 경과 관찰 폴더를 만드는 자리 */
function LinkSection({
  siteLabel,
  disease,
  linkedFolder,
  onLink,
  onOpenFolder,
}: {
  siteLabel: string;
  disease?: string;
  linkedFolder: { id: string; name: string } | null;
  onLink: () => void;
  onOpenFolder: (folderId: string) => void;
}) {
  if (linkedFolder) {
    return (
      <View style={[monitoringCard(), styles.card, styles.linkedCard]}>
        <View style={styles.linkedHead}>
          <MaterialIcons name="check-circle" size={20} color={mc.sev1} />
          <Text style={styles.linkedTitle}>경과 관찰에 연동했어요</Text>
        </View>
        <Text style={styles.linkedName}>{plainSiteLabel(linkedFolder.name)}</Text>
        <Pressable style={styles.openFolderBtn} onPress={() => onOpenFolder(linkedFolder.id)}>
          <MaterialIcons name="timeline" size={18} color={AppColors.greenMuted} />
          <Text style={styles.openFolderText}>추이 보기</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>경과 관찰에 연동</Text>
      <Text style={styles.metricFoot}>
        이 기록으로 경과 관찰 폴더를 하나 만들어요. 다음부터 같은 자리를 찍으면 추이 그래프에
        이어서 볼 수 있어요.
      </Text>
      <View style={{ height: 12 }} />
      <View style={styles.newFolderRow}>
        <MaterialIcons name="accessibility-new" size={20} color={AppColors.greenMuted} />
        <Text style={styles.newFolderName} numberOfLines={1}>
          {folderNameOf(plainSiteLabel(siteLabel), disease)}
        </Text>
      </View>
      <View style={{ height: 12 }} />
      <Pressable style={styles.linkBtn} onPress={onLink}>
        <Text style={styles.linkBtnText}>경과 관찰에 연동하기</Text>
      </Pressable>
    </View>
  );
}

/** 진단명 직접 입력 시트 */
function DiagnosisSheet({
  visible,
  current,
  onClose,
  onSave,
}: {
  visible: boolean;
  current?: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState('');

  React.useEffect(() => {
    if (!visible) return;
    if (current && DIAGNOSES.includes(current)) {
      setPicked(current);
      setCustom('');
    } else if (current) {
      setPicked('직접 입력');
      setCustom(current);
    } else {
      setPicked(null);
      setCustom('');
    }
  }, [visible, current]);

  if (!visible) return null;

  const name = picked === '직접 입력' ? custom.trim() : picked ?? '';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>진단명 입력</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialIcons name="close" size={20} color={mc.sub} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetHint}>
              피부과에서 들은 진단명이 있으면 골라주세요. 입력하지 않으면 분석으로 추정한 이름을 씁니다.
            </Text>
            <View style={{ height: 14 }} />
            <View style={styles.grid}>
              {DIAGNOSES.map((d) => (
                <Pressable
                  key={d}
                  style={[styles.gridBox, picked === d && styles.gridBoxActive]}
                  onPress={() => setPicked(d)}
                >
                  <Text style={[styles.gridText, picked === d && styles.gridTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>
            {picked === '직접 입력' && (
              <>
                <View style={{ height: 12 }} />
                <TextInput
                  style={styles.input}
                  value={custom}
                  onChangeText={setCustom}
                  placeholder="진단명을 입력해주세요"
                  placeholderTextColor={mc.sub}
                />
              </>
            )}
            <View style={{ height: 20 }} />
            <Pressable
              style={[styles.linkBtn, !name && styles.linkBtnDisabled]}
              disabled={!name}
              onPress={() => onSave(name)}
            >
              <Text style={[styles.linkBtnText, !name && styles.linkBtnTextDisabled]}>저장</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

/** 진단율을 보여주는 원형 게이지 */
function RingPercent({ percent, color, size = 46 }: { percent: number; color: string; size?: number }) {
  const stroke = 4.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, percent)) / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={mc.line} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringText}>{Math.round(percent)}%</Text>
    </View>
  );
}

const PHOTO_SIZE = 130;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mc.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: mc.card,
    borderBottomWidth: 1,
    borderBottomColor: mc.line,
  },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: mc.ink },
  headerSub: { fontSize: 11.5, color: mc.sub, marginTop: 1 },
  confPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  confPillText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },

  body: { padding: 16, gap: 12, paddingBottom: 24 },
  dumpNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#EDF7E1',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dumpNoticeText: { flex: 1, fontSize: 11.5, color: mc.greenDeep, lineHeight: 17 },
  card: { padding: 16 },
  cardLabel: { fontSize: 16, fontWeight: '800', color: mc.ink, marginBottom: 12 },
  metricFoot: { fontSize: 11.5, color: mc.sub, marginTop: 10, lineHeight: 17 },

  diseaseHead: { flexDirection: 'row', alignItems: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF5E4',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  editBtnText: { fontSize: 12, fontWeight: '800', color: AppColors.greenMuted },
  diseaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: mc.bg,
  },
  diseaseRowTop: { backgroundColor: '#EDF7E1' },
  diseaseName: { flex: 1, fontSize: 14.5, fontWeight: '600', color: mc.ink },
  diseaseNameTop: { fontSize: 16, fontWeight: '800' },
  ringText: { position: 'absolute', fontSize: 11.5, fontWeight: '800', color: mc.ink },
  registeredName: { fontSize: 22, fontWeight: '800', color: mc.ink },

  photoCard: { padding: 12 },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  photoCol: { alignItems: 'center' },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  linkedCard: { borderWidth: 1.5, borderColor: mc.greenTop },
  linkedHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkedTitle: { fontSize: 13, fontWeight: '800', color: mc.ink },
  linkedName: { fontSize: 16, fontWeight: '800', color: mc.ink, marginTop: 8 },
  newFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: mc.bg,
    borderWidth: 1,
    borderColor: mc.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  newFolderName: { flex: 1, fontSize: 14.5, fontWeight: '800', color: mc.ink },
  linkBtn: { backgroundColor: mc.greenTop, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  linkBtnDisabled: { backgroundColor: '#E7E9EC' },
  linkBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  linkBtnTextDisabled: { color: mc.sub },
  openFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: mc.card,
  },
  openFolderText: { fontSize: 13.5, fontWeight: '800', color: AppColors.greenMuted },

  warnText: { fontSize: 12.5, color: mc.ink, lineHeight: 19 },

  footer: { paddingHorizontal: 16, paddingBottom: 18, paddingTop: 10, backgroundColor: mc.bg },
  saveBtn: { backgroundColor: mc.greenTop, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  savedText: { fontSize: 12, fontWeight: '600', color: mc.sub },
  disclaimer: { fontSize: 10, color: mc.sub, textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: mc.card,
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
    borderBottomColor: mc.line,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: mc.ink },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26 },
  sheetHint: { fontSize: 12.5, color: mc.sub, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridBox: {
    width: '47%',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
  },
  gridBoxActive: { borderColor: mc.greenTop, backgroundColor: mc.greenTop },
  gridText: { fontSize: 14.5, fontWeight: '700', color: mc.ink },
  gridTextActive: { color: '#16320A' },
  input: {
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: mc.ink,
  },
});
