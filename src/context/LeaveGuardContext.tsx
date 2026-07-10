import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';

interface LeaveGuardContextValue {
  /** 저장하지 않은 결과가 있는 동안 true로 설정 */
  setGuarded: (guarded: boolean) => void;
  /** 화면 이동이 필요한 액션을 감싸서, 보호 중이면 확인창을 먼저 띄운다 */
  guardedAction: (action: () => void) => void;
}

const LeaveGuardContext = createContext<LeaveGuardContextValue | null>(null);

export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const guardedRef = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(false);

  const setGuarded = useCallback((guarded: boolean) => {
    guardedRef.current = guarded;
  }, []);

  const guardedAction = useCallback((action: () => void) => {
    if (guardedRef.current) {
      pendingAction.current = action;
      setVisible(true);
    } else {
      action();
    }
  }, []);

  const confirmLeave = () => {
    setVisible(false);
    guardedRef.current = false;
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };

  const cancelLeave = () => {
    setVisible(false);
    pendingAction.current = null;
  };

  return (
    <LeaveGuardContext.Provider value={{ setGuarded, guardedAction }}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={cancelLeave}>
        <View style={styles.backdrop}>
          <View style={[cardDecoration(24), styles.card]}>
            <View style={styles.iconCircle}>
              <MaterialIcons name="error-outline" size={28} color={AppColors.sev2} />
            </View>
            <View style={{ height: 14 }} />
            <Text style={styles.title}>지금 나가시면 저장되지 않습니다.</Text>
            <View style={{ height: 4 }} />
            <Text style={styles.subtitle}>그래도 나가실건가요?</Text>
            <View style={{ height: 22 }} />
            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.btnNo]} onPress={cancelLeave}>
                <Text style={styles.btnNoText}>아니오</Text>
              </Pressable>
              <View style={{ width: 10 }} />
              <Pressable style={[styles.btn, styles.btnYes]} onPress={confirmLeave}>
                <Text style={styles.btnYesText}>네</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </LeaveGuardContext.Provider>
  );
}

export function useLeaveGuard(): LeaveGuardContextValue {
  const ctx = useContext(LeaveGuardContext);
  if (!ctx) throw new Error('useLeaveGuard must be used within a LeaveGuardProvider');
  return ctx;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,23,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  card: { backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center', alignSelf: 'stretch' },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFF6E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '700', color: AppColors.ink, textAlign: 'center' },
  subtitle: { fontSize: 13, color: AppColors.sub, textAlign: 'center' },
  row: { flexDirection: 'row', alignSelf: 'stretch' },
  btn: { flex: 1, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  btnNo: { backgroundColor: '#F1F3F6' },
  btnYes: { backgroundColor: AppColors.sev3 },
  btnNoText: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  btnYesText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
