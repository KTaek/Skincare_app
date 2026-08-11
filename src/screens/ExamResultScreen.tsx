import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { AppColors } from '../theme';
import {
  monitoringColors as mc,
  monitoringCard,
  segmentFor,
  ITCH_SEGMENTS,
  SKIN_SEGMENTS,
  SYMPTOM_SEGMENTS_BASE,
} from '../folders/theme';
import { folderNameOf } from '../folders/targets';
import { getFolder } from '../folders/store';
import {
  areaTrendOf,
  changePhrase,
  coveragePctOf,
  fmtCoverage,
  fmtPct,
  verdictOf,
} from '../folders/areaTrend';
import { plainSiteLabel } from '../models';
import { GRADE_NAMES_KO } from '../ai/labels';
import type { LocalAnalysisResult } from '../ai/analyzeLocal';
import { REGION_COLORS } from '../ai/maskOverlay';
import { ExamAnalysis, ExamCapture } from '../exam/examTypes';
import type { AreaEligibility } from '../monitoring/types';
import { SCALE_SPEC, type ScaleKind } from '../ai/scaleFrame';
import { scaleKindOf } from '../monitoring/bodyParts';
import { DUMP_RESULTS } from '../exam/dumpAnalysis';
import { igaDisplayValue, itchDisplayValue, SIGN_DISPLAY, SIGN_ORDER, signDisplayValue } from '../exam/examMetrics';
import { useMonitoring } from '../context/MonitoringContext';
import { Badge, MetricCard, MetricRow } from '../components/MetricCard';
import { fitBox, useImageAspect } from '../components/imageAspect';
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
  /** 크게 보고 있는 사진 (null이면 안 보고 있다) */
  const [zoom, setZoom] = useState<{ uri: string; label: string } | null>(null);

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

        <PhotoPair uri={capture.photoUri} maskUri={analysis.local.maskUri} onZoom={setZoom} />

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

        {/*
          병변 넓이 변화 — 이어서 기록에서 폴더에 이번 기록이 들어간 뒤에만 나온다.

          여기 두는 이유: 확인 화면에서 "넓이도 기록돼요"라고 해 놓고 결과 화면에서 아무 말이
          없으면, 사용자는 관심이 가장 높은 순간(방금 찍고 결과를 볼 때)에 그 값을 못 본다.
          폴더까지 들어가야 보이는 건 너무 멀다.

          계산은 폴더 화면의 카드와 **같은 모듈**(folders/areaTrend)을 쓴다. 두 화면이 따로
          계산하면 언젠가 어긋나고, 그때 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
        */}
        {isFollowUp && linkedFolder ? (
          <AreaChangeCard
            folderId={linkedFolder.id}
            local={analysis.local}
            eligible={session.areaEligible}
          />
        ) : (
          // 견줄 회차가 아직 없는 촬영(신규 기록)에도 "지금 얼마나 넓은가"는 말해 줄 수 있다.
          // 넓이를 잴 수 있는 자리인지는 부위가 정하므로(바로 스캔은 아예 재지 않는다) 함께 넘긴다.
          <AreaCoverageCard
            local={analysis.local}
            kind={isQuick ? null : scaleKindOf(target.part)}
            eligible={session.areaEligible}
          />
        )}

        {/* 판정 단위가 둘 이상이거나 제외된 덩어리가 있을 때만 — 하나면 위 카드가 곧 그 하나다 */}
        {(analysis.local.regions.length > 1 || analysis.local.droppedRegions > 0) && (
          <RegionCard local={analysis.local} />
        )}

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

      {/* 사진 확대는 화면 트리 맨 위에 둔다 — 헤더·푸터까지 덮어야 사진이 가장 크게 들어간다 */}
      {zoom && <PhotoZoom uri={zoom.uri} label={zoom.label} onClose={() => setZoom(null)} />}
    </View>
  );
}

