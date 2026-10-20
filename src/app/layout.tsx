import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/lib/gb/gb-ui.css";
import { Header } from "@/components/layout/Header";
import { GlobalOverlays } from "@/components/common/GlobalOverlays";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A0A1A",
};

export const metadata: Metadata = {
  title: "TypingVerse - 타이핑버스",
  description: "손끝으로 여는 무한한 세계 - 종합 타자연습 웹앱",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
  openGraph: {
    title: 'TypingVerse - 타이핑버스',
    description: '손끝으로 여는 무한한 세계 - 종합 타자연습 웹앱',
    siteName: 'TypingVerse',
    type: 'website',
    images: [{ url: '/og-image.svg', width: 1200, height: 630 }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TypingVerse",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="antialiased font-body">
        <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
        <Header />
        <main id="main-content" className="pt-[calc(var(--header-height)+4px)]">
          {children}
        </main>
        <footer className="mt-12 py-6 text-center text-xs" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--key-border)' }}>
          <a href="/privacy" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>개인정보처리방침</a>
          <span className="mx-2">·</span>
          <span>© {new Date().getFullYear()} TypingVerse</span>
        </footer>
        <GlobalOverlays />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />
      </body>
    </html>
  );
}
