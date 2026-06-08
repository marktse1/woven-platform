import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import AccountStrip from "@/components/shell/AccountStrip";
import MainNav from "@/components/shell/MainNav";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Woven — Web Games Platform",
  description: "Browse and play browser-native games. Publish your worlds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.className}>
        <body>
          <AccountStrip />
          <MainNav />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
