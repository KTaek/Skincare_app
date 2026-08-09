import { useCallback, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

/**
 * 촬영 안내를 말로 읽어 준다.
 *
 * 화면에 띄우던 한 줄 안내("조금 더 가까이 …")를 그대로 소리로 옮긴 것이다. 촬영 중에는
 * 카메라를 피부에 대고 있어서 화면을 볼 수 없는 자세가 많다 — 등·목 뒤·발바닥처럼 혼자
 * 찍기 어려운 자리가 특히 그렇다. 눈으로 확인할 수 없는 안내는 없는 것과 같아서 귀로 옮겼다.
 *
 * 말이 겹치거나 쉴 새 없이 떠들지 않도록 두 가지 간격을 둔다.
 *   · 안내가 **바뀌었을 때**는 최소 MIN_GAP_MS 뒤에야 새로 말한다 (경계선에서 왔다 갔다 하는
 *     판정이 그대로 수다가 되지 않도록).
 *   · 같은 안내가 계속되면 REPEAT_MS마다 한 번씩만 되풀이한다.
 */

/** 안내가 바뀌어도 이 간격 안에는 새로 말하지 않는다 */
const MIN_GAP_MS = 2000;
/** 같은 안내가 이어질 때 되풀이하는 간격 */
const REPEAT_MS = 5000;

/** 화면용 문장을 소리내어 읽기 좋게 — 줄표는 TTS가 어색하게 읽는다 */
function toSpeech(hint: string): string {
  return hint.replace(/\s*—\s*/g, ', ');
}

export function useCaptureVoice(enabled: boolean): (hint: string | null | undefined) => void {
  const last = useRef({ text: '', at: 0 });

  // 꺼지거나 화면을 벗어나면 하던 말을 끊는다 — 촬영이 끝난 뒤까지 이어지면 안 된다
  useEffect(() => {
    if (!enabled) {
      Speech.stop();
      last.current = { text: '', at: 0 };
    }
  }, [enabled]);
  useEffect(
    () => () => {
      Speech.stop();
    },
    [],
  );

  return useCallback(
    (hint: string | null | undefined) => {
      if (!enabled || !hint) return;
      const now = Date.now();
      const changed = hint !== last.current.text;
      const gap = now - last.current.at;
      if (changed ? gap < MIN_GAP_MS : gap < REPEAT_MS) return;

      last.current = { text: hint, at: now };
      // 방금 것보다 지금 상황이 항상 더 맞으므로, 하던 말은 끊고 새로 읽는다
      Speech.stop();
      Speech.speak(toSpeech(hint), { language: 'ko-KR' });
    },
    [enabled],
  );
}
