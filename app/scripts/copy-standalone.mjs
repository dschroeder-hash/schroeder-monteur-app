// next build (output: standalone) does not copy static assets; the standalone server needs them next to it.
import { cpSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const target = `${root}.next/standalone/app`;
if (existsSync(target)) {
  cpSync(`${root}.next/static`, `${target}/.next/static`, { recursive: true });
  cpSync(`${root}public`, `${target}/public`, { recursive: true });
}
