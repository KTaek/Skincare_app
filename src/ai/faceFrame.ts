import type { FaceDetection, FaceKeypoints } from './faceDetector';
import { scaleFrameOf, SCALE_SPEC, type ScaleFrame } from './scaleFrame';

/**
 * 얼굴 세 점(양눈·입) → 촬영 기하.
 *
 * 왜 이 세 점인가. 병변 면적을 회차 간 비교하려면 "같은 배율로 찍었는가"를 알아야 하는데,
 * 그 기준이 될 수 있는 것은 **시간에 따라 변하지 않는 것**뿐이다. 병변은 변한다(그래서 병변
 * 크기를 기준으로 삼던 구도 게이트가 frameQuality.ts에서 걷어내졌다). 얼굴 골격은 변하지 않는다.
 *
 * d·v를 면적의 자로 쓰는 이유와 ROI·게이트의 근거는 전부 scaleFrame.ts에 있다 — 몸통과 나눠
 * 쓰는 계산이라 그쪽 한 곳에만 둔다. 여기 남은 것은 "얼굴에서 그 세 점을 어떻게 뽑는가"뿐이다.
 */

/** 얼굴에서 잰 자. 몸통과 같은 모양이라 파이프라인 전체가 구분 없이 다룬다 */
export type FaceFrame = ScaleFrame;

/** 넓이를 재기 위해 필요한 최소 얼굴 크기 (길이 스케일 s, 원본 픽셀) — 근거는 SCALE_SPEC 주석 */
export const MIN_FACE_SCALE_PX = SCALE_SPEC.face.minScalePx;

/**
 * 키포인트 → 촬영 기하. 세 점이 거의 한 점으로 뭉쳐 있으면(검출 실패의 흔한 모습) null.
 *
 * 비대칭 지표는 **코의 좌우 치우침**을 쓴다. 두 눈에서 코까지의 거리 차를 안간거리로 나눈 값이라
 * 사람에 따른 편차가 작아, 기준 세션 없이도 쓸 수 있는 유일한 정면성 지표다.
 *
 *     코 옆이동 1mm → 0.024 (3°)    4mm → 0.096 (12°)    7mm → 0.168 (20°)
 */
export function faceFrameOf(kp: FaceKeypoints, box?: FaceDetection['box']): FaceFrame | null {
  const dl = Math.hypot(kp.leftEye.x - kp.nose.x, kp.leftEye.y - kp.nose.y);
  const dr = Math.hypot(kp.rightEye.x - kp.nose.x, kp.rightEye.y - kp.nose.y);
  const d = Math.hypot(kp.leftEye.x - kp.rightEye.x, kp.leftEye.y - kp.rightEye.y);
  const asym = d > 0 ? Math.abs(dl - dr) / d : 0;

  // 얼굴은 눈 둘과 입이 보이면 그것이 자의 전부다 — 더 들어와야 할 것이 없으므로 항상 complete
  return scaleFrameOf('face', kp.leftEye, kp.rightEye, kp.mouth, asym, true, box);
}

export function faceFrameOfDetection(det: FaceDetection | null): FaceFrame | null {
  // 검출 상자를 함께 넘긴다 — "얼굴이 사진에 얼마나 담겼나"를 비례 상수 없이 재기 위해서다
  // (scaleFrame의 ScaleFrame.box 주석: 성인 비례는 아이 얼굴에 맞지 않는다)
  return det ? faceFrameOf(det.kp, det.box) : null;
}
