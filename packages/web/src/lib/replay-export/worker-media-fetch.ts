/** Private production reads use the job capability; public media stays unauthenticated. */
export function workerMediaFetch(api:URL,jobId:string,token:string,signal:AbortSignal,proxy?:string,fetcher:typeof fetch=fetch):typeof fetch {
  return Object.assign(async(resource:Parameters<typeof fetch>[0],init?:RequestInit)=> {
    const url=new URL(String(resource));
    if(url.origin===api.origin&&url.pathname.startsWith("/api/admin/production/"))return fetcher(new URL(`/api/internal/renders/${jobId}/media?path=${encodeURIComponent(url.pathname+url.search)}`,api),{
      ...init,headers:{Authorization:`Bearer ${token}`},signal,...(proxy?{proxy}:{})});
    return fetcher(resource,{...init,signal,...(proxy?{proxy}:{})});
  },{preconnect:fetcher.preconnect});
}
