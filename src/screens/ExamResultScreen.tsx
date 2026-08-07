import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Rect } from 'react-native-svg';
import { AppColors } from '../theme';
import {
  monitoringColors as mc,
  monitoringCard,
  itchBand,
  skinConditionInfo,
  sleepBand,
  symptomBand,
  ITCH_SEGMENTS,
  SKIN_SEGMENTS,
  SLEEP_SEGMENTS,
  SYMPTOM_SEGMENTS_BASE,
} from '../folders/theme';
import ScaleBar, { ScaleAxis } from '../folders/components/ScaleBar';
import { folderNameOf } from '../folders/targets';
import { LesionBox } from '../ai/analyzeLocal';
import { GRADE_NAMES_KO } from '../ai/labels';
import { ExamAnalysis, ExamCapture } from '../exam/examTypes';
import { DUMP_RESULTS } from '../exam/dumpAnalysis';
import { igaDisplayValue, itchDisplayValue, SIGN_DISPLAY, SIGN_ORDER, signDisplayValue } from '../exam/examMetrics';

/**
 * 검사 결과 화면 — 검사 종류에 따라 보여주는 깊이가 다르다.
 *
 *   신규 검사        : 질환 Top3 + 피부 종합 상태(IGA)만 먼저 보여주고, 세부 지표
 *                      (홍반·구진·찰상·태선화 + 가려움 + 수면)는 "자세히 보기"를 눌렀을 때 펼친다.
 *                      여기서 이 검사를 경과 기록(모니터링 폴더)에 연동할 수 있다.
 *   경과 이어서 기록 : 이미 지켜보는 자리라 질환 분류는 하지 않고, IGA와 세부 지표를 처음부터
 *                      한 화면에 펼쳐 보여준다 ("자세히 보기" 창이 없다).
 */
