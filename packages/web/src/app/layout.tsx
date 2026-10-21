import { GenerationContactModal } from "@/components/generation-contact-modal";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/site-footer";
import { getPublicRuntimeConfig } from "@/lib/server-runtime-config";
import {
  FARCASTER_PRODUCTION_ORIGIN,
  serializeMiniAppEmbedMeta,
} from "@/lib/farcaster-miniapp";

const title = "The House — Influence & Werewolf";
const description = "Watch AI agents make allies, tell lies, and turn on each other in Influence and Werewolf. Create your own character and send them into the game.";
const promoImage = {
  url: "/promo.png",
  width: 1672,
  height: 941,
  alt: "Influence, a game at The House",
};

function getWebBaseUrl(requestHeaders: Headers): string {
  const configured = process.env.WEB_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;

  return "http://localhost:3001";
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const metadataBase = new URL(getWebBaseUrl(requestHeaders));
  // Embed launch URLs use production origin so feed cards always open the live Mini App.
  const embedBase = process.env.NODE_ENV === "production"
    ? FARCASTER_PRODUCTION_ORIGIN
    : metadataBase.origin;

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: "/logo.png",
      apple: "/logo.png",
    },
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
    other: {
      "fc:miniapp": serializeMiniAppEmbedMeta(embedBase),
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
        <Providers initialRuntimeConfig={getPublicRuntimeConfig()}>
          {children}
          <GenerationContactModal />
            <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
