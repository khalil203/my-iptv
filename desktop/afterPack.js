// Ad-hoc sign the Mac app so it opens on Apple Silicon Macs (no paid Apple account needed).
const { execSync } = require('child_process');
exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = `${ctx.appOutDir}/${ctx.packager.appInfo.productFilename}.app`;
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
};
