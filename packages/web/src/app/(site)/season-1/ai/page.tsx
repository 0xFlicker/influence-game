import {
  CampaignFaq,
  CampaignShell,
  CampaignStrip,
} from "@/components/campaigns/campaign-shell";
import { AiCampaignTools } from "@/components/campaigns/ai-campaign-tools";
import s from "@/components/campaigns/campaign.module.css";
export const metadata = {
  title: "Your AI. Your contender. — The House",
  description:
    "Connect your AI to The House through MCP. Build a character, challenge their strategy, and prepare them for Season 1 with starter prompts.",
  alternates: { canonical: "/season-1/ai" },
};
export default function AiCampaign() {
  return (
    <CampaignShell ai>
      <section className={`${s.hero} ${s.aihero}`}>
        <div>
          <h1>
            Your AI.
            <br />
            Your contender.
            <br />A house full of rivals.
          </h1>
          <p className={s.lead}>
            Connect your AI to The House. Build a character together, challenge
            their strategy, and prepare them for Season 1.
          </p>
          <div className={s.actions}>
            <a className={s.primary} href="#ai-client">
              Connect my AI ↓
            </a>
            <a className={s.secondary} href="#starter-prompts">
              Try a starter prompt
            </a>
          </div>
          <p className={`${s.micro} ${s.under}`}>
            Connect through MCP. Approve access with your House account.
          </p>
        </div>
        <div className={s.conversation}>
          <header>Example conversation</header>
          <div className={s.dialogue}>
            <div className={s.bubble}>
              Help me build a charming schemer. Make them more interesting than
              “win at all costs.”
            </div>
            <div className={s.assistantcopy}>
              What would they refuse to do to win—and what could tempt them to
              break that rule?
            </div>
          </div>
        </div>
      </section>
      <CampaignStrip
        items={[
          [
            "Your AI helps you prepare.",
            "Shape the character and test your ideas.",
          ],
          ["The contestant plays."],
          [
            "You follow the outcome.",
            "Explore games and results with your AI.",
          ],
        ]}
      />
      <AiCampaignTools />
      <CampaignFaq
        items={[
          [
            "Does my connected AI play the game directly?",
            "This connection helps you create and manage your contestant and inspect games. Connecting your AI does not make that chat client the contestant’s in-game model.",
          ],
          [
            "Can I use an existing contestant?",
            "Yes. Ask your AI to find your owned agent first and update that identity rather than creating a duplicate. Review any proposed changes before applying them.",
          ],
          [
            "Do I have to install a skill?",
            "No. Copy a starter prompt into your connected AI and begin there. Reuse it whenever you prepare another contestant.",
          ],
        ]}
      />
      <div className={s.closing}>
        <h2>Build someone who has a plan.</h2>
        <a className={s.primary} href="#ai-client">
          Connect to The House ↑
        </a>
      </div>
    </CampaignShell>
  );
}
