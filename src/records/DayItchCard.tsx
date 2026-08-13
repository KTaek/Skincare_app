import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { useFolders } from '../folders/store';
import { DISPLAY_SCALE, ITCH_SEGMENTS, segmentFor } from '../folders/theme';
import ItchVasSlider from '../components/ItchVasSlider';
import { normalizeDateKey } from './memoStore';
import { MAX_VAS, setDayItch, useDayItch } from './itchStore';

/**
 * 달력 바로 밑에 놓이는 "오늘의 가려움" 카드.
 *
 * 촬영 흐름 안에 있던 문진을 여기로 옮겼다. 가려움은 사진 한 장의 속성이 아니라 하루의
 * 상태라서다 — 옮긴 이유 전부는 records/itchStore 머리말에 있다.
 *
 * **한 번 적으면 그날 찍은 기록에 전부 적용된다.** 그래서 이 카드는 값을 받는 것으로 끝나지
 * 않고 "몇 건에 적용됐는지"까지 말한다 — 촬영 화면에서 묻던 것을 여기로 옮겼으니, 그 답이
 * 어디로 갔는지 눈에 보이지 않으면 사용자는 두 기능이 이어져 있다는 걸 알 방법이 없다.
 *
 * 날짜는 달력에서 고른 날을 따라간다. 오늘이 기본 선택이라 평소에는 "오늘의 가려움"이지만,
 * 지난 날짜를 골랐으면 그날 값을 고칠 수 있다 — 어제 얼마나 가려웠는지 오늘 적는 일은 흔하다.
 * 아직 오지 않은 날은 적을 것이 없으므로 카드 자체를 그리지 않는다.
 */
export default function DayItchCard({
  dateKey,
  openToken = 0,
}: {
  dateKey: string;
  /**
   * 루틴에서 "가려움증 문진하기"를 눌러 넘어왔다는 신호 — 값이 **바뀔 때마다** 카드를 펼친다.
   *
   * 불리언 하나로는 안 된다. 탭 화면은 한 번 뜬 뒤 계속 살아 있어서, 이미 떠 있는 기록 탭으로
   * 넘어오면 이 카드는 다시 만들어지지 않는다 — 초기 상태로만 열면 첫 한 번 말고는 아무 일도
   * 일어나지 않는다. 그래서 누를 때마다 올라가는 수를 받아 그 변화에 반응한다.
   */
  openToken?: number;
}) {
  const date = normalizeDateKey(dateKey);
  const saved = useDayItch(date);
  const folders = useFolders();
  const [open, setOpen] = useState(openToken > 0);
  // 카드를 열 때의 값에서 시작한다 — 처음 적는 날은 0(가렵지 않음)
  const [draft, setDraft] = useState(saved ?? 0);

  useEffect(() => {
    if (openToken <= 0) return;
    setDraft(saved ?? 0);
    setOpen(true);
    // saved는 일부러 뺀다 — 값이 저장되는 순간(적고 나서)에 카드가 다시 열리면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openToken]);

  const [y, m, d] = date.split('-').map(Number);
  const today = new Date();
  const isToday =
    today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
  const isFuture = new Date(y, m - 1, d).getTime() > new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (isFuture) return null;

  // 이 값이 실제로 적용될(또는 적용된) 촬영 기록 수 — 카드가 혼자 도는 값이 아님을 보여준다
  const applied = folders.reduce(
    (n, folder) => n + folder.records.filter((r: any) => r.date === date).length,
    0,
  );

  const dayLabel = isToday ? '오늘' : `${m}월 ${d}일`;
  const band = segmentFor(DISPLAY_SCALE.itch(draft), ITCH_SEGMENTS);
  const savedBand = saved != null ? segmentFor(DISPLAY_SCALE.itch(saved), ITCH_SEGMENTS) : null;

  const toggle = () => {
    setDraft(saved ?? 0);
    setOpen((v) => !v);
  };

  return (
    <View style={[cardDecoration(16), styles.card, saved == null && styles.cardEmpty]}>
      <Pressable style={styles.headerRow} onPress={toggle}>
        <View style={[styles.icon, saved == null && styles.iconEmpty]}>
          <MaterialIcons
            name="healing"
            size={20}
            color={saved == null ? '#16320A' : AppColors.greenMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {saved == null ? `${dayLabel}의 가려움 기록하기` : `${dayLabel}의 가려움`}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {saved == null
              ? '한 번 적으면 그날 촬영한 기록에 모두 적용돼요'
              : applied > 0
                ? `촬영 기록 ${applied}건에 적용됐어요`
                : '오늘 촬영한 기록에 자동으로 적용돼요'}
          </Text>
        </View>
        {savedBand && !open && (
          <View style={[styles.valuePill, { backgroundColor: savedBand.color }]}>
            <Text style={styles.valuePillText}>{savedBand.ko}</Text>
            <Text style={styles.valuePillScore}>{saved} / 10</Text>
          </View>
        )}
        <MaterialIcons
          name={open ? 'expand-less' : saved == null ? 'add' : 'expand-more'}
          size={22}
          color={AppColors.sub}
          style={{ marginLeft: 6 }}
        />
      </Pressable>

      {open && (
        <View style={styles.editor}>
          {/*
            "가려움 정도" 카드 — 배지·글자 색은 전부 ITCH_SEGMENTS(folders/theme.js)가 정의한
            4단계 색·이름(band.color/band.ko)을 그대로 쓴다. 앱 다른 화면(경과 관찰 요약칸 등)과
            같은 기준이라, 여기만 다른 말("미약한/중간/극심한 가려움" 같은)을 새로 쓰면 화면마다
            가려움 단계를 다른 말로 부르게 된다.
          */}
          <View style={styles.severityHead}>
            <Text style={styles.severityTitle}>가려움 정도</Text>
            <View style={[styles.severityPill, { backgroundColor: band.color }]}>
              <Text style={styles.severityPillText}>{draft} / {MAX_VAS}</Text>
            </View>
          </View>
          <Text style={[styles.severitySub, { color: band.color }]}>{band.ko}</Text>

          <View style={{ height: 14 }} />
          <ItchVasSlider value={draft} onChange={setDraft} color={band.color} />

          <View style={{ height: 14 }} />
          <Pressable
            style={styles.saveBtn}
            onPress={() => {
              setDayItch(date, draft);
              setOpen(false);
            }}
          >
            <Text style={styles.saveBtnText}>{saved == null ? '기록하기' : '수정하기'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 14 },
  /** 아직 안 적은 날은 테두리를 둘러 눈에 띄게 — 이 탭에서 사용자가 직접 채우는 유일한 값이다 */
  cardEmpty: { borderWidth: 1.5, borderColor: AppColors.greenTop },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmpty: { backgroundColor: AppColors.greenTop },
  title: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  caption: { fontSize: 12, color: AppColors.sub, marginTop: 3 },

  valuePill: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center' },
  valuePillText: { fontSize: 11.5, fontWeight: '800', color: '#FFFFFF' },
  valuePillScore: { fontSize: 10, fontWeight: '700', color: '#FFFFFF', opacity: 0.9, marginTop: 1 },

  editor: { paddingTop: 14 },

  severityHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  severityTitle: { fontSize: 15.5, fontWeight: '800', color: AppColors.ink },
  severityPill: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  severityPillText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  severitySub: { fontSize: 13, fontWeight: '700', marginTop: 3 },

  saveBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
});
