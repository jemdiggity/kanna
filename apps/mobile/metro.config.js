const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const appPackage = require("./package.json");
const appRequire = createRequire(path.join(__dirname, "package.json"));
const config = getDefaultConfig(__dirname);
const expoOwnedModules = [
  "expo-asset",
  "expo-constants",
  "expo-modules-core"
];
const appOwnedModules = Array.from(
  new Set([
    ...Object.keys(appPackage.dependencies ?? {}),
    "@babel/runtime",
    ...expoOwnedModules
  ])
);

function packageRoot(moduleName) {
  return fs.realpathSync(path.dirname(appRequire.resolve(`${moduleName}/package.json`)));
}

function pnpmLinksRoot(packagePath) {
  const match = packagePath.match(/^(.*\/store\/v\d+\/links)(?:\/|$)/);
  return match ? match[1] : null;
}

const packageRoots = Object.fromEntries(
  appOwnedModules.map((moduleName) => [moduleName, packageRoot(moduleName)])
);
const babelRuntimeRoot = packageRoots["@babel/runtime"];
const pnpmStoreLinksRoot = pnpmLinksRoot(babelRuntimeRoot);

const extraNodeModules = Object.fromEntries(
  expoOwnedModules.map((moduleName) => [
    moduleName,
    path.join(__dirname, "node_modules", moduleName)
  ])
);

config.transformer.minifierPath = require.resolve("metro-minify-terser");
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@babel/runtime": babelRuntimeRoot,
  ...extraNodeModules
};
config.resolver.unstable_enableSymlinks = true;
config.watchFolders = Array.from(
  new Set([
    ...(config.watchFolders ?? []),
    ...Object.values(packageRoots),
    ...(pnpmStoreLinksRoot ? [pnpmStoreLinksRoot] : [])
  ])
);

const defaultResolveRequest = config.resolver.resolveRequest;

function resolveBabelRuntime(moduleName) {
  const prefix = "@babel/runtime/";
  if (!moduleName.startsWith(prefix)) {
    return null;
  }

  const runtimePath = path.join(babelRuntimeRoot, `${moduleName.slice(prefix.length)}.js`);
  if (!fs.existsSync(runtimePath)) {
    return null;
  }

  return {
    type: "sourceFile",
    filePath: runtimePath
  };
}

function resolveAppOwnedModule(moduleName) {
  const packageName = moduleName.startsWith("@")
    ? moduleName.split("/").slice(0, 2).join("/")
    : moduleName.split("/")[0];
  if (!appOwnedModules.includes(packageName)) {
    return null;
  }

  try {
    return {
      type: "sourceFile",
      filePath: appRequire.resolve(moduleName)
    };
  } catch {
    return null;
  }
}

function resolveNodeModuleFromOrigin(context, moduleName) {
  if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
    return null;
  }

  const originModulePath = context.originModulePath;
  if (typeof originModulePath !== "string" || !originModulePath) {
    return null;
  }

  try {
    return {
      type: "sourceFile",
      filePath: fs.realpathSync(createRequire(originModulePath).resolve(moduleName))
    };
  } catch {
    return null;
  }
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const babelRuntimeResolution = resolveBabelRuntime(moduleName);
  if (babelRuntimeResolution) {
    return babelRuntimeResolution;
  }

  const appOwnedModuleResolution = resolveAppOwnedModule(moduleName);
  if (appOwnedModuleResolution) {
    return appOwnedModuleResolution;
  }

  const originModuleResolution = resolveNodeModuleFromOrigin(context, moduleName);
  if (originModuleResolution) {
    return originModuleResolution;
  }

  const resolveRequest = defaultResolveRequest ?? context.resolveRequest;
  return resolveRequest(context, moduleName, platform);
};

module.exports = config;
