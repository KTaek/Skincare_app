import AsyncStorage from '@react-native-async-storage/async-storage';
// 파일 API는 저장소의 다른 곳(records/pdfExport.ts)과 같은 legacy 진입점을 쓴다 —
// 새 File/Directory API로 옮기려면 두 곳을 함께 옮겨야 한다
import { copyAsync, deleteAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';

/**
 * 기록을 앱을 껐다 켜도 남기는 자리 — 저장소 접근을 여기 한 곳에 모은다.
 *
 * ── 왜 사진을 따로 옮기는가 ────────────────────────────────────
 *
 * 촬영본과 방향 보정본은 전부 **캐시 디렉터리**에 만들어진다(카메라의 takePictureAsync,
 * expo-image-manipulator 둘 다). 캐시는 OS가 언제든 지울 수 있는 자리다 — 저장 용량이 부족하면
 * 사용자에게 묻지 않고 지운다. 경로만 저장해 두면 며칠 뒤 폴더를 열었을 때 기록은 남아 있는데
 * 사진만 사라져 있고, 그건 앱이 사진을 잃어버린 것으로 보인다.
 *
 * 그래서 기록으로 확정되는 순간 문서 디렉터리로 **복사**한다. 원본을 옮기지(move) 않는 이유는
 * 그 파일을 아직 다른 화면이 보고 있을 수 있기 때문이다.
 *
 * ── 무엇을 저장하지 않는가 ────────────────────────────────────
 *
 * 세션(MonitorSession) 자체는 저장하지 않는다. 촬영 순간에만 의미가 있는 값(정지 판정 지문,
 * 프레임 크기)이 대부분이고, 다음 촬영이 필요로 하는 것은 기준 세션(baseline)뿐이다.
 * 그건 대상(MonitorTarget)에 붙어 함께 저장된다.
 */

const KEY_PREFIX = 'ogw.v1.';
export const FOLDERS_KEY = `${KEY_PREFIX}folders`;
export const TARGETS_KEY = `${KEY_PREFIX}targets`;

/** 기록 사진을 모아 두는 자리. 캐시와 달리 OS가 마음대로 지우지 않는다 */
const PHOTO_DIR = `${documentDirectory}photos/`;

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {
      // 이미 있으면 여기로 온다 — 실패로 볼 이유가 없다
    });
  }
  return dirReady;
}

/**
 * 사진을 오래 남는 자리로 복사하고 그 uri를 돌려준다.
 *
 * 실패하면 원래 uri를 그대로 돌려준다 — 사진이 캐시에 남아 있는 편이, 복사에 실패했다고 기록
 * 자체를 못 남기는 것보다 낫다. 이미 문서 디렉터리에 있는 사진(다시 저장되는 기록)은 그대로 둔다.
 */
export async function persistPhoto(uri: string | undefined | null): Promise<string | undefined> {
  if (!uri) return undefined;
  if (uri.startsWith(PHOTO_DIR)) return uri;
  // 번들 에셋(require로 들어온 것)이나 원격 이미지는 복사할 대상이 아니다
  if (!uri.startsWith('file://')) return uri;

  try {
    await ensureDir();
    const ext = uri.split('?')[0].split('.').pop()?.slice(0, 5) || 'jpg';
    const to = `${PHOTO_DIR}${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    await copyAsync({ from: uri, to });
    return to;
  } catch (e: any) {
    console.warn('[persist] 사진을 옮기지 못했어요 (캐시 경로를 그대로 씁니다):', e?.message ?? e);
    return uri;
  }
}

/** 더 이상 참조되지 않는 사진 파일을 지운다. 실패는 조용히 넘긴다 (다음 기회에 다시 지우면 된다) */
export async function deletePhotos(uris: readonly (string | undefined)[]): Promise<void> {
  for (const uri of uris) {
    if (!uri || !uri.startsWith(PHOTO_DIR)) continue;
    try {
      await deleteAsync(uri, { idempotent: true });
    } catch {
      /* 남아 있어도 기능에는 영향이 없다 */
    }
  }
}

/**
 * 저장은 **묶어서 미룬다**.
 *
 * 기록 하나를 넣는 동안에도 상태가 여러 번 바뀌는데(폴더 생성 → 기록 추가 → 질환명 갱신) 그때마다
 * 직렬화해 쓰면 큰 배열을 몇 번씩 문자열로 만든다. 조금 미뤘다가 마지막 상태만 쓰면 한 번으로 끝난다.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DELAY_MS = 300;

export function saveLater(key: string, getValue: () => unknown): void {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const value = getValue();
      AsyncStorage.setItem(key, JSON.stringify(value)).catch((e: any) => {
        console.warn(`[persist] ${key} 저장 실패:`, e?.message ?? e);
      });
    }, SAVE_DELAY_MS),
  );
}

/** 저장된 값을 읽는다. 없거나 깨졌으면 null — 깨진 저장 때문에 앱이 못 뜨면 안 된다 */
export async function loadSaved<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e: any) {
    console.warn(`[persist] ${key} 불러오기 실패 (빈 상태로 시작합니다):`, e?.message ?? e);
    return null;
  }
}

/** 저장된 것을 통째로 지운다 (설정의 "기록 초기화"용) */
export async function clearSaved(): Promise<void> {
  await AsyncStorage.multiRemove([FOLDERS_KEY, TARGETS_KEY]).catch(() => {});
}
