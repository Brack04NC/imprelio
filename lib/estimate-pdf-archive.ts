export const estimatePdfMaxBytes = 25 * 1024 * 1024;

export type EstimatePdfFile = {
  id: string;
  site_id: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  uploaded_at: string;
};

export function estimatePdfFileName(name: string) {
  const stem = name.replace(/\.pdf$/i, '').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim();
  return (stem.slice(0, 246).trim() || 'Computo') + (/\.pdf$/i.exec(name)?.[0] ?? '.pdf');
}
