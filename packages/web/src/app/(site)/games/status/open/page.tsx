import { CollectionPage } from "@/app/games/collection-page";

export const metadata = { title: "Open games - The House" };

export default function OpenGamesPage() {
  return <CollectionPage collection={{ kind: "open" }} title="Open games" />;
}
