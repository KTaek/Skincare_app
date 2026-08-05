// .tflite 모델을 앱 번들에 에셋으로 포함시키기 위한 Metro 설정
// (react-native-fast-tflite 로 require('../assets/xxx.tflite') 하려면 필요)
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite');

module.exports = config;
