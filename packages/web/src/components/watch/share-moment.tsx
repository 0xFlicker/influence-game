"use client";
import {useState} from "react";
import {sharePostgameLink,type ShareFeedback} from "@/lib/share-link";
export function ShareMoment({href}: {href:string}) {
 const [feedback,setFeedback]=useState<ShareFeedback|null>(null);
 return <div><button type="button" className="rounded-lg border border-white/20 px-3 py-2" onClick={async()=>{
  setFeedback(await sharePostgameLink({href,origin:window.location.origin,title:"A moment in the House",text:"Watch from this moment.",unavailableMessage:"Could not copy the link. Please try again.",
   share:typeof navigator.share === "function" ? data=>navigator.share(data) : undefined,copy:navigator.clipboard?.writeText ? url=>navigator.clipboard.writeText(url) : undefined}));
 }}>Share this moment</button>{feedback && <p role="status" className={`mt-2 text-xs ${feedback.tone === "error" ? "text-red-200" : "text-white/70"}`}>{feedback.message}</p>}</div>;
}
