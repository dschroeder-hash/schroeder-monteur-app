import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildThemeCss } from './css.js';

const target = fileURLToPath(new URL('./theme.css', import.meta.url));
writeFileSync(target, buildThemeCss());
console.log(`wrote ${target}`);
