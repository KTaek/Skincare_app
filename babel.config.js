module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated v4 — 반드시 plugins 마지막에 위치
    plugins: ['react-native-worklets/plugin'],
  };
};