/**
 * 사진 확대 보기 — 사진을 누르면 화면을 덮고 원본 비율 그대로 최대 크기로 보여준다.
 * 아무 곳이나 누르면 닫힌다 (안드로이드 뒤로가기도 결과 화면을 벗어나지 않고 이것만 닫는다).
 *
 * RN Modal이 아니라 절대위치 View인 이유는 이 앱의 다른 시트들과 같다 — Modal은 웹 미리보기에서
 * 폰 프레임 밖으로 나간다.
 */
function PhotoZoom({ uri, label, onClose }: { uri: string; label: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const aspect = useImageAspect(uri);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <Pressable
      style={[styles.zoomRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}
      onPress={onClose}
    >
      {/*
        너비를 다 쓰고 높이는 사진 비율에서 나오되, 남은 자리보다 길면 줄어든다(flexShrink).
        줄어든 뒤에도 contain이라 잘리지 않고, 결과적으로 화면에 들어가는 최대 크기가 된다.
      */}
      <Image
        source={{ uri }}
        style={[styles.zoomImage, { aspectRatio: aspect ?? 1 }]}
        resizeMode="contain"
      />
      <Text style={styles.zoomLabel}>{label}</Text>
      <Text style={styles.zoomHint}>화면을 누르면 닫혀요</Text>
    </Pressable>
  );
}

/** 촬영·후처리 신뢰도 배지 — 낮은 기록은 추세에서 가중치를 낮춰야 하므로 결과에도 계속 달고 다닌다 */
/**
 * 이번 촬영의 병변 넓이 — **지금 얼마나 넓은지**와 **첫 촬영에서 얼마나 달라졌는지**를 함께.
 *
 * 두 숫자를 같이 두는 이유: 변화율만 있으면 "42% 줄었다"가 무엇에서 무엇으로 줄었는지 알 수
 * 없고, 절대량만 있으면 그게 좋아지는 중인지 알 수 없다. "얼굴의 20%, 처음보다 42% 감소"가
 * 되어야 한 줄로 상태가 그려진다.
 *
 * 다만 두 숫자의 성격이 다르다는 것을 화면도 알아야 한다 — 부위 대비 %는 그 부위의 넓이를 성인
 * 평균 비례로 어림한 값이고(scaleFrame의 areaOverAreaRef), 변화율은 그 어림이 위아래에서
 * 상쇄돼 남지 않는 값이다. 그래서 큰 숫자 옆의 판정 배지는 **변화율**에만 붙인다.
 *
 * 폴더의 AreaTrendCard와 같은 계산(folders/areaTrend)을 쓰고, 여기서는 그래프 없이 숫자와
 * 판정만 보여준다 — 결과 화면은 "오늘 어땠나"를 훑는 자리이고, 흐름을 보는 것은 폴더의 일이다.
 *
 * **어떤 사진에서도 숫자 하나는 보여준다**(areaShowOf). 게이트를 못 넘었다고 화면이 조용해지면
 * 사용자는 "계산 중인가", "기능이 없나"를 알 수 없고, 몇 번 그러면 기능을 쓰지 않게 된다.
 * 못 넘은 것은 대개 회차 간 비교 자격이지 그 한 장의 값이 아니므로, 값은 보여주고 추이에서만 뺀다.
 */
function AreaChangeCard({
  folderId,
  local,
  eligible,
}: {
  folderId: string;
  /** 이번 사진의 분석 결과 — 게이트를 못 넘은 회차에서도 어림값은 보여줄 수 있다 */
  local: LocalAnalysisResult;
  /** 촬영 시점에 판단한 이번 장의 측정 자격 — 못 쟀으면 그 이유가 들어 있다 */
  eligible?: AreaEligibility;
}) {
  // 이 화면이 뜨기 전에 recordExam이 이미 오늘 기록을 넣어 두었다 — 그래서 마지막 회차가 이번 촬영이다
  const trend = areaTrendOf(getFolder(folderId)?.records ?? []);

  const body = () => {
    /*
      게이트를 못 넘은 회차 — 예전에는 여기서 "못 쟀어요" 한 줄로 끝났다. 그런데 못 넘은 이유는
      대개 **회차 간 비교 자격**이지 이 한 장의 값이 아니다. 그래서 숫자는 보여주고(어림값),
      추이에서만 뺀다. 지난번까지의 추이는 그대로 아래에 남는다 — 이번 한 장이 빠졌다고 지금까지
      쌓인 흐름을 감출 이유가 없다.
    */
    if (eligible && !eligible.ok) {
      const show = areaShowOf(local, eligible);
      return (
        <>
          <View style={styles.areaRow}>
            <Text style={styles.areaValue}>{show.text}</Text>
          </View>
          <Text style={styles.areaNote}>
            {show.level === 'frame'
              ? `몸통 크기를 재지 못해 사진 대비로 보여드려요 — ${eligible.reason}`
              : `어림값이에요 — ${eligible.reason}. 이 값은 변화 추이에 넣지 않았어요.`}
          </Text>
          {trend && !trend.baselineOnly && (
            <Text style={styles.areaNote}>
              지난 회차까지의 추이는 그대로예요 — {changePhrase(trend.latest.delta, trend.kind)}{' '}
              (첫 촬영 대비 {fmtPct(trend.latest.delta)}).
            </Text>
          )}
        </>
      );
    }
    if (!trend) return <Text style={styles.areaNote}>아직 넓이를 잰 촬영이 없어요.</Text>;

    const { delta } = trend.latest;
    // 배지는 변화율에만 붙는다 — 기준 한 장뿐이면 견줄 것이 없으므로 배지도 없다
    const verdict = trend.baselineOnly ? null : verdictOf(delta, trend.kind);

    // 부위 대비 %는 "잰 회차"면 언제나 나온다 — 기준 한 장뿐이어도 오늘의 넓이는 말해 줄 수 있다
    const coverage = (
      <View style={styles.areaRow}>
        <Text style={styles.areaValue}>
          {trend.latest.noun}의 {fmtCoverage(trend.latest.coveragePct)}
        </Text>
        {verdict && (
          <View style={[styles.areaPill, { backgroundColor: verdict.color }]}>
            <Text style={[styles.areaPillText, verdict.lightBg && { color: mc.ink }]}>{verdict.ko}</Text>
          </View>
        )}
      </View>
    );

    if (!verdict) {
      return (
        <>
          {coverage}
          <Text style={styles.areaNote}>
            병변 부위를 모두 합친 넓이가 {trend.latest.noun} 전체에서 차지하는 비율이에요.
          </Text>
          <Text style={styles.areaNote}>
            기준이 되는 첫 촬영이 기록됐어요. 다음에 같은 자리를 한 번 더 찍으면 변화가 보여요.
          </Text>
          {trend.latest.lowRes && <Text style={styles.areaNote}>{LOW_RES_NOTE}</Text>}
          <Text style={styles.areaNote}>{COVERAGE_CAVEAT}</Text>
        </>
      );
    }

    const base = trend.points[0];
    return (
      <>
        {coverage}
        {/*
          변화율은 말(감소/증가)과 숫자(-42%)를 함께 적는다. 말만 있으면 얼마나인지 모르고,
          부호 붙은 숫자만 있으면 "-42%가 좋은 건가"를 한 번 더 생각해야 한다.
        */}
        <Text style={styles.areaChange}>
          {changePhrase(delta, trend.kind)} <Text style={styles.areaChangeExact}>(첫 촬영 대비 {fmtPct(delta)})</Text>
        </Text>
        <Text style={styles.areaNote}>
          기준은 {fmtRecordDate(base.record.ts)}의 첫 촬영이에요 — 그때는 {base.noun}의{' '}
          {fmtCoverage(base.coveragePct)}였어요. (직전 촬영이 아니라 항상 첫 촬영과 견줍니다)
        </Text>
        {/* 띠 안이면 왜 방향을 말하지 않는지 밝힌다 — 안 그러면 "±30%는 왜 변화가 아니지"가 된다 */}
        <Text style={styles.areaNote}>
          {verdict.tone === 'same'
            ? `${fmtPct(-trend.lod)} ~ ${fmtPct(trend.lod)} 안의 움직임은 측정 오차와 구분되지 않아 변화로 보지 않아요.`
            : `변화율은 촬영 거리와 상관없이 ${trend.latest.noun} 크기를 기준으로 잰 값이에요.`}
        </Text>
        {/* 화질로 흔들릴 수 있는 값은 그 사실을 값 옆에 남긴다 — 나중에는 물어볼 데가 없다 */}
        {(trend.latest.lowRes || base.lowRes) && <Text style={styles.areaNote}>{LOW_RES_NOTE}</Text>}
        <Text style={styles.areaNote}>{COVERAGE_CAVEAT}</Text>
      </>
    );
  };

  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.areaHead}>
        <Text style={styles.cardLabel}>병변 넓이</Text>
        <Text style={styles.areaSub}>{trend ? `${trend.latest.noun} 대비` : '부위 대비'} · 첫 촬영 대비</Text>
      </View>
      {body()}
    </View>
  );
}

