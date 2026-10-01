# Supported Providers & Protocols

`loot-dlp` relies on a modular extraction architecture with dedicated scrapers for catalog indices, automated resolvers for embedded players, and generic stream protocol parsers.

---

## Dedicated Site Extractors

Below is the status matrix for primary site extractors, tracking operational status, stream types, and parser updates:

| Provider / Site | Identifier | Stream Type | Status | Last Verified |
| :--- | :--- | :--- | :--- | :--- |
| **AnimeFLV** | `animeflv` | HLS (`.m3u8`), Direct MP4 | Pending | - |
| **Cuevana** | `cuevana` | HLS (`.m3u8`), DASH (`.mpd`) | Pending | - |
| **TioAnime** | `tioanime` | Direct MP4, Embedded HLS | Pending | - |
| **JKAnime** | `jkanime` | Direct MP4, HLS | Pending | - |
| **PelisPlus** | `pelisplus` | Embedded HLS | Pending | - |
| **AnimeBoom** | `animeboom` | HLS (`.m3u8`) | Pending | - |

---

## Embedded Host Resolvers

If a website delegates video delivery to third-party storage hosts or embedded players, `loot-dlp` automatically intercepts the iframe and resolves the direct stream:

| Host / Resolver | Max Resolution | Status | Last Updated |
| :--- | :--- | :--- | :--- |
| **Streamtape** | 1080p | Pending | - |
| **Fembed / Voe** | 1080p | Pending | - |
| **YourUpload** | 720p | Pending | - |
| **Mega.nz** | Source | Pending | - |
| **Doodstream** | 720p | Pending | - |
| **Mixdrop** | 1080p | Pending | - |
| **Streamwish** | 1080p | Pending | - |
| **Vidhide** | 1080p | Pending | - |

---

## Generic Protocol Handlers

Pages not explicitly listed above can still be parsed using generic streaming handlers if they embed standard media pipelines:

* **HLS (`.m3u8`):** Multi-bitrate master playlist selection, parallel chunk fetching, and automatic `ffmpeg` demuxing/reassembly.
* **MPEG-DASH (`.mpd`):** Initialization segment retrieval and unified AV track merging.
* **HTML5 Direct (`.mp4`, `.webm`):** Range header chunk download with custom HTTP Referer and User-Agent spoofing.

---

## Site & Architecture Compatibility

To check whether a specific page is supported or inspect the installed extractors in your local environment, run:

```bash
# List all registered site extractors and active resolvers
loot-dlp --list-extractors

# Dry-run a target URL to check extractor matching and stream health
loot-dlp "[https://example.com/watch/item](https://example.com/watch/item)" --dry-run
