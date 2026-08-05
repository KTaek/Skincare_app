module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4: the worklets plugin must stay last in this list.
    plugins: ['react-native-worklets/plugin'],
  };
};
