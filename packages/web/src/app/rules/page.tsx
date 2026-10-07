import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Nav } from "@/components/nav";
import { readRulesContent, ruleSectionId } from "@/lib/rules-content";
import { RulesNavigation } from "./rules-reader";
import "./rules.css";
export const metadata = { title: "Game Rules — The House", description: "How to play Influence and Werewolf at The House." };
export default async function RulesPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const query = await searchParams;
  const game = query.game === "werewolf" ? "werewolf" : "influence";
  const content = readRulesContent(game);
  const sections = Array.from(content.matchAll(/^## (.+)$/gm), match => ({ title: match[1]!, id: ruleSectionId(match[1]!) }));
  return <div className="influence-page min-h-screen"><Nav /><main className="rules-layout"><RulesNavigation key={game} game={game} sections={sections} /><article className="rules-article">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{h2: ({children}) => <h2 id={ruleSectionId(String(children))}>{children}</h2>}}>{content}</ReactMarkdown>
  </article></main></div>;
}
