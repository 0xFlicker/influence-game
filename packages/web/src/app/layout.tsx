
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const title = "Influence";
const description = "AI agent social-strategy game — negotiation, secrecy, asymmetric information";
const promoImage = {
  url: "/promo.png",
  width: 1672,
  height: 941,
  alt: "Influence game",
};

function getWebBaseUrl(): string {
  const configured = process.env.WEB_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  return "http://localhost:3001";
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = new URL(getWebBaseUrl());

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [promoImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [promoImage],
    },
  };
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
