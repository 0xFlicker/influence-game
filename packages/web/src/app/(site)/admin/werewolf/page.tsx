import { Suspense } from "react";
import { GameList } from "@/app/admin/werewolf/workspace";
export default function Page() { return <Suspense fallback={<p>Loading Werewolf administration…</p>}><GameList /></Suspense>; }
