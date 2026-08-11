import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import Svg, { Ellipse, Line, Rect } from 'react-native-svg';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { AppColors } from '../theme';
import { roiOf, SCALE_SPEC, standardRoi, type ScaleFrame, type ScaleKind } from '../ai/scaleFrame';

/**
 * 사진을 직접 잘라내는 화면 — 앨범 사진에서 얼굴을 못 찾거나 엉뚱한 얼굴이 잡혔을 때의 탈출구.
 *
 * ── 자르기가 무엇을 고치고 무엇을 못 고치는가 ────────────────────────
 *
 * 이 구분을 흐리면 안 된다. 잘라내기는 **픽셀을 늘리지 못한다.** 넓이 측정의 해상도 게이트
 * (frameQuality의 face.s < MIN_FACE_SCALE_PX)는 원본 픽셀로 재는 값이라, 같은 사진을 아무리
 * 잘라도 얼굴의 픽셀 수는 1픽셀도 늘지 않는다. 늘려 저장하면 없는 정보를 지어내는 것이고,
 * 그건 MIN_FACE_SCALE_PX가 애초에 막으려던 것이다 — 그래서 여기서는 **확대하지 않는다.**
 *
 * 그런데도 자르기가 필요한 이유는 따로 있다:
 *
 *   · 얼굴 검출 실패 — 검출 모델 입력은 128px이다. 전신 사진에서 얼굴이 화면의 5%면 그 입력에서
 *     얼굴은 여섯 픽셀 남짓이라 아예 안 잡힌다. 얼굴 자리만 잘라 주면 같은 128px이 얼굴에 온전히
 *     쓰여서 잡힌다 — 픽셀이 늘어난 게 아니라 **모델이 볼 자리를 사람이 정해 준 것**이다.
 *   · 여러 명이 찍힌 사진 — 검출기는 가장 확신도 높은 얼굴 하나만 돌려준다. 옆 사람이 더 크게
 *     찍혔으면 그 얼굴이 자가 되어 넓이가 통째로 틀어진다. 자르기는 "누구를 잴지"를 고르는 일이다.
 *
 * 반대로 **너무 바짝 자르면 오히려 못 잰다.** 넓이는 얼굴 관심영역(3s 정사각형)이 사진 안에 온전히
 * 들어와야만 셀 수 있다(faceRoiFits) — 턱이나 이마가 잘려 나가면 그쪽 병변이 빠지는데 분모인
 * d·v는 그대로라, **병변은 그대로인데 좋아진 것처럼 보인다.** 그래서 화면 안에 촬영 가이드와
 * 똑같은 도형을 그려 두고(standardRoi), 그 안에 얼굴을 채우게 한다.
 *
 * 이 화면은 사진만 만들고 판정은 하지 않는다. 자른 사진은 처음 고른 사진과 **똑같은 경로**
 * (commitPhoto → 방향 보정 → 얼굴 검출 → 품질·넓이 판정)로 다시 들어간다 — 여기서 따로 판정하면
 * 두 경로가 언젠가 어긋나고, 그러면 "자를 때는 된다더니 결과에서는 안 됐다"가 된다.
 */

/**
 * 자를 수 있는 가장 작은 사각형의 한 변 (원본 픽셀).
 *
 * 취향이 아니라 **해상도 게이트에서 유도되는 값**이다. 가이드에 부위를 꽉 채웠을 때의 길이
 * 스케일이 s = targetOfMinSide × 자른 변이므로, 그것이 minScalePx를 넘으려면:
 *
 *     얼굴  120 / 0.24 = 500px      몸통  225 / 0.26 = 865px
 *
 * 이보다 작게 자르면 가이드에 정확히 맞춰도 넓이를 잴 수 없다. 막지는 않고(등급·증상 판정은
 * 그래도 나오므로 자를 이유가 남아 있다) 자르기 전에 말해 준다.
 */
export function minCropSidePx(kind: ScaleKind): number {
  const spec = SCALE_SPEC[kind];
  return Math.round(spec.minScalePx / spec.targetOfMinSide);
}

