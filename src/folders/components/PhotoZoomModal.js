/**
 * 사진 확대 보기 — 어두운 배경 위에 크게 띄우는 톤을 쓴다.
 * 좌우로 넘기면 "사진" ↔ "증상 부위 표시" 두 페이지를 전환한다.
 * 상세 결과 화면에서 원본/오버레이 썸네일을 나란히 두고 각각 탭하면, 탭한 쪽 페이지가 바로
 * 보이도록 initialPage로 열 페이지를 지정할 수 있다(기본은 0=사진).
 *
 * RN의 <Modal>은 쓰지 않는다 — 웹 미리보기는 브라우저 창 전체가 아니라 그 안의 폰 프레임
 * (App.js의 WebPhoneFrame, 402×874)만큼만 실제로 보이는데, react-native-web의 Modal은 그 프레임
 * 밖(document.body)에 그려지고 크기도 Dimensions.get('window')(브라우저 전체 크기)를 기준으로
 * 잡아서, 사진이 폰 프레임보다 훨씬 크게 계산되어 화면 밖으로 넘쳤다. 그 대신 화면 트리 안에서
 * 절대 위치(absoluteFill)로 덮는 일반 View를 쓰고, 크기도 onLayout으로 "이 컴포넌트가 실제로
 * 차지한 박스"를 직접 실측해 쓴다 — 그러면 폰 프레임이든 실기기 전체화면이든 항상 실제 보이는
 * 영역에 정확히 맞는다.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import LesionThumb from './LesionThumb';

const PAGES = [
  { mode: 'photo', label: '사진' },
  // "윤곽만"이 아니다 — 분석이 합성한 실제 마스크(반투명 면 + 테두리)를 그대로 보여준다
  { mode: 'overlay', label: '증상 부위 표시' },
];

const PAGE_PADDING = 64; // 사진 좌우/상하 여백 — 이만큼을 뺀 정사각형으로 사진을 보여준다

export default function PhotoZoomModal({ visible, record, initialPage = 0, onClose, overlay = null }) {
  const [page, setPage] = useState(initialPage);
  // 화면(window) 전체 크기가 아니라, 이 컴포넌트가 실제로 차지하는 박스 크기를 직접 실측한다.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const scrollRef = useRef(null);

  // 열릴 때마다(그리고 박스 크기를 처음 측정했을 때) 요청받은 페이지로 스크롤 위치를 맞춘다
  useEffect(() => {
    if (visible && box.width > 0) {
      setPage(initialPage);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: initialPage * box.width, animated: false });
      });
    }
  }, [visible, initialPage, box.width]);

  if (!visible || !record) return null;

  const handleClose = () => { setPage(0); onClose(); };
  const onMomentumEnd = (e) => {
    if (!box.width) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / box.width);
    setPage(idx);
  };

  // 사진은 정사각형 박스로 보여준다(LesionThumb과 같은 규칙) — 가로·세로 중 더 좁은 쪽을
  // 기준으로 크기를 정해야 화면 폭뿐 아니라 높이도 넘치지 않는다.
  const photoSize = Math.max(0, Math.min(box.width, box.height) - PAGE_PADDING);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />

        {box.width > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            style={{ flexGrow: 0, width: box.width }}
          >
            {PAGES.map((p) => (
              <View key={p.mode} style={[styles.page, { width: box.width }]}>
                <View style={styles.imgWrap} pointerEvents="none">
                  <LesionThumb photo={record.photo} overlay={overlay} mode={p.mode} size={photoSize} />
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.dots} pointerEvents="none">
          {PAGES.map((p, i) => (
            <View key={p.mode} style={[styles.dot, page === i && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.caption} pointerEvents="none">
          <Text style={styles.captionText}>{PAGES[page].label}</Text>
          <Text style={styles.captionHint}>
            {page === 0 ? '오른쪽으로 넘기면 증상 부위 표시를 볼 수 있어요' : '화면을 탭하면 닫힙니다'}
          </Text>
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  page: { justifyContent: 'center', alignItems: 'center' },
  imgWrap: { borderRadius: 20, overflow: 'hidden' },
  dots: { flexDirection: 'row', gap: 6, position: 'absolute', bottom: 96 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },
  caption: { position: 'absolute', bottom: 48, alignItems: 'center', paddingHorizontal: 24 },
  captionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  captionHint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4, textAlign: 'center' },
  closeBtn: {
    position: 'absolute', top: 48, right: 24,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 18 },
});