/**
 * 부위 대비 %에 항상 따라붙는 단서.
 *
 * 이 값의 분모(부위의 넓이)는 재지 않고 성인 평균 비례로 어림한 것이라, 사람에 따라 실제와
 * 몇 %p 어긋난다. 반면 변화율은 그 어림이 상쇄돼 남지 않는다 — 사용자가 어느 숫자를 얼마나
 * 믿어야 하는지 알려면 이 차이를 말해 줘야 한다.
 */
/**
 * 사용자가 해상도 게이트를 열고 잰 회차에 붙는 단서.
 *
 * 기준 회차가 그렇게 잰 것이면 **모든 회차의 변화율**이 함께 흔들린다 — 분모이기 때문이다.
 * 그래서 이번 회차뿐 아니라 기준 회차의 표시도 함께 본다.
 */
const LOW_RES_NOTE =
  '작게 찍힌 사진에서 잰 값이 섞여 있어요 — 실제 변화보다 값이 더 흔들릴 수 있어요.';

const COVERAGE_CAVEAT =
  '부위 대비 %는 그 부위 크기를 평균 비례로 어림해 환산한 값이라 사람에 따라 조금 다를 수 있어요. 변화율은 이 어림과 무관해요.';

/** 기준 회차의 날짜 — "6월 1일". 연도는 붙이지 않는다 (같은 폴더 안이라 헷갈릴 일이 거의 없다) */
function fmtRecordDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * 이 사진에서 보여줄 수 있는 넓이 — **세 등급 중 하나는 언제나 나온다.**
 *
 * 이 함수가 생긴 이유가 중요하다. 예전에는 게이트를 하나라도 못 넘으면 넓이를 아예 보여주지
 * 않았는데, 몸통에서는 그 조건이 많아 대부분의 사진이 아무 숫자도 못 봤다. 그러면 사용자는
 * 기능을 쓰다가 포기하고, 포기하면 추이도 없다 — 정확도를 지키려다 측정 자체를 잃는다.
 *
 * 그래서 **볼 권리와 견줄 자격을 나눈다**:
 *
 *   exact — 게이트를 다 통과했다. 숫자를 그대로 보여주고 추이에도 넣는다.
 *   rough — 자는 쟀지만(어깨·골반을 찾았다) 정렬·조명이 어긋났다. 그 사진 한 장 안에서는 여전히
 *           "몸통의 몇 %"가 맞다 — 어긋난 것은 **회차 간 비교 자격**이지 이 한 장의 값이 아니다.
 *           그래서 "약"을 붙여 보여주고 추이에서만 뺀다.
 *   frame — 자를 못 찾았다. 부위 대비로는 말할 수 없으므로 **사진 대비**로 바꿔 말한다.
 *           촬영 거리에 따라 통째로 달라지는 값이라 회차 비교는 불가능하고, 그 사실을 함께 적는다.
 */
