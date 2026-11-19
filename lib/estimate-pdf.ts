import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { estimateHeaderText, estimateImportWarnings, readEstimatePages, type PdfPage } from './estimate-import';
import { extractEstimateSite } from './estimate-site';

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
    const siteDetails = extractEstimateSite(estimateHeaderText(pages));
    const rows = readEstimatePages(pages);
    const importIssue = !rows.length
      ? (pages.some(page => page.items.some(item => item.text.trim()))
        ? 'Non ho riconosciuto una tabella di computo in questo PDF.'
        : 'Il PDF sembra una scansione. Usa una versione con testo selezionabile.')
      : rows.length > 350 ? 'Il computo supera 350 voci. Dividilo in più PDF per importare le lavorazioni.' : '';
    if (importIssue) {
      if (!Object.values(siteDetails).some(Boolean)) throw new Error(importIssue);
      return { items: [], warnings: [], siteDetails, importIssue };
    }
    return { items: rows, warnings: estimateImportWarnings(pages, rows), siteDetails, importIssue };
  } finally {
    await task.destroy();
  }
}
