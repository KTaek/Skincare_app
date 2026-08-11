import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';

/**
 * TFLite 모델을 불러오는 한 자리 — 캐시와 재시도를 여기서만 다룬다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────
 *
 * 개발 중에는 `require('....tflite')`가 파일이 아니라 **Metro 개발 서버의 URL**로 풀린다. 즉
 * 모델 로딩이 네트워크 다운로드다(릴리즈 빌드에서는 앱에 번들되어 이 경로가 아예 없다). 그래서
 * 끊길 수 있고, 실제로 끊긴다:
 *
 *     java.net.SocketException: Software caused connection abort
 *       ... okhttp ... com.margelo.nitro.tflite.HybridAssetLoader.loadAsset
 *
 * 모델이 큰 만큼(수 MB) 확률도 높고, 여러 개를 동시에 받으면 더 높아진다.
 *
 * 예전 방식은 이 실패를 **영구화**했다. 로딩 프로미스를 모듈 변수에 캐시해 두었는데, 실패한
 * 프로미스도 그대로 캐시되므로 다음 호출이 같은 거절을 즉시 돌려받는다 — 네트워크가 잠깐
 * 끊겼을 뿐인데 앱을 껐다 켤 때까지 그 기능이 죽어 있었다.
 *
 * 그래서 이 파일이 하는 일은 넷이다:
 *   1. **한 번에 하나씩만 받는다.** 앱 전체에서 하나의 줄을 선다 — 아래 enqueue 주석 참고.
 *   2. **성공만 캐시한다.** 실패하면 캐시를 비워 다음 시도가 다시 받게 한다.
 *   3. 짧게 몇 번 다시 시도한다 — 끊김은 대개 일시적이다.
 *   4. 연속 실패 횟수를 세어 둔다. 몇 번을 해도 안 되면(에셋 누락, 웹 스텁) 부르는 쪽이
 *      그 기능을 조용히 끄고 나머지 촬영 흐름은 그대로 살릴 수 있어야 한다.
 */

/** 한 번의 로딩에서 시도하는 횟수 (첫 시도 포함) */
const ATTEMPTS = 3;
/** 시도 사이 간격 — 끊긴 직후 바로 다시 붙으면 같은 이유로 또 끊긴다 */
const RETRY_DELAY_MS = 400;
/**
 * 이만큼 연속으로 실패하면 부르는 쪽이 기능을 끈다.
 *
 * 1로 두면 잠깐의 끊김에 기능이 사라지고, 너무 크게 두면 에셋이 정말 없을 때 매 틱마다
 * 네트워크를 두드린다. 2번(= 최대 6회 시도)이면 둘 다 피할 수 있다.
 */
const GIVE_UP_AFTER = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 앱 전체에서 모델 로딩을 한 줄로 세운다.
 *
 * 호출부마다 "동시에 부르지 말 것"을 지키게 하는 방법도 있지만, 그건 지켜지지 않는다 — 지금도
 * 카메라 화면이 분석 모델 둘(37MB)과 질환 모델(18MB)을 함께 부르고, 그 위에 촬영 화면이 자
 * 모델을 얹는다. 각자는 자기 화면만 알기 때문에 서로를 피할 수가 없다. 줄을 세우는 자리는
 * 그 사실을 아는 유일한 곳, 즉 여기여야 한다.
 *
 * 앞의 작업이 실패해도 뒤가 막히면 안 되므로 성공·실패 양쪽에서 이어 붙인다.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface ModelSlot {
  /** 모델을 얻는다. 이미 성공한 적이 있으면 그 인스턴스를 그대로 돌려준다 */
  get(): Promise<TensorflowModel>;
  /** 연속 실패 횟수 — GIVE_UP_AFTER 이상이면 포기해도 되는 상태다 */
  readonly failures: number;
  /** 되살릴 가망이 없는지 (부르는 쪽이 기능을 끌 기준) */
  readonly hopeless: boolean;
}

/**
 * @param label  로그에 남길 이름
 * @param source require('...tflite')를 **호출 시점에** 평가하는 함수
 */
export function createModelSlot(label: string, source: () => unknown): ModelSlot {
  let cached: Promise<TensorflowModel> | null = null;
  let failures = 0;

  return {
    get(): Promise<TensorflowModel> {
      if (!cached) {
        cached = load(label, source).then(
          (model) => {
            failures = 0;
            return model;
          },
          (e) => {
            // 실패는 캐시하지 않는다 — 다음 호출이 처음부터 다시 받을 수 있어야 한다
            cached = null;
            failures += 1;
            throw e;
          },
        );
      }
      return cached;
    },
    get failures() {
      return failures;
    },
    get hopeless() {
      return failures >= GIVE_UP_AFTER;
    },
  };
}

async function load(label: string, source: () => unknown): Promise<TensorflowModel> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // 한 판씩 줄을 선다 — 재시도도 마찬가지다 (다른 모델이 받는 중이면 그것부터 끝난다)
      return await enqueue(() => loadTensorflowModel(source() as any, []));
    } catch (e: any) {
      lastError = e;
      const msg = e?.message ?? String(e);
      console.warn(`[model] ${label} 로딩 실패 (${attempt}/${ATTEMPTS}): ${msg}`);
      if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

/**
 * 여러 모델을 순서대로 불러온다.
 *
 * 줄 세우기(enqueue) 덕분에 Promise.all로 불러도 실제 다운로드는 하나씩이지만, 여기서 순서를
 * 명시하면 **먼저 필요한 것이 먼저 온다**. 미리 불러 두는 것은 첫 추론의 지연을 없애자는
 * 편의라, 조금 늦어지는 대신 확실히 받는 편이 낫다.
 */
export async function preloadInOrder(slots: readonly ModelSlot[]): Promise<void> {
  for (const slot of slots) await slot.get();
}
