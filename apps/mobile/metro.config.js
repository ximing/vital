const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const rootReact = path.resolve(monorepoRoot, 'node_modules/react');

const config = getDefaultConfig(projectRoot);
// api-client / dto / markdown / tokens export ESM dist — need package exports.
config.resolver.unstable_enablePackageExports = true;
config.watchFolders = [monorepoRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  react: rootReact,
};

module.exports = config;
