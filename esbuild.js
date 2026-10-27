const esbuild = require('esbuild');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const clientConfig = {
  entryPoints: ['src/client/extension.ts'],
  bundle: true,
  outfile: 'dist/client.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info'
};

/** @type {esbuild.BuildOptions} */
const serverConfig = {
  entryPoints: ['src/server/server.ts'],
  bundle: true,
  outfile: 'dist/server.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info'
};

async function build() {
  if (isWatch) {
    const clientCtx = await esbuild.context(clientConfig);
    const serverCtx = await esbuild.context(serverConfig);
    await clientCtx.watch();
    await serverCtx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(clientConfig);
    await esbuild.build(serverConfig);
    console.log('Build completed successfully.');
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
