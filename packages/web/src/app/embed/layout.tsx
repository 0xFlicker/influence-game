import type {Metadata} from "next";
export const metadata:Metadata = {title:"The House player",robots:{index:false,follow:false}};
export default function EmbedLayout({children}: {children:React.ReactNode}) { return children; }
