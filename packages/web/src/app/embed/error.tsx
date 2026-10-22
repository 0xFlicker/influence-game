"use client";
export default function ErrorPage({reset}: {reset:()=>void}) {
  return <div role="alert" className="p-6">Could not load this replay. <button type="button" onClick={reset}>Try again</button></div>;
}
