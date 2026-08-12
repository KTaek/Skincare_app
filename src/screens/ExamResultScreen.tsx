import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { AppColors } from '../theme';
import {
  monitoringColors as mc,
  monitoringCard,
  ITCH_SEGMENTS,
  SKIN_SEGMENTS,
  SLEEP_SEGMENTS,
  SYMPTOM_SEGMENTS_BASE,
} from '../folders/theme';
import { folderNameOf } from '../folders/targets';
import { useLatestMonitoringRecord } from '../folders/store';
import { plainSiteLabel } from '../models';
import { LesionBox, LesionRegionResult } from '../ai/analyzeLocal';
import { ExamAnalysis, ExamCapture } from '../exam/examTypes';
import { DUMP_RESULTS } from '../exam/dumpAnalysis';
import { igaDisplayValue, itchDisplayValue, SIGN_DISPLAY, SIGN_ORDER, signDisplayValue } from '../exam/examMetrics';
import { useMonitoring } from '../context/MonitoringContext';
import { useProfile } from '../context/ProfileContext';
import { MetricCard, MetricRow, EmptyMetricCard } from '../components/MetricCard';

/** 사용자가 직접 고를 수 있는 진단명 — 분류 모델의 클래스와 같은 집합에 "직접 입력"을 더한 것 */
const DIAGNOSES = ['아토피피부염', '건선', '여드름', '주사', '지루', '직접 입력'];

/**
 * 부위별 증상 칩을 2×2로 고정 배치하기 위한 줄 나누기 — [피부 붉기, 오돌토돌함] / [긁은 상처,
 * 피부 두꺼워짐]. flexWrap에 맡기면 칩 너비·화면 폭에 따라 한 줄에 3개+1개처럼 들쭉날쭉하게
 * 잘려서, 항상 이 순서·이 줄 구성으로 보이도록 미리 2개씩 묶어 둔다.
 */
