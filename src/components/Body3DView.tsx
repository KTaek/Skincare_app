import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { BodyPartId, PartFacing } from '../monitoring/bodyParts';
import { Camera, Mesh, meshBounds, pickPart, projectVertices, rotationMatrix, Vec3 } from '../three/geom3d';
import { BodyModelId, buildBodyMesh, getPreset } from '../three/humanModel';

export interface BodyPick {
  part: BodyPartId;
  facing: PartFacing;
  /** 모델 좌표계에서 실제로 찍은 지점 — 같은 부위 안에서도 위치를 기억해 두면 재촬영 안내에 쓸 수 있다 */
  point: Vec3;
  /** 탭한 면의 법선 (모델 좌표계) — 앞/뒤·위아래 면 판정에 쓴다 */
  normal: Vec3;
}

/** 셰이딩 단계 수. 늘리면 부드러워지지만 프레임당 그려야 할 Path가 늘어난다 */
const SHADE_LEVELS = 5;
const LIGHT = { x: -0.35, y: -0.45, z: 0.82 };

const SKIN_BASE = { r: 0xc6, g: 0xcb, b: 0xd3 };
const SELECTED_BASE = { r: 0xe2, g: 0x4b, b: 0x3f };
const MONITORED_BASE = { r: 0x93, g: 0xd2, b: 0x58 };
/** 위치를 알려주려고 곁들인 인접 부위 — 주인공보다 흐리게 */
const CONTEXT_BASE = { r: 0xe4, g: 0xe7, b: 0xec };

type Group = 'base' | 'selected' | 'monitored' | 'context';

const GROUP_BASE: Record<Group, { r: number; g: number; b: number }> = {
  base: SKIN_BASE,
  selected: SELECTED_BASE,
  monitored: MONITORED_BASE,
  context: CONTEXT_BASE,
};

/** 그룹×명암 단계별 색을 미리 만들어 둔다 (프레임마다 문자열을 만들지 않도록) */
const PALETTE: Record<Group, string[]> = {
  base: [],
  selected: [],
  monitored: [],
  context: [],
};
(Object.keys(GROUP_BASE) as Group[]).forEach((g) => {
  const c = GROUP_BASE[g];
  for (let i = 0; i < SHADE_LEVELS; i++) {
    const f = 0.55 + (0.55 * i) / (SHADE_LEVELS - 1);
    const to = (v: number) => Math.round(Math.min(255, v * f));
    PALETTE[g].push(`rgb(${to(c.r)},${to(c.g)},${to(c.b)})`);
  }
});

interface Bucket {
  key: string;
  path: SkPath;
  color: string;
}