export default function ExamResultScreen({
  capture,
  analysis,
  sleepScore,
  linkedFolder,
  onLink,
  onOpenFolder,
  onSave,
  onClose,
}: {
  capture: ExamCapture;
  analysis: ExamAnalysis;
  /** 삼성헬스 연동 수면 점수(0~100). 이어받을 값이 없으면 null → "등록 안함" */
  sleepScore: number | null;
  linkedFolder: { id: string; name: string } | null;
  /** 이 자리로 경과 기록 폴더를 만들고 이번 검사를 첫 기록으로 넣는다 */
  onLink: () => void;
  onOpenFolder: (folderId: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isNew = capture.kind === 'new';
  const [detailOpen, setDetailOpen] = useState(false);

  const { target, session } = capture;
  const skinValue = igaDisplayValue(analysis.local.igaGrade);
  const skin = skinConditionInfo(skinValue);
  const disease = target.diagnosis?.disease;

  const detail = (
    <>
      <PhotoPair uri={capture.photoUri} bbox={analysis.local.bbox} />
      <SymptomCard analysis={analysis} />
      <ItchCard vas={capture.itchVas} />
      <SleepCard score={sleepScore} />
    </>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose}>
          <MaterialIcons name="close" size={22} color={AppColors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{isNew ? '검사 결과' : '경과 기록 결과'}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {[target.label, disease].filter(Boolean).join(' · ')}
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
        {isNew ? (
          <>
            {analysis.diseases ? (
              <DiseaseTop3Card predictions={analysis.diseases} />
            ) : (
              <RegisteredDiseaseCard disease={disease} />
            )}

            <SkinCard value={skinValue} band={skin} igaName={analysis.local.igaGradeName} />

            <Pressable style={styles.detailToggle} onPress={() => setDetailOpen((v) => !v)}>
              <Text style={styles.detailToggleText}>자세히 보기</Text>
              <MaterialIcons
                name={detailOpen ? 'expand-less' : 'expand-more'}
                size={20}
                color={AppColors.greenMuted}
              />
            </Pressable>
            {detailOpen && detail}

            <LinkSection
              target={target}
              disease={disease}
              linkedFolder={linkedFolder}
              onLink={onLink}
              onOpenFolder={onOpenFolder}
            />
          </>
        ) : (
          <>
            <PhotoPair uri={capture.photoUri} bbox={analysis.local.bbox} />
            <SkinCard value={skinValue} band={skin} igaName={analysis.local.igaGradeName}>
              <View style={styles.symptomDivider} />
              <SymptomList analysis={analysis} />
            </SkinCard>
            <ItchCard vas={capture.itchVas} />
            <SleepCard score={sleepScore} />
            {linkedFolder && (
              <Pressable style={styles.openFolderBtn} onPress={() => onOpenFolder(linkedFolder.id)}>
                <MaterialIcons name="timeline" size={18} color={AppColors.greenMuted} />
                <Text style={styles.openFolderText}>“{linkedFolder.name}” 추이 보기</Text>
              </Pressable>
            )}
          </>
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
        <Pressable style={styles.saveBtn} onPress={onSave}>
          <Text style={styles.saveBtnText}>결과 저장하고 기록 보기</Text>
        </Pressable>
        <View style={{ height: 10 }} />
        <Text style={styles.disclaimer}>
          ** 해당 앱은 치료와 진단을 하지 않습니다. 의심이 들 경우 전문의에게 상담하세요. **
        </Text>
      </View>
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

/** 질환 분류 상위 3개 — 1위만 초록 링/강조 행으로 띄운다 */
function DiseaseTop3Card({ predictions }: { predictions: ExamAnalysis['diseases'] }) {
  if (!predictions) return null;
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>상위 3개 결과</Text>
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
        사진으로 추정한 참고용 결과예요. 진단은 피부과 전문의만 내릴 수 있어요.
      </Text>
    </View>
  );
}

/** 의사 진단을 이미 등록한 경우 — 질환 분류 모델은 돌리지 않는다 */
function RegisteredDiseaseCard({ disease }: { disease?: string }) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>등록한 질환</Text>
      <Text style={styles.registeredName}>{disease ?? '등록 안함'}</Text>
      <Text style={styles.metricFoot}>
        전문의 진단을 등록해 두어서 질환 분류는 건너뛰고 중증도만 분석했어요.
      </Text>
    </View>
  );
}

/** 피부 종합 상태(IGA) — 모니터링 상세 화면과 같은 0~100 스케일·같은 4단계 이름 */
function SkinCard({
  value,
  band,
  igaName,
  children,
}: {
  value: number;
  band: { ko: string; color: string };
  igaName: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>피부 종합 상태</Text>
      <View style={styles.metricHeadRow}>
        <Text style={styles.metricBig}>
          {value.toFixed(1)}
          <Text style={styles.metricUnit}>/100</Text>
        </Text>
        <Text style={[styles.metricSub, { color: band.color }]}>{band.ko}</Text>
      </View>
      <ScaleBar value={value} segments={SKIN_SEGMENTS} />
      <Text style={styles.metricFoot}>IGA {GRADE_NAMES_KO[igaName] ?? igaName}</Text>
      {children}
    </View>
  );
}

/** 세부 지표 4종을 카드 하나로 (신규 검사의 "자세히 보기"에서 쓴다) */
function SymptomCard({ analysis }: { analysis: ExamAnalysis }) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>세부 증상</Text>
      <SymptomList analysis={analysis} />
    </View>
  );
}

/**
 * 세부 지표 목록 — 눈금/숫자/라벨이 4번 반복되면 자리만 차지하므로 ScaleAxis를 맨 위에 한 번만
 * 두고 아래 막대는 minimal로 그린다 (모니터링 상세 화면과 같은 방식).
 */
function SymptomList({ analysis }: { analysis: ExamAnalysis }) {
  const byKey = useMemo(
    () => Object.fromEntries(analysis.local.signs.map((s) => [s.sign, s])),
    [analysis],
  );
  return (
    <>
      <ScaleAxis segments={SYMPTOM_SEGMENTS_BASE} />
      {SIGN_ORDER.map((sign) => {
        const found = byKey[sign];
        const value = found ? signDisplayValue(sign, found.grade) : 0;
        const band = symptomBand(value);
        const meta = SIGN_DISPLAY[sign];
        return (
          <View key={sign} style={styles.symptomRow}>
            <View style={styles.symptomHeadRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.symptomLabel}>{meta.label}</Text>
                <Text style={styles.symptomHint}>{meta.hint}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.symptomValue}>
                  {value.toFixed(1)}
                  <Text style={styles.symptomValueUnit}>/100</Text>
                </Text>
                <Text style={[styles.symptomBandText, { color: band.color }]}>{band.ko}</Text>
              </View>
            </View>
            <ScaleBar value={value} segments={SYMPTOM_SEGMENTS_BASE} minimal />
          </View>
        );
      })}
    </>
  );
}

/** 가려움 (VAS) — 문진에서 "넘어가기"를 골랐으면 0점이 아니라 "등록 안함"이다 */
function ItchCard({ vas }: { vas: number | null }) {
  if (vas == null) return <NotRegisteredCard label="가려움 (VAS)" />;
  const value = itchDisplayValue(vas);
  const band = itchBand(value);
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>가려움 (VAS)</Text>
      <View style={styles.metricHeadRow}>
        <Text style={styles.metricBig}>
          {value}
          <Text style={styles.metricUnit}>/100</Text>
        </Text>
        <Text style={[styles.metricSub, { color: band.color }]}>{band.ko}</Text>
      </View>
      <ScaleBar value={value} segments={ITCH_SEGMENTS} />
    </View>
  );
}

