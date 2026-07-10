import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { AppColors } from '../theme';
import { BodyRegion, RegionHeat } from '../models';
import { ARMS, ARM_RADIUS, HEAD, LEGS, LEG_RADIUS, NECK, TORSO, VIEWBOX_H, VIEWBOX_W } from './bodyShapes';

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** 0(약함, 초록) ~ 1(심함, 빨강) 점수를 색으로 변환 */
function heatColor(score: number): string {
  const stops = [hexToRgb(AppColors.sev1), hexToRgb(AppColors.sev2), hexToRgb(AppColors.sev3)];
  const t = Math.max(0, Math.min(1, score));
  const segment = t < 0.5 ? 0 : 1;
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [r1, g1, b1] = stops[segment];
  const [r2, g2, b2] = stops[segment + 1];
  return `rgb(${lerp(r1, r2, localT)}, ${lerp(g1, g2, localT)}, ${lerp(b1, b2, localT)})`;
}

export default function BodyHeatmapView({ heat }: { heat: RegionHeat[] }) {
  const colorOf = (region: BodyRegion) => {
    const h = heat.find((x) => x.region === region);
    return h && h.count > 0 ? heatColor(h.score) : AppColors.line;
  };

  return (
    <View style={styles.wrap}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
        <Circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={colorOf('head')} />
        <Rect x={NECK.x1} y={NECK.y1} width={NECK.x2 - NECK.x1} height={NECK.y2 - NECK.y1} rx={8} fill={colorOf('head')} />
        <Rect
          x={TORSO.x1}
          y={TORSO.y1}
          width={TORSO.x2 - TORSO.x1}
          height={TORSO.y2 - TORSO.y1}
          rx={38}
          fill={colorOf('torso')}
        />
        {ARMS.map(([ax, ay, bx, by], i) => (
          <Path
            key={`arm-${i}`}
            d={`M${ax} ${ay} L${bx} ${by}`}
            stroke={colorOf(i < 2 ? 'leftArm' : 'rightArm')}
            strokeWidth={ARM_RADIUS * 2}
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {LEGS.map(([ax, ay, bx, by], i) => (
          <Path
            key={`leg-${i}`}
            d={`M${ax} ${ay} L${bx} ${by}`}
            stroke={colorOf(i < 2 ? 'leftLeg' : 'rightLeg')}
            strokeWidth={LEG_RADIUS * 2}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '55%', aspectRatio: VIEWBOX_W / VIEWBOX_H, alignSelf: 'center' },
});
