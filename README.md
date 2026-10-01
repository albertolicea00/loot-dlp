# loot-dl

A modular command-line media downloader for extracting and saving streaming video feeds, embedded players, and segmented web broadcasts.

## Features

- **Modular Extractors:** Pluggable parser architecture to support multiple streaming layouts and target endpoints.

## Prerequisites

- Python 3.10+
- `ffmpeg` installed and accessible via system `$PATH`

## Installation

```bash
# Clone the repository
git clone [https://github.com/your-username/loot-dl.git](https://github.com/your-username/loot-dl.git)
cd loot-dl

# Install dependencies
pip install -r requirements.txt

# Install CLI locally in editable mode
pip install -e .