/** 손가락이 이 거리 안에 들어오면 모서리를 잡은 것으로 본다 (화면 px) */
const HANDLE_HIT = 30;
/** 사각형이 손톱만 해지면 다시 키울 모서리를 잡을 수 없다 — 화면에서의 최소 크기 */
const MIN_BOX_SCREEN = 72;

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Drag = { kind: 'move' | Corner; x: number; y: number; side: number };

interface Crop {
  /** 원본 픽셀 좌표 — 화면 좌표가 아니라 이쪽이 진짜 값이다 (화면 크기가 바뀌어도 뜻이 안 변한다) */
  x: number;
  y: number;
  /** 정사각형이다. 분석 관심영역이 정사각형이라, 여기서 비율을 열어 두면 사용자가 고를 수 있는
   *  자유도만 늘고 도움은 되지 않는다 (긴 직사각형으로 잘라도 분석은 정사각형만 본다) */
  side: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function PhotoCropper({
  uri,
  scale,
  kind,
  onCancel,
  onDone,
}: {
  /** 자를 사진. **방향 보정이 끝난** uri여야 한다 — EXIF가 살아 있는 원본을 넘기면 화면에 보이는
   *  자리와 실제로 잘리는 자리가 어긋난다 (imageOrientation.ts 참고) */
  uri: string;
  /**
   * 이 사진에서 **이미 검출된** 얼굴 기하 (못 찾았으면 없다).
   *
   * 이 값이 있고 없고에 따라 화면이 할 수 있는 말이 완전히 달라진다. 있으면 얼굴이 원본에서 몇
   * 픽셀인지 이미 아는 값이라 자르기 전에 결과를 정확히 말해 줄 수 있고, 없으면 잘라서 다시
   * 찾아보는 수밖에 없다 — 그 둘을 같은 문구로 뭉뚱그리면 안 된다.
   */
  scale?: ScaleFrame | null;
  /** 이 자리가 무엇을 자로 쓰는지 — 자를 못 찾았을 때도 기준을 말해 주려면 필요하다 */
  kind: ScaleKind;
  onCancel: () => void;
  /** 잘라 만든 새 사진의 uri. 부르는 쪽이 이걸 처음 고른 사진과 같은 경로로 다시 넣는다 */
  onDone: (croppedUri: string) => void;
}) {
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Crop | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (!alive || !(w > 0) || !(h > 0)) return;
        setImg({ w, h });
        // 처음에는 자르지 않은 상태 — 가운데 정사각형을 최대로 잡아 둔다. 사용자가 할 일은
        // "얼굴을 가이드에 채우도록 줄이는 것" 하나로 좁혀진다.
        const side = Math.min(w, h);
        setCrop({ x: (w - side) / 2, y: (h - side) / 2, side });
      },
      () => {
        if (alive) setFailed('사진 크기를 읽지 못했어요');
      },
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  /** 원본 픽셀 → 화면 px 변환 (contain 배치). 사진이나 화면 크기를 아직 모르면 null */
  const fit = useMemo(() => {
    if (!img || area.w <= 0 || area.h <= 0) return null;
    const scale = Math.min(area.w / img.w, area.h / img.h);
    return {
      scale,
      dx: (area.w - img.w * scale) / 2,
      dy: (area.h - img.h * scale) / 2,
      w: img.w * scale,
      h: img.h * scale,
    };
  }, [img, area]);

  /*
    제스처 계산은 렌더와 무관하게 항상 **최신 값**을 봐야 한다. PanResponder는 만들어질 때의
    클로저를 그대로 들고 있어서, state만 쓰면 첫 렌더의 사진 크기·배율로 계산하게 된다.
  */
  const cropRef = useRef<Crop | null>(null);
  cropRef.current = crop;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const imgRef = useRef(img);
  imgRef.current = img;
  const drag = useRef<Drag | null>(null);

