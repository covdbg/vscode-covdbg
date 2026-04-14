const esbuild = require('esbuild');
const fs = require('fs/promises');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'out');
const watchMode = process.argv.includes('--watch');

async function copyFile(source, target) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
}

const copyAssetsPlugin = {
    name: 'copy-assets',
    setup(build) {
        build.onStart(async () => {
            await copyFile(
                path.join(rootDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
                path.join(outDir, 'sql-wasm.wasm'),
            );
        });
    },
};

const buildOptions = {
    entryPoints: [path.join(rootDir, 'src', 'extension.ts')],
    bundle: true,
    outfile: path.join(outDir, 'extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
    sourcesContent: false,
    logLevel: 'info',
    plugins: [copyAssetsPlugin],
};

async function main() {
    if (watchMode) {
        const context = await esbuild.context(buildOptions);
        await context.watch();
        console.log('esbuild watching extension bundle...');
        return;
    }

    await esbuild.build(buildOptions);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
