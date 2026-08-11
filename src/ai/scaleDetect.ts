import type { SkImage } from '@shopify/react-native-skia';
import { detectFace, isFaceDetectionAvailable, preloadFaceModel } from './faceDetector';
import { detectPose, isPoseDetectionAvailable, preloadPoseModel } from './poseDetector';
import { faceFrameOfDetection } from './faceFrame';
import { torsoFrameOf } from './torsoFrame';
import type { ScaleFrame, ScaleKind } from './scaleFrame';

/**
 * 자를 재는 단 하나의 문 — 부르는 쪽은 부위 종류만 넘기고 어느 모델이 도는지 몰라도 된다.
 *
 * 이 파일이 있는 이유: 촬영 화면·고스트·분석이 전부 "이 사진의 자"를 필요로 하는데, 그때마다
 * `if (얼굴) detectFace else detectPose`를 쓰면 부위를 하나 더 붙이는 순간 그 분기를 전부 찾아
 * 고쳐야 한다. 자가 늘어나는 자리는 여기 한 곳이다.
 */

/** 이 부위의 자를 지금 쓸 수 있는지 (모델 로딩 실패·웹 미리보기에서 false) */
export function isScaleAvailable(kind: ScaleKind): boolean {
  return kind === 'face' ? isFaceDetectionAvailable() : isPoseDetectionAvailable();
}

/** 촬영 화면에 들어올 때 미리 불러 둔다 — 첫 틱이 모델 로딩을 기다리지 않도록 */
export function preloadScaleModel(kind: ScaleKind): Promise<void> {
  return kind === 'face' ? preloadFaceModel() : preloadPoseModel();
}

/** 사진에서 자를 잰다. 못 찾거나 모델을 못 쓰면 null */
export async function detectScaleFrame(image: SkImage, kind: ScaleKind): Promise<ScaleFrame | null> {
  if (kind === 'face') return faceFrameOfDetection(await detectFace(image));
  const lm = await detectPose(image);
  return lm ? torsoFrameOf(lm, image.width(), image.height()) : null;
}