  /** 지금 손가락이 잡은 것이 어느 모서리인지 (아니면 안쪽을 잡아 옮기는 것인지) */
  const grabAt = useCallback((sx: number, sy: number): Drag | null => {
    const c = cropRef.current;
    const f = fitRef.current;
    if (!c || !f) return null;

    const x = f.dx + c.x * f.scale;
    const y = f.dy + c.y * f.scale;
    const side = c.side * f.scale;
    const corners: Array<[Corner, number, number]> = [
      ['tl', x, y],
      ['tr', x + side, y],
      ['bl', x, y + side],
      ['br', x + side, y + side],
    ];
    const base = { x: c.x, y: c.y, side: c.side };
    for (const [kind, cx, cy] of corners) {
      if (Math.hypot(sx - cx, sy - cy) <= HANDLE_HIT) return { kind, ...base };
    }
    if (sx >= x && sx <= x + side && sy >= y && sy <= y + side) return { kind: 'move', ...base };
    return null;
  }, []);

  const onMove = useCallback((_e: GestureResponderEvent, g: PanResponderGestureState) => {
    const d = drag.current;
    const f = fitRef.current;
    const im = imgRef.current;
    if (!d || !f || !im) return;

    // 손가락 이동(화면 px)을 원본 픽셀로 되돌린다 — 크롭은 언제나 원본 좌표로 들고 있다
    const dx = g.dx / f.scale;
    const dy = g.dy / f.scale;
    /*
      막는 것은 **화면에서 다시 잡을 수 없을 만큼 작아지는 것** 하나뿐이다.

      MIN_CROP_SIDE_PX보다 작게 자르는 것은 막지 않는다 — 이 앱의 다른 판정들과 같은 태도다.
      넓이가 빠져도 등급·증상 판정은 그대로 나오므로 작게 자를 이유가 남아 있고, 무엇을 잃는지는
      아래 경고로 말해 준다. 고를 수 있는 일을 대신 정해 주지 않는다.
    */
    const minSide = MIN_BOX_SCREEN / f.scale;

    if (d.kind === 'move') {
      setCrop({
        x: clamp(d.x + dx, 0, im.w - d.side),
        y: clamp(d.y + dy, 0, im.h - d.side),
        side: d.side,
      });
      return;
    }

    /*
      모서리를 끌면 **맞은편 모서리를 고정한 채** 정사각형을 키우거나 줄인다.
      대각선 방향의 이동량만 반영해야(가로·세로 평균) 손가락을 비스듬히 움직여도 튀지 않는다.
    */
    const right = d.x + d.side;
    const bottom = d.y + d.side;
    let side: number;
    let maxSide: number;
    switch (d.kind) {
      case 'br':
        side = d.side + (dx + dy) / 2;
        maxSide = Math.min(im.w - d.x, im.h - d.y);
        break;
      case 'tl':
        side = d.side - (dx + dy) / 2;
        maxSide = Math.min(right, bottom);
        break;
      case 'tr':
        side = d.side + (dx - dy) / 2;
        maxSide = Math.min(im.w - d.x, bottom);
        break;
      case 'bl':
        side = d.side + (dy - dx) / 2;
        maxSide = Math.min(right, im.h - d.y);
        break;
    }
    side = clamp(side, Math.min(minSide, maxSide), maxSide);

    // 고정한 모서리에서 새 위치를 되짚는다
    const x = d.kind === 'tl' || d.kind === 'bl' ? right - side : d.x;
    const y = d.kind === 'tl' || d.kind === 'tr' ? bottom - side : d.y;
    setCrop({ x: clamp(x, 0, im.w - side), y: clamp(y, 0, im.h - side), side });
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => {
          drag.current = grabAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
          return drag.current != null;
        },
        onMoveShouldSetPanResponder: () => drag.current != null,
        onPanResponderMove: onMove,
        onPanResponderRelease: () => {
          drag.current = null;
        },
        onPanResponderTerminate: () => {
          drag.current = null;
        },
      }),
    [grabAt, onMove],
  );

  const apply = useCallback(async () => {
    if (!crop || !img || busy) return;
    setBusy(true);
    try {
      /*
        정수 픽셀로 맞춰 자른다 — 소수점이 남으면 네이티브 쪽에서 반올림이 갈려 한 줄씩 어긋난다.
        크기는 건드리지 않는다(resize 없음): 늘리면 없는 정보를 지어내는 것이고, 줄이면 넓이를
        재는 데 필요한 픽셀을 스스로 버리는 것이다.
      */
      const originX = Math.round(clamp(crop.x, 0, img.w - 1));
      const originY = Math.round(clamp(crop.y, 0, img.h - 1));
      const side = Math.round(clamp(crop.side, 1, Math.min(img.w - originX, img.h - originY)));
      const out = await manipulateAsync(uri, [{ crop: { originX, originY, width: side, height: side } }], {
        compress: 1,
        format: SaveFormat.JPEG,
      });
      onDone(out.uri);
    } catch (e: any) {
      setBusy(false);
      setFailed(e?.message ?? '사진을 자르지 못했어요');
    }
  }, [crop, img, busy, uri, onDone]);

  const cropped = crop ? Math.round(crop.side) : 0;
  const status = useMemo(() => cropStatus(crop, img, kind, scale), [crop, img, kind, scale]);
  const warn = status.tone === 'warn';

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>사진 자르기</Text>
        <Text style={styles.sub}>
          {scale
            ? `초록 사각형이 앱이 찾은 ${SCALE_SPEC[scale.kind].noun} 영역이에요. 그 사각형이 다 들어오도록 잘라주세요.`
            : '점선 사각형 안에 얼굴이 다 들어오도록 맞춰주세요.'}{' '}
          모서리를 끌면 크기가, 안쪽을 끌면 위치가 바뀝니다.
        </Text>
      </View>

      <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {fit && crop ? (
          <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
            <Image
              source={{ uri }}
              style={{ position: 'absolute', left: fit.dx, top: fit.dy, width: fit.w, height: fit.h }}
              resizeMode="stretch"
            />
            <CropOverlay
              box={{
                x: fit.dx + crop.x * fit.scale,
                y: fit.dy + crop.y * fit.scale,
                side: crop.side * fit.scale,
              }}
              area={area}
              warn={warn}
              faceRoi={scaleRoiBox(scale, img, fit)}
              kind={scale?.kind ?? kind}
            />
          </View>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </View>

      <View style={styles.foot}>
        {failed && <Text style={styles.errText}>{failed}</Text>}

        {/*
          자른 크기를 픽셀로 보여준다. "몇 %로 줄었다"가 아니라 픽셀이어야 하는 이유는, 넓이를 잴 수
          있는지가 오직 픽셀 수로 갈리기 때문이다 — 사용자가 조절하면서 그 숫자가 오르내리는 걸 봐야
          어디까지 줄여도 되는지 감을 잡는다.
        */}
        <Text style={[styles.meta, warn && styles.metaWarn]}>
          자른 크기 {cropped}×{cropped}px{status.headline ? ` · ${status.headline}` : ''}
        </Text>
        <Text style={warn ? styles.warnText : styles.hintText}>{status.detail}</Text>

        <View style={{ height: 12 }} />
        <Pressable style={[styles.primaryBtn, busy && styles.btnBusy]} onPress={apply} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#16320A" />
          ) : (
            <Text style={styles.primaryBtnText}>이 부분으로 자르기</Text>
          )}
        </Pressable>
        <View style={{ height: 10 }} />
        <Pressable style={styles.secondaryBtn} onPress={onCancel} disabled={busy}>
          <Text style={styles.secondaryBtnText}>취소</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 검출된 자의 관심영역을 화면 좌표 사각형으로. 못 찾았으면 null */
