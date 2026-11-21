import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { Worker as OcrWorker } from 'tesseract.js';
import { documentMaxBytes, documentMimeForName, type DocumentExtraction } from './document-intake';
import { parseDocumentText } from './document-extraction-fields';
import { estimatePlainText } from './estimate-import';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const ocrAssets = '/document-ocr/v1';
const maxPages = 100;
const maxOcrPages = 4;
const maxRecognitionDimension = 2450;
type Progress = (message: string) => void;
type Recognize = (canvas: HTMLCanvasElement) => Promise<string>;

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new DOMException('Lettura annullata.', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

async function withOcr<T>(onProgress: Progress, signal: AbortSignal | undefined, work: (recognize: Recognize) => Promise<T>) {
  let worker: OcrWorker | undefined;
  const cancel = () => { void worker?.terminate(); };
  signal?.addEventListener('abort', cancel, { once: true });
  async function recognize(canvas: HTMLCanvasElement) {
    signal?.throwIfAborted();
    if (!worker) {
      onProgress('Caricamento del riconoscimento testo…');
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      signal?.throwIfAborted();
      const pending = new Promise<OcrWorker>((resolve, reject) => {
        void createWorker(['ita', 'eng'], OEM.LSTM_ONLY, {
          workerPath: `${ocrAssets}/worker.min.js`,
          corePath: `${ocrAssets}/tesseract-core-lstm.wasm.js`,
          langPath: ocrAssets,
          cachePath: 'imprelio-document-ocr-v1',
          workerBlobURL: false,
          errorHandler: reject,
          logger: ({ status, progress }) => {
            if (!signal?.aborted && status === 'recognizing text') onProgress(`Riconoscimento del testo… ${Math.round(progress * 100)}%`);
          },
        }).then(resolve, reject);
      });
      void pending.then(lateWorker => { if (signal?.aborted) void lateWorker.terminate(); }, () => {});
      worker = await abortable(pending, signal);
      await abortable(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }), signal);
    }
    const result = await abortable(worker.recognize(canvas), signal);
    return result.data.text.trim();
  }

  try { return await work(recognize); }
  finally {
    signal?.removeEventListener('abort', cancel);
    await worker?.terminate();
  }
}

function makeCanvas(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Dimensioni dell’immagine non valide.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}

async function photoText(file: File, recognize: Recognize, signal?: AbortSignal) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  try {
    await abortable(image.decode(), signal);
    const scale = Math.min(1, maxRecognitionDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = makeCanvas(Math.max(1, image.naturalWidth * scale), Math.max(1, image.naturalHeight * scale));
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Riconoscimento immagine non disponibile.');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await recognize(canvas);
    } finally { canvas.width = canvas.height = 0; }
  } finally { URL.revokeObjectURL(objectUrl); }
}

async function readPdf(file: File, recognize: Recognize, onProgress: Progress, signal?: AbortSignal) {
  const data = new Uint8Array(await abortable(file.arrayBuffer(), signal));
  const task = getDocument({ data, useSystemFonts: true, stopAtErrors: false });
  let destroyed = false;
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { await task.destroy(); } catch { /* A failed render can have released its worker already. */ }
  }
  const cancel = () => { void destroy(); };
  signal?.addEventListener('abort', cancel, { once: true });
  let text = '';
  let incomplete = false;
  try {
    const pdf = await abortable(task.promise, signal);
    const pages = Math.min(pdf.numPages, maxPages);
    incomplete = pdf.numPages > pages;
    let ocrPages = 0;
    for (let number = 1; number <= pages; number++) {
      signal?.throwIfAborted();
      onProgress(`Lettura pagina ${number} di ${pages}…`);
      const page = await abortable(pdf.getPage(number), signal);
      try {
        const content = await abortable(page.getTextContent(), signal);
        let block = estimatePlainText([{ number, items: content.items.flatMap(item => 'str' in item
          ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }] : []) }]);
        if (block.replace(/[^\p{L}\d]/gu, '').length < 18) {
          if (ocrPages < maxOcrPages) {
            ocrPages++;
            const original = page.getViewport({ scale: 1 });
            const scale = Math.min(3, maxRecognitionDimension / Math.max(original.width, original.height));
            const viewport = page.getViewport({ scale });
            const canvas = makeCanvas(viewport.width, viewport.height);
            try {
              await abortable(page.render({ canvas, viewport }).promise, signal);
              block = await recognize(canvas) || block;
            } catch {
              signal?.throwIfAborted();
              incomplete = true;
            } finally { canvas.width = canvas.height = 0; }
          } else incomplete = true;
        }
        if (block) text += (text ? '\n\n' : '') + block;
      } catch {
        signal?.throwIfAborted();
        incomplete = true;
      } finally { page.cleanup(); }
    }
    return { text, incomplete };
  } catch (error) {
    signal?.throwIfAborted();
    if (text) return { text, incomplete: true };
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await destroy();
  }
}

export async function extractDocument(file: File, onProgress: Progress, signal?: AbortSignal): Promise<DocumentExtraction> {
  const mime = documentMimeForName(file.name);
  if (!mime || file.size === 0 || file.size > documentMaxBytes) throw new Error('Scegli un PDF, JPG, PNG o WebP di massimo 25 MB.');
  signal?.throwIfAborted();
  try {
    return await withOcr(onProgress, signal, async recognize => {
      const result = mime === 'application/pdf' ? await readPdf(file, recognize, onProgress, signal)
        : { text: await photoText(file, recognize, signal), incomplete: false };
      const extracted = parseDocumentText(result.text, file.name);
      return result.incomplete && extracted.status === 'extracted' ? { ...extracted, status: 'review' } : extracted;
    });
  } catch {
    signal?.throwIfAborted();
    return parseDocumentText('', file.name);
  }
}
