"use client";
import { HouseShareButton } from "@/components/house-share-button";

export function ShareMoment({href, getHref}: {href?:string; getHref?:()=>string}) {
  return <HouseShareButton href={href} getHref={getHref} label="Share this moment" title="A moment in the House" text="Watch from this moment." description="Starts here, with your playback settings." />;
}
