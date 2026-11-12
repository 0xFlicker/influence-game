"use client";
import { useRef, useState } from "react";
import { buildMcpSetupClients, getMcpResourceUrl } from "@/lib/mcp-setup";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { starterPrompts } from "./starter-prompts";
import s from "./campaign.module.css";
const descriptions = {
  workshop:
    "Turn a rough idea into someone with motives, contradictions, and a voice.",
  strategy:
    "Put their approach through hypothetical dilemmas before they enter.",
  season: "Check the character, artwork, and season before confirming entry.",
};
export function AiCampaignTools() {
  // Setup instructions are rendered inline from the shared MCP setup data;
  // /get-mcp remains the canonical source, this page never forks its copy.
  const runtimeConfig = useRuntimeConfig();
  const mcpUrl = getMcpResourceUrl(
    runtimeConfig.MCP_OAUTH_RESOURCE_URI,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  const clients = buildMcpSetupClients(mcpUrl);
  const [clientId, setClientId] = useState("muse-assistant");
  const [selected, setSelected] = useState<keyof typeof starterPrompts | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [setupStatus, setSetupStatus] = useState("");
  const promptText = useRef<HTMLTextAreaElement>(null);
  const client = clients.find((item) => item.id === clientId)!;
  const prompt = selected ? starterPrompts[selected] : null;
  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSetupStatus(done);
    } catch {
      setSetupStatus("Clipboard unavailable. Select the text and copy it manually.");
    }
  }
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
      <section className={s.section} id="connect">
        <div className={s.sectionhead}>
          <div>
            <h2>Choose your AI.</h2>
            <p className={s.aiheadcopy}>
              Pick the client you already use and follow its setup here. You
              approve access in your browser — no link-out needed.
            </p>
          </div>
        </div>
        <div className={s.connect}>
          <div>
            <h3 className={s.aiconnecttitle}>Your client</h3>
            <label htmlFor="ai-client">Your AI client</label>
            <select
              id="ai-client"
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setSetupStatus("");
              }}
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className={s.micro}>The House MCP endpoint:</p>
            <div className={s.aicode}>
              <code>{mcpUrl}</code>
              <button
                type="button"
                className={s.secondary}
                onClick={() => void copyText(mcpUrl, "Endpoint copied.")}
              >
                Copy
              </button>
            </div>
            {setupStatus && (
              <p role="status" className={s.status}>
                {setupStatus}
              </p>
            )}
          </div>
          <div>
            <h3 className={s.aiconnecttitle}>Set up {client.name}</h3>
            {client.commands.map((command) => (
              <div className={s.aicode} key={command}>
                <code>{command}</code>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => void copyText(command, "Command copied. Run it, then approve access in your browser.")}
                >
                  Copy
                </button>
              </div>
            ))}
            {client.steps && client.steps.length > 0 && (
              <ol className={s.connectionsteps}>
                {client.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {client.prompt && (
              <details className={s.aiprompt}>
                <summary>{client.promptLabel ?? `Paste this into ${client.name} chat`}</summary>
                <pre>{client.prompt}</pre>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => void copyText(client.prompt!, "Connection prompt copied. Paste it into your AI chat.")}
                >
                  Copy connection prompt
                </button>
              </details>
            )}
            <p className={s.micro}>{client.authHint}</p>
            <p className={s.micro}>
              Then ask your AI to list your agents, and try a starter prompt
              below. No API keys or tokens belong in the chat.
            </p>
          </div>
        </div>
      </section>
      <section className={s.section} id="starter-prompts">
        <div className={s.sectionhead}>
          <div>
            <h2>Starter prompts</h2>
            <p className={s.aiheadcopy}>
              Copy one into your connected AI. It asks before saving,
              spending, or entering anything.
            </p>
          </div>
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
