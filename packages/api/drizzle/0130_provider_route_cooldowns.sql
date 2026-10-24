ALTER TABLE provider_health_states DROP CONSTRAINT provider_health_states_reason_check;
--> statement-breakpoint
ALTER TABLE provider_health_states ADD CONSTRAINT provider_health_states_reason_check CHECK (reason IS NULL OR reason IN ('authentication', 'configuration', 'service_error', 'transport_timeout', 'transport_error', 'rate_limit'));
--> statement-breakpoint
ALTER TABLE provider_health_events DROP CONSTRAINT provider_health_events_reason_check;
--> statement-breakpoint
ALTER TABLE provider_health_events ADD CONSTRAINT provider_health_events_reason_check CHECK (reason IS NULL OR reason IN ('authentication', 'configuration', 'service_error', 'transport_timeout', 'transport_error', 'rate_limit'));
--> statement-breakpoint
ALTER TABLE provider_health_events DROP CONSTRAINT provider_health_events_kind_check;
--> statement-breakpoint
ALTER TABLE provider_health_events ADD CONSTRAINT provider_health_events_kind_check CHECK (event_kind IN ('failure_recorded', 'success_recorded', 'opened', 'probe_started', 'probe_expired', 'probe_succeeded', 'probe_failed', 'cooldown_expired'));
