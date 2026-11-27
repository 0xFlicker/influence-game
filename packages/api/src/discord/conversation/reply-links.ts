const replyLimit = 1900;
const linkLimit = 12;
const replyLink = /\[([^\[\]\r\n]+)\]\((https?:\/\/[^\s<>\])]+)\)|https?:\/\/[^\s<>\])]+/gi;
const resourcePaths = new Set(["agents", "games", "profile"]);

export function prepareReply(content: string, origin: string) {
  const source = content.trim();
  const links = new Set<string>();
  const parts: Array<string | { label?: string; href: string; needsValidation: boolean }> = [];
  let offset = 0;
  for (const match of source.matchAll(replyLink)) {
    const start = match.index;
    if (start >= replyLimit) break;
    parts.push(source.slice(offset, start));
    offset = start + match[0].length;
    if (offset > replyLimit) break;

    const [, rawLabel, destination] = match;
    const label = rawLabel?.replace(replyLink, "");
    const raw = destination ?? match[0].replace(/[.,!?]+$/, "");
    const trailing = destination === undefined ? match[0].slice(raw.length) : "";
    const href = URL.canParse(raw) ? new URL(raw) : null;
    if (href?.origin === origin && !href.username && !href.password) {
      const [, section, id] = href.pathname.split("/");
      if (id && section && resourcePaths.has(section)) {
        if (links.has(href.href) || links.size < linkLimit) {
          links.add(href.href);
          parts.push({ label, href: href.href, needsValidation: true });
          if (trailing) parts.push(trailing);
          continue;
        }
      } else if (href.pathname === "/seasons" && /^\?season=[A-Za-z0-9_-]+$/.test(href.search) && !href.hash) {
        parts.push({ label, href: href.href, needsValidation: false });
        if (trailing) parts.push(trailing);
        continue;
      }
    }
    parts.push((label || "[link removed]") + trailing);
  }
  if (offset < replyLimit) parts.push(source.slice(offset, replyLimit));

  return {
    links: [...links],
    render(allowed: ReadonlySet<string>) {
      let text = "";
      for (const part of parts) {
        if (typeof part === "string") {
          text += part.slice(0, replyLimit - text.length);
        } else {
          const fallback = part.label || "[link removed]";
          const value = part.needsValidation && !allowed.has(part.href) ? fallback
            : part.label === undefined ? part.href : `[${part.label}](${part.href})`;
          if (text.length + value.length > replyLimit) break;
          text += value;
        }
        if (text.length === replyLimit) break;
      }
      return text.trim();
    },
  };
}