type AreaShow =
  | { level: 'exact' | 'rough'; noun: string; text: string }
  | { level: 'frame'; noun: null; text: string };

function areaShowOf(local: LocalAnalysisResult, eligible?: AreaEligibility): AreaShow {
  const area = local.scaleArea;
  if (area && area.index > 0) {
    const noun = SCALE_SPEC[area.kind].noun;
    const pct = fmtCoverage(coveragePctOf(area.index, area.kind));
    return eligible?.ok ?? true
      ? { level: 'exact', noun, text: `${noun}의 ${pct}` }
      : { level: 'rough', noun, text: `${noun}의 약 ${pct}` };
  }
  // 자가 없으면 분모를 사진으로 바꾼다 — 없는 값을 지어내는 것이 아니라 다른 값을 말하는 것이다
  return { level: 'frame', noun: null, text: `사진의 ${fmtCoverage(local.maskAreaPct)}` };
}

/**
 * 견줄 회차가 없는 촬영(신규 기록)의 넓이 — 변화 없이 "지금 얼마나 넓은가"만.
 *
 * 이 값은 오늘 한 장에서 나오므로 폴더도 기준 회차도 필요 없다. 반대로 **변화는 말할 수 없다** —
 * 그건 AreaChangeCard의 일이고, 두 번째 촬영부터 나온다.
 *
 * **못 잰 경우에도 카드를 띄운다.** 예전에는 조용히 사라지게 두었는데, 그러면 사용자는 "이 앱은
 * 첫 기록에서는 넓이를 안 재는구나"와 "이번엔 못 쟀구나"를 구분할 수 없다. 특히 첫 촬영은 이후
 * 모든 회차의 기준이 되는 사진이라, 못 쟀다는 사실을 **그 자리에서** 알아야 다시 찍을 수 있다 —
 * 나중에는 되돌릴 방법이 없다.
 *
 * 넓이를 아예 잴 수 없는 자리(팔·다리)에서만 카드가 없다. 그건 이번 촬영의 문제가 아니라
 * 그 부위에 자가 될 뼈 기준점이 없다는 뜻이라, 매번 말해 봐야 사용자가 할 수 있는 일이 없다.
 */
