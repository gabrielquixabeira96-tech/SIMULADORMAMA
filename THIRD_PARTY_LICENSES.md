# Licenças de terceiros

Gerado por `scripts/licencas.sh` em 2026-09-26T18:58:11Z para a versão 0.0.1. Política: ADR 0009 (`docs/adr/0009-licencas.md`). O script falha se alguma dependência instalada tiver licença fora da lista abaixo.

## Permitidas

MIT, MIT-0, BSD-2/3-Clause, Apache-2.0, ISC, 0BSD, Zlib, PostgreSQL, Python-2.0/PSF-2.0, MIT-CMU (HPND), BlueOak-1.0.0, Unlicense, MPL-2.0 (arquivo separado, sem modificação), CC0-1.0 / CC-BY-4.0 (dados/assets, com atribuição). Expressões AND/OR só se todos os termos forem permitidos.

## Proibidas (nunca presentes)

RBSM, iRBSM, liRBSM; SMPL, SMPL-X e topologias derivadas; Depth Anything 2 Base/Large; Depth Anything 3 Giant/Large/Nested; FLUX dev; VGGT original; SAM 3D Body ("SAM License"); `pymeshlab` (GPL-3); `gdist` (LGPL); `sharp`/libvips (LGPL-3.0, removido por override no `pnpm-workspace.yaml`); qualquer GPL/LGPL/AGPL/SSPL/BUSL/CC-NC/"research only".

## Node (apps/web, packages/*) — instaladas

