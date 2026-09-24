import { CollectionPage } from "../../collection-page";
export const metadata = { title: "Season games — The House" };
export default async function Page({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  return <CollectionPage collection={{ kind: "season", slug: seasonSlug }} title="Season games" />;
}
