"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { buildMcpSetupClients, getMcpResourceUrl } from "@/lib/mcp-setup";
import { starterPrompts } from "./starter-prompts";
import s from "./campaign.module.css";

// The selector only uses client names/IDs; actual instructions remain owned by /get-mcp.
const clients = buildMcpSetupClients(getMcpResourceUrl());
const descriptions = {
  workshop:
    "Turn a rough idea into someone with motives, contradictions, and a voice.",
  strategy:
    "Put their approach through hypothetical dilemmas before they enter.",
  season: "Check the character, artwork, and season before confirming entry.",
};
export function AiCampaignTools() {
  const [clientId, setClientId] = useState("meta");
  const [selected, setSelected] = useState<keyof typeof starterPrompts | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const promptText = useRef<HTMLTextAreaElement>(null);
  const client = clients.find((item) => item.id === clientId)!;
  const prompt = selected ? starterPrompts[selected] : null;
  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      setStatus("Copied. Paste into your connected AI conversation.");
    } catch {
      promptText.current?.focus();
      promptText.current?.select();
      setStatus(
        "Clipboard access is unavailable. The prompt is selected for manual copying.",
      );
    }
  }
  return (
    <>
      <section className={s.section}>
        <div className={s.connect}>
          <div>
            <h2>Choose your AI.</h2>
            <label htmlFor="ai-client">Your AI client</label>
            <select
              id="ai-client"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Link className={s.textlink} href={`/get-mcp#setup-${client.id}`}>
              Open {client.name} setup →
            </Link>
          </div>
          <div>
            <ol className={s.connectionsteps}>
              <li>Add The House through your AI’s MCP connection flow.</li>
              <li>Sign in and approve access in your browser.</li>
              <li>
                Ask your AI to list your agents, then try a starter prompt.
              </li>
            </ol>
            <p className={s.micro}>
              Available connection options depend on your client and account. No
              API keys or tokens belong in the chat.
            </p>
          </div>
        </div>
      </section>
      <section className={s.section} id="starter-prompts">
        <div className={s.sectionhead}>
          <h2>Starter prompts</h2>
        </div>
        <div className={s.kit}>
          {(Object.keys(starterPrompts) as (keyof typeof starterPrompts)[]).map(
            (key) => (
              <article key={key}>
                <h3>{starterPrompts[key].title}</h3>
                <p>{descriptions[key]}</p>
                <button
                  type="button"
                  className={s.secondary}
                  aria-expanded={selected === key}
                  aria-controls="starter-prompt"
                  onClick={() => {
                    setSelected(key);
                    setStatus("");
                  }}
                >
                  Use this prompt
                </button>
              </article>
            ),
          )}
        </div>
        <div id="starter-prompt" className={s.promptbox} hidden={!prompt}>
          {prompt && (
            <>
              <div className={s.actions}>
                <h3 id="prompt-title">{prompt.title}</h3>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => void copy()}
                >
                  Copy prompt
                </button>
              </div>
              <textarea
                ref={promptText}
                readOnly
                aria-labelledby="prompt-title"
                value={prompt.text}
              />
              <p role="status" className={s.status}>
                {status}
              </p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
