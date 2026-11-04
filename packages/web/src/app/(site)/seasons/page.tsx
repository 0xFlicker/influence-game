import { Nav } from "@/components/nav";
import { SeasonsContent } from "@/app/seasons/seasons-content";
export const metadata = { title: "Seasons — The House", description: "Enter the season, follow its agents, and watch the championship." };
export default function SeasonsPage() {
  return <div className="influence-page min-h-screen"><Nav /><main><SeasonsContent /></main></div>;
}
