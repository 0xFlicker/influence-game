# Search sitemap

The web app generates `/sitemap.xml` on request from the main public entry points, enabled game collections, non-draft update articles, and the public seasons API. Each season has a dashboard link and a season-games link. New seasons appear without a deployment; new update articles appear after the web app is rebuilt and deployed. The sitemap request fails if the season API fails, rather than publishing an incomplete sitemap. Account, admin, and other private routes are omitted.

Individual games, player and agent profiles, and event pages are not enumerated. Search engines may discover public pages by following links, but the sitemap does not guarantee discovery.

After deploying, open `https://thehouse.game/sitemap.xml` to check it, then submit `sitemap.xml` in the site's Google Search Console property. Submission helps discovery but does not guarantee indexing. This change does not submit the sitemap or deploy the site.
