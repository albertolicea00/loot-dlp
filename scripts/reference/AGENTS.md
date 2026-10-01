# AGENTS.md - Media Downloads Audit, Management, and Standardization Guide

This document defines the knowledge base, protocols, and workflows for AI agents (and developers) to audit, verify file integrity, and normalize TV series episodes and subtitles downloaded from local or remote repositories (e.g., `visuales.uclv.cu`).

---

## 1. Workflow Overview

The goal of this workspace structure is to maintain a clean, standardized, and media server compatible (Plex, Jellyfin, Kodi) media library, avoiding duplicate files, partial downloads, or leftover naming artifacts.

The main download script is `download.sh` located at the root of this directory, alongside specialized Python download tools in `./scripts/download_season.py`.
All helper scripts created by AI agents are stored in `./scripts/` and documented with detailed docstrings explaining their usage and context.

---

## 2. Step-by-Step Audit & Download Protocol

When an audit or download request is received for a TV series season, the AI agent must execute the following steps in sequence:

### Step 1: Verify Active Processes (Process Lifecycle Check)
Before modifying or moving files, verify if background downloads or renaming scripts are running using `./scripts/check_processes.sh`:

```bash
./scripts/check_processes.sh
```
* **If active processes are found:** Notify the user which processes are active and do NOT alter files currently being written.
* **If no active processes are found:** Declare the download/renaming task stopped/dead.

---

### Step 2: Episode Inventory & Integrity Audit
Inspect all files in the target directory with size details using `./scripts/audit_season.py`:

```bash
python3 ./scripts/audit_season.py "/Volumes/HDDTRANSINT/visuales.uclv.cu/Series/Ingles/CSI Las Vegas/S11"
```

#### Integrity Evaluation Criteria:
1. **0-Byte Files:** Corrupted or immediately interrupted downloads. Must be flagged for deletion or re-download.
2. **Suspiciously Small Files (< 120 MB for ~42 min episodes):**
   * *Note:* Standard x264/x265 40–45 min episodes typically range between **150 MB and 700 MB**.
   * If a video is `< 100 MB` (e.g., 89 MB), flag as **potentially incomplete / cut in half** and recommend manual verification or re-downloading.
3. **Subtitles (`.srt` / `.vtt`):** Typically range between **50 KB and 90 KB**.

---

### Step 3: Filename Standardization (Normalization)

All episodes and subtitles must adhere to the standard naming convention:

$$\text{ShowName} \quad \text{S\{Season\}E\{Episode\}} . \text{ext}$$

#### Standardized Examples:
* **Video:** `CSI Las Vegas S11E01.avi`, `Suits S09E01.mkv`
* **Subtitle:** `CSI Las Vegas S11E01.srt`, `Suits S09E01.srt`

To normalize filenames in a season directory, use `./scripts/normalize_names.py`:

```bash
python3 ./scripts/normalize_names.py "/path/to/season" "Show Name" SeasonNumber
```

---

### Step 4: Missing File Detection & Automated Downloading (with Resume Support)

To compare local downloads against the remote repository on `visuales.uclv.cu` and identify missing files:

```bash
python3 ./scripts/check_missing.py "/path/to/local/season" "https://visuales.uclv.cu/remote/season/url/"
```

To download missing subtitles and videos while auto-renaming and supporting **interrupted download resume (`curl -C -`)**:

```bash
python3 ./scripts/download_season.py "/path/to/local/season" "Show Name" SeasonNumber "https://visuales.uclv.cu/remote/season/url/" srt,avi,mkv,mp4
```

---

### Step 5: Duplicate and Artifact Cleanup

Automated or manual downloads frequently leave residual files:
* **Un-renamed originals:** e.g., `CSI 11x01.avi` alongside `CSI Las Vegas S11E01.avi`.
* **Duplicate subtitles:** e.g., `suits.s09e01.web.x264-tbs.srt` vs `Suits S09E01.srt`.
* **Corrupted 0B files:** e.g., `Suits.S09E07.Scenic Route.mkv` (0B).

Perform safe automated cleanups using `./scripts/clean_duplicates.py`:

```bash
python3 ./scripts/clean_duplicates.py "/Volumes/HDDTRANSINT/visuales.uclv.cu/Series/Ingles/Suits/Suits x 9"
```

---

## 3. Registered Utility Scripts in `./scripts/`

Every helper script stored in `./scripts/` includes a detailed docstring:

1. `scripts/check_processes.sh`: Checks for active background processes (`wget`, `curl`, `aria2c`, `download.sh`).
2. `scripts/audit_season.py`: Audits file sizes, flags 0-byte corrupted files or partial downloads (<120MB).
3. `scripts/normalize_names.py`: Normalizes filenames to standard `Show SxxExx.ext` format.
4. `scripts/check_missing.py`: Compares local files against `visuales.uclv.cu` to report missing episodes/subtitles.
5. `scripts/download_season.py`: Downloads missing files with auto-resume (`curl -C -`) and auto-renaming.
6. `scripts/clean_duplicates.py`: Atomically removes duplicate or residual files when standard `SxxExx` files exist.

---

*Document generated to guide AI agents in maintaining the `visuales.uclv.cu` media repository.*
