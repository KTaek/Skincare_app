// 기준(배꼽/유두) 양 끝 2점을 정밀하게 찍는 화면 — 확대(1/2/3×) + 드래그 이동 + 작은 점.
// gesture-handler 없이 PanResponder(코어)로 구현: 짧게 누르면 점 찍기, 확대 상태에서 끌면 이동.
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, StatusBar, Image, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors } from '../appTheme';

export default function LandmarkPicker({ uri, refName, mode = 'circle', onBack, onConfirm }) {
  const [wrap, setWrap] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [pts, setPts] = useState([]);   // {x,y} in 512 그리드

  const st = useRef({});
  st.current = { w: wrap.w, h: wrap.h, scale, tx, ty };
  const mv = useRef({ x: 0, y: 0, moved: 0, tx0: 0, ty0: 0 });

  const clamp = (v, m) => Math.max(-m, Math.min(m, v));

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      mv.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, moved: 0, tx0: st.current.tx, ty0: st.current.ty };
    },
    onPanResponderMove: (e, g) => {
      mv.current.moved = Math.hypot(g.dx, g.dy);
      if (st.current.scale > 1) {
        const maxX = ((st.current.scale - 1) * st.current.w) / 2;
        const maxY = ((st.current.scale - 1) * st.current.h) / 2;
        setTx(clamp(mv.current.tx0 + g.dx, maxX));
        setTy(clamp(mv.current.ty0 + g.dy, maxY));
      }
    },
    onPanResponderRelease: () => {
      if (mv.current.moved >= 8) return;   // 끌기(이동)였으면 점 안 찍음
      const { w, h, scale: s, tx: t, ty: u } = st.current;
      if (w <= 0) return;
      const imgNx = 0.5 + (mv.current.x / w - 0.5 - t / w) / s;
      const imgNy = 0.5 + (mv.current.y / h - 0.5 - u / h) / s;
      const px = Math.max(0, Math.min(512, imgNx * 512));
      const py = Math.max(0, Math.min(512, imgNy * 512));
      setPts((prev) => (prev.length >= 2 ? [{ x: px, y: py }] : [...prev, { x: px, y: py }]));
    },
  })).current;

  const zoom = (s) => { setScale(s); setTx(0); setTy(0); };
  const len = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  // 기준 면적: 원 모드=π r²(배꼽/홍채), 길이 모드=길이²(눈 가로 폭)
  const refArea = pts.length === 2 ? (mode === 'length' ? len * len : Math.PI * (len / 2) ** 2) : 0;
  const center512 = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : null;

  // 화면 좌표(현재 확대/이동 반영)
  const screen = (p) => ({
    x: (0.5 + scale * (p.x / 512 - 0.5) + tx / (wrap.w || 1)) * wrap.w,
    y: (0.5 + scale * (p.y / 512 - 0.5) + ty / (wrap.h || 1)) * wrap.h,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle}>기준 표시</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={styles.title}>
        {mode === 'length'
          ? `양쪽 바깥 눈꼬리를 두 번 탭하세요 (좌·우) · ${pts.length}/2`
          : `「${refName}」를 원으로 감싸도록 지름 양 끝을 탭하세요 · ${pts.length}/2`}
      </Text>
      <Text style={styles.sub}>
        {mode === 'length'
          ? '양쪽 바깥 눈꼬리 사이 거리(양안 폭)를 기준으로 거리를 보정합니다 · 확대(＋)/드래그 가능'
          : `${refName}을 원으로 색칠해 그 면적을 기준으로 씁니다 · 확대(＋)/드래그 가능`}
      </Text>

      <View style={styles.imgWrap}
        onLayout={(e) => setWrap({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}>
          {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
        </View>
        {/* 기준 표시: 원(면적) 또는 선(길이) */}
        {center512 && mode !== 'length' && (() => {
          const c = screen(center512);
          const r = ((len / 2) / 512) * wrap.w * scale;
          return <View pointerEvents="none" style={[styles.circle, { left: c.x - r, top: c.y - r, width: 2 * r, height: 2 * r, borderRadius: r }]} />;
        })()}
        {pts.length === 2 && mode === 'length' && (() => {
          const a = screen(pts[0]), b = screen(pts[1]);
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          return <View pointerEvents="none" style={[styles.line, { left: mx - L / 2, top: my - 1.5, width: L, transform: [{ rotateZ: `${ang}deg` }] }]} />;
        })()}
        {/* 점은 변환 밖에서 그려 크기 일정하게 */}
        {pts.map((p, i) => {
          const s = screen(p);
          return (
            <View key={i} pointerEvents="none" style={[styles.dot, { left: s.x - 6, top: s.y - 6 }]}>
              <View style={styles.dotCore} />
            </View>
          );
        })}
        {/* 최상단 캡처 레이어(변환 없음) — 탭 좌표를 wrap 기준으로 받기 위함 */}
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
      </View>

      <View style={styles.zoomRow}>
        {[1, 2, 3].map((s) => (
          <TouchableOpacity key={s} onPress={() => zoom(s)} style={[styles.zoomBtn, scale === s && styles.zoomOn]}>
            <Text style={[styles.zoomTxt, scale === s && styles.zoomTxtOn]}>{s}×</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setPts([])} style={styles.resetBtn}>
          <Ionicons name="refresh" size={15} color={AppColors.greenMuted} />
          <Text style={styles.resetTxt}>다시</Text>
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 18 }}>
        <TouchableOpacity style={[styles.primaryBtn, pts.length < 2 && styles.primaryOff]}
          disabled={pts.length < 2} onPress={() => onConfirm(refArea)}>
          <Text style={styles.primaryTxt}>{pts.length < 2 ? `${refName} 양 끝 2점 탭` : '확인 · 측정'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: AppColors.greenDeep, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '800', color: AppColors.ink, textAlign: 'center', marginTop: 12 },
  sub: { fontSize: 12, color: AppColors.sub, textAlign: 'center', marginTop: 5 },
  imgWrap: { width: '92%', aspectRatio: 1, alignSelf: 'center', marginTop: 12,
             backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff',
         alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#E8A33D' },
  circle: { position: 'absolute', backgroundColor: 'rgba(232,163,61,0.35)', borderWidth: 2, borderColor: '#E8A33D' },
  line: { position: 'absolute', height: 3, backgroundColor: '#E8A33D', borderRadius: 2 },
  zoomRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 },
  zoomBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: AppColors.line, backgroundColor: AppColors.card },
  zoomOn: { backgroundColor: AppColors.greenTop, borderColor: AppColors.greenTop },
  zoomTxt: { color: AppColors.ink, fontSize: 13, fontWeight: '700' },
  zoomTxtOn: { color: AppColors.greenDeep },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 6 },
  resetTxt: { color: AppColors.greenMuted, fontSize: 13, fontWeight: '700' },
  primaryBtn: { backgroundColor: AppColors.greenTop, borderRadius: 20, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: AppColors.navInactive },
  primaryTxt: { color: AppColors.greenDeep, fontSize: 15, fontWeight: '800' },
});
