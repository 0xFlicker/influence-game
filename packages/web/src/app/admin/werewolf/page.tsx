import { Suspense } from "react";
import { WerewolfAdmin } from "./workspace";
export const metadata = { title: "Werewolf — Administration" };
export default function Page() { return <Suspense fallback={<p>Loading Werewolf administration…</p>}><WerewolfAdmin /></Suspense>; }
