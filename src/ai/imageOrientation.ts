import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * EXIF 방향을 픽셀에 실제로 반영한 사본을 만들어 그 uri를 돌려준다.
 *
 * 왜 필요한가: Skia의 MakeImageFromEncoded는 EXIF 방향 태그를 픽셀에 적용하지 않는다.
 * 그래서 세로로 찍힌 사진이 가로로 눕은 채 모델에 들어가고, 결과 화면의 증상부위 박스도
 * 엉뚱한 자리에 그려진다. 두 경로 모두 이 위험이 있다:
 *
 *   · 앨범 사진 — 어떤 기기·앱에서 만들어진 파일인지 알 수 없다
 *   · 자동 촬영본 — 판정 루프가 skipProcessing: true로 찍는다 (expo 문서가 명시하듯
 *     이 옵션은 방향 보정을 건너뛴다). 그 프레임이 그대로 기록 사진이 된다.
 *
 * 아무 편집도 지정하지 않고 다시 인코딩하기만 하면 방향이 픽셀에 구워진다.
 * 판정 루프의 매 프레임마다 부르면 비싸므로, **채택이 확정된 한 장에만** 적용한다.
 *
 * 실패하면 원본 uri를 그대로 돌려준다 — 방향 보정 실패로 촬영 흐름이 막히는 것이
 * 사진이 눕는 것보다 나쁘다.
 */
export async function normalizeOrientation(uri: string): Promise<string> {
  try {
    const out = await manipulateAsync(uri, [], { compress: 1, format: SaveFormat.JPEG });
    return out.uri || uri;
  } catch {
    return uri;
  }
}
