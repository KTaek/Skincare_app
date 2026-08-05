// 안드로이드 largeHeap 활성화 — 대용량 온디바이스 모델(TFLite) 로딩용 힙 확대
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$ = app.$ || {};
      app.$['android:largeHeap'] = 'true';
    }
    return cfg;
  });
};
