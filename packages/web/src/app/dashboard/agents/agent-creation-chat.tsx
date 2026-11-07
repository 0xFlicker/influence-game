"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  decodeCreationTurn,
  type CharacterEditCommand,
  type CreationStage,
} from "@influence/engine/agent-creation-assistant";
import { apiFetch, ApiError, type AgentGender } from "@/lib/api";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import { PERSONAS } from "@/lib/personas";
import {
  ALL_AGENT_CREATION_TRAITS,
  type AgentCreationTraitId,
} from "@influence/engine/agent-creation-traits";
import { AgentGenderControl } from "./agent-gender-control";
import styles from "./agent-workspace.module.css";
import { AgentCreationIngredients } from "./agent-creation-ingredients";

const labels = {
  name: "Name",
  personaKey: "Archetype",
  gender: "Gender",
  personality: "Character prompt",
  strategyStyle: "Influence strategy",
  werewolfStrategyStyle: "Werewolf strategy",
  backstory: "Backstory",
  performanceInstructions: "Performance",
  visualDesign: "Appearance",
};
export type CharacterSection = keyof typeof labels;
export type CharacterChatProfile = Record<CharacterSection, string>;
const replies = {
  character:
    "Your character can play Influence and Werewolf, with separate strategy notes for each game. Would your character win people over, seek control, or surprise everyone? Tell me what sounds fun to play.",
  review:
    "Does that feel right to you? You can say yes, tell me what to change, or edit a section above.",
  appearance:
    "What do they look like? Describe their face, body, clothing, colors, or any distinctive details.",
  portrait:
    "Your character is ready to look over. Confirm this headshot when it feels right, or tell me what to change about their appearance.",
};

export interface CharacterConversation {
  stage: CreationStage | null;
  messages: { role: "user" | "assistant"; text: string }[];
  input: string;
  sections: CharacterSection[];
  ended: boolean;
}

