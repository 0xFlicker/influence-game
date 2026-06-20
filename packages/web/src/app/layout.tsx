
import type { Metadata } from "next";
import { headers } from "next/headers";
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

function getWebBaseUrl(requestHeaders: Headers): string {
  const configured = process.env.WEB_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;

  return "http://localhost:3001";
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const metadataBase = new URL(getWebBaseUrl(requestHeaders));

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