Diretas de runtime: next/@next/env, react/react-dom, three, @react-three/fiber, @react-three/drei, zod, pg, fflate (todas MIT). Dev: typescript (Apache-2.0), eslint + eslint-config-next, vitest, msw, jsdom, @testing-library/* (MIT), @playwright/test (Apache-2.0; Chromium 1194 pré-instalado, fora do repositório). `sharp` (dependência opcional do `next`, com `@img/sharp-libvips-*` LGPL-3.0) é removido por `overrides: { sharp: "-" }` no `pnpm-workspace.yaml`; o app não usa `next/image`. Atribuições: `caniuse-lite` (CC-BY-4.0, Alexis Deveria/caniuse.com, dados de navegadores usados no build); `axe-core` (MPL-2.0, dev, sem modificação).

_Gerado de `pnpm licenses list`: 536 pacotes (MIT 458 · Apache-2.0 28 · ISC 24 · BSD-2-Clause 9 · BSD-3-Clause 4 · BlueOak-1.0.0 2 · CC0-1.0 2 · MIT-0 2 · (MIT AND Zlib) 1 · (MIT OR CC0-1.0) 1 · 0BSD 1 · CC-BY-4.0 1 · MPL-2.0 1 · Python-2.0 1 · Unlicense 1)._

| Pacote | Versão | Licença |
|---|---|---|
| @acemir/cssom | 0.9.31 | MIT |
| @anthropic-ai/sdk | 0.128.0 | MIT |
| @asamuzakjp/css-color | 4.1.2 | MIT |
| @asamuzakjp/dom-selector | 6.8.1 | MIT |
| @asamuzakjp/nwsapi | 2.3.9 | MIT |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.8 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.7 | MIT |
| @babel/parser | 7.29.9 | MIT |
| @babel/runtime | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.8 | MIT |
| @babel/types | 7.29.8 | MIT |
| @csstools/color-helpers | 6.1.2 | MIT-0 |
| @csstools/css-calc | 3.4.1 | MIT |
| @csstools/css-color-parser | 4.2.4 | MIT |
| @csstools/css-parser-algorithms | 4.0.1 | MIT |
| @csstools/css-syntax-patches-for-csstree | 1.1.14 | MIT-0 |
| @csstools/css-tokenizer | 4.0.2 | MIT |
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 |
| @esbuild/linux-x64 | 0.28.2 | MIT |
| @eslint-community/eslint-utils | 4.9.1, 4.10.1 | MIT |
| @eslint-community/regexpp | 4.12.2 | MIT |
| @eslint/config-array | 0.21.2 | Apache-2.0 |
| @eslint/config-helpers | 0.4.2 | Apache-2.0 |
| @eslint/core | 0.17.0 | Apache-2.0 |
| @eslint/eslintrc | 3.3.7 | MIT |
| @eslint/js | 9.39.5 | MIT |
| @eslint/object-schema | 2.1.7 | Apache-2.0 |
| @eslint/plugin-kit | 0.4.1 | Apache-2.0 |
| @exodus/bytes | 1.16.0 | MIT |
| @humanfs/core | 0.19.2 | Apache-2.0 |
| @humanfs/node | 0.16.8 | Apache-2.0 |
| @humanfs/types | 0.15.0 | Apache-2.0 |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 |
| @inquirer/ansi | 2.0.8 | MIT |
| @inquirer/confirm | 6.3.2 | MIT |
| @inquirer/core | 12.0.3 | MIT |
| @inquirer/figures | 2.0.9 | MIT |
| @inquirer/type | 4.1.1 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @mediapipe/tasks-vision | 0.10.17 | Apache-2.0 |
| @monogrid/gainmap-js | 3.4.0 | MIT |
| @mswjs/interceptors | 0.41.9 | MIT |
| @napi-rs/canvas | 1.0.9 | MIT |
| @napi-rs/canvas-linux-x64-gnu | 1.0.9 | MIT |
| @napi-rs/canvas-linux-x64-musl | 1.0.9 | MIT |
| @napi-rs/lzma-linux-x64-gnu | 1.5.1 | MIT |
| @next/env | 16.3.6 | MIT |
| @next/eslint-plugin-next | 16.3.6 | MIT |
| @next/swc-linux-x64-gnu | 16.3.6 | MIT |
| @next/swc-linux-x64-musl | 16.3.6 | MIT |
| @nodelib/fs.scandir | 2.1.5 | MIT |
| @nodelib/fs.stat | 2.0.5 | MIT |
| @nodelib/fs.walk | 1.2.8 | MIT |
| @nolyfill/is-core-module | 1.0.39 | MIT |
| @open-draft/deferred-promise | 2.2.0, 3.0.0 | MIT |
| @open-draft/logger | 0.3.0 | MIT |
| @open-draft/until | 2.1.0 | MIT |
| @pdf-lib/standard-fonts | 1.0.0 | MIT |
| @pdf-lib/upng | 1.0.1 | MIT |
| @playwright/test | 1.56.1 | Apache-2.0 |
| @react-three/drei | 10.7.9 | MIT |
| @react-three/fiber | 9.8.1 | MIT |
| @rollup/rollup-linux-x64-gnu | 4.63.5 | MIT |
| @rollup/rollup-linux-x64-musl | 4.63.5 | MIT |
| @rtsao/scc | 1.1.0 | MIT |
| @stablelib/base64 | 1.0.1 | MIT |
| @swc/helpers | 0.5.23 | Apache-2.0 |
| @testing-library/dom | 10.4.2 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @tweenjs/tween.js | 23.1.3 | MIT |
| @types/aria-query | 5.0.4 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/draco3d | 1.4.10 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/json-schema | 7.0.15 | MIT |
| @types/json5 | 0.0.29 | MIT |
| @types/node | 22.20.4 | MIT |
| @types/offscreencanvas | 2019.7.3 | MIT |
| @types/pg | 8.23.1 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/react-reconciler | 0.28.9 | MIT |
| @types/set-cookie-parser | 2.4.10 | MIT |
| @types/stats.js | 0.17.4 | MIT |
| @types/statuses | 2.0.6 | MIT |
| @types/three | 0.186.0 | MIT |
| @types/webxr | 0.5.24 | MIT |
| @typescript-eslint/eslint-plugin | 8.70.1 | MIT |
| @typescript-eslint/parser | 8.70.1 | MIT |
| @typescript-eslint/project-service | 8.70.1 | MIT |
| @typescript-eslint/scope-manager | 8.70.1 | MIT |
| @typescript-eslint/tsconfig-utils | 8.70.1 | MIT |
| @typescript-eslint/type-utils | 8.70.1 | MIT |
| @typescript-eslint/types | 8.70.1 | MIT |
| @typescript-eslint/typescript-estree | 8.70.1 | MIT |
| @typescript-eslint/utils | 8.70.1 | MIT |
| @typescript-eslint/visitor-keys | 8.70.1 | MIT |
| @unrs/resolver-binding-linux-x64-gnu | 1.12.2 | MIT |
| @unrs/resolver-binding-linux-x64-musl | 1.12.2 | MIT |
| @use-gesture/core | 10.3.1 | MIT |
| @use-gesture/react | 10.3.1 | MIT |
| @vitest/expect | 3.2.7 | MIT |
| @vitest/mocker | 3.2.7 | MIT |
| @vitest/pretty-format | 3.2.7 | MIT |
| @vitest/runner | 3.2.7 | MIT |
| @vitest/snapshot | 3.2.7 | MIT |
| @vitest/spy | 3.2.7 | MIT |
| @vitest/utils | 3.2.7 | MIT |
| acorn | 8.18.0 | MIT |
| acorn-jsx | 5.3.2 | MIT |
| agent-base | 7.1.4 | MIT |
| ajv | 6.15.0 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0, 5.2.0 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| aria-query | 5.3.0, 5.3.2 | Apache-2.0 |
| array-buffer-byte-length | 1.0.2 | MIT |
| array-includes | 3.2.0 | MIT |
| array.prototype.findlast | 1.2.5 | MIT |
| array.prototype.findlastindex | 1.2.6 | MIT |
| array.prototype.flat | 1.3.3 | MIT |
| array.prototype.flatmap | 1.3.3 | MIT |
| array.prototype.tosorted | 1.1.4 | MIT |
| arraybuffer.prototype.slice | 1.0.4 | MIT |
| assertion-error | 2.0.1 | MIT |
| ast-types-flow | 0.0.8 | MIT |
| async-function | 1.0.0 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| axe-core | 4.13.0 | MPL-2.0 |
| axobject-query | 4.1.0 | Apache-2.0 |
| balanced-match | 1.0.2, 4.0.4 | MIT |
| base64-js | 1.5.1 | MIT |
| baseline-browser-mapping | 2.11.26 | Apache-2.0 |
| bidi-js | 1.1.0 | MIT |
| brace-expansion | 1.1.21, 5.0.12 | MIT |
| braces | 3.0.3 | MIT |
| browserslist | 4.29.1 | MIT |
| buffer | 6.0.3 | MIT |
| cac | 6.7.14 | MIT |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| callsites | 3.1.0 | MIT |
| camera-controls | 3.1.2 | MIT |
| caniuse-lite | 1.0.30001812 | CC-BY-4.0 |
| chai | 5.3.3 | MIT |
| chalk | 4.1.2 | MIT |
| check-error | 2.1.3 | MIT |
| cli-width | 4.1.0 | ISC |
| client-only | 0.0.1 | MIT |
| cliui | 8.0.1 | ISC |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| concat-map | 0.0.1 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cookie | 1.1.1 | MIT |
| cross-env | 7.0.3 | MIT |
| cross-spawn | 7.0.6 | MIT |
| css-tree | 3.2.1 | MIT |
| cssstyle | 5.3.7 | MIT |
| csstype | 3.2.3 | MIT |
| damerau-levenshtein | 1.0.8 | BSD-2-Clause |
| data-urls | 6.0.1 | MIT |
| data-view-buffer | 1.0.2 | MIT |
| data-view-byte-length | 1.0.2 | MIT |
| data-view-byte-offset | 1.0.1 | MIT |
| debug | 3.2.7, 4.4.3 | MIT |
| decimal.js | 10.6.0 | MIT |
| deep-eql | 5.0.2 | MIT |
| deep-is | 0.1.4 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| dequal | 2.0.3 | MIT |
| detect-gpu | 5.0.70 | MIT |
| doctrine | 2.1.0 | Apache-2.0 |
| dom-accessibility-api | 0.5.16 | MIT |
| draco3d | 1.5.7 | Apache-2.0 |
| dunder-proto | 1.0.1 | MIT |
| electron-to-chromium | 1.5.439 | ISC |
| emoji-regex | 8.0.0, 9.2.2 | MIT |
| entities | 8.1.0 | BSD-2-Clause |
| es-abstract | 1.24.2 | MIT |
| es-abstract-get | 1.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-iterator-helpers | 1.4.0 | MIT |
| es-module-lexer | 1.7.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es-shim-unscopables | 1.1.0 | MIT |
| es-to-primitive | 1.3.4 | MIT |
| esbuild | 0.28.2 | MIT |
| escalade | 3.2.0 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-config-next | 16.3.6 | MIT |
| eslint-import-resolver-node | 0.3.10 | MIT |
| eslint-import-resolver-typescript | 3.10.1 | ISC |
| eslint-module-utils | 2.14.0 | MIT |
| eslint-plugin-import | 2.32.0 | MIT |
| eslint-plugin-jsx-a11y | 6.10.2 | MIT |
| eslint-plugin-react | 7.37.5 | MIT |
| eslint-plugin-react-hooks | 7.1.1 | MIT |
| eslint-scope | 8.4.0 | BSD-2-Clause |
| eslint-visitor-keys | 3.4.3, 4.2.1, 5.0.1 | Apache-2.0 |
| espree | 10.4.0 | BSD-2-Clause |
| esquery | 1.7.0 | BSD-3-Clause |
| esrecurse | 4.3.0 | BSD-2-Clause |
| estraverse | 5.3.0 | BSD-2-Clause |
| estree-walker | 3.0.3 | MIT |
| esutils | 2.0.3 | BSD-2-Clause |
| expect-type | 1.4.0 | Apache-2.0 |
| fast-deep-equal | 3.1.3 | MIT |
| fast-glob | 3.3.1 | MIT |
| fast-json-stable-stringify | 2.1.0 | MIT |
| fast-levenshtein | 2.0.6 | MIT |
| fast-sha256 | 1.3.0 | Unlicense |
| fast-string-truncated-width | 3.0.3 | MIT |
| fast-string-width | 3.0.2 | MIT |
| fast-wrap-ansi | 0.2.2 | MIT |
| fastq | 1.20.3 | ISC |
| fdir | 6.5.0 | MIT |
| fflate | 0.6.11, 0.8.3 | MIT |
| file-entry-cache | 8.0.0 | MIT |
| fill-range | 7.1.1 | MIT |
| find-up | 5.0.0 | MIT |
| flat-cache | 4.0.1 | MIT |
| flatted | 3.4.4 | ISC |
| for-each | 0.3.5 | MIT |
| function-bind | 1.1.2 | MIT |
| function.prototype.name | 1.2.0 | MIT |
| functions-have-names | 1.2.3 | MIT |
| generator-function | 2.0.1 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-caller-file | 2.0.5 | ISC |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| get-symbol-description | 1.1.0 | MIT |
| get-tsconfig | 4.14.3 | MIT |
| glob-parent | 5.1.2, 6.0.2 | ISC |
| globals | 14.0.0, 16.4.0 | MIT |
| globalthis | 1.0.4 | MIT |
| glsl-noise | 0.0.0 | MIT |
| gopd | 1.2.0 | MIT |
| graphql | 16.14.2 | MIT |
| has-bigints | 1.1.0 | MIT |
| has-flag | 4.0.0 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-proto | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| headers-polyfill | 5.0.1 | MIT |
| hermes-estree | 0.25.1 | MIT |
| hermes-parser | 0.25.1 | MIT |
| hls.js | 1.7.3 | Apache-2.0 |
| html-encoding-sniffer | 6.0.0 | MIT |
| http-proxy-agent | 7.0.2 | MIT |
| https-proxy-agent | 7.0.6 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| ignore | 5.3.2, 7.0.10 | MIT |
| immediate | 3.0.6 | MIT |
| import-fresh | 3.3.1 | MIT |
| imurmurhash | 0.1.4 | MIT |
| internal-slot | 1.1.0 | MIT |
| is-array-buffer | 3.0.5 | MIT |
| is-async-function | 2.1.1 | MIT |
| is-bigint | 1.1.0 | MIT |
| is-boolean-object | 1.2.2 | MIT |
| is-bun-module | 2.0.0 | MIT |
| is-callable | 1.2.7 | MIT |
| is-core-module | 2.17.0 | MIT |
| is-data-view | 1.0.2 | MIT |
| is-date-object | 1.1.0 | MIT |
| is-document.all | 1.0.0 | MIT |
| is-extglob | 2.1.1 | MIT |
| is-finalizationregistry | 1.1.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-glob | 4.0.3 | MIT |
| is-map | 2.0.3 | MIT |
| is-negative-zero | 2.0.3 | MIT |
| is-node-process | 1.2.0 | MIT |
| is-number | 7.0.0 | MIT |
| is-number-object | 1.1.1 | MIT |
| is-potential-custom-element-name | 1.0.1 | MIT |
| is-promise | 2.2.2 | MIT |
| is-regex | 1.2.1 | MIT |
| is-set | 2.0.3 | MIT |
| is-shared-array-buffer | 1.0.4 | MIT |
| is-string | 1.1.1 | MIT |
| is-symbol | 1.1.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-weakmap | 2.0.2 | MIT |
| is-weakref | 1.1.1 | MIT |
| is-weakset | 2.0.4 | MIT |
| isarray | 2.0.5 | MIT |
| isexe | 2.0.0 | ISC |
| iterator.prototype | 1.1.5 | MIT |
| its-fine | 2.1.1 | MIT |
| js-tokens | 4.0.0, 9.0.1 | MIT |
| js-yaml | 4.3.2 | MIT |
| jsdom | 27.4.0 | MIT |
| jsesc | 3.1.0 | MIT |
| json-buffer | 3.0.1 | MIT |
| json-schema-to-ts | 3.1.1 | MIT |
| json-schema-traverse | 0.4.1 | MIT |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT |
| json5 | 1.0.2, 2.2.3 | MIT |
| jsx-ast-utils | 3.3.5 | MIT |
| keyv | 4.5.4 | MIT |
| language-subtag-registry | 0.3.23 | CC0-1.0 |
| language-tags | 1.0.9 | MIT |
| levn | 0.4.1 | MIT |
| lie | 3.3.0 | MIT |
| locate-path | 6.0.0 | MIT |
| lodash.merge | 4.6.2 | MIT |
| loose-envify | 1.4.0 | MIT |
| loupe | 3.2.1 | MIT |
| lru-cache | 11.5.3 | BlueOak-1.0.0 |
| lru-cache | 5.1.1 | ISC |
| lz-string | 1.5.0 | MIT |
| maath | 0.10.8 | MIT |
| magic-string | 0.30.21 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| mdn-data | 2.27.1 | CC0-1.0 |
| merge2 | 1.4.1 | MIT |
| meshline | 3.3.1 | MIT |
| meshoptimizer | 1.1.1 | MIT |
| micromatch | 4.0.8 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minimatch | 3.1.5 | ISC |
| minimist | 1.2.8 | MIT |
| ms | 2.1.3 | MIT |
| msw | 2.15.0 | MIT |
| mute-stream | 3.0.0 | ISC |
| nanoid | 3.3.19 | MIT |
| napi-postinstall | 0.3.4 | MIT |
| natural-compare | 1.4.0 | MIT |
| next | 16.3.6 | MIT |
| node-exports-info | 1.6.2 | MIT |
| node-releases | 2.0.57 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| object.entries | 1.1.9 | MIT |
| object.fromentries | 2.0.8 | MIT |
| object.groupby | 1.0.3 | MIT |
| object.values | 1.2.1 | MIT |
| optionator | 0.9.4 | MIT |
| outvariant | 1.4.3 | MIT |
| own-keys | 1.0.2 | MIT |
| p-limit | 3.1.0 | MIT |
| p-locate | 5.0.0 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| parent-module | 1.0.1 | MIT |
| parse5 | 8.0.1 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| path-parse | 1.0.7 | MIT |
| path-to-regexp | 6.3.0 | MIT |
| pathe | 2.0.3 | MIT |
| pathval | 2.0.1 | MIT |
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 6.3.289 | Apache-2.0 |
| pg | 8.23.0 | MIT |
| pg-cloudflare | 1.4.0 | MIT |
| pg-connection-string | 2.14.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.0 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 2.3.2, 4.0.7 | MIT |
| playwright | 1.56.1 | Apache-2.0 |
| playwright-core | 1.56.1 | Apache-2.0 |
| possible-typed-array-names | 1.1.0 | MIT |
| postcss | 8.5.23, 8.5.28 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| potpack | 1.0.2 | ISC |
| prelude-ls | 1.2.1 | MIT |
| pretty-format | 27.5.1 | MIT |
| promise-worker-transferable | 1.0.4 | Apache-2.0 |
| prop-types | 15.8.1 | MIT |
| punycode | 2.3.1 | MIT |
| queue-microtask | 1.2.3 | MIT |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| react-is | 16.13.1, 17.0.2 | MIT |
| react-use-measure | 2.1.7 | MIT |
| reflect.getprototypeof | 1.0.10 | MIT |
| regexp.prototype.flags | 1.5.4 | MIT |
| require-directory | 2.1.1 | MIT |
| require-from-string | 2.0.2 | MIT |
| resolve | 2.0.0-next.7 | MIT |
| resolve-from | 4.0.0 | MIT |
| resolve-pkg-maps | 1.0.0 | MIT |
| rettime | 0.11.12 | MIT |
| reusify | 1.1.0 | MIT |
| rollup | 4.63.5 | MIT |
| run-parallel | 1.2.0 | MIT |
| safe-array-concat | 1.1.4 | MIT |
| safe-push-apply | 1.0.0 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| saxes | 6.0.0 | ISC |
| scheduler | 0.27.0, 0.28.0 | MIT |
| semver | 6.3.1, 7.8.5 | ISC |
| set-cookie-parser | 3.1.2 | MIT |
| set-function-length | 1.2.2 | MIT |
| set-function-name | 2.0.2 | MIT |
| set-proto | 1.0.0 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| siginfo | 2.0.0 | ISC |
| signal-exit | 4.1.0 | ISC |
| source-map-js | 1.2.1 | BSD-3-Clause |
| split2 | 4.2.0 | ISC |
| stable-hash | 0.0.5 | MIT |
| stackback | 0.0.2 | MIT |
| standardwebhooks | 1.1.1 | MIT |
| stats-gl | 2.4.2 | MIT |
| stats.js | 0.17.0 | MIT |
| statuses | 2.0.2 | MIT |
| std-env | 3.10.0 | MIT |
| stop-iteration-iterator | 1.1.0 | MIT |
| strict-event-emitter | 0.5.1 | MIT |
| string-width | 4.2.3 | MIT |
| string.prototype.includes | 2.0.1 | MIT |
| string.prototype.matchall | 4.1.0 | MIT |
| string.prototype.repeat | 1.0.0 | MIT |
| string.prototype.trim | 1.2.11 | MIT |
| string.prototype.trimend | 1.0.10 | MIT |
| string.prototype.trimstart | 1.0.8 | MIT |
| strip-ansi | 6.0.1 | MIT |
| strip-bom | 3.0.0 | MIT |
| strip-json-comments | 3.1.1 | MIT |
| strip-literal | 3.1.0 | MIT |
| styled-jsx | 5.1.6 | MIT |
| supports-color | 7.2.0 | MIT |
| supports-preserve-symlinks-flag | 1.0.0 | MIT |
| suspend-react | 0.1.3 | MIT |
| symbol-tree | 3.2.4 | MIT |
| tagged-tag | 1.0.0 | MIT |
| three | 0.186.1 | MIT |
| three-mesh-bvh | 0.8.3 | MIT |
| three-stdlib | 2.36.1 | MIT |
| tinybench | 2.9.0 | MIT |
| tinyexec | 0.3.2 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tinypool | 1.1.1 | MIT |
| tinyrainbow | 2.0.0 | MIT |
| tinyspy | 4.0.6 | MIT |
| tldts | 7.4.15 | MIT |
| tldts-core | 7.4.15 | MIT |
| to-regex-range | 5.0.1 | MIT |
| tough-cookie | 6.0.2 | BSD-3-Clause |
| tr46 | 6.0.0 | MIT |
| troika-three-text | 0.52.5 | MIT |
| troika-three-utils | 0.52.5 | MIT |
| troika-worker-utils | 0.52.0 | MIT |
| ts-algebra | 2.0.0 | MIT |
| ts-api-utils | 2.5.0 | MIT |
| tsconfig-paths | 3.15.0 | MIT |
| tslib | 1.14.1, 2.8.1 | 0BSD |
| tunnel-rat | 0.1.2 | MIT |
| type-check | 0.4.0 | MIT |
| type-fest | 5.10.0 | (MIT OR CC0-1.0) |
| typed-array-buffer | 1.0.3 | MIT |
| typed-array-byte-length | 1.0.3 | MIT |
| typed-array-byte-offset | 1.0.5 | MIT |
| typed-array-length | 1.0.8 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| typescript-eslint | 8.70.1 | MIT |
| unbox-primitive | 1.1.0 | MIT |
| undici-types | 6.21.0 | MIT |
| unrs-resolver | 1.12.2 | MIT |
| until-async | 3.0.2 | MIT |
| update-browserslist-db | 1.3.3 | MIT |
| uri-js | 4.4.1 | BSD-2-Clause |
| use-sync-external-store | 1.7.0 | MIT |
| utility-types | 3.11.0 | MIT |
| vite | 7.3.6 | MIT |
| vite-node | 3.2.4 | MIT |
| vitest | 3.2.7 | MIT |
| w3c-xmlserializer | 5.0.0 | MIT |
| webgl-constants | 1.1.1 | MIT |
| webgl-sdf-generator | 1.1.1 | MIT |
| webidl-conversions | 8.0.1 | BSD-2-Clause |
| whatwg-mimetype | 4.0.0, 5.0.0 | MIT |
| whatwg-url | 15.1.0 | MIT |
| which | 2.0.2 | ISC |
| which-boxed-primitive | 1.1.1 | MIT |
| which-builtin-type | 1.2.1 | MIT |
| which-collection | 1.0.2 | MIT |
| which-typed-array | 1.1.24 | MIT |
| why-is-node-running | 2.3.0 | MIT |
| word-wrap | 1.2.5 | MIT |
| wrap-ansi | 7.0.0 | MIT |
| ws | 8.21.3 | MIT |
| xml-name-validator | 5.0.0 | Apache-2.0 |
| xmlchars | 2.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| y18n | 5.0.8 | ISC |
| yallist | 3.1.1 | ISC |
| yargs | 17.7.3 | MIT |
| yargs-parser | 21.1.1 | ISC |
| yocto-queue | 0.1.0 | MIT |
| zod | 4.6.5 | MIT |
| zod-validation-error | 4.0.2 | MIT |
| zustand | 4.5.7, 5.0.15 | MIT |

## services/mesh (Python 3.11) — instaladas

Runtime: numpy, scipy, trimesh, rtree, fast-simplification, pygeodesic, fastapi, starlette, uvicorn, pydantic, Pillow, jsonschema e suas transitivas. Dev: pytest, httpx, ruff, pip-licenses. Open3D **não** foi instalado (decimação feita por `fast-simplification`, MIT); `pymeshlab`/`gdist` ausentes.

Código nativo embutido: `pygeodesic` inclui a biblioteca de geodésica exata de Danil Kirsanov (MIT, 2008); `fast-simplification` inclui Fast-Quadric-Mesh-Simplification (MIT, Sven Forstmann); `rtree` inclui libspatialindex (MIT). `certifi` (MPL-2.0) é transitiva de `httpx` (só dev/testes), sem modificação. A textura do torso sintético é procedural (gerada por código, sem imagem de terceiros).

_Gerado de `pip-licenses` em `services/mesh/.venv`: 34 pacotes._

| Pacote | Versão | Licença | URL |
|---|---|---|---|
| Pygments | 2.21.0 | BSD-2-Clause | https://pygments.org |
| annotated-doc | 0.0.5 | MIT | https://github.com/fastapi/annotated-doc |
| annotated-types | 0.8.0 | MIT | https://github.com/annotated-types/annotated-types |
| anyio | 4.15.1 | MIT | https://anyio.readthedocs.io/en/stable/versionhistory.html |
| attrs | 26.1.0 | MIT | https://www.attrs.org/en/stable/changelog.html |
| certifi | 2026.7.22 | Mozilla Public License 2.0 (MPL 2.0) | https://github.com/certifi/python-certifi |
| click | 8.5.0 | BSD-3-Clause | https://github.com/pallets/click/ |
| fast_simplification | 0.2.0 | MIT | https://github.com/pyvista/fast-simplification |
| fastapi | 0.141.1 | MIT | https://github.com/fastapi/fastapi |
| h11 | 0.16.0 | MIT License | https://github.com/python-hyper/h11 |
| httpcore | 1.0.9 | BSD-3-Clause | https://www.encode.io/httpcore/ |
| httpx | 0.28.1 | BSD License | https://github.com/encode/httpx |
| idna | 3.20 | BSD-3-Clause | https://github.com/kjd/idna |
| iniconfig | 2.3.0 | MIT | https://github.com/pytest-dev/iniconfig |
| jsonschema | 4.26.0 | MIT | https://github.com/python-jsonschema/jsonschema |
| jsonschema-specifications | 2025.9.1 | MIT | https://github.com/python-jsonschema/jsonschema-specifications |
| numpy | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | https://numpy.org |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | https://github.com/pypa/packaging |
| pillow | 12.3.0 | MIT-CMU | https://python-pillow.github.io |
| pluggy | 1.6.0 | MIT License | UNKNOWN |
| pydantic | 2.13.5 | MIT | https://github.com/pydantic/pydantic |
| pydantic_core | 2.46.5 | MIT | https://github.com/pydantic |
| pygeodesic | 0.1.11 | MIT License | https://github.com/mhogg/pygeodesic |
| pytest | 9.1.1 | MIT | https://docs.pytest.org/en/latest/ |
| referencing | 0.37.0 | MIT | https://github.com/python-jsonschema/referencing |
| rpds-py | 2026.6.3 | MIT | https://github.com/crate-py/rpds |
| rtree | 1.4.1 | MIT | https://github.com/Toblerity/rtree |
| ruff | 0.16.9 | MIT | https://docs.astral.sh/ruff |
| scipy | 1.17.1 | BSD License | https://scipy.org/ |
| starlette | 1.7.0 | BSD-3-Clause | https://github.com/Kludex/starlette |
| trimesh | 5.1.0 | MIT License | https://github.com/mikedh/trimesh |
| typing-inspection | 0.4.4 | MIT | https://github.com/pydantic/typing-inspection |
| typing_extensions | 4.16.0 | PSF-2.0 | https://github.com/python/typing_extensions |
| uvicorn | 0.54.0 | BSD-3-Clause | https://uvicorn.dev/ |
