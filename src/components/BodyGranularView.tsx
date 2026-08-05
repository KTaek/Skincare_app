import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import {
  ARMS, ARM_RADIUS, classifyBodyPartGranular, GranularPart,
  HEAD, LEGS, LEG_RADIUS, NECK, TORSO, VIEWBOX_H, VIEWBOX_W,
} from './bodyShapes';

const BODY_COLOR = '#B9BCC2';
const MARKER_COLOR = '#E24B3F';

// Body2DView와 동일하되, 탭 위치를 관절 기준 세부 부위(GranularPart)로 반환.
export default function BodyGranularView({ onMarked }: { onMarked: (p: GranularPart) => void }) {
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 });
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!point) return;
    pulse.setValue(1);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.5, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [point, pulse]);

  const onWrapLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setWrapSize({ width, height });
  };

  const onPress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (wrapSize.width === 0 || wrapSize.height === 0) return;
    const { locationX, locationY } = e.nativeEvent;
    const vx = (locationX / wrapSize.width) * VIEWBOX_W;
    const vy = (locationY / wrapSize.height) * VIEWBOX_H;
    const part = classifyBodyPartGranular(vx, vy);
    if (!part) return;
    setPoint({ x: locationX, y: locationY });
    onMarked(part);
  };

  return (
    <View style={styles.container}>
      <View style={styles.figureWrap} onLayout={onWrapLayout}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onPress}>
          {wrapSize.width > 0 && (
            <Svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
              <Circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={BODY_COLOR} />
              <Rect x={NECK.x1} y={NECK.y1} width={NECK.x2 - NECK.x1} height={NECK.y2 - NECK.y1} rx={8} fill={BODY_COLOR} />
              <Rect x={TORSO.x1} y={TORSO.y1} width={TORSO.x2 - TORSO.x1} height={TORSO.y2 - TORSO.y1} rx={38} fill={BODY_COLOR} />
              {ARMS.map(([ax, ay, bx, by], i) => (
                <Path key={`arm-${i}`} d={`M${ax} ${ay} L${bx} ${by}`} stroke={BODY_COLOR}
                  strokeWidth={ARM_RADIUS * 2} strokeLinecap="round" fill="none" />
              ))}
              {LEGS.map(([ax, ay, bx, by], i) => (
                <Path key={`leg-${i}`} d={`M${ax} ${ay} L${bx} ${by}`} stroke={BODY_COLOR}
                  strokeWidth={LEG_RADIUS * 2} strokeLinecap="round" fill="none" />
              ))}
            </Svg>
          )}
        </Pressable>

        {point && (
          <Animated.View pointerEvents="none"
            style={[styles.marker, { left: point.x - 9, top: point.y - 9, transform: [{ scale: pulse }] }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  figureWrap: { width: '70%', aspectRatio: VIEWBOX_W / VIEWBOX_H },
  marker: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: MARKER_COLOR },
});
