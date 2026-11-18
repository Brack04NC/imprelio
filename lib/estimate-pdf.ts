import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { estimateImportWarnings, readEstimatePages, type PdfPage } from './estimate-import';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export async function extractEstimate(file: File, onPage: (page: number, total: number) => void) {
  if (!/\.pdf$/i.test(file.name) || file.size > 25 * 1024 * 1024) throw new Error('Scegli un PDF di massimo 25 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data, useSystemFonts: true, stopAtErrors: true });
  try {
    const document = await task.promise;
    if (document.numPages > 100) throw new Error('Il PDF deve avere al massimo 100 pagine.');
    const pages: PdfPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push({ number, items: content.items.flatMap(item => 'str' in item
        ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }] : []) });
      page.cleanup();
      onPage(number, document.numPages);
    }
    const rows = readEstimatePages(pages);
    if (!rows.length) throw new Error(pages.some(page => page.items.length > 0)
      ? 'Non ho riconosciuto una tabella di computo in questo PDF.'
      : 'Il PDF sembra una scansione. Usa una versione con testo selezionabile.');
    if (rows.length > 350) throw new Error('Il computo supera 350 voci. Dividilo in più PDF per importarlo.');
    return { items: rows, warnings: estimateImportWarnings(pages, rows) };
  } finally {
    await task.destroy();
  }
}
