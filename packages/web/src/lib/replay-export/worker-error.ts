/** Worker logs are private diagnostics, but bearer and signed-URL credentials never belong in them. */
export function renderWorkerError(error:unknown,secrets:readonly (string|undefined)[]) {
  let message=error instanceof Error?error.message:"Unknown render failure";
  for(const secret of secrets)if(secret)message=message.replaceAll(secret,"[redacted]");
  message=message.replace(/https?:\/\/[^\s"'<>]+/g,value=> {
    try {const url=new URL(value);return `${url.origin}${url.pathname}`;}catch {return "[redacted URL]";}
  }).replace(/Bearer\s+\S+/gi,"Bearer [redacted]");
  return {name:error instanceof Error?error.name:"UnknownError",message:message.slice(0,2000)};
}