function scaleRoiBox(
  frame: ScaleFrame | null | undefined,
  img: { w: number; h: number } | null,
  fit: { scale: number; dx: number; dy: number } | null,
) {
  if (!frame || !img || !fit) return null;
  const r = roiOf(frame, img.w, img.h);
  return { x: fit.dx + r.x * fit.scale, y: fit.dy + r.y * fit.scale, side: r.width * fit.scale };
}

interface CropStatus {
  tone: 'ok' | 'info' | 'warn';
  /** 크기 줄 옆에 붙는 짧은 값 */
  headline: string;
  detail: string;
}

/**
 * 지금 이 크롭으로 넓이를 잴 수 있는지 — **자르기 전에** 말해 준다.
 *
 * 이 함수가 있는 이유가 곧 이 화면이 한 번 틀렸던 이유다. 처음에는 "가이드를 꽉 채우면 얼굴이 몇
 * px"이라는 **가정**을 보여줬는데, 얼굴 픽셀 크기는 자른다고 변하지 않는다 — 크게 자를수록 그
 * 가정값만 커져서, 화면은 초록불인데 확인 화면은 "얼굴이 너무 작아요"로 거부하는 모순이 났다.
 *
 * 이미 이 사진에서 얼굴을 찾아 두었으면(face) 추측할 것이 없다. s는 원본 픽셀로 이미 정해진 값이고,
 * 자르기가 바꿀 수 있는 것은 **관심영역이 잘리는지** 하나뿐이다. 그 둘만 정확히 말한다.
 */