export function AgentCreationChat({
  onIssue,
  preferences,
  editing = false,
  conversation,
  onConversationChange,
  scope,
  onGenderChange,
  profile,
  onGenerate,
  onAppearance,
  busy,
  blocked,
  headRequired,
  hasImage,
  onHeadshot,
  creationTraitIds = [],
  onCreationTraitIdsChange,
  anonymous = false,
  anonymousUsed = false,
  onAnonymousMessage,
  onRequireAccount,
}: {
  onIssue?: (cause: unknown) => void;
  preferences?: ReactNode;
  editing?: boolean;
  conversation?: CharacterConversation;
  onConversationChange?: (value: CharacterConversation) => void;
  scope?: { section: CharacterSection };
  onGenderChange?: (value: AgentGender) => void;
  anonymous?: boolean;
  anonymousUsed?: boolean;
  onAnonymousMessage?: (
    message: string,
  ) => Promise<{ reply: string; hasCharacter: boolean }>;
  onRequireAccount?: () => void;
  creationTraitIds?: AgentCreationTraitId[];
  onCreationTraitIdsChange?: (ids: AgentCreationTraitId[]) => void;
  profile: CharacterChatProfile;
  onGenerate: (
    message: string,
    sections: CharacterSection[],
  ) => Promise<boolean>;
  onAppearance: (
    description: string,
    operation: "create" | "edit",
  ) => Promise<boolean>;
  busy: boolean;
  blocked: boolean;
  headRequired: boolean;
  hasImage: boolean;
  onHeadshot: () => void;
}) {
  const [stageOverride, setStage] = useState<CreationStage | null>(
    conversation?.stage ?? null,
  );
  const stage = stageOverride ?? (profile.personality ? "review" : "character");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >(conversation?.messages ?? []);
  const [input, setInput] = useState(conversation?.input ?? "");
  const [sections, setSections] = useState<CharacterSection[]>(
    conversation?.sections ?? [],
  );
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [ended, setEnded] = useState(conversation?.ended ?? false);
  useEffect(() => {
    onConversationChange?.({
      stage: stageOverride,
      messages,
      input,
      sections,
      ended,
    });
  }, [stageOverride, messages, input, sections, ended, onConversationChange]);
  const [error, updateError] = useAgentIssue("assistant");
  function setError(cause: unknown) {
    updateError(cause);
    onIssue?.(cause);
  }
  const [poolBusy, setPoolBusy] = useState(false);
  const inFlight = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const handledScope = useRef<typeof scope>(undefined);
  const chatLog = useRef<HTMLDivElement>(null);
  const locked = busy || pending || blocked;
  const ingredientMode =
    stage === "character" || stage === "review" ? "character" : "appearance";
  const showIngredients = stage === "character" || stage === "appearance";
  const hasIngredients = showIngredients && creationTraitIds.length > 0;
  const working = pending || busy;
  const hasCharacter = Boolean(profile.personality || hasImage);
  const openingMessage = {
    role: "assistant" as const,
    text: editing
      ? "What would you like to change? Choose a section above, or tell me what you have in mind."
      : replies[stage],
  };
  const visibleMessages = messages.length ? messages : [openingMessage];

  useEffect(() => {
    if (chatLog.current)
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [messages, submitted, working]);
  function selectSection(section: CharacterSection) {
    setSelectionVersion((current) => current + 1);
    setSections([section]);
    setStage(
      section === "visualDesign"
        ? hasImage
          ? "portrait"
          : "appearance"
        : "review",
    );
    composer.current?.focus();
  }

  function advanceAfterApproval() {
    setStage(hasImage ? "portrait" : "appearance");
    return hasImage
      ? headRequired
        ? replies.portrait
        : "Your character and images are ready. You can create your Agent, or tell me what else to change."
      : replies.appearance;
  }

  function approveCharacter() {
    if (stage !== "review" || locked || inFlight.current || ended) return;
    const reply = advanceAfterApproval();
    setMessages((current) => [
      ...(current.length ? current : [openingMessage]),
      { role: "user", text: "Yes, this character feels right." },
      { role: "assistant", text: reply },
    ]);
    setInput("");
    setSections([]);
    setError(null);
    onCreationTraitIdsChange?.([]);
    composer.current?.focus();
  }

  async function send(text = input) {
    if (
      inFlight.current ||
      locked ||
      ended ||
      (!text.trim() && !hasIngredients)
    )
      return;
    if (anonymous && stage !== "character") {
      onRequireAccount?.();
      return;
    }
    const ingredientLabels = creationTraitIds
      .map(
        (id) =>
          ALL_AGENT_CREATION_TRAITS.find((trait) => trait.id === id)?.label,
      )
      .join(", ");
    const request = hasIngredients
      ? `${text.trim() || (ingredientMode === "appearance" ? "Describe their appearance using these visual ingredients." : "Create a character from these ingredients.")}\nSelected character ingredients: ${ingredientLabels}`
      : text;
    const originalInput = input;
    let succeeded = false;
    setSubmitted(
      [text.trim(), hasIngredients ? ingredientLabels : ""]
        .filter(Boolean)
        .join(" · "),
    );
    setInput("");
    inFlight.current = true;
    setPending(true);
    setError(null);
    setPoolBusy(false);
    try {
      if (anonymous && onAnonymousMessage) {
        const turn = await onAnonymousMessage(request);
        if (turn.hasCharacter) setStage("review");
        setMessages((current) => [
          ...(current.length ? current : [openingMessage]),
          {
            role: "user",
            text: [text.trim(), hasIngredients ? ingredientLabels : ""]
              .filter(Boolean)
              .join(" · "),
          },
          { role: "assistant", text: turn.reply },
        ]);
        onCreationTraitIdsChange?.([]);
        succeeded = true;
        setSections([]);
        return;
      }
      const result = await apiFetch<unknown>(
        "/api/agent-profiles/creation-assistant",
        {
          method: "POST",
          body: JSON.stringify({
            stage,
            message: request,
            history: visibleMessages
              .slice(-24)
              .map((message) =>
                `${message.role}: ${message.text}`.slice(0, 2000),
              ),
            sections,
            draft: profile,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const turn = decodeCreationTurn(JSON.stringify(result), stage);
      const { command } = turn;
      let reply: string;
      if (command === "end_abuse" || command === "end_fatigue") {
        setEnded(true);
        reply =
          command === "end_abuse"
            ? "I’m ending this conversation here. Your draft is still available in Advanced create."
            : "We seem to be going in circles, so I’m going to stop here. Your draft is still available in Advanced create.";
      } else if (command === "accept_character") {
        reply = advanceAfterApproval();
      } else if (command === "revise_character") {
        const edit: CharacterEditCommand =
          hasCharacter && !sections.length
            ? await apiFetch<CharacterEditCommand>(
                "/api/agent-profiles/edit-assistant",
                {
                  method: "POST",
                  body: JSON.stringify({
                    context: { ...profile, hasFullBody: hasImage },
                    message: request,
                    history: visibleMessages
                      .slice(-24)
                      .map(message => `${message.role}: ${message.text}`.slice(0, 2000)),
                  }),
                  signal: AbortSignal.timeout(60_000),
                },
              )
            : { tool: "update_character", fields: sections };
        if (edit.tool === "clarify") reply = edit.message;
        else if (edit.tool === "update_visuals") {
          if (!(await onAppearance(request, hasImage ? "edit" : "create"))) return;
          setStage("portrait");
          reply = replies.portrait;
        } else {
          if (!(await onGenerate(request, edit.fields))) return;
          setStage("review");
          reply = replies.review;
        }
      } else if (
        command === "generate_appearance" ||
        command === "revise_appearance"
      ) {
        if (
          !(await onAppearance(
            request,
            command === "revise_appearance" ? "edit" : "create",
          ))
        )
          return;
        setStage("portrait");
        reply = replies.portrait;
      } else {
        reply = turn.reply;
      }
      setMessages((current) => [
        ...(current.length ? current : [openingMessage]),
        {
          role: "user",
          text: [text.trim(), hasIngredients ? ingredientLabels : ""]
            .filter(Boolean)
            .join(" · "),
        },
        { role: "assistant", text: reply },
      ]);
      onCreationTraitIdsChange?.([]);
      succeeded = true;
      setInput("");
      setSections([]);
    } catch (cause) {
      setPoolBusy(
        cause instanceof ApiError && cause.code === "anonymous_pool_busy",
      );
      setError(cause);
    } finally {
      if (!succeeded) setInput(originalInput);
      setSubmitted(null);
      inFlight.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (scope && handledScope.current !== scope) {
      handledScope.current = scope;
      setSections([scope.section]);
      setStage(
        scope.section === "visualDesign"
          ? hasImage
            ? "portrait"
            : "appearance"
          : "review",
      );
      composer.current?.focus();
    }
  }, [scope, hasImage]);
  return (
    <>
      <div className="agent-creation-stage relative mx-auto flex min-h-[20rem] w-full max-w-6xl flex-1 flex-col px-4 sm:px-8">
        <section
          aria-label="Character fixtures"
          className={`agent-creation-visual relative z-10 mx-auto w-full ${hasCharacter ? "agent-creation-visual-filled" : "agent-creation-visual-empty"} ${working && (stage === "appearance" || stage === "portrait") ? "agent-creation-visual-forming" : ""}`}
        >
          {!hasCharacter ? (
            <div className="agent-creation-empty mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center py-4 text-center">
              <div className="agent-creation-empty-mark flex size-36 items-center justify-center rounded-full border border-amber-200/30 bg-[#100d18]/60 shadow-[0_0_90px_rgba(211,164,80,0.16)] sm:size-48">
                {/* eslint-disable-next-line @next/next/no-img-element -- the existing House brand asset */}
                <img
                  src="/logo.png"
                  alt=""
                  className="size-24 object-contain mix-blend-screen sm:size-32"
                />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight text-amber-50 sm:mt-6 sm:text-2xl">
                Your character starts here.
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/70">
                Start with a name, a motive, or a way they would play. The House
                will help you shape the rest.
              </p>
            </div>
          ) : (
            <div className="agent-creation-summary mx-auto flex w-full max-w-5xl items-start gap-4 p-3">
              <div className="agent-creation-fixture-grid grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(labels) as CharacterSection[]).map((section) =>
                  section === "gender" && onGenderChange ? (
                    <AgentGenderControl
                      key={section}
                      value={profile.gender}
                      onChange={onGenderChange}
                      disabled={locked}
                    />
                  ) : (
                    <button
                      key={section}
                      type="button"
                      disabled={locked || ended}
                      onClick={() => selectSection(section)}
                      aria-label={`Revise ${labels[section]}`}
                      aria-pressed={sections.includes(section)}
                      className={`agent-creation-fixture min-w-0 rounded-lg border p-2 text-left ${sections.includes(section) ? "border-amber-200/70 bg-amber-200/15" : "border-amber-200/20"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-white/45">
                          {labels[section]}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-sm text-violet-200"
                        >
                          ↗
                        </span>
                      </span>
                      <span className="agent-creation-fixture-copy mt-2 line-clamp-2 text-sm leading-5">
                        {section === "personaKey"
                          ? PERSONAS.find(
                              (persona) => persona.key === profile[section],
                            )?.name
                          : profile[section]}
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </section>
        <div
          ref={chatLog}
          role="log"
          aria-label="Character creation conversation"
          aria-live="polite"
          aria-relevant="additions text"
          className="agent-creation-chat-log mx-auto w-full max-w-3xl"
          hidden={!messages.length && !working && !editing}
        >
          <div className="agent-creation-message-stack space-y-2 px-1 pb-3 pt-4">
            {visibleMessages.map((message, index) => (
              <p
                key={`${index}-${message.text}`}
                className={`agent-creation-bubble w-fit max-w-[90%] rounded-2xl border px-3 py-2 text-sm leading-6 sm:max-w-xl ${message.role === "user" ? "ml-auto rounded-br-sm border-violet-300/25 bg-violet-400/20 text-violet-50" : "rounded-bl-sm border-amber-100/15 bg-[#15111f]/75 text-white/90"}`}
              >
                {message.text}
              </p>
            ))}
            {submitted !== null && (
              <p className="agent-creation-bubble ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm border border-violet-300/25 bg-violet-400/20 px-3 py-2 text-sm leading-6 text-violet-50 sm:max-w-xl">
                {submitted}
              </p>
            )}
            {working && (
              <div
                role="status"
                aria-label="Assistant typing"
                className="agent-creation-bubble flex w-fit gap-1 rounded-2xl rounded-bl-sm border border-amber-100/15 bg-[#15111f]/75 px-4 py-3"
              >
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    aria-hidden="true"
                    className="size-1.5 animate-pulse rounded-full bg-amber-100/70 motion-reduce:animate-none"
                    style={{ animationDelay: `${dot * 180}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <footer className="agent-creation-dock relative z-10 shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-8">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {stage === "review" && !editing && !ended && !working && (
            <button
              type="button"
              disabled={locked}
              onClick={approveCharacter}
              className="influence-button-primary min-h-11 rounded-lg px-4 text-sm"
            >
              Continue
            </button>
          )}
          {!onIssue && error && (
            <AgentIssueNotice
              issue={error}
              onAction={
                error.recovery === "sign_in" ? onRequireAccount : undefined
              }
            />
          )}
          {anonymous && poolBusy && (
            <div className="flex items-center gap-4 text-sm">
              <button
                type="button"
                onClick={onRequireAccount}
                className="influence-button-primary min-h-11 rounded-lg px-4"
              >
                Create a free account
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPoolBusy(false);
                  composer.current?.focus();
                }}
                className="min-h-11 text-amber-100/80"
              >
                Try again later
              </button>
            </div>
          )}
          {!working && !!sections.length && (
            <div
              className={styles.refineContext}
              aria-label="Selected sections"
            >
              {sections.map((section) => (
                <div key={`${section}-${selectionVersion}`}>
                  <details open={profile[section].length < 260}>
                    <summary>{labels[section]}</summary>
                    <p>
                      {section === "personaKey"
                        ? PERSONAS.find(
                            (persona) => persona.key === profile[section],
                          )?.name
                        : profile[section] || "No details yet."}
                    </p>
                  </details>
                  <button
                    key={`${section}-${selectionVersion}`}
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setSections((current) =>
                        current.filter((value) => value !== section),
                      )
                    }
                    aria-label={`Remove change ${labels[section]}`}
                    className="creation-section-pill"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {!ended && showIngredients && onCreationTraitIdsChange && (
            <div className="agent-creation-ingredients rounded-xl p-3 sm:p-4">
              <AgentCreationIngredients
                key={ingredientMode}
                mode={ingredientMode}
                selected={creationTraitIds}
                onChange={onCreationTraitIdsChange}
                disabled={locked}
              />
            </div>
          )}
          {!ended && (
            <label
              htmlFor="agent-creation-message"
              className="block text-xs font-medium uppercase tracking-[.14em] text-amber-100/80"
            >
              {sections.length ? "Describe the change" : "Your response"}
            </label>
          )}
          {anonymous && (
            <p className="text-xs leading-5 text-white/60">
              {anonymousUsed
                ? "Your free message is complete. Create a free account for more messages and character images."
                : "Your first House message is free. Start with a character idea or a question about the game."}
            </p>
          )}
          {anonymous && anonymousUsed && !poolBusy && (
            <button
              type="button"
              onClick={onRequireAccount}
              className="min-h-11 text-sm text-amber-100"
            >
              Continue with a free account <span aria-hidden="true">↗</span>
            </button>
          )}
          {!ended && (
            <div className="relative">
              <textarea
                id="agent-creation-message"
                ref={composer}
                aria-label="Message the character assistant"
                placeholder={
                  sections.length
                    ? `What would you like to change about ${sections.map((section) => labels[section].toLowerCase()).join(" and ")}…`
                    : stage === "appearance" || stage === "portrait"
                      ? "Describe their look…"
                      : "Tell me about your character…"
                }
                value={input}
                maxLength={1400}
                disabled={locked}
                onInput={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                className="influence-field agent-creation-composer max-h-32 min-h-20 w-full resize-none rounded-2xl py-3 pl-4 pr-14 text-base"
              />
              <button
                type="button"
                aria-label={working ? "Assistant working" : "Send"}
                aria-busy={working}
                disabled={locked || (!input.trim() && !hasIngredients)}
                onClick={() => void send()}
                className={`group absolute bottom-2 right-2 flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 ${working ? "" : "disabled:opacity-35"}`}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-violet-400 text-[#11111b] transition-colors group-hover:bg-violet-300">
                  {working ? (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin rounded-full border-2 border-current/25 border-t-current motion-reduce:animate-none"
                    />
                  ) : (
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 19V5m-6 6 6-6 6 6" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          )}

          {hasImage && headRequired && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={locked}
                onClick={onHeadshot}
                className="influence-button-primary min-h-11 rounded-lg px-3 text-sm"
              >
                Confirm
              </button>
            </div>
          )}
          {preferences}
        </div>
      </footer>
    </>
  );
}
