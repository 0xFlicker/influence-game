import { Nav } from "@/components/nav";
import { HomepageHero } from "@/components/home/homepage-hero";

export default function HomePage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <HomepageHero />
    </div>
  );
}
