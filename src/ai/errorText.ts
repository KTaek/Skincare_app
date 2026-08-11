/**
 * 예외를 화면에 보여줄 한 줄로 바꾼다.
 *
 * 왜 필요한가. 네이티브(TFLite·Skia)에서 올라오는 오류는 **자바 스택 트레이스 전체가 message에
 * 들어 있다.** 그걸 그대로 화면에 넣으면 사용자는 무엇이 잘못됐는지 알 수 없는 수십 줄짜리
 * 글자벽을 보게 되고, 정작 할 수 있는 일(다시 시도, 네트워크 확인)은 어디에도 적혀 있지 않다.
 *
 *     java.net.SocketException: Software caused connection abort
 *       at java.net.SocketInputStream.socketRead0(Native Method)
 *       at ... (수십 줄)
 *
 * 여기서 두 가지를 한다: **첫 줄만 남기고**, 아는 실패는 사람이 할 일이 적힌 문장으로 바꾼다.
 * 원문은 버리지 않고 콘솔에 남긴다 — 개발자가 봐야 하는 것과 사용자가 봐야 하는 것이 다르다.
 */

/** 첫 줄만, 그리고 너무 길면 자른다 (한 줄짜리 오류도 문단만큼 길 수 있다) */
const MAX = 140;

function firstLine(message: string): string {
  const line = message.split('\n')[0].trim();
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
}

/**
 * 모델 파일을 못 받은 실패인지.
 *
 * 개발 중에는 모델이 Metro 개발 서버에서 HTTP로 내려온다(릴리즈 빌드에서는 앱에 번들되어 이
 * 경로가 없다). 그래서 연결이 끊기면 이 오류가 나는데, 사용자가 할 일은 "다시 시도"뿐이라
 * 원인을 자세히 적을 이유가 없다.
 */
function isModelDownloadFailure(message: string): boolean {
  return (
    /SocketException|SocketTimeout|Connection (reset|abort|refused)|Software caused connection abort|Unable to resolve host|Failed to (load|download)|HybridAssetLoader/i.test(
      message,
    )
  );
}

/** 모델 자체가 이상한 경우 — 다시 시도해도 같다 */
function isModelBroken(message: string): boolean {
  return /Failed to allocate|Didn't find op|Invalid model|TfLite|tensor/i.test(message);
}

export function humanError(e: unknown, fallback = '알 수 없는 오류가 발생했어요'): string {
  const raw = (e as any)?.message ?? (typeof e === 'string' ? e : '');
  if (!raw) return fallback;

  // 원문은 개발자에게 필요하다 — 화면에서 지운다고 없애면 안 된다
  console.warn('[error]', raw);

  if (isModelDownloadFailure(raw)) {
    return '분석 모델을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해주세요.';
  }
  if (isModelBroken(raw)) {
    return '분석 모델을 준비하지 못했어요. 앱을 다시 실행해주세요.';
  }
  return firstLine(raw) || fallback;
}
