# 피부 케어 (Skin Care App) — React Native

Flutter UI 프로토타입을 React Native(Expo SDK 56 / TypeScript)로 1:1 포팅한 버전입니다.
원본과 동일하게 카메라·지도·서버는 목업이며 네이티브 의존성이 없습니다.

## 실행 방법

가장 확실한 방법은 깨끗한 Expo 앱을 만들고 `src/`와 설정 파일을 덮어쓰는 것입니다.
네이티브 패키지 버전이 SDK와 자동 정렬됩니다.

```bash
# 1) 의존성 설치 (버전 정렬을 위해 npx expo install 권장)
npx expo install \
  expo-linear-gradient expo-status-bar \
  react-native-safe-area-context react-native-screens \
  @react-navigation/native @react-navigation/bottom-tabs \
  @react-native-community/datetimepicker @expo/vector-icons

npm install

# 2) 개발 서버 실행
npx expo start
```

그런 다음 Expo Go 앱(또는 개발 빌드/시뮬레이터)에서 QR로 실행하세요.

> package.json의 버전은 Expo SDK 56 기준입니다. 설치 시 경고가 나오면
> `npx expo install --fix` 로 SDK에 맞춰 정렬하면 됩니다.

## 구조

```
App.tsx                      앱 진입점 (Provider + NavigationContainer)
src/
  theme.ts                   디자인 토큰 (← theme.dart)
  models.ts                  타입 + 시드 데이터 (← models.dart)
  context/RoutineContext.tsx 루틴 공유 상태 (← RootScaffold의 state 분리)
  components/widgets.tsx      SectionHeader / RoutineRow / SevBadge (← widgets.dart)
  navigation/
    RootNavigator.tsx        하단 탭 네비게이터 (← RootScaffold)
    BottomNav.tsx            커스텀 탭바 (← _BottomNav)
  screens/
    HomeScreen.tsx           (← home_screen.dart)
    RecordsScreen.tsx        (← records_screen.dart, 달력)
    CameraScreen.tsx         (← camera_screen.dart)
    RoutineScreen.tsx        (← routine_screen.dart)
    HospitalScreen.tsx       (← hospital_screen.dart)
```

## Flutter → RN 매핑 메모

- 상태 관리: `RootScaffold`가 prop으로 내려주던 루틴 상태를 `RoutineContext`로 분리.
  홈/루틴 화면이 같은 소스를 구독하므로 동기화가 자동입니다.
- 탭 전환: `IndexedStack` + 커스텀 `_BottomNav` → React Navigation 하단 탭 +
  커스텀 `tabBar`. `lazy:false`로 모든 화면을 처음부터 마운트해 상태를 보존합니다.
- 카메라 초기화: `_camKey.currentState?.reset()` → `useFocusEffect`로 포커스 시 초기화.
- 완료 페이드: `AnimatedOpacity` → `Animated.timing` (1초). 1초 뒤 홈 목록에서 제거.
- 그림자: Flutter `BoxShadow` → iOS `shadow*` + Android `elevation`.
- 그라데이션: `LinearGradient` → `expo-linear-gradient`.
- 시각 선택: `showTimePicker` → `@react-native-community/datetimepicker`.
- 아이콘: Material 아이콘 → `@expo/vector-icons`의 `MaterialIcons`.

## 다음 단계 (실제 연동 시)

- 카메라: `expo-camera`의 `CameraView`로 교체, 촬영 이미지를 서버로 전송.
- 지도: `react-native-maps` 또는 카카오/네이버 지도 SDK로 목업 교체 + 위치 권한.
- 영속화: 루틴/기록을 `@react-native-async-storage/async-storage`나 서버 API로 저장.
