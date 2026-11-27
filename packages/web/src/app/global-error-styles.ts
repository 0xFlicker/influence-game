// Next can render the root fallback without loading the application's stylesheet.
export const globalErrorStyles = `
  body.house-error-page {
    --error-ink: #f6f0e9;
    --error-muted: #beb3c2;
    --error-gold: #f1cd93;
    --error-border: #443447;

    color-scheme: dark;
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    background: radial-gradient(ellipse at 34% 22%, #221629 0%, #0c090f 62%);
    color: var(--error-ink);
    font: 400 1rem/1.55 system-ui, -apple-system, sans-serif;
    display: grid;
    place-items: center;
  }

  .house-error-page *,
  .house-error-page *::before,
  .house-error-page *::after { box-sizing: border-box; }

  .house-error-shell {
    width: min(100%, 74rem);
    padding: clamp(1rem, 4vw, 3.25rem);
  }

  .house-error-brand { margin-bottom: 1.1rem; }

  .house-error-brand a {
    display: inline-flex;
    gap: .7rem;
    align-items: center;
    padding: .35rem 0;
    color: var(--error-gold);
    font-size: .8rem;
    font-weight: 750;
    letter-spacing: .22em;
    text-decoration: none;
    text-transform: uppercase;
  }

  .house-error-brand a::before {
    content: "";
    width: .52rem;
    height: .52rem;
    border: 1px solid currentColor;
    transform: rotate(45deg);
  }

  .house-error-stage {
    display: grid;
    grid-template-columns: minmax(0, 46fr) minmax(0, 54fr);
    overflow: hidden;
    border: 1px solid var(--error-border);
    border-radius: 1.15rem;
    background: #151019;
    box-shadow: 0 24px 76px #0008;
  }

  .house-error-portrait {
    position: relative;
    min-height: 26rem;
    isolation: isolate;
    background:
      radial-gradient(ellipse at 50% 40%, #b68c654a, transparent 60%),
      linear-gradient(160deg, #10091818 12%, #100918bb 95%),
      #211726 url("/agent-creation-hall.webp") center 45% / cover no-repeat;
  }

  .house-error-portrait::after {
    content: "";
    position: absolute;
    inset: .8rem;
    border: 1px solid #f3d2984a;
    border-radius: .65rem;
    pointer-events: none;
  }

  .house-error-portrait img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: clamp(.65rem, 1.5vw, 1.3rem);
    object-fit: contain;
    filter: drop-shadow(0 16px 22px #0009);
  }

  .house-error-content {
    min-width: 0;
    padding: clamp(1.5rem, 4.25vw, 4rem);
    border-inline-start: 1px solid var(--error-border);
  }

  .house-error-content h1 {
    margin: 0;
    max-width: 12ch;
    color: var(--error-ink);
    font: 600 clamp(2.5rem, 5.7vw, 4.45rem)/1.01 Georgia, "Times New Roman", serif;
    letter-spacing: -.055em;
    text-wrap: balance;
  }

  .house-error-lead {
    margin: 1rem 0 0;
    color: var(--error-muted);
    font-size: 1.075rem;
  }

  .house-error-message {
    position: relative;
    margin: 1.6rem 0 1.55rem;
    padding: .9rem 1.1rem 1rem;
    border: 1px solid #61494d;
    border-radius: .55rem;
    background: linear-gradient(110deg, #332239, #211626 82%);
  }

  .house-error-speaker {
    display: block;
    margin-bottom: .27rem;
    color: var(--error-gold);
    font-size: .71rem;
    font-weight: 750;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .house-error-message p { margin: 0; }

  .house-error-message strong {
    color: var(--error-gold);
    font-family: ui-monospace, Menlo, monospace;
  }

  .house-error-actions,
  .house-error-help {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .65rem 1rem;
  }

  .house-error-actions button,
  .house-error-actions a {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-height: 2.75rem;
    padding: .65rem 1.1rem;
    border: 1px solid var(--error-border);
    border-radius: .45rem;
    font: inherit;
    font-size: .94rem;
    font-weight: 700;
    text-decoration: none;
  }

  .house-error-actions button {
    border-color: var(--error-gold);
    background: var(--error-gold);
    color: #271a17;
    cursor: pointer;
  }

  .house-error-actions button:hover { background: #ffe0ac; }
  .house-error-actions a { background: #211827; color: var(--error-ink); }
  .house-error-actions a:hover { background: #35263d; }

  .house-error-help {
    margin-top: 1.55rem;
    padding-top: .7rem;
    border-top: 1px solid var(--error-border);
    color: var(--error-muted);
    font-size: .875rem;
  }

  .house-error-help a {
    display: inline-flex;
    align-items: center;
    gap: .25rem;
    min-height: 2.75rem;
    color: var(--error-gold);
    text-decoration: underline;
    text-underline-offset: .25em;
  }

  .house-error-help a:hover { color: #ffe9c5; }

  .house-error-page :is(a, button):focus-visible {
    outline: 2px solid var(--error-gold);
    outline-offset: 3px;
  }

  .house-error-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (max-width: 47rem) {
    .house-error-stage { grid-template-columns: minmax(0, 1fr); }

    .house-error-portrait {
      min-height: 0;
      height: clamp(13rem, 57vw, 20rem);
    }

    .house-error-content {
      border-inline-start: 0;
      border-top: 1px solid var(--error-border);
    }

    .house-error-content h1 { max-width: none; }
    .house-error-lead { font-size: 1rem; }
    .house-error-message { margin-block: 1.15rem; }
    .house-error-help { margin-top: 1.15rem; gap: 0 .85rem; }
  }
`;
