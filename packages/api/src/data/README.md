# Onomaverse name data

Names data from [Onomaverse](https://onomaverse.com/datasets), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The House adapted the `v2026.10` given-name and surname tables by normalizing
and deduplicating name text, dropping values that cannot fit a profile name,
and grouping the retained names by country. It uses name text and country
membership only.

To reproduce the bundled snapshot, download `given-name-frequency.jsonl` and
`surname-frequency.jsonl` from the [pinned release](https://github.com/onomaverse/datasets/releases/tag/v2026.10)
into the same directory. Run the rebuild script from the repository root.

```sh
bun packages/api/src/scripts/prepare-onomaverse-names.ts /path/to/downloads
```

The build script checks the published SHA-256 for each input before replacing
`onomaverse-v2026.10.json`.
