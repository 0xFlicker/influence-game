---
module: object-storage
problem_type: configuration
---

# Reject conflicting storage selections

An explicit AWS object-storage provider and a local public-backend override must not silently select different storage families for public and private writes. Provider validation rejects the conflict before either adapter constructs a client or public upload target. The intentional disabled public-backend setting and legacy local mode remain available.

An explicitly selected shared local-storage config must also exist. The private bootstrap now stops before running Bun, Docker, curl, or writing the legacy environment file when that file is missing. An existing explicit config still delegates to the shared-storage command. Neither check migrates existing objects or authorizes a storage cutover.
