import { Nav } from "@/components/nav";
import { HomepageHero } from "@/components/home/homepage-hero";
import { getAllPosts } from "@/lib/updates";

export default function HomePage() {
  const latest = getAllPosts()[0];
  const latestUpdate = latest
    ? {
        title: latest.title,
        date: latest.date,
        href: `/updates/${latest.slug}`,
      }
    : null;

  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <HomepageHero latestUpdate={latestUpdate} />
    </div>
  );
}
