ALTER TABLE "deployment_admission_leases"
  DROP CONSTRAINT "deployment_admission_leases_actor_check",
  ADD CONSTRAINT "deployment_admission_leases_actor_check"
    CHECK ("deployment_admission_leases"."actor" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$');
