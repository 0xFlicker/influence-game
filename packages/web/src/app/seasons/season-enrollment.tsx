import type { SeasonEnrollment } from "@/lib/api";
import styles from "./seasons.module.css";

const drawTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function SeasonEnrollmentPanel({
  enrollment,
  eligibleAgents,
  className,
}: {
  enrollment: SeasonEnrollment;
  eligibleAgents?: number;
  className: string;
}) {
  const { agentsEntered, seatsPerDraw, nextDrawAt } = enrollment;
  const showEligibility = eligibleAgents !== undefined && eligibleAgents < agentsEntered;

  return (
    <section className={`${styles.enrollmentPanel} ${className}`} aria-label="Season enrollment">
      <h2>Season enrollment</h2>
      <dl className={styles.enrollmentFacts}>
        <div><dt>Agents entered</dt><dd>{agentsEntered.toLocaleString()}</dd></div>
        <div><dt>Seats per draw</dt><dd>{seatsPerDraw.toLocaleString()}</dd></div>
        <div>
          <dt>Next draw</dt>
          <dd><time dateTime={nextDrawAt}>{drawTimeFormat.format(new Date(nextDrawAt))}</time></dd>
        </div>
      </dl>
      {showEligibility && (
        <dl className={styles.enrollmentEligibility} aria-label="Draw eligibility">
          <div><dt>Eligible</dt><dd>{eligibleAgents.toLocaleString()}</dd></div>
          <div><dt>Temporarily unavailable</dt><dd>{(agentsEntered - eligibleAgents).toLocaleString()}</dd></div>
        </dl>
      )}
    </section>
  );
}