const SIGN_ROWS = [SIGN_ORDER.slice(0, 2), SIGN_ORDER.slice(2, 4)];

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
 * 수면 점수는 이 촬영이 재는 값이 아니라 스마트워치(삼성헬스) 연동으로 들어오는 값이라, 폴더별
 * 기록이 아니라 기기 전체에서 가장 최근에 들어온 값을 그대로 보여준다 — 상세 결과 화면들과 같은
 * 값이다. 연동을 꺼 두었거나 아직 들어온 값이 없으면 "미기재"로 남는다.
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
  /** 이 자리로 경과 관찰 폴더를 만들고 이번 기록을 첫 기록으로 넣는다. 만든(또는 이미 있던) 폴더 id를 그대로 돌려준다 */
  onLink: () => string;
  onOpenFolder: (folderId: string) => void;
  /** 기록 탭으로 넘어간다 (저장은 이미 끝나 있다) */
  onOpenRecords: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { findTarget, setDiagnosis } = useMonitoring();
  const { healthConnected } = useProfile();
  const latestSleep = useLatestMonitoringRecord();
  const isQuick = capture.kind === 'quick';
  const isNew = capture.kind === 'new';
  const isFollowUp = capture.kind === 'followUp';

  // 진단명을 결과 화면에서 고칠 수 있어서, 대상은 항상 저장소의 최신 상태를 읽는다
  const target = findTarget(capture.target.id) ?? capture.target;
  const disease = target.diagnosis?.disease;
  const skinValue = igaDisplayValue(analysis.local.igaGrade);

  // 하단 버튼 문구 — 신규는 "만들 폴더 이름", 이어서 기록은 "이미 있는 폴더 이름"을 그대로 보여준다
  const footerLabel = isQuick
    ? '닫기'
    : isNew
      ? `“${folderNameOf(plainSiteLabel(target.label), disease)}” 경과 폴더 생성`
      : isFollowUp && linkedFolder
        ? `“${linkedFolder.name}” 경과 보기`
        : '기록 보기';

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

        <PhotoPair uri={capture.photoUri} maskUri={analysis.local.maskUri ?? null} />

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

        {/* 4가지 증상·IGA 모델은 아토피피부염 채점 기준이라, 이 진단명이 그게 아니면(정상은 예외)
            근거 없는 값이라 이 블록을 통째로 보여주지 않는다. */}
        {analysis.severitySupported && (
          <>
            <MetricCard
              label="피부 종합 상태"
              value={skinValue}
              unit="/100"
              segments={SKIN_SEGMENTS}
            />

            <SymptomCard analysis={analysis} />

            {/* 부위별 증상은 "4가지 증상" 바로 다음 — 그 카드가 대표(가장 나쁜) 판정 단위 하나의
                등급을 보여주는 자리이니, 병변이 여러 곳일 때 그 대표값이 어디서 왔는지를 바로
                이어서 펼쳐 보여준다(경과 관찰 폴더의 상세 결과와 같은 순서). 병변이 한 곳뿐이면
                위 PhotoPair의 마스크 오버레이로 이미 위치·모양을 보여줬으니 여기서 또 크롭 한
                장을 반복할 이유가 없다. */}
            {analysis.local.regions.length > 1 && (
              <RegionSymptomsCard photoUri={capture.photoUri} regions={analysis.local.regions} />
            )}
          </>
        )}

        {/* 가려움은 이 촬영이 재는 값이 아니라 기록 탭에서 하루에 한 번 적는 값이다 — 아직 적지
            않은 날이면 칸을 지우지 않고 수면 점수와 같은 방식으로 "미기재"를 남긴다. 자리가
            통째로 사라지면 사용자 눈에는 분석이 그 항목을 놓친 것으로 보인다. */}
        {capture.itchVas != null ? (
          <MetricCard label="가려움 안정도" value={itchDisplayValue(capture.itchVas)} unit="/100" segments={ITCH_SEGMENTS} />
        ) : (
          <EmptyMetricCard label="가려움 안정도" text="미기재" />
        )}

        {/* 스마트워치 연동 값 — 이 촬영이 재는 값이 아니라 기기 전체에서 가장 최근 값을 그대로 보여준다 */}
        {healthConnected && latestSleep ? (
          <MetricCard label="수면 점수" value={latestSleep.record.sleepScore} unit="/100" segments={SLEEP_SEGMENTS} />
        ) : (
          <EmptyMetricCard label="수면 점수" text="미기재" />
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
        <Pressable
          style={styles.saveBtn}
          onPress={() => {
            if (isQuick) return onClose();
            // 신규 증상 기록은 예전엔 "경과 관찰에 연동" 박스에서 따로 눌러야 폴더가 생겼는데,
            // 지금은 이 버튼 한 번으로 폴더까지 만들고 바로 그 경과로 넘어간다.
            if (isNew) return onOpenFolder(onLink());
            if (isFollowUp && linkedFolder) return onOpenFolder(linkedFolder.id);
            return onOpenRecords();
          }}
        >
          <Text style={styles.saveBtnText}>{footerLabel}</Text>
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
            segments={SYMPTOM_SEGMENTS_BASE}
            first={i === 0}
            hideValue
          />
        );
      })}
    </View>
  );
}

/**
 * 촬영 이미지 원본 + 분할 마스크 오버레이 — 상세 결과 화면의 사진 카드와 같은 배치.
 *
 * 오버레이는 bbox를 사각형으로 그리는 대신 analyzeLocal이 이미 합성해 준 이미지(maskUri)를
 * 그대로 보여준다 — 실제 병변 모양(반투명 색 면)과 그 경계(흰 테두리 + 어두운 테두리 한 겹, 어떤
 * 피부색 위에서도 보이도록)가 그대로 담겨 있어서, 사각형 박스보다 "어디가, 어떤 모양으로" 병변인지
 * 정확히 보여준다(ai/maskOverlay.ts 참고). 판정 단위가 하나뿐이면 항상 붉은색(REGION_COLORS[0])
 * 하나로 칠해진다.
 *
 * 마스크를 못 찾았거나(비정상 피부·정상 피부 등) 합성에 실패하면 maskUri가 null이라 원본을
 * 그대로 보여주고, 캡션으로 그 사실을 알린다 — 빈 오버레이를 사각 박스로 억지로 채우지 않는다.
 */
