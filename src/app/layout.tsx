import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import UpcomingGamesSidebar from "@/components/sidebar/upcoming-games-sidebar";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "TrendLine — Sports Gambling Trends Engine",
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
      <body className={`${inter.variable} font-sans antialiased`}>
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
