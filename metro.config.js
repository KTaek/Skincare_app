const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('tflite');

// react-native-fast-tflite is a native-only (Nitro Modules) library with no
// web target. On the web platform, redirect it to a lightweight stub so
// Metro doesn't drag in react-native's internal native-component registry
// (see web-stubs/react-native-fast-tflite.web.js for why that crashes).
const { resolveRequest: defaultResolveRequest } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  if (platform === 'web' && moduleName === 'react-native-fast-tflite') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'web-stubs/react-native-fast-tflite.web.js'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform, ...rest)
    : context.resolveRequest(context, moduleName, platform, ...rest);
};

module.exports = config;
