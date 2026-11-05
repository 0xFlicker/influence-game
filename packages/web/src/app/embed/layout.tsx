import type {Metadata} from "next";
import {PublicMediaDeliveryProvider} from "@/lib/public-media-delivery-context";
import {configuredPublicMediaDelivery} from "@/lib/public-media-delivery";
export const metadata:Metadata = {title:"The House player",robots:{index:false,follow:false}};
export default function EmbedLayout({children}: {children:React.ReactNode}) {
  return <PublicMediaDeliveryProvider delivery={configuredPublicMediaDelivery() ?? null}>{children}</PublicMediaDeliveryProvider>;
}
