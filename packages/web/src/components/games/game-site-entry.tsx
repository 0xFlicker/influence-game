import type {ReactNode} from "react";
import {Nav} from "@/components/nav";
export function GameSiteEntry({children}: {children:ReactNode}) {
 return <div className="min-h-screen flex flex-col"><Nav /><main className="flex-1 px-6 py-10 max-w-6xl mx-auto w-full">{children}</main></div>;
}
