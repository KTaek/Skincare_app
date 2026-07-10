import { BodyRegion } from '../models';

export const VIEWBOX_W = 220;
export const VIEWBOX_H = 420;

export const HEAD = { cx: 110, cy: 42, r: 30 };
export const NECK = { x1: 99, y1: 68, x2: 121, y2: 84 };
export const TORSO = { x1: 68, y1: 82, x2: 152, y2: 222 };

export const ARM_RADIUS = 11;
/** [시작x, 시작y, 끝x, 끝y]. 앞쪽 2개는 화면상 왼쪽 팔, 뒤쪽 2개는 오른쪽 팔 */
export const ARMS: [number, number, number, number][] = [
  [82, 100, 42, 175],
  [42, 175, 26, 232],
  [138, 100, 178, 175],
  [178, 175, 194, 232],
];

export const LEG_RADIUS = 14;
/** 앞쪽 2개는 화면상 왼쪽 다리, 뒤쪽 2개는 오른쪽 다리 */
export const LEGS: [number, number, number, number][] = [
  [93, 214, 88, 320],
  [88, 320, 86, 400],
  [127, 214, 132, 320],
  [132, 320, 134, 400],
];

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

/** viewBox 좌표 (x, y)가 어떤 신체 부위 위에 있는지 판정. 신체 밖이면 null */
export function classifyBodyRegion(x: number, y: number): BodyRegion | null {
  if (Math.hypot(x - HEAD.cx, y - HEAD.cy) <= HEAD.r) return 'head';
  if (x >= NECK.x1 && x <= NECK.x2 && y >= NECK.y1 && y <= NECK.y2) return 'head';
  if (x >= TORSO.x1 && x <= TORSO.x2 && y >= TORSO.y1 && y <= TORSO.y2) return 'torso';
  if (ARMS.slice(0, 2).some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= ARM_RADIUS)) {
    return 'leftArm';
  }
  if (ARMS.slice(2, 4).some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= ARM_RADIUS)) {
    return 'rightArm';
  }
  if (LEGS.slice(0, 2).some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= LEG_RADIUS)) {
    return 'leftLeg';
  }
  if (LEGS.slice(2, 4).some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= LEG_RADIUS)) {
    return 'rightLeg';
  }
  return null;
}
