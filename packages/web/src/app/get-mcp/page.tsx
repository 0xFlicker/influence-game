import { Nav } from "@/components/nav";
import {
  ACTIVE_GAME,
  HOUSE_VENUE,
} from "@/lib/product-identity";
import { GetMcpClient } from "./get-mcp-client";

export const metadata = {
  title: `Connect MCP - ${HOUSE_VENUE.name} / ${ACTIVE_GAME.name}`,
};

interface GetMcpPageProps {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}

export function safeMcpReturnTo(value: string | string[] | undefined): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/dashboard/agents/") ||
    value.startsWith("//")
  ) {
    return "/dashboard";
  }
  return value;
}

export default async function GetMcpPage({ searchParams }: GetMcpPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const returnHref = safeMcpReturnTo(resolvedSearchParams.returnTo);

  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <GetMcpClient returnHref={returnHref} />
    </div>
  );
}
