// 병변 면적 변화 추적 — 세션 저장소 (기존 diagnosis_records와 병존, 별도 key)
// Phase 1: 이미지 영구 저장(cache→documentDirectory) + Session 스키마 + 원/근거리 구분
//
// 온디바이스 전용(서버 없음). 부위별(body_site) 독립 시계열로만 다루며
// 좌/우·앞/뒤 서로 다른 부위는 절대 합산·평균하지 않는다(siteKey로 분리).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';

const SESSIONS_KEY = 'tracking_sessions';   // 기존 'diagnosis_records'와 별개
const PHOTO_DIR    = 'tracking_photos';     // documentDirectory 하위 영구 보관 폴더

// 촬영 종류: 면적 측정용 원거리(overview) / 중증도용 근거리(detail)
export const CAPTURE = { OVERVIEW: 'overview', DETAIL: 'detail' };

// ---- 이미지 영구 저장 (캐시 uri → documentDirectory 복사) ----
function photosDir() {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  try { if (!dir.exists) dir.create({ intermediates: true }); } catch (e) {}
  return dir;
}

// srcUri(캐시) → 영구 파일로 복사, 영구 uri 반환. 실패 시 원본 uri 폴백.
export function persistPhoto(srcUri, name) {
  if (!srcUri) return null;
  try {
    const dir = photosDir();
    const raw = (srcUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const ext = /^(jpg|jpeg|png|webp)$/.test(raw) ? raw : 'jpg';
    const dest = new File(dir, `${name}.${ext}`);
    if (dest.exists) dest.delete();
    new File(srcUri).copy(dest);
    return dest.uri;
  } catch (e) {
    console.error('사진 영구 저장 실패:', e);
    return srcUri;   // 폴백: 캐시 uri 유지(다음 정리 전까지는 유효)
  }
}

function deletePhoto(uri) {
  if (!uri) return;
  try { const f = new File(uri); if (f.exists) f.delete(); } catch (e) {}
}

// ---- body_site: { part: '왼팔', side: 'front'|'back'|null } ----
// 부위별 그룹핑 키 (part + side). 좌/우·앞/뒤가 다르면 다른 시계열.
export function siteKey(site) {
  if (!site) return 'unknown';
  return `${site.part || 'unknown'}__${site.side || 'na'}`;
}
export function siteLabel(site) {
  if (!site || !site.part) return '부위 미지정';
  const sideKo = site.side === 'front' ? '앞' : site.side === 'back' ? '뒤' : null;
  return sideKo ? `${site.part}·${sideKo}` : site.part;
}

// ---- 세션 저장/조회 ----
async function getRaw() {
  try {
    const data = await AsyncStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}
async function setRaw(arr) {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(arr));
}

// 활성 세션만(소프트 삭제 제외). 모든 조회/오버레이 기준/baseline이 이걸 사용.
export async function getSessions() {
  return (await getRaw()).filter(s => !s.deleted);
}

// session(입력): { body_site, overviewUri, detailUri,
//                  lesion_pixels?, bodypart_pixels?, area_ratio?,
//                  severity_scores?, quality_flags?, diagnosis_id? }
// 원/근거리 사진은 영구 저장 후 overview_photo_path/detail_photo_path로 기록.
export async function saveSession(session) {
  try {
    const id = Date.now().toString();
    const timestamp = new Date().toISOString();
    const rawAll = await getRaw();
    const existing = rawAll.filter(s => !s.deleted);   // baseline 판정은 활성 세션 기준

    const overview_photo_path = persistPhoto(session.overviewUri, `${id}_overview`);
    const detail_photo_path   = persistPhoto(session.detailUri,   `${id}_detail`);

    // 같은 body_site의 첫 세션이면 baseline(기준)
    const key = siteKey(session.body_site);
    const hasSite = existing.some(s => siteKey(s.body_site) === key);

    const newSession = {
      id,
      timestamp,
      body_site:       session.body_site || null,      // { part, side }
      capture: {                                        // 원/근거리 원본 경로(영구)
        overview_photo_path,
        detail_photo_path,
      },
      overview_photo_path,                              // 편의 접근용(스키마 평탄화)
      detail_photo_path,
      lesion_pixels:   session.lesion_pixels   ?? null, // 병변∩피부 픽셀(면적 분자)
      bodypart_pixels: session.bodypart_pixels ?? null, // = 프레임 내 피부 픽셀(분모)
      area_ratio:      session.area_ratio      ?? null, // 값(모드에 따라 피부대비% or 기준대비 지표)
      measure_mode:    session.measure_mode    ?? 'skin', // 'skin'(피부대비) | 'ref'(랜드마크 대비)
      ref_name:        session.ref_name        ?? null,  // 기준 랜드마크 이름(배꼽/유두)
      landmark_px:     session.landmark_px     ?? null,  // 기준 길이(px, 512그리드)
      severity_scores: session.severity_scores ?? null, // 근거리 중증도 결과
      quality_flags:   session.quality_flags   ?? [],   // 품질 경고 key 배열
      // baseline 대비 품질비교용 원신호(Phase3 quality.evaluateQuality가 사용)
      skin_occupancy:  session.skin_occupancy  ?? null,
      laplacian_var:   session.laplacian_var   ?? null,
      box_frac:        session.box_frac        ?? null,   // 규격 박스 크기(짧은변 대비)
      is_baseline:     !hasSite,
      diagnosis_id:    session.diagnosis_id    ?? null, // 기존 진단기록과 선택적 링크
    };

    await setRaw([newSession, ...rawAll]);   // 소프트삭제된 것도 보존
    return newSession;
  } catch (e) {
    console.error('세션 저장 실패:', e);
    return null;
  }
}

// 특정 부위의 세션들 — 시간 오름차순(추이/타임랩스용)
export async function getSessionsBySite(site) {
  const key = siteKey(site);
  const all = await getSessions();
  return all
    .filter(s => siteKey(s.body_site) === key)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// 다음 촬영 오버레이용 — 해당 부위의 가장 최근 세션(원거리 사진 보유)
export async function getLatestSessionForSite(site) {
  const list = await getSessionsBySite(site);
  return list.length ? list[list.length - 1] : null;
}

// 해당 부위 기준(baseline) 세션
export async function getSiteBaseline(site) {
  const list = await getSessionsBySite(site);
  return list.find(s => s.is_baseline) || (list.length ? list[0] : null);
}

// 추적 중인 부위 목록(부위별 카드/그룹 UI용)
export async function getTrackedSites() {
  const all = await getSessions();
  const map = new Map();
  all.forEach(s => {
    const key = siteKey(s.body_site);
    if (!map.has(key)) map.set(key, { key, body_site: s.body_site, count: 0, last: s.timestamp });
    const e = map.get(key);
    e.count += 1;
    if (new Date(s.timestamp) > new Date(e.last)) e.last = s.timestamp;
  });
  return [...map.values()].sort((a, b) => new Date(b.last) - new Date(a.last));
}

// 소프트 삭제 — 목록/오버레이/baseline에서 제외하되 사진은 보존(복원 가능)
export async function softDeleteSession(id) {
  try {
    const raw = await getRaw();
    const i = raw.findIndex(s => s.id === id);
    if (i >= 0) { raw[i].deleted = true; await setRaw(raw); }
  } catch (e) {
    console.error('세션 삭제 실패:', e);
  }
}

// 실행 취소 — 소프트 삭제 복원
export async function restoreSession(id) {
  try {
    const raw = await getRaw();
    const i = raw.findIndex(s => s.id === id);
    if (i >= 0) { delete raw[i].deleted; await setRaw(raw); }
  } catch (e) {
    console.error('세션 복원 실패:', e);
  }
}

// 영구 삭제 — 사진 파일까지 제거(복원 불가)
export async function deleteSession(id) {
  try {
    const raw = await getRaw();
    const target = raw.find(s => s.id === id);
    if (target) {
      deletePhoto(target.overview_photo_path);
      deletePhoto(target.detail_photo_path);
    }
    await setRaw(raw.filter(s => s.id !== id));
  } catch (e) {
    console.error('세션 영구삭제 실패:', e);
  }
}
