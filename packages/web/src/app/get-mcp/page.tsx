import { Nav } from "@/components/nav";
import { GetMcpClient } from "./get-mcp-client";

export const metadata = {
  title: "Connect MCP - Influence",
};

export default function GetMcpPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <GetMcpClient />
    </div>
  );
}
