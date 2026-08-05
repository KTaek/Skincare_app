// 촬영 품질 검증 (Phase 3) — measureAreaOnDevice 원신호 → quality_flags.
// 정책: 경고(비차단). 사용자가 계속 진행할 수 있고, flag는 세션에 기록해 신뢰도 표시에 사용.
// 의료 표현 금지 — "측정 품질/선명도/구도" 등 측정 용어만.

export const QFLAG = {
  BLUR:      'blur',        // 흐림
  OCCUPANCY: 'occupancy',   // 피부 점유율 이상(너무 멀/가까움, baseline 대비 ±30%)
  CROP:      'crop',        // 부위 잘림(테두리 피부 과다)
  MISMATCH:  'mismatch',    // 병변-피부 불일치(병변이 피부 밖)
};

// 임계값 — 512 리사이즈 기준. 실데이터 튜닝 반영:
// · 라플라시안 분산은 "텍스처 양"이라 매끈한 피부 근접샷은 초점이 맞아도 값이 낮음(10~30) →
//   절대 임계값 불가. baseline(같은 부위) 대비 상대비교로만 판정.
export const QTH = {
  blurRelDrop: 0.5,    // baseline 선명도의 50% 미만이면 흐림(상대)
  blurAbsFloor: 3,     // baseline 없을 때 극단 하한(이 미만만 흐림)
  occLow:      10,     // 피부 점유율 하한%
  occHigh:     95,     // 상한%
  occRelDelta: 0.30,   // baseline 대비 상대 허용(±30%)
  lesionEdge:  8,      // 병변 경계걸림% 상한(이상 = 병변 잘림 → 면적 과소측정)
  outsideSkin: 45,     // 병변-피부밖% 상한(이상 = 불일치)
};

// m: measureAreaOnDevice 반환값, baseline(선택): 같은 부위 기준 세션의 { skin_occupancy, laplacian_var }
// 반환: [{ key, level:'warn', msg }]
export function evaluateQuality(m, baseline) {
  const flags = [];
  if (!m) return flags;

  // 1) 블러 — baseline 대비 상대(절대비교는 매끈한 피부에서 오판)
  if (baseline && baseline.laplacian_var > 0) {
    if (m.laplacian_var < baseline.laplacian_var * QTH.blurRelDrop) {
      flags.push({ key: QFLAG.BLUR, level: 'warn',
        msg: `이전보다 흐림 (선명도 ${m.laplacian_var} · 기준 ${baseline.laplacian_var})` });
    }
  } else if (m.laplacian_var != null && m.laplacian_var < QTH.blurAbsFloor) {
    flags.push({ key: QFLAG.BLUR, level: 'warn', msg: `매우 흐릿할 수 있음 (선명도 ${m.laplacian_var})` });
  }

  // 2) 피부 점유율 — baseline 있으면 상대(±30%), 없으면 절대 범위
  if (baseline && baseline.skin_occupancy > 0) {
    const rel = Math.abs(m.skin_occupancy - baseline.skin_occupancy) / baseline.skin_occupancy;
    if (rel > QTH.occRelDelta) {
      flags.push({ key: QFLAG.OCCUPANCY, level: 'warn',
        msg: `구도 차이 큼 (피부 ${m.skin_occupancy}% · 기준 ${baseline.skin_occupancy}%)` });
    }
  } else if (m.skin_occupancy != null) {
    if (m.skin_occupancy < QTH.occLow) {
      flags.push({ key: QFLAG.OCCUPANCY, level: 'warn',
        msg: `피부가 적게 잡힘 (${m.skin_occupancy}%) — 더 가까이/부위를 채워서` });
    } else if (m.skin_occupancy > QTH.occHigh) {
      flags.push({ key: QFLAG.OCCUPANCY, level: 'warn',
        msg: `너무 가까움 (피부 ${m.skin_occupancy}%) — 부위가 잘릴 수 있음` });
    }
  }

  // 3) 병변 잘림 — 병변이 프레임 경계에 걸림(피부 테두리 아님)
  if (m.lesion_edge_frac != null && m.lesion_edge_frac > QTH.lesionEdge) {
    flags.push({ key: QFLAG.CROP, level: 'warn',
      msg: `병변이 프레임 경계에 걸림 (${m.lesion_edge_frac}%) — 잘려서 면적이 실제보다 작을 수 있음` });
  }

  // 4) 병변-피부 불일치
  if (m.lesion_outside_skin != null && m.lesion_outside_skin > QTH.outsideSkin) {
    flags.push({ key: QFLAG.MISMATCH, level: 'warn',
      msg: `병변-피부 불일치 (${m.lesion_outside_skin}% 피부 밖) — 실제 피부/구도 확인` });
  }

  return flags;
}

// 세션 저장용: flag key 배열만
export function qualityFlagKeys(flags) {
  return (flags || []).map(f => f.key);
}

// UI 요약
export function qualitySummary(flags) {
  if (!flags || flags.length === 0) return { ok: true, text: '측정 품질 양호' };
  return { ok: false, text: flags.map(f => f.msg).join(' · ') };
}
