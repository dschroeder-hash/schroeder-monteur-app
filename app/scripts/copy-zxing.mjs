// Copies the zxing WebAssembly reader into public/ so barcode scanning works offline (no CDN, E-18).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// package.json is not exported; resolve the package directory via node_modules of this app.
const pkg = new URL('../node_modules/zxing-wasm/', import.meta.url).pathname;
const out = new URL('../public/zxing/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
copyFileSync(join(pkg, 'dist/reader/zxing_reader.wasm'), join(out, 'zxing_reader.wasm'));
