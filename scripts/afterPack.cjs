/**
 * electron-builder afterPack hook.
 * ה-file matcher של electron-builder מסנן תיקיות node_modules גם ב-extraResources —
 * מה ששבר את npm המצורף (npm.cmd נארז בלי npm עצמו). מעתיקים אותו ידנית.
 */
const { cpSync, existsSync } = require('fs')
const { join } = require('path')

exports.default = async function afterPack(context) {
  const src = join(context.packager.projectDir, 'resources', 'runtime', 'node_modules')
  const dest = join(context.appOutDir, 'resources', 'runtime', 'node_modules')
  if (!existsSync(src)) return
  cpSync(src, dest, { recursive: true })
  console.log('  • afterPack: copied bundled runtime node_modules (npm) into package')
}
