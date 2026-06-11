import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import App from '@/components/App';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Scrollsurf',
  description: 'Infinite-scroll Wikipedia article browser with voting and topics',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <InitColorSchemeScript attribute="media" />
        <AppRouterCacheProvider>
          <App>{children}</App>
        </AppRouterCacheProvider>
        <div
          style={{
            position: 'fixed',
            bottom: 8,
            left: 12,
            fontSize: 11,
            opacity: 0.15,
            pointerEvents: 'none',
            fontFamily: 'monospace',
            userSelect: 'none',
            zIndex: 9999,
          }}
        >
          {process.env.NEXT_PUBLIC_COMMIT_ID}
        </div>
      </body>
    </html>
  );
}