function cropStatus(
  crop: Crop | null,
  img: { w: number; h: number } | null,
  kind: ScaleKind,
  frame?: ScaleFrame | null,
): CropStatus {
  if (!crop || !img) return { tone: 'info', headline: '', detail: '사진을 불러오는 중이에요' };

  const spec = SCALE_SPEC[frame?.kind ?? kind];
  const noun = spec.noun;
  const minSidePx = minCropSidePx(frame?.kind ?? kind);

  if (frame) {
    const s = Math.round(frame.s);
    const roi = roiOf(frame, img.w, img.h);
    const fits =
      roi.x >= crop.x &&
      roi.y >= crop.y &&
      roi.x + roi.width <= crop.x + crop.side &&
      roi.y + roi.height <= crop.y + crop.side;

    if (s < spec.minScalePx) {
      return {
        tone: 'warn',
        headline: `${noun} ${s}px (최소 ${spec.minScalePx}px)`,
        detail:
          `이 사진의 ${noun}은 원본에서 ${s}px이라 넓이를 재기엔 작아요. 잘라도 이 값은 커지지 않아요 — ` +
          '픽셀 수는 자른다고 늘지 않으니까요. 등급·증상 판정은 그대로 나오고 넓이만 빠집니다.',
      };
    }
    /*
      몸통에만 있는 경고다. 어깨나 골반이 화면 밖이면 모델이 그 자리를 추정해서 내놓기 때문에,
      좌표만 보면 자가 있는 것처럼 보인다 — 자르기로는 더 나빠질 뿐이라는 것을 미리 말해 준다.
    */
    if (!frame.complete) {
      return {
        tone: 'warn',
        headline: '어깨·골반이 잘렸어요',
        detail:
          '양 어깨와 골반이 모두 사진 안에 있어야 몸통 크기를 잴 수 있어요. 화면 밖의 관절은 앱이 ' +
          '추정할 뿐이라 그 값으로는 넓이를 재지 않아요 — 자르기로는 고칠 수 없어요.',
      };
    }
    /*
      찾아 둔 얼굴에서 완전히 벗어났으면 실수가 아니라 **의도**로 본다 — 여러 명이 찍힌 사진에서
      다른 사람을 고르는 중이다. 그때 "얼굴이 잘렸어요"라고 막으면 정확히 하려던 일을 말리는 셈이다.
    */
    const overlaps =
      roi.x < crop.x + crop.side &&
      roi.x + roi.width > crop.x &&
      roi.y < crop.y + crop.side &&
      roi.y + roi.height > crop.y;
    if (!overlaps) {
      return {
        tone: 'info',
        headline: '다른 사람 고르는 중',
        detail:
          `앱이 찾아 둔 ${noun}(초록 사각형)에서 완전히 벗어났어요. 다른 사람을 고르는 중이라면 ` +
          '이대로 자르면 돼요 — 자른 사진에서 다시 찾습니다.',
      };
    }
    if (!fits) {
      return {
        tone: 'warn',
        headline: `${noun} ${s}px`,
        detail:
          `분석에 들어가는 ${noun} 영역(초록 사각형)이 잘렸어요. 이대로 자르면 잘린 쪽 병변이 빠지는데 ` +
          '기준이 되는 얼굴 크기는 그대로라, 병변이 줄어든 것처럼 보여요 — 그래서 넓이를 재지 않습니다.',
      };
    }
    return {
      tone: 'ok',
      headline: `${noun} ${s}px`,
      detail: '이대로 자르면 넓이를 잴 수 있어요. 자르기는 화질을 바꾸지 않고 앱이 볼 자리만 좁혀줍니다.',
    };
  }

  // 얼굴을 못 찾은 사진 — 자르기가 실제로 도움이 되는 경우다. 얼굴이 얼마나 클지는 아직 모르므로
  // 말할 수 있는 것은 상한뿐이다("꽉 채웠을 때"), 그 조건을 문구에 그대로 적는다.
  const side = Math.round(crop.side);
  const best = Math.round(side * spec.targetOfMinSide);
  if (side < minSidePx) {
    return {
      tone: 'warn',
      headline: `${noun}을 꽉 채워도 ${best}px`,
      detail:
        `이 크기로는 ${noun}이 사각형을 꽉 채워도 ${spec.minScalePx}px에 못 미쳐 넓이를 잴 수 없어요 ` +
        `(한 변 ${minSidePx}px 이상 필요). 등급·증상 판정은 그대로 나옵니다.`,
    };
  }
  return {
    tone: 'info',
    headline: `${noun} 못 찾음`,
    detail:
      kind === 'face'
        ? '이 사진에서는 얼굴을 찾지 못했어요. 얼굴 부분만 남기고 자르면 찾을 수 있어요 — 자른 뒤 바로 다시 확인해 드릴게요.'
        : '이 사진에서는 사람을 찾지 못했어요. 사람이 있는 부분만 남기고 자르면 찾을 수 있어요 — 다만 몸통은 전신이 다 보여야 넓이를 잴 수 있어요.',
  };
}