function AreaCoverageCard({
  local,
  kind,
  eligible,
}: {
  local: LocalAnalysisResult;
  /** 이 자리가 무엇을 자로 쓰는지. null이면 넓이를 재지 않는 자리라 카드 자체가 없다 */
  kind: ScaleKind | null;
  eligible?: AreaEligibility;
}) {
  if (!kind) return null;
  const show = areaShowOf(local, eligible);

  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.areaHead}>
        <Text style={styles.cardLabel}>병변 넓이</Text>
        <Text style={styles.areaSub}>{show.noun ? `${show.noun} 대비` : '사진 대비'}</Text>
      </View>

      <View style={styles.areaRow}>
        <Text style={styles.areaValue}>{show.text}</Text>
      </View>

      {/*
        설명은 한 줄만 둔다. 이 화면에서 넓이는 훑고 지나가는 값이고, 자세한 단서는 추이를 볼 때
        (폴더 카드에서) 필요하다 — 여기서 네 줄을 쌓으면 정작 숫자가 안 읽힌다.
      */}
      <Text style={styles.areaNote}>
        {show.level === 'exact'
          ? `병변을 모두 합친 넓이가 ${show.noun} 전체에서 차지하는 비율이에요.`
          : show.level === 'rough'
            ? `어림값이에요 — ${eligible?.reason ?? '촬영 조건이 지난번과 달라요'}. 이 값은 변화 추이에 넣지 않았어요.`
            : '몸통 크기를 재지 못해 사진에서 차지하는 비율로 보여드려요 — 촬영 거리에 따라 달라지는 값이라 회차끼리 비교할 수 없어요.'}
      </Text>
      {eligible?.override && <Text style={styles.areaNote}>{LOW_RES_NOTE}</Text>}
    </View>
  );
}

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

