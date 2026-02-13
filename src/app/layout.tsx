import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Providers } from "./providers";

const UpcomingGamesSidebar = dynamic(
  () => import("@/components/sidebar/upcoming-games-sidebar"),
  { ssr: false }
);
const ServiceWorkerRegistration = dynamic(
  () => import("@/components/service-worker-registration").then((m) => m.ServiceWorkerRegistration),
  { ssr: false }
);
const OfflineBanner = dynamic(
  () => import("@/components/offline-banner").then((m) => m.OfflineBanner),
  { ssr: false }
);
const NotificationPrompt = dynamic(
  () => import("@/components/notification-prompt").then((m) => m.NotificationPrompt),
  { ssr: false }
);

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14b8a6",
};

export const metadata: Metadata = {
  title: "TrendLine — Sports Betting Trends Engine",
  description:
    "Search historical ATS trends across NFL, NCAAF, and NCAA Men's Basketball with natural language queries.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TrendLine",
  },
  icons: {
    apple: "/icons/icon-192.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
          <div className="flex min-h-screen flex-col">
            <OfflineBanner />
            <Header />
            <main className="flex-1">
              <div className="mx-auto flex max-w-7xl gap-6 px-4">
                <div className="min-w-0 flex-1">{children}</div>
                <div className="hidden lg:block">
                  <Suspense
                    fallback={
                      <div className="w-72 space-y-3 pt-8">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />
                        ))}
                      </div>
                    }
                  >
                    <UpcomingGamesSidebar />
                  </Suspense>
                </div>
              </div>
            </main>
            <Footer />
          </div>
          <ServiceWorkerRegistration />
          <NotificationPrompt />
        </Providers>
      </body>
    </html>
  );
}
