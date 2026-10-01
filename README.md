# loot-dlp

A modular command-line media downloader for extracting and saving streaming video feeds, embedded players, and segmented web broadcasts.

## Features

- **Modular Extractors:** Pluggable parser architecture to support multiple streaming layouts and target endpoints.

## Prerequisites

- Node.js 18+
- `ffmpeg` installed and accessible via system `$PATH`

## Installation

```bash
# Clone the repository
git clone https://github.com/albertolicea00/loot-dlp.git
cd loot-dlp

# Install dependencies (also installs Playwright browsers)
npm install

# Link the CLI globally so you can use the `loot-dlp` command
npm link
```