/**
 * 병변별 중증도 — 판정 단위마다 IGA 등급을 따로 보여주고, 누르면 4증상까지 펼친다.
 *
 * 색 칩은 사진 오버레이의 색과 같다 (둘 다 maskOverlay의 REGION_COLORS를 쓴다) — 사진에서 본
 * 자리와 이 줄을 눈으로 맞추는 유일한 연결이라, 색 정의가 두 곳으로 갈라지면 안 된다.
 *
 * 종합 카드를 대체하지 않고 아래에 덧붙인다. 종합값(가장 나쁜 단위)이 여전히 이 촬영의 대표이고,
 * 기록·추이도 그 값으로 남기 때문이다.
 */
const FOREIGN_NOTICE_PCT = 10;

function RegionCard({ local }: { local: LocalAnalysisResult }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const merged = local.regions.some((r) => r.mergedBlobs > 1);

  const notes = [
    '사진에 같은 색으로 표시된 곳이에요.',
    merged ? '경계가 거의 붙어 있는 곳은 한 병변으로 묶었어요.' : null,
    local.droppedRegions > 0
      ? `너무 작은 ${local.droppedRegions}곳은 등급을 매기지 않았어요 (회색으로 표시, 넓이에는 포함).`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>병변별 중증도</Text>
      {local.regions.map((region, i) => {
        const open = openIndex === i;
        const band = segmentFor(igaDisplayValue(region.igaGrade), SKIN_SEGMENTS);
        return (
          <View key={i} style={[styles.regionRow, i > 0 && styles.regionRowDivided]}>
            <Pressable style={styles.regionHead} onPress={() => setOpenIndex(open ? null : i)}>
              <View
                style={[
                  styles.regionChip,
                  { backgroundColor: REGION_COLORS[i % REGION_COLORS.length] },
                ]}
              />
              <Text style={styles.regionName}>병변 {i + 1}</Text>
              {i === local.worstRegionIndex && local.regions.length > 1 && (
                <Text style={styles.regionRep}>대표</Text>
              )}
              <View style={{ flex: 1 }} />
              <Text style={styles.regionArea}>{region.areaPct.toFixed(1)}%</Text>
              <Badge text={GRADE_NAMES_KO[region.igaGradeName] ?? region.igaGradeName} color={band.color} small />
              <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={mc.sub} />
            </Pressable>
            {/* 이 등급이 옆 병변이 함께 찍힌 크롭에서 나왔다면 조용히 넘기지 않고 말해 준다 */}
            {region.foreignPct > FOREIGN_NOTICE_PCT && (
              <Text style={styles.regionNote}>
                옆 병변이 일부 함께 찍혔어요 (이 병변 면적의 약 {Math.round(region.foreignPct)}%)
              </Text>
            )}
            {open &&
              SIGN_ORDER.map((sign, k) => {
                const found = region.signs.find((s) => s.sign === sign);
                return (
                  <MetricRow
                    key={sign}
                    label={SIGN_DISPLAY[sign].label}
                    value={found ? signDisplayValue(sign, found.grade) : 0}
                    segments={SYMPTOM_SEGMENTS_BASE}
                    first={k === 0}
                  />
                );
              })}
          </View>
        );
      })}
      <Text style={styles.metricFoot}>{notes}</Text>
    </View>
  );
}

/**
 * 촬영 이미지 원본 + 분할 마스크 오버레이 — 상세 결과 화면의 사진 카드와 같은 배치.
 *
 * 오버레이는 analyzeLocal이 사진과 마스크를 픽셀 단계에서 이미 합성해 둔 이미지다.
 * 여기서 마스크를 따로 올리지 않는 이유는 maskOverlay.ts 주석에 적어 두었다.
 */
