import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RoutineProvider } from './src/context/RoutineContext';
import { RecordsProvider } from './src/context/RecordsContext';
import { LeaveGuardProvider } from './src/context/LeaveGuardContext';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <RoutineProvider>
        <RecordsProvider>
          <LeaveGuardProvider>
            <NavigationContainer>
              <StatusBar style="dark" />
              <RootNavigator />
            </NavigationContainer>
          </LeaveGuardProvider>
        </RecordsProvider>
      </RoutineProvider>
    </SafeAreaProvider>
  );
}
