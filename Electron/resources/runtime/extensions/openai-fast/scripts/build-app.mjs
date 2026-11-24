import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('../app/control-source.js',import.meta.url))],
  outfile:fileURLToPath(new URL('../app/control.js',import.meta.url)),bundle:true,format:'esm',target:'es2020',logLevel:'warning'});
