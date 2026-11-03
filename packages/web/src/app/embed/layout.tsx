import type {Metadata} from "next";
import {RuntimeConfigProvider} from "@/lib/runtime-config";
import {getPublicRuntimeConfig} from "@/lib/server-runtime-config";
export const metadata:Metadata = {title:"The House player",robots:{index:false,follow:false}};
export default function EmbedLayout({children}: {children:React.ReactNode}) {
  return <RuntimeConfigProvider initialConfig={getPublicRuntimeConfig()}>{children}</RuntimeConfigProvider>;
}
