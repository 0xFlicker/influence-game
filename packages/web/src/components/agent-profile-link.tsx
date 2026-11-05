import Link from "next/link";
import type { ReactNode } from "react";

export function agentProfileHref(id: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? `/agents/${id}` : null;
}

/** Keep navigation separate from portrait previews, badge buttons and editing controls. */
export function AgentProfileLink({ agentId, href, children, className }: {
  agentId?: string; href?: string; children: ReactNode; className?: string;
}) {
  const target = agentId ? agentProfileHref(agentId) : href && /^\/agents\/[A-Za-z0-9_-]{1,128}$/.test(href) ? href : null;
  return target ? <Link href={target} className={className}>{children}</Link> : <span className={className}>{children}</span>;
}
