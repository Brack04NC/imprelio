import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const resolve = createRequire(import.meta.url).resolve;
const assetFolder = new URL('../public/document-ocr/v1/', import.meta.url);
const tesseract = dirname(resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));

await mkdir(assetFolder, { recursive: true });
await Promise.all([
  copyFile(join(tesseract, 'dist', 'worker.min.js'), new URL('worker.min.js', assetFolder)),
  copyFile(join(tesseract, 'dist', 'worker.min.js.LICENSE.txt'), new URL('worker.min.js.LICENSE.txt', assetFolder)),
  copyFile(join(tesseract, 'LICENSE.md'), new URL('Tesseract-JS-LICENSE.md', assetFolder)),
  copyFile(join(core, 'tesseract-core-lstm.wasm.js'), new URL('tesseract-core-lstm.wasm.js', assetFolder)),
  copyFile(join(core, 'LICENSE'), new URL('Apache-2.0.txt', assetFolder)),
  ...['ita', 'eng'].map(language => copyFile(
    join(dirname(resolve(`@tesseract.js-data/${language}/package.json`)), '4.0.0_best_int', `${language}.traineddata.gz`),
    new URL(`${language}.traineddata.gz`, assetFolder),
  )),
  writeFile(new URL('NOTICE.txt', assetFolder), [
    'This directory contains Tesseract.js, Tesseract.js-core and the Italian and English Tesseract language models.',
    'The assets originate from the corresponding npm packages and are provided under the Apache License, Version 2.0.',
    'Sources: https://github.com/naptha/tesseract.js and https://github.com/tesseract-ocr/tessdata_best.',
    '',
  ].join('\n')),
]);
