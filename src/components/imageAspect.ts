import { useEffect, useState } from 'react';
import { Image } from 'react-native';

/**
 * 사진을 원본 비율 그대로 보여주기 위한 도구.
 *
 * 카메라와 앨범에서 오는 사진은 4:3·16:9·세로 등 제각각인데, 이걸 정사각형 자리에 넣고
 * resizeMode를 cover로 두면 화면에 보이는 사진과 모델이 본 사진이 달라진다 —
 * 가장자리에 있는 병변이 화면에서만 잘려 보이면 사용자는 앱이 그 부위를 놓쳤다고 읽는다.
 * 그래서 자리 크기를 사진에 맞추고(cover 대신 contain), 잘라내지 않는다.
 */

/**
 * uri 이미지의 실제 종횡비(가로/세로). 아직 못 읽었거나 읽기에 실패하면 null.
 *
 * 크기를 못 읽는 경우(잘못된 uri, 권한 문제 등)에도 화면은 그려져야 하므로 실패를 삼킨다 —
 * 호출부는 fitBox의 정사각형 폴백을 쓰고, resizeMode가 contain이라 잘리지는 않는다.
 */
export function useImageAspect(uri?: string | null): number | null {
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    setAspect(null);
    if (!uri) return;

    // uri가 바뀌거나 화면이 사라진 뒤에 도착한 응답으로 다른 사진의 비율을 덮어쓰지 않는다
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspect(w / h);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  return aspect;
}

/** 종횡비를 유지한 채 maxW×maxH 안에 들어가는 가장 큰 크기. aspect가 없으면 정사각형. */
export function fitBox(aspect: number | null, maxW: number, maxH: number): { width: number; height: number } {
  const a = aspect && aspect > 0 ? aspect : 1;
  const width = Math.min(maxW, maxH * a);
  return { width, height: width / a };
}
