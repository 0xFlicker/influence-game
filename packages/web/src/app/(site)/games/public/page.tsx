import { CollectionPage } from "@/app/games/collection-page";
export const metadata = { title: "Public games - The House" };
export default function Page() { return <CollectionPage collection={{ kind: "public" }} title="Public games" />; }
