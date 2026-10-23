// Puts the staged server (stage-server.mjs) in the app's Resources/server. A hook, because electron-builder
// leaves node_modules out of extraResources.
const { cpSync } = require('node:fs');
const path = require('node:path');

exports.default = ({ appOutDir, packager }) => {
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'server');
  cpSync(path.join(__dirname, 'build', 'server'), app, { recursive: true, verbatimSymlinks: true });
};
