import type { Metadata } from "next";
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

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "TrendLine — Sports Betting Trends Engine",
  description:
    "Search historical ATS trends across NFL, NCAAF, and NCAA Men's Basketball with natural language queries.",
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
            <Header />
            <main className="flex-1">
              <div className="mx-auto flex max-w-7xl gap-6 px-4">
                <div className="min-w-0 flex-1">{children}</div>
                <div className="hidden lg:block">
                  <UpcomingGamesSidebar />
                </div>
              </div>
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
