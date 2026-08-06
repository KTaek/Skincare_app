module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4: react-native-worklets/plugin must stay LAST in this list.
    plugins: ['react-native-worklets/plugin'],
  };
};
