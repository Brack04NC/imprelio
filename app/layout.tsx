import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Imprelio', template: '%s · Imprelio' },
  description: 'Organizza i cantieri e pianifica gli interventi di ponteggio.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/brand/imprelio-favicon.ico', type: 'image/x-icon' },
      { url: '/brand/imprelio-favicon-16.png', type: 'image/png', sizes: '16x16' },
      { url: '/brand/imprelio-favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: { url: '/brand/imprelio-apple-touch-icon.png', type: 'image/png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