function PhotoPair({ uri, maskUri }: { uri: string; maskUri: string | null }) {
  const overlayCaption = maskUri ? '증상 부위 표시' : '증상 부위를 찾지 못했어요';
  return (
    <View style={[monitoringCard(), styles.photoCard]}>
      <View style={styles.photoRow}>
        <View style={styles.photoCol}>
          <Image source={{ uri }} style={styles.photo} />
          <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
        </View>
        <View style={styles.photoCol}>
          <Image source={{ uri: maskUri ?? uri }} style={styles.photo} />
          <Text style={styles.photoCaption}>{overlayCaption}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * 부위별 증상 카드 — 병변이 여러 곳으로 떨어져 있어 판정 단위(regions)가 둘 이상일 때, 그 부위를
 * 하나씩 잘라 보여주며 4가지 증상 중 "있음/없음"만 알려준다. 등급(중증도)까지 보여주지 않는 건
 * 위 "4가지 증상" 카드가 이미 대표(가장 나쁜) 단위 하나로 등급을 보여주고 있어서, 여기서 부위마다
 * 등급까지 늘어놓으면 정보가 겹쳐서 오히려 어디를 봐야 할지 헷갈리기 때문이다 — 여기서는 "이 부위는
 * 무슨 증상인지"만 훑고, 얼마나 심한지는 위 카드로 돌아가 보게 한다.
 */
function RegionSymptomsCard({ photoUri, regions }: { photoUri: string; regions: LesionRegionResult[] }) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>부위별 증상</Text>
      {regions.map((region, i) => (
        <RegionSymptomRow key={i} index={i} photoUri={photoUri} region={region} />
      ))}
    </View>
  );
}

/** 부위별 증상 카드의 한 줄 — 그 부위를 잘라낸 사진 + 4가지 증상 있음/없음 칩 */
function RegionSymptomRow({
  index,
  photoUri,
  region,
}: {
  index: number;
  photoUri: string;
  region: LesionRegionResult;
}) {
  return (
    <View style={[styles.regionRow, index > 0 && styles.regionRowDivider]}>
      <View style={styles.regionCropCol}>
        <RegionCrop uri={photoUri} bbox={region.bbox} />
        <Text style={styles.regionCropCaption}>부위 {index + 1}</Text>
      </View>
      <View style={styles.regionChips}>
        {SIGN_ROWS.map((row, r) => (
          <View key={r} style={styles.symptomChipRow}>
            {row.map((sign) => {
              const found = region.signs.find((s) => s.sign === sign);
              const present = !!found && found.grade > 0;
              return (
                <View key={sign} style={[styles.symptomChip, present && styles.symptomChipOn]}>
                  <MaterialIcons
                    name={present ? 'check-circle' : 'radio-button-unchecked'}
                    size={13}
                    color={present ? mc.greenDeep : mc.sub}
                  />
                  <Text style={[styles.symptomChipText, present && styles.symptomChipTextOn]}>
                    {SIGN_DISPLAY[sign].label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * 크롭 한 장 — bbox 사각형을 정사각형 썸네일에 그대로 눌러 넣는다(종횡비 유지 안 함).
 * 중증도 모델이 실제로 보는 입력(ai/skiaPixels의 extractNormalizedRGB)과 같은 규칙이라, 화면에
 * 보이는 크롭이 곧 "모델이 본 바로 그 사진"이다.
 */
function RegionCrop({ uri, bbox }: { uri: string; bbox: LesionBox }) {
  const scaleX = REGION_CROP_SIZE / bbox.width;
  const scaleY = REGION_CROP_SIZE / bbox.height;
  return (
    <View style={styles.regionCrop}>
      <Image
        source={{ uri }}
        style={{
          position: 'absolute',
          width: bbox.imageWidth * scaleX,
          height: bbox.imageHeight * scaleY,
          left: -bbox.x * scaleX,
          top: -bbox.y * scaleY,
        }}
      />
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
const REGION_CROP_SIZE = 64;

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

  regionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  regionRowDivider: { borderTopWidth: 1, borderTopColor: mc.line },
  regionCropCol: { alignItems: 'center' },
  regionCrop: {
    width: REGION_CROP_SIZE,
    height: REGION_CROP_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: mc.bg,
  },
  regionCropCaption: { fontSize: 10, color: mc.sub, marginTop: 4 },
  regionChips: { flex: 1, gap: 6 },
  symptomChipRow: { flexDirection: 'row', gap: 6 },
  symptomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: mc.bg,
    flexShrink: 1,
  },
  symptomChipOn: { backgroundColor: '#EDF7E1' },
  symptomChipText: { fontSize: 11.5, fontWeight: '700', color: mc.sub },
  symptomChipTextOn: { color: mc.greenDeep },

  linkBtn: { backgroundColor: mc.greenTop, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  linkBtnDisabled: { backgroundColor: '#E7E9EC' },
  linkBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  linkBtnTextDisabled: { color: mc.sub },


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