/**
 * 자를 자리 표시 — 바깥을 어둡게 덮고, 안쪽에 촬영 가이드와 **똑같은 도형**을 그린다.
 *
 * 도형을 standardRoi에서 가져오는 것이 핵심이다. 카메라 가이드(FaceGuideOverlay)와 넓이 게이트가
 * 겨냥하는 사각형이 바로 이것이라, 여기서 따로 그리면 "가이드에 맞춰 잘랐는데 넓이가 빠졌다"가
 * 생긴다. 정사각형으로 자르므로 화면 좌표에서 바로 계산해도 원본에서와 같은 비율이 나온다.
 */
function CropOverlay({
  box,
  area,
  warn,
  faceRoi,
  kind,
}: {
  box: { x: number; y: number; side: number };
  /** 화면 자리의 크기 — react-native-svg는 캔버스 크기를 속성으로 받아야 확실히 그려진다 */
  area: { w: number; h: number };
  warn: boolean;
  /**
   * 이 사진에서 실제로 찾은 얼굴의 관심영역 (화면 좌표). 있으면 표준 도형 대신 이것을 그린다 —
   * 맞춰야 할 대상이 "얼굴을 이만큼 담아라"라는 일반론이 아니라, 눈앞의 이 사각형이 되기 때문이다.
   */
  faceRoi?: { x: number; y: number; side: number } | null;
  /** 자를 못 찾았을 때 그릴 표준 도형의 종류 */
  kind: ScaleKind;
}) {
  const color = warn ? '#FFB020' : '#FFFFFF';

  /*
    안쪽에 그리는 사각형의 뜻이 두 경우에 다르다.

      · 얼굴을 찾았으면 — **이 사진에서 실제로 잡힌 자리**다. 사용자가 할 일은 이걸 잘라 내지 않는
        것뿐이라, 잘라낼 흰 사각형과 색을 달리해 "내가 움직이는 것"과 "앱이 이미 찾은 것"을 가른다.
      · 못 찾았으면 — 표준 촬영 가이드(standardRoi)다. 여기에 얼굴을 오게 잘라 달라는 부탁이고,
        게이트가 겨냥하는 것과 같은 계산이라 화면과 판정이 어긋나지 않는다.
  */
  const guide = standardRoi(kind, box.side, box.side);
  const rx = faceRoi ? faceRoi.x : box.x + guide.x;
  const ry = faceRoi ? faceRoi.y : box.y + guide.y;
  const rs = faceRoi ? faceRoi.side : guide.width;
  const roiColor = faceRoi ? (warn ? '#FFB020' : '#8FD14F') : color;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* 바깥 어둡게 — 네 조각으로 덮는다 (구멍 뚫린 뷰를 만들 방법이 RN에는 없다) */}
      <View style={[styles.shade, { left: 0, right: 0, top: 0, height: box.y }]} />
      <View style={[styles.shade, { left: 0, right: 0, top: box.y + box.side, bottom: 0 }]} />
      <View style={[styles.shade, { left: 0, width: box.x, top: box.y, height: box.side }]} />
      <View style={[styles.shade, { left: box.x + box.side, right: 0, top: box.y, height: box.side }]} />

      <Svg style={StyleSheet.absoluteFill} width={area.w} height={area.h}>
        {/* 자를 사각형 */}
        <Rect x={box.x} y={box.y} width={box.side} height={box.side} fill="none" stroke={color} strokeWidth={2} />
        {/* 분석에 실제로 들어가는 관심영역 — 얼굴은 이 안에 다 들어와야 한다 */}
        <Rect
          x={rx}
          y={ry}
          width={rs}
          height={rs}
          rx={rs * 0.08}
          fill="none"
          stroke={roiColor}
          strokeWidth={2}
          strokeDasharray={faceRoi ? undefined : '10 8'}
          opacity={0.95}
        />
        {/* 얼굴 도형은 "여기에 얼굴을 두라"는 부탁이라, 이미 찾은 얼굴에는 그리지 않는다 */}
        {!faceRoi && (
          <>
            {/* 얼굴 자리 (성인 얼굴 비례: 가로 ≈ 세로의 0.74) */}
            <Ellipse
              cx={rx + rs / 2}
              cy={ry + rs / 2}
              rx={rs * 0.37}
              ry={rs * 0.5}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              opacity={0.5}
            />
            {/* 눈높이 — 위아래 위치를 맞추는 가장 쉬운 기준점 */}
            <Line
              x1={rx + rs * 0.2}
              y1={ry + rs * 0.4}
              x2={rx + rs * 0.8}
              y2={ry + rs * 0.4}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 6"
              opacity={0.5}
            />
          </>
        )}
      </Svg>

      {/* 모서리 손잡이 — 어디를 잡아야 하는지 보이지 않으면 아무도 크기를 바꾸지 않는다 */}
      {([
        ['tl', box.x, box.y],
        ['tr', box.x + box.side, box.y],
        ['bl', box.x, box.y + box.side],
        ['br', box.x + box.side, box.y + box.side],
      ] as const).map(([k, hx, hy]) => (
        <View key={k} style={[styles.handle, { left: hx - HANDLE_SIZE / 2, top: hy - HANDLE_SIZE / 2, borderColor: color }]} />
      ))}
    </View>
  );
}

const HANDLE_SIZE = 22;

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#14171C' },
  head: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  stage: { flex: 1, margin: 12 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  foot: { paddingHorizontal: 20, paddingBottom: 26 },
  meta: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  metaWarn: { color: '#FFB020' },
  warnText: {
    color: '#FFB020',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  hintText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  errText: { color: '#FF8A8A', fontSize: 12.5, textAlign: 'center', marginBottom: 8 },
  primaryBtn: { backgroundColor: AppColors.greenTop, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnBusy: { opacity: 0.7 },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#16320A' },
  secondaryBtn: { paddingVertical: 13, alignItems: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
});
