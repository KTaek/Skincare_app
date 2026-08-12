/**
 * 온디바이스 분석 파이프라인의 단계별 소요 시간 계측기.
 *
 * "사진 한 장이 들어가서 결과창이 뜰 때까지" 어디에 시간이 가는지를 **전처리 / 모델 추론 /
 * 후처리**로 갈라 재기 위한 것이다. 총 시간만 보면(analyzeLocal의 inferenceTimeMs) 느릴 때
 * 무엇을 고쳐야 하는지 알 수 없다 — 512×512 픽셀을 정규화하는 JS 루프가 범인인지, TFLite
 * 추론이 범인인지, 오버레이 JPEG 인코딩이 범인인지가 전혀 다른 문제이기 때문이다.
 *
 * 설계 원칙 세 가지:
 *
 *   · **꺼져 있으면 공짜다.** ENABLED가 false면 span()은 콜백을 그대로 부르고 끝난다.
 *     계측 자체가 재려는 시간을 바꾸면 안 된다.
 *   · **중첩을 그대로 남긴다.** extractNormalizedRGB(전처리)는 analyzeLocal(전체) 안에서
 *     불리므로, 합계가 아니라 트리로 봐야 이중 계산 없이 읽힌다.
 *   · **화면 코드가 아무것도 몰라도 된다.** 각 모듈이 자기 자리에서 span으로 감싸면,
 *     세션 하나를 열고 닫는 쪽(CameraScreen)은 결과만 받아 찍는다.
 *
 * ⚠️ Date.now()가 아니라 performance.now()를 쓴다 — 밀리초 단위 벽시계는 20~30ms짜리
 * 단계에서 눈금이 너무 굵다. Hermes에 performance가 없으면 Date.now로 물러선다.
 */

/** 계측을 켤지. 배포 빌드에서 끄고 싶으면 __DEV__로 바꾸면 된다. */
export const PROFILING_ENABLED = true;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** 단계 하나 — 이름, 걸린 시간, 그리고 그 안에서 갈라진 하위 단계들 */
export interface Span {
  name: string;
  ms: number;
  /** 이 단계가 몇 번 불렸는지 (판정 단위마다 도는 Stage2처럼 반복되는 자리) */
  count: number;
  children: Span[];
}

interface Frame {
  name: string;
  start: number;
  children: Span[];
}

/**
 * 한 번의 "사진 → 결과"를 담는 기록.
 * 여러 화면이 각자 span을 부르므로 세션은 모듈 전역에 하나만 둔다 — 분석은 동시에 두 개가
 * 돌지 않는다(화면이 analyzing 단계에 붙들려 있다).
 */
interface Session {
  label: string;
  start: number;
  root: Span[];
  stack: Frame[];
}

let session: Session | null = null;

/** 마지막으로 끝난 계측 — 결과 화면이나 개발 도구에서 꺼내 볼 수 있게 남긴다 */
export let lastProfile: { label: string; totalMs: number; spans: Span[] } | null = null;

/** 새 계측을 시작한다. 이미 열려 있으면 버리고 새로 연다 (분석을 취소하고 다시 찍은 경우). */
export function startProfile(label: string): void {
  if (!PROFILING_ENABLED) return;
  session = { label, start: now(), root: [], stack: [] };
}

/**
 * 계측을 닫고 결과를 콘솔에 표로 찍는다.
 * 열려 있지 않으면(계측이 꺼져 있거나 시작 없이 불렸으면) 아무 일도 하지 않는다.
 */
export function endProfile(extra?: Record<string, string | number | boolean | null | undefined>) {
  if (!session) return null;
  const totalMs = now() - session.start;
  const result = { label: session.label, totalMs, spans: session.root };
  lastProfile = result;
  session = null;
  printProfile(result, extra);
  return result;
}

/** 같은 이름의 형제 단계는 하나로 합친다 — Stage2가 판정 단위마다 도는 자리를 위해서다 */
function merge(into: Span[], span: Span) {
  const found = into.find((s) => s.name === span.name);
  if (!found) {
    into.push(span);
    return;
  }
  found.ms += span.ms;
  found.count += span.count;
  for (const child of span.children) merge(found.children, child);
}

/**
 * 동기 함수 한 자리를 잰다. 반환값은 그대로 통과시키므로 기존 호출을 감싸기만 하면 된다.
 * 예외가 나도 단계는 닫힌다 — 실패한 분석의 시간도 남는 편이 낫다.
 */
export function span<T>(name: string, fn: () => T): T {
  if (!session) return fn();
  const frame: Frame = { name, start: now(), children: [] };
  const parent = session.stack[session.stack.length - 1];
  session.stack.push(frame);
  try {
    return fn();
  } finally {
    const s = session;
    if (s) {
      s.stack.pop();
      const done: Span = { name, ms: now() - frame.start, count: 1, children: frame.children };
      merge(parent ? parent.children : s.root, done);
    }
  }
}

/** span의 비동기판 — 모델 추론처럼 await가 끼는 자리에 쓴다 */
export async function spanAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!session) return fn();
  const frame: Frame = { name, start: now(), children: [] };
  const parent = session.stack[session.stack.length - 1];
  session.stack.push(frame);
  try {
    return await fn();
  } finally {
    const s = session;
    if (s) {
      s.stack.pop();
      const done: Span = { name, ms: now() - frame.start, count: 1, children: frame.children };
      merge(parent ? parent.children : s.root, done);
    }
  }
}

/**
 * 계측이 열려 있는 동안 한 줄 표시를 남긴다 (시간이 아니라 조건 — 어떤 경로를 탔는지).
 * "질환 분류를 건너뛴 촬영"과 "정상으로 판정돼 세그를 안 돌린 촬영"은 총 시간이 크게 다른데,
 * 숫자만 남으면 나중에 그 차이를 설명할 수 없다.
 */
const notes: string[] = [];
export function note(text: string): void {
  if (!session) return;
  notes.push(text);
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function lines(spans: Span[], totalMs: number, depth: number, out: string[]) {
  for (const s of spans) {
    const pct = totalMs > 0 ? (s.ms / totalMs) * 100 : 0;
    const label = `${'  '.repeat(depth)}${s.name}${s.count > 1 ? ` ×${s.count}` : ''}`;
    out.push(`${pad(label, 34)}${padLeft(s.ms.toFixed(1), 8)} ms ${padLeft(pct.toFixed(1), 5)}%`);
    lines(s.children, totalMs, depth + 1, out);
  }
}

function printProfile(
  result: { label: string; totalMs: number; spans: Span[] },
  extra?: Record<string, string | number | boolean | null | undefined>,
) {
  const out: string[] = [];
  out.push(`── ${result.label} — 총 ${result.totalMs.toFixed(1)} ms ──`);
  lines(result.spans, result.totalMs, 0, out);
  // 트리에 잡히지 않은 시간(상태 갱신, 저장, 사이사이 await 대기)
  const measured = result.spans.reduce((a, s) => a + s.ms, 0);
  out.push(`${pad('기타(미계측)', 34)}${padLeft((result.totalMs - measured).toFixed(1), 8)} ms`);
  if (notes.length) out.push(`경로: ${notes.join(' · ')}`);
  if (extra) {
    const kv = Object.entries(extra)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${v}`);
    if (kv.length) out.push(kv.join(' · '));
  }
  notes.length = 0;
  console.log(out.join('\n'));
}
