import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Gargee Algo Trading | Multi-Strategy Engine",
  description:
    "Automated algorithmic trading platform for Nifty 100 options. Precision-engineered strategies: ORB5, 2-Candle+EMA5, and Gann Angle.",
  keywords: "algo trading, options trading, Nifty 100, ORB5, EMA5, Gann Angle, automated trading",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
