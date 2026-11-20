import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Imprelio', template: '%s · Imprelio' },
  description: 'Organizza i cantieri e pianifica gli interventi di ponteggio.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