export default function Body3DView({
  modelId,
  visibleParts,
  focusParts,
  framePadding = 1,
  contextParts,
  highlightParts,
  faceHighlight,
  monitoredParts,
  marker: markerPoint,
  view,
  onPick,
  onViewChange,
}: {
  modelId: BodyModelId;
  /** 지정하면 그 부위만 떼어서 크게 보여준다 (없으면 전신) */
  visibleParts?: BodyPartId[];
  /** 화면을 맞출(그리고 회전 중심이 될) 부위 — 없으면 보이는 것 전체 기준 */
  focusParts?: BodyPartId[];
  /** 1보다 크면 그만큼 뒤로 물러난다 — 인접 부위가 화면에 걸치도록 */
  framePadding?: number;
  /** 방향을 알려주려고 곁들인 인접 부위 — 흐리게 그린다 */
  contextParts?: BodyPartId[];
  /** 선택된 부위 — 빨강으로 표시 */
  highlightParts?: BodyPartId[];
  /** 특정 부위에서 그 방향을 향한 면만 빨갛게 칠한다 (앞/뒤 중 어느 쪽을 고른 건지 보여줄 때) */
  faceHighlight?: { parts: BodyPartId[]; direction: Vec3 };
  /** 이미 모니터링 중인 부위 — 초록으로 표시 */
  monitoredParts?: BodyPartId[];
  /** 모델 좌표계 위의 점 하나에 마커를 찍는다 */
  marker?: Vec3 | null;
  /** 밖에서 시점을 지정한다. 값이 바뀔 때마다 그 각도로 회전한다 (이후 드래그는 자유) */
  view?: { yaw: number; pitch: number };
  onPick?: (pick: BodyPick) => void;
  /** 드래그·스냅으로 시점이 바뀔 때마다 알려준다 (지금 어느 쪽을 보고 있는지 표시용) */
  onViewChange?: (rot: { yaw: number; pitch: number }) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rot, setRot] = useState({ yaw: view?.yaw ?? 0, pitch: view?.pitch ?? 0 });
  const rotRef = useRef(rot);
  const frameRef = useRef<number | null>(null);

  const fullMesh = useMemo(() => buildBodyMesh(getPreset(modelId)), [modelId]);

  // visibleParts가 있으면 그 삼각형만 남긴다. 정점 배열은 그대로 둬서 인덱스가 어긋나지 않게 한다.
  const mesh = useMemo<Mesh<BodyPartId>>(() => {
    if (!visibleParts?.length) return fullMesh;
    const keep = new Set(visibleParts);
    return { vertices: fullMesh.vertices, tris: fullMesh.tris.filter((t) => keep.has(t.part)) };
  }, [fullMesh, visibleParts]);

  // 화면을 맞추는 기준은 focusParts(있으면) → 보이는 부위 → 전신 순
  const bounds = useMemo(() => {
    const frame = focusParts?.length ? new Set(focusParts) : visibleParts?.length ? new Set(visibleParts) : null;
    if (!frame) return meshBounds(fullMesh.vertices);
    const used: Vec3[] = [];
    fullMesh.tris.forEach((t) => {
      if (!frame.has(t.part)) return;
      used.push(fullMesh.vertices[t.a], fullMesh.vertices[t.b], fullMesh.vertices[t.c]);
    });
    return meshBounds(used.length ? used : fullMesh.vertices);
  }, [fullMesh, visibleParts, focusParts]);

  const camera: Camera | null = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null;
    // 어느 각도로 돌려도 화면 밖으로 나가지 않도록 깊이(z)까지 감안해 여유를 잡는다
    const spanH = Math.max(bounds.size.x, bounds.size.z);
    const spanV = Math.max(bounds.size.y, bounds.size.z);
    const fit = Math.min(size.width / (spanH * 1.15 * framePadding), size.height / (spanV * 1.1 * framePadding));
    const span = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);
    return {
      cx: size.width / 2,
      cy: size.height / 2,
      scale: fit,
      dist: span * 2.6,
      focal: span * 2.6,
    };
  }, [size, bounds, framePadding]);

  const monitoredSet = useMemo(() => new Set(monitoredParts ?? []), [monitoredParts]);
  const highlightSet = useMemo(() => new Set(highlightParts ?? []), [highlightParts]);
  const contextSet = useMemo(() => new Set(contextParts ?? []), [contextParts]);
  const faceSet = useMemo(() => new Set(faceHighlight?.parts ?? []), [faceHighlight]);

  // 드래그 중 setState가 프레임마다 몰리지 않도록 rAF로 한 번만 반영
  const scheduleRot = useCallback((next: { yaw: number; pitch: number }) => {
    rotRef.current = next;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setRot(rotRef.current);
    });
  }, []);

  // 밖에서 시점을 바꾸면(지점 선택 등) 그 각도로 맞춰 준다
  const viewYaw = view?.yaw;
  const viewPitch = view?.pitch;
  useEffect(() => {
    if (viewYaw == null || viewPitch == null) return;
    scheduleRot({ yaw: viewYaw, pitch: viewPitch });
  }, [viewYaw, viewPitch, scheduleRot]);

  const viewChangeRef = useRef(onViewChange);
  viewChangeRef.current = onViewChange;
  useEffect(() => {
    viewChangeRef.current?.(rot);
  }, [rot]);

  const panStart = useRef({ yaw: 0, pitch: 0 });

  // 제스처 도중에 PanResponder가 새로 만들어지면 회전이 튀므로, 바뀌는 값은 ref로만 넘긴다.
  // (부모가 리렌더될 때마다 onPick 같은 콜백의 identity가 바뀌는 것이 원인이었다)
  const pickRef = useRef({ mesh, bounds, camera, onPick });
  pickRef.current = { mesh, bounds, camera, onPick };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          panStart.current = { ...rotRef.current };
        },
        onPanResponderMove: (_e, g) => {
          const yaw = panStart.current.yaw + g.dx * 0.012;
          const pitch = Math.max(-0.5, Math.min(0.5, panStart.current.pitch - g.dy * 0.006));
          scheduleRot({ yaw, pitch });
        },
        onPanResponderRelease: (e, g) => {
          const { mesh: m, bounds: b, camera: cam, onPick: pick } = pickRef.current;
          const moved = Math.hypot(g.dx, g.dy);
          if (moved > 8 || !cam || !pick) return; // 회전 제스처였으면 선택하지 않는다
          const hit = pickPart(
            m,
            b.center,
            rotationMatrix(rotRef.current.yaw, rotRef.current.pitch),
            cam,
            e.nativeEvent.locationX,
            e.nativeEvent.locationY,
          );
          if (!hit) return;
          pick({
            part: hit.part,
            facing: hit.normal.z >= 0 ? 'front' : 'back',
            point: hit.point,
            normal: hit.normal,
          });
        },
      }),
    [scheduleRot],
  );

  const buckets = useMemo<Bucket[]>(() => {
    if (!camera) return [];
    const matrix = rotationMatrix(rot.yaw, rot.pitch);
    const proj = projectVertices(mesh.vertices, bounds.center, matrix, camera);
    const { sx, sy, rx, ry, rz } = proj;

    // 부위 단위로 앞뒤를 정렬한다. 부위 안쪽은 뒷면 컬링으로 충분하고,
    // 부위끼리의 가림(예: 옆에서 볼 때 팔이 몸통을 가림)은 이 정렬이 처리한다.
    const partDepth = new Map<BodyPartId, { sum: number; n: number }>();
    const partTris = new Map<BodyPartId, { level: number; d: string; face: boolean }[]>();

    // 면 강조 방향도 같은 행렬로 돌려 두면, 회전 좌표계 법선과 그대로 내적할 수 있다
    // (회전은 내적을 보존하므로 모델 좌표계에서 비교한 것과 같다).
    let hx = 0;
    let hy = 0;
    let hz = 0;
    if (faceHighlight) {
      const d = faceHighlight.direction;
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      hx = (matrix[0] * d.x + matrix[1] * d.y + matrix[2] * d.z) / len;
      hy = (matrix[3] * d.x + matrix[4] * d.y + matrix[5] * d.z) / len;
      hz = (matrix[6] * d.x + matrix[7] * d.y + matrix[8] * d.z) / len;
    }

    for (let i = 0; i < mesh.tris.length; i++) {
      const t = mesh.tris[i];
      const ax = sx[t.a];
      const ay = sy[t.a];
      const bx = sx[t.b];
      const by = sy[t.b];
      const cxp = sx[t.c];
      const cyp = sy[t.c];

      // 회전 좌표계에서의 법선으로 뒷면 컬링 + 램버트 셰이딩
      const e1x = rx[t.b] - rx[t.a];
      const e1y = ry[t.b] - ry[t.a];
      const e1z = rz[t.b] - rz[t.a];
      const e2x = rx[t.c] - rx[t.a];
      const e2y = ry[t.c] - ry[t.a];
      const e2z = rz[t.c] - rz[t.a];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      if (nz <= 0) continue;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      const diffuse = Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
      const shade = 0.32 + 0.68 * diffuse;
      const level = Math.max(0, Math.min(SHADE_LEVELS - 1, Math.floor(shade * SHADE_LEVELS)));

      const depth = (rz[t.a] + rz[t.b] + rz[t.c]) / 3;
      const acc = partDepth.get(t.part);
      if (acc) {
        acc.sum += depth;
        acc.n += 1;
      } else {
        partDepth.set(t.part, { sum: depth, n: 1 });
      }

      // 선택한 면(예: "하완 앞")을 향한 삼각형만 강조 — 옆면까지 번지지 않도록 여유는 좁게
      const face = faceSet.has(t.part) && nx * hx + ny * hy + nz * hz > 0.35;

      const d = `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}L${cxp.toFixed(1)} ${cyp.toFixed(1)}Z`;
      const list = partTris.get(t.part);
      if (list) list.push({ level, d, face });
      else partTris.set(t.part, [{ level, d, face }]);
    }

    const orderedParts = [...partDepth.entries()]
      .sort((a, b) => a[1].sum / a[1].n - b[1].sum / b[1].n)
      .map(([part]) => part);

    const out: Bucket[] = [];
    orderedParts.forEach((part) => {
      const base: Group = highlightSet.has(part)
        ? 'selected'
        : monitoredSet.has(part)
          ? 'monitored'
          : contextSet.has(part)
            ? 'context'
            : 'base';
      // 같은 부위 안에서도 강조된 면과 나머지가 색이 다르므로 (그룹, 명암) 조합별로 모은다
      const byKey = new Map<string, string>();
      partTris.get(part)?.forEach(({ level, d, face }) => {
        const key = `${face ? 'selected' : base}-${level}`;
        byKey.set(key, (byKey.get(key) ?? '') + d);
      });
      byKey.forEach((d, key) => {
        const [group, lv] = key.split('-') as [Group, string];
        const path = Skia.Path.MakeFromSVGString(d);
        if (!path) return;
        out.push({ key: `${part}-${key}`, path, color: PALETTE[group][Number(lv)] });
      });
    });
    return out;
  }, [mesh, bounds, camera, rot, highlightSet, monitoredSet, contextSet, faceSet, faceHighlight]);

  // 선택 지점을 화면 좌표로 옮겨 마커를 찍는다 (뒤로 돌아가면 숨긴다)
  const marker = useMemo(() => {
    if (!camera || !markerPoint) return null;
    const matrix = rotationMatrix(rot.yaw, rot.pitch);
    const p = projectVertices([markerPoint], bounds.center, matrix, camera);
    if (p.rz[0] < -0.02) return null;
    return { x: p.sx[0], y: p.sy[0] };
  }, [camera, markerPoint, rot, bounds]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.root}>
      <View style={styles.canvasWrap} onLayout={onLayout} {...pan.panHandlers}>
        {camera && (
          <Canvas style={StyleSheet.absoluteFill}>
            {buckets.map((b) => (
              <Path key={b.key} path={b.path} color={b.color} />
            ))}
          </Canvas>
        )}
        {marker && <View pointerEvents="none" style={[styles.marker, { left: marker.x - 7, top: marker.y - 7 }]} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvasWrap: { flex: 1 },
  marker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#E24B3F',
  },
});
