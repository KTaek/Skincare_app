// 면적추적을 전체화면 Modal로 띄우는 프로바이더 (react-navigation 스택 불필요).
import React, { createContext, useContext, useState } from 'react';
import { Modal } from 'react-native';
import TrackingRoot from './TrackingRoot';

const Ctx = createContext({ open: () => {} });
export const useTracking = () => useContext(Ctx);

export function TrackingModalProvider({ children }) {
  const [visible, setVisible] = useState(false);
  return (
    <Ctx.Provider value={{ open: () => setVisible(true) }}>
      {children}
      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <TrackingRoot onExit={() => setVisible(false)} />
      </Modal>
    </Ctx.Provider>
  );
}
