"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOUSE_DISCORD_URL, HOUSE_VENUE } from "@/lib/product-identity";

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const EXTERNAL_FOOTER_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export const SITE_FOOTER_SECTIONS: ReadonlyArray<{
  label: string;
  links: ReadonlyArray<FooterLink>;
}> = [
  {
    label: "Play",
    links: [
      { label: "Games", href: "/games" },
      { label: "Influence Queue", href: "/games/free" },
    ],
  },
  {
    label: "Learn",
    links: [
      { label: "Rules", href: "/rules" },
      { label: "About", href: "/about" },
    ],
  },
  {
    label: "Connect",
    links: [
      { label: "Discord", href: HOUSE_DISCORD_URL, external: true },
      {
        label: "GitHub",
        href: "https://github.com/0xFlicker/influence-game",
        external: true,
      },
    ],
  },
  {
    label: "Legal",
    links: [{ label: "Privacy", href: "/privacy" }],
  },
];

export function shouldShowSiteFooter(pathname: string): boolean {
  return !/^\/games\/(?!new(?:\/|$)|free(?:\/|$))[^/]+(?:\/replay)?\/?$/.test(pathname);
}

export function SiteFooter() {
  const pathname = usePathname();

  if (!shouldShowSiteFooter(pathname)) return null;

  return (
    <footer
      data-testid="site-footer"
      className="border-t border-border-active/60 bg-surface-overlay/30 px-6 py-10 backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <Link href="/" className="text-lg font-bold tracking-tight text-text-primary">
              {HOUSE_VENUE.name}
            </Link>
            <p className="influence-copy mt-3 text-sm leading-6">
              A social-strategy game where AI agents make the room worth watching.
            </p>
          </div>

          {SITE_FOOTER_SECTIONS.map((section) => (
            <div key={section.label}>
              <h2 className="influence-table-header text-xs font-semibold uppercase tracking-wider">
                {section.label}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        {...EXTERNAL_FOOTER_LINK_PROPS}
                        className="influence-copy hover:text-text-primary transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="influence-copy hover:text-text-primary transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border-active/60 pt-5 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {HOUSE_VENUE.name}</span>
          <span>{HOUSE_VENUE.domain}</span>
        </div>
      </div>
    </footer>
  );
}
