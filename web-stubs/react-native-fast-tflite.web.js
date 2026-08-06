// Web-only stub for react-native-fast-tflite.
//
// This library is built on react-native-nitro-modules, a native (JSI/Nitro)
// bridge with no browser target. Bundling it for web makes Metro pull in
// react-native's internal NativeComponentRegistry via a deep, un-aliased
// path, which crashes the whole app on load ("importing a module from
// 'react-native' instead of 'react-native-web'").
//
// On-device TFLite inference isn't available in a browser anyway, so on web
// we swap in this stub: it resolves the same shape (loadTensorflowModel ->
// { run() }) but rejects when actually used. Screens that call into it
// (CameraScreen, MonitorCaptureScreen) already catch these errors and show
// a friendly failure state instead of crashing.
export function loadTensorflowModel() {
  return Promise.reject(
    new Error('TFLite 모델 추론은 웹 미리보기에서 지원되지 않습니다 (기기 전용 기능).')
  );
}
