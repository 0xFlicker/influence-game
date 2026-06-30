import { Nav } from "@/components/nav";
import {
  ACTIVE_GAME,
  HOUSE_VENUE,
} from "@/lib/product-identity";
import { GetMcpClient } from "./get-mcp-client";

export const metadata = {
  title: `Connect MCP - ${HOUSE_VENUE.name} / ${ACTIVE_GAME.name}`,
};

export default function GetMcpPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <GetMcpClient />
    </div>
  );
}
