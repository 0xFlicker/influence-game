import { CollectionPage } from "../collection-page";
export const metadata = { title: "Your private games — The House" };
export default function Page() { return <CollectionPage collection={{ kind: "private" }} title="Your private games" />; }