function PhotoPair({
  uri,
  maskUri,
  onZoom,
}: {
  uri: string;
  maskUri: string | null;
  onZoom: (photo: { uri: string; label: string }) => void;
}) {
  // 원본과 오버레이는 종횡비가 같다 (maskOverlay가 원본 비율을 유지한다) — 한 장만 재서 같이 쓴다.
  // 두 자리가 같은 크기라야 나란히 놓은 사진이 어긋나 보이지 않는다.
  const aspect = useImageAspect(uri);
  const box = fitBox(aspect, PHOTO_MAX_W, PHOTO_MAX_H);
  const overlayCaption = maskUri ? '증상 부위 표시' : '증상 부위를 찾지 못했어요';

  return (
    <View style={[monitoringCard(), styles.photoCard]}>
      <View style={styles.photoRow}>
        <View style={styles.photoCol}>
          <PhotoThumb
            uri={uri}
            box={box}
            onPress={() => onZoom({ uri, label: '촬영 이미지 (원본)' })}
          />
          <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
        </View>
        <View style={styles.photoCol}>
          <PhotoThumb
            uri={maskUri ?? uri}
            box={box}
            onPress={() => onZoom({ uri: maskUri ?? uri, label: overlayCaption })}
          />
          <Text style={styles.photoCaption}>{overlayCaption}</Text>
        </View>
      </View>
      <Text style={styles.photoHint}>사진을 누르면 크게 볼 수 있어요</Text>
    </View>
  );
}

/** 카드 안의 사진 한 장 — 누르면 확대된다. 돋보기 배지는 누를 수 있다는 표시다. */
function PhotoThumb({
  uri,
  box,
  onPress,
}: {
  uri: string;
  box: { width: number; height: number };
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.photo, box]} onPress={onPress}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      <View style={styles.photoZoomBadge}>
        <MaterialIcons name="zoom-in" size={13} color="#FFFFFF" />
      </View>
    </Pressable>
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

/**
 * 사진 카드 한 칸이 차지할 수 있는 최대 크기. 사진은 이 안에서 원본 비율대로 들어간다 —
 * 가로 사진은 낮고 세로 사진은 좁아진다. 세로 한도를 가로보다 넉넉히 둔 이유는 세로 사진이
 * 흔하고, 카드가 두 칸을 나란히 놓느라 가로는 이미 좁기 때문이다.
 */
const PHOTO_MAX_W = 130;
const PHOTO_MAX_H = 175;

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
  // 크기(width/height)는 PhotoPair가 사진의 실제 비율에서 계산해 덧붙인다
  photo: { borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },
  photoHint: { fontSize: 10.5, color: mc.sub, marginTop: 8, textAlign: 'center' },

  regionRow: { paddingTop: 4 },
  regionRowDivided: { borderTopWidth: 1, borderTopColor: mc.line, marginTop: 12, paddingTop: 12 },
  regionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  regionChip: { width: 12, height: 12, borderRadius: 3 },
  regionName: { fontSize: 14, fontWeight: '800', color: mc.ink },
  regionRep: {
    fontSize: 10,
    fontWeight: '800',
    color: mc.sub,
    borderWidth: 1,
    borderColor: mc.line,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  regionArea: { fontSize: 12, fontWeight: '700', color: mc.sub },
  regionNote: { fontSize: 11, color: mc.sub, marginTop: 6, marginLeft: 18, lineHeight: 16 },
  photoZoomBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  zoomRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.93)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  zoomImage: { width: '100%', flexShrink: 1 },
  zoomLabel: { marginTop: 16, fontSize: 13.5, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  zoomHint: { marginTop: 6, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },

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

  areaHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  areaSub: { fontSize: 12, color: mc.sub },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  areaValue: { fontSize: 26, fontWeight: '800', color: mc.ink },
  areaPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  areaChange: { marginTop: 6, fontSize: 15, fontWeight: '800', color: mc.ink },
  areaChangeExact: { fontSize: 13, fontWeight: '600', color: mc.sub },
  areaPillText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  areaNote: { marginTop: 8, fontSize: 12, color: mc.sub, lineHeight: 18 },
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
