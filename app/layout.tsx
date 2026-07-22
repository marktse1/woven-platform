import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import AccountStrip from "@/components/shell/AccountStrip";
import MainNav from "@/components/shell/MainNav";
import HeaderShell from "@/components/shell/HeaderShell";
import AssetLibraryPanel from "@/components/assets/AssetLibraryPanel";
import { ActiveLoaderProvider } from "@/components/assets/ActiveLoaderContext";
import { getSiteUrl } from "@/lib/siteUrl";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

const siteTitle = "Woven — Web Games Platform";
const siteDescription = "Browse and play browser-native games. Publish your worlds.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "Woven",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.className}>
        <body>
          <ActiveLoaderProvider>
            <HeaderShell>
              <AccountStrip />
              <MainNav />
            </HeaderShell>
            {children}
            <AssetLibraryPanel />
          </ActiveLoaderProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
