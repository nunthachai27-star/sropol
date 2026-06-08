// Root layout — Sarabun font, SWR provider, Thai locale, TooltipProvider
import type { Metadata, Viewport } from 'next';
import { Sarabun, JetBrains_Mono } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SWRProvider } from './swr-provider';
import { BuildBadge } from '@/components/shared/BuildBadge';
import './globals.css';

const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sarabun',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SR-LRMS — ระบบติดตามการคลอดจังหวัดสุรินทร์',
  description: 'ระบบติดตามการคลอดแบบรวมศูนย์ จังหวัดสุรินทร์ (Surin Labor Room Monitoring System)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className={`${sarabun.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <SWRProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SWRProvider>
        <BuildBadge />
      </body>
    </html>
  );
}
