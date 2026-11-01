# Normal staging renderer activation

Use the ordinary staging database and the user's normal game flow. No isolated
database, frozen fixture import or assistant-created game is required.
Production remains local. Credential installation and live activation require
the operator's specific approval; source publication alone is not activation.

## Staging credential destinations

| Setting | Source | Destination and authority |
| --- | --- | --- |
| `POSTGAME_MEDIA_CONTROL_TOKEN` | New independent staging-only bearer | Doppler `social-strategy-agent/stg` and root-owned mode-0600 `/etc/influence/render-control-staging/api.key`. Authenticates only the renderer release endpoint: read release state and accept/drain renderer generations. It grants no game-admin, database or AWS authority. |
| `POSTGAME_MEDIA_WAKE_SECRET` | Existing SSM `/house/render/staging/wake` | Doppler `social-strategy-agent/stg`; signs wake hints. Cannot choose images/generations or perform cloud release operations. |
| `POSTGAME_MEDIA_WAKE_URL` | Existing staging stack `WakeUrl` | Nonsecret Doppler `social-strategy-agent/stg` setting. |
| Cloud release HMAC | Existing SSM `/house/render/staging/control` | Root-owned mode-0600 `/etc/influence/render-control-staging/cloud.key`; authenticates the existing staging cloud release controller. Keep it out of application Doppler settings. |

SSM is in account `978355607658`, region `us-west-1`. The root-owned directory
`/etc/influence/render-control-staging/` is mode 0700. The existing four-field
mode-0600 `/etc/influence/render-control-staging.json` points to those files,
the stack `ReviewControlUrl`, and canonical API URL
`https://influence-staging.tail8a79ed.ts.net/api/internal/postgame-media/release`.
Reuse the existing staging worker token. OAuth stays in SSM with the broker;
the host and renderer do not receive it. Never log credential values.

## Ordered rollout after approval

1. Let any current staging deployment/E2E finish. Pin its actual accepted API,
   web and worker family. Bootstrap the control/wake settings into that local
   release before attempting the authenticated local-to-remote handoff.
2. Publish a fresh staging-only `local` to `remote` policy change from current
   main. Keep production local and preserve the exact three-image manifest.
   Do not reuse the older frozen candidate's application images.
3. Keep the SQS event-source binding disabled through normal deployment and
   ECR publication. Cloud activation alone does not increment `wakeSerial`;
   wake ingress queues hints, and only their consumer admits them to launch.
   Therefore the existing normal release controller can finish the handoff
   before the exact worker image is copied, without starting a task early.
4. Verify the successful main CI manifest, measure/copy its worker to staging
   ECR, and require equal source/destination digests. Refresh exact retained and
   incoming root protections and native previews before policy changes. Default
   retention targets five objects; an explicit nine-object allowance permits
   three three-object worker roots or three single-manifest sidecar roots
   without deleting existing images. A sidecar repair therefore keeps three
   image objects, still below the five-object target. Ten
   objects and the existing 3 GiB worker-storage cap remain hard admissions.
   Stop if those bounds cannot accommodate the image; do not delete to fit.
5. Verify the accepted cloud/API generation, images and released host locks,
   then enable the single existing staging wake binding. Preserve pending wake
   hints and legitimate jobs. Activation can start an idle bootstrap task.
   Use the existing normal runtime (four jobs per task, 30-second quiet exit);
   do not deploy the isolated one-task-per-generation guard or its StopTask
   permission for this functional test.
6. Observe startup/HTTPS and clean shutdown, then tell the user when the normal
   staging game can test actual claim/render/upload/playback. The assistant does
   not create a game or invoke model/image/TTS providers. Retain the normal
   fenced rollback path and the accepted image family; do not reset epochs.

The proposed initial activation allowance includes a possible idle bootstrap
task. It is separate from the user's later game/provider/render costs. Linux
x86 2-vCPU/4-GiB compute is approximately $0.11356/hour in `us-west-1`, plus
usage. A spend allowance is not a hard AWS billing cap. No alarm, subscription,
registry secret or new persistent AWS permission is needed for this rollout.
