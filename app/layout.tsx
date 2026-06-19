import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkFuse — an on-chain ink house, on ARC",
  description:
    "Drop a sketch, collect it for USDC, resell it with automatic artist royalties, and tip the artist — every flow settled in native USDC, instantly, on ARC.",
  keywords: "InkFuse, ARC, USDC, art, sketch, NFT, royalties, marketplace, tattoo, illustration, web3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
