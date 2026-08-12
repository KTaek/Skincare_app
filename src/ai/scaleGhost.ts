import { withSkImage } from './skiaPixels';
import { detectScaleFrame } from './scaleDetect';
import { coverageOf, roiOf, framingOf, type ScaleFraming, type ScaleKind } from './scaleFrame';
// 넓이 자격과 **같은 기준**으로 판단해야 한다 — 고스트로 쓸 수 있는 사진과 넓이를 잴 수 있는
// 사진이 다르면, 눈으로 맞춘 구도가 정작 측정에서는 탈락한다
import { GATE } from '../monitoring/frameQuality';

/**
 * 프리뷰에 겹칠 지난 사진 한 장을 읽어, 그 사진이 겨냥한 구도를 알아낸다.
 *
 * **고스트를 가공하지 않는다.** 사진을 그대로 화면 전체에 반투명하게 깔고, 사용자는 지금 몸을
 * 거기 겹쳐 맞춘다. 잘라내거나 흑백으로 만들거나 윤곽선을 뽑지 않는다 — 맞춰야 할 대상이
 * 지난 사진 그 자체이기 때문이다. 화면에 나온 그림과 게이트가 재는 대상이 같은 것이어야 한다.
 *
 * 그래서 이 파일이 하는 일은 사실상 하나다: 그 사진에서 자를 찾아 **구도(framing)**를 재는 것.
 * 그 값이 곧 이번 촬영의 정렬 목표가 된다. 자를 못 찾으면 null이고, 그때는 고스트를 띄우지
 * 않고 표준 가이드 도형으로 되돌아간다 — 맞출 목표를 모르는 채로 사진만 깔면 사용자는 눈대중으로
 * 맞추는데 게이트는 다른 자리를 재게 된다.
 *
 * ⚠️ 여기서 잰 구도를 목표로 삼으므로, **어느 사진을 넘기느냐가 곧 어느 구도로 수렴하느냐**다.
 *    부르는 쪽은 기준 세션(첫 사진)을 우선 넘긴다 — 매번 직전 사진을 목표로 삼으면 오차가
 *    조금씩 쌓여 구도가 서서히 밀린다(drift).
 */

export interface ScaleGhost {
  /** 화면에 그대로 깔 사진 (원본 uri — 가공하지 않는다) */
  uri: string;
  /** 이 사진이 겨냥한 구도 — 이번 촬영의 정렬 목표 */
  framing: ScaleFraming;
}

/** 지난 사진에서 구도를 읽는다. 자를 못 찾거나 사진을 못 열면 null. */
export async function buildScaleGhost(uri: string, kind: ScaleKind): Promise<ScaleGhost | null> {
  try {
    return await withSkImage(uri, async (image) => {
      const frame = await detectScaleFrame(image, kind);
      if (!frame) return null;

      /*
        부위가 너무 적게 담긴 사진은 목표로 삼지 않는다. 그걸 목표로 두면 이후 모든 촬영이 같은
        자리를 겨냥하게 되고, 그 자리에서는 넓이를 영영 못 재게 된다. null을 내면 표준 프레이밍으로
        돌아가고, 그 구도는 잘리지 않도록 잡혀 있다.

        **판단 기준은 넓이 자격과 같은 covered다.** 예전에는 roiFits(여백까지 포함한 사각형이
        통째로 들어왔는가)를 썼는데, 그 기준에서는 얼굴을 가득 채워 찍은 사진이 거의 전부
        탈락한다 — 정작 가장 흔한 기준 사진이 고스트가 될 수 없었다.
      */
      const covered = coverageOf(frame, roiOf(frame, image.width(), image.height()));
      if (covered < GATE.areaCoveredMin) {
        console.warn('[scale] 지난 사진에 부위가 적게 담겨 구도 기준으로 쓰지 않아요', {
          covered: Math.round(covered * 1000) / 10,
        });
        return null;
      }
      // 몸통은 양 어깨가 보이는 사진만 목표가 될 수 있다 — 어깨가 추정값인 사진에서 잰 자는
      // 프레이밍에 따라 크게 흔들려서, 그 구도로 수렴시키면 이후 회차가 전부 그 잡음 위에 쌓인다.
      if (!frame.complete) {
        console.warn('[scale] 지난 사진의 자를 믿을 수 없어 구도 기준으로 쓰지 않아요');
        return null;
      }

      return { uri, framing: framingOf(frame, image.width(), image.height()) };
    });
  } catch (e: any) {
    console.warn('[scale] 지난 사진의 구도를 읽지 못했어요:', e?.message ?? e);
    return null;
  }
}