/** 수면 점수 — 삼성헬스 연동 값이라 검사만으로는 채워지지 않는다 */
function SleepCard({ score }: { score: number | null }) {
  if (score == null) return <NotRegisteredCard label="수면 점수" />;
  const band = sleepBand(score);
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>수면 점수</Text>
      <View style={styles.metricHeadRow}>
        <Text style={styles.metricBig}>
          {score}
          <Text style={styles.metricUnit}>/100</Text>
        </Text>
        <Text style={[styles.metricSub, { color: band.color }]}>{band.ko}</Text>
      </View>
      <ScaleBar value={score} segments={SLEEP_SEGMENTS} />
    </View>
  );
}

function NotRegisteredCard({ label }: { label: string }) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>{label}</Text>
      <View style={styles.notRegistered}>
        <Text style={styles.notRegisteredText}>등록 안함</Text>
      </View>
    </View>
  );
}

/** 촬영 이미지 원본 + 병변 위치 오버레이 — 모니터링 상세 화면의 사진 카드와 같은 배치 */
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
          <Text style={styles.photoCaption}>마스크 오버레이 이미지</Text>
        </View>
      </View>
    </View>
  );
}

/** 신규 검사 결과로 이 자리의 경과 기록 폴더를 만드는 자리 */
function LinkSection({
  target,
  disease,
  linkedFolder,
  onLink,
  onOpenFolder,
}: {
  target: ExamCapture['target'];
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
          <Text style={styles.linkedTitle}>경과 기록에 연동했어요</Text>
        </View>
        <Text style={styles.linkedName}>{linkedFolder.name}</Text>
        <Pressable style={styles.openFolderBtn} onPress={() => onOpenFolder(linkedFolder.id)}>
          <MaterialIcons name="timeline" size={18} color={AppColors.greenMuted} />
          <Text style={styles.openFolderText}>추이 보기</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>경과 기록에 연동</Text>
      <Text style={styles.metricFoot}>
        이 검사로 경과 기록 폴더를 하나 만들어요. 다음부터 같은 자리를 고스트로 겹쳐 찍고 추이
        그래프에 이어서 볼 수 있어요.
      </Text>
      <View style={{ height: 12 }} />
      <View style={styles.newFolderRow}>
        <MaterialIcons name="create-new-folder" size={20} color={AppColors.greenMuted} />
        <Text style={styles.newFolderName} numberOfLines={1}>
          {folderNameOf(target.label, disease)}
        </Text>
      </View>
      <View style={{ height: 12 }} />
      <Pressable style={styles.linkBtn} onPress={onLink}>
        <Text style={styles.linkBtnText}>경과 기록에 연동하기</Text>
      </Pressable>
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
  cardLabel: { fontSize: 17, fontWeight: '800', color: mc.ink, marginBottom: 12 },
  metricHeadRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  metricBig: { fontSize: 28, fontWeight: '800', color: mc.ink },
  metricUnit: { fontSize: 15, fontWeight: '600', color: mc.sub },
  metricSub: { fontSize: 12, fontWeight: '800', marginBottom: 4, textAlign: 'right', flexShrink: 1, marginLeft: 8 },
  metricFoot: { fontSize: 11.5, color: mc.sub, marginTop: 10, lineHeight: 17 },

  notRegistered: {
    borderRadius: 12,
    backgroundColor: mc.bg,
    borderWidth: 1,
    borderColor: mc.line,
    paddingVertical: 18,
    alignItems: 'center',
  },
  notRegisteredText: { fontSize: 16, fontWeight: '800', color: mc.sub },

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

  symptomDivider: { height: 1, backgroundColor: mc.line, marginTop: 16, marginBottom: 12 },
  symptomRow: { marginTop: 12 },
  symptomHeadRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 },
  symptomLabel: { fontSize: 13.5, fontWeight: '700', color: mc.ink },
  symptomHint: { fontSize: 10.5, color: mc.sub, marginTop: 1 },
  symptomValue: { fontSize: 14, fontWeight: '800', color: mc.ink },
  symptomValueUnit: { fontSize: 10, fontWeight: '600', color: mc.sub },
  symptomBandText: { fontSize: 10.5, fontWeight: '800', marginTop: 1 },

  photoCard: { padding: 12 },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  photoCol: { alignItems: 'center' },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  detailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: mc.card,
    borderWidth: 1.5,
    borderColor: mc.greenTop,
  },
  detailToggleText: { fontSize: 14.5, fontWeight: '800', color: AppColors.greenMuted },

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
  linkBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  openFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: mc.bg,
  },
  openFolderText: { fontSize: 13.5, fontWeight: '800', color: AppColors.greenMuted },

  warnText: { fontSize: 12.5, color: mc.ink, lineHeight: 19 },

  footer: { paddingHorizontal: 16, paddingBottom: 18, paddingTop: 10, backgroundColor: mc.bg },
  saveBtn: { backgroundColor: mc.greenTop, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  disclaimer: { fontSize: 10, color: mc.sub, textAlign: 'center' },

});
