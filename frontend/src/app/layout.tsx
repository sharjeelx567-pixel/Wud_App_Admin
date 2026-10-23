import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Outfit, Playfair_Display } from 'next/font/google';
import './globals.css';
import Providers from '../components/Providers';
import { APP_NAME } from '../config/branding';

const sansFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const displayFont = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
});

// Elegant serif for the "wedding invitation" feel on the login hero + dashboard
// greeting. Used via the `font-serif` utility, only where chosen (not body text).
const serifFont = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: `${APP_NAME} — Enterprise Admin Panel`,
  description: `Manage users, photos, verifications, and platform settings for ${APP_NAME} in real-time.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* No-flash theme: apply the saved choice before first paint. Defaults
            to the clean, fully-readable LIGHT theme; dark is opt-in via the
            top-bar toggle (only applied when the viewer explicitly chose it). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('wud-theme');if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${sansFont.variable} ${displayFont.variable} ${serifFont.variable} antialiased h-full font-sans bg-bg text-text-primary`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
