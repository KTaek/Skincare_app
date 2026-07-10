import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppColors, cardDecoration } from '../theme';
import { Hospital, seedHospitals } from '../models';

export default function HospitalScreen() {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}
    >
      <Text style={styles.title}>주변 병원 찾기</Text>
      <View style={{ height: 4 }} />
      <Text style={styles.subtitle}>현재 위치 기준 가까운 피부과를 찾았어요</Text>
      <View style={{ height: 16 }} />

      <MapMock />
      <View style={{ height: 14 }} />

      {seedHospitals.map((h, i) => (
        <HospitalCard key={h.name} index={i} hospital={h} />
      ))}
    </ScrollView>
  );
}

// GPS + 실제 지도 SDK가 들어갈 자리 (현재는 목업)
function MapMock() {
  return (
    <View style={styles.mapShadow}>
      <LinearGradient
        colors={['#DDE5EC', '#EEF2F6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.map}
      >
        <MaterialIcons name="location-on" size={28} color={AppColors.sev3} style={{ position: 'absolute', left: 90, top: 70 }} />
        <MaterialIcons name="location-on" size={28} color={AppColors.sev3} style={{ position: 'absolute', left: 200, top: 55 }} />
        <MaterialIcons name="location-on" size={28} color={AppColors.sev3} style={{ position: 'absolute', left: 230, top: 130 }} />
        <MaterialIcons name="circle" size={18} color="#2F80ED" style={{ position: 'absolute', left: 150, top: 120 }} />
        <View style={styles.myLocation}>
          <MaterialIcons name="my-location" size={20} color="#2F80ED" />
        </View>
      </LinearGradient>
    </View>
  );
}

function HospitalCard({ index, hospital }: { index: number; hospital: Hospital }) {
  return (
    <View style={[cardDecoration(), styles.card]}>
      <View style={styles.rank}>
        <Text style={styles.rankText}>{index + 1}</Text>
      </View>
      <View style={{ width: 13 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{hospital.name}</Text>
        <View style={{ height: 4 }} />
        <Text style={styles.addr}>{hospital.addr}</Text>
        <View style={{ height: 7 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.rating}>★ {hospital.rating}</Text>
          <Text style={styles.metaSep}>  ·  </Text>
          <Text style={styles.meta}>{hospital.dist}</Text>
          <Text style={styles.metaSep}>  ·  </Text>
          <Text style={styles.meta}>{hospital.open}</Text>
        </View>
        <View style={{ height: 11 }} />
        <View style={{ flexDirection: 'row' }}>
          <Action label="전화" bg="#EDF0F4" fg="#444444" />
          <View style={{ width: 8 }} />
          <Action label="길찾기" bg={AppColors.greenTop} fg="#16320A" />
        </View>
      </View>
    </View>
  );
}

function Action({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <Pressable style={[styles.action, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: fg }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  mapShadow: {
    borderRadius: 20,
    shadowColor: '#1E283C',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  map: { height: 230, borderRadius: 20, overflow: 'hidden' },
  myLocation: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  card: { flexDirection: 'row', marginBottom: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16 },
  rank: { width: 30, height: 30, marginTop: 2, borderRadius: 10, backgroundColor: AppColors.bg, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, fontWeight: '800', color: AppColors.greenMuted },
  name: { fontSize: 16, fontWeight: '700', color: AppColors.ink },
  addr: { fontSize: 12.5, color: AppColors.sub },
  rating: { fontSize: 12.5, fontWeight: '700', color: AppColors.sev2 },
  meta: { fontSize: 12.5, color: '#666666' },
  metaSep: { fontSize: 12.5, color: '#666666' },
  action: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
});
