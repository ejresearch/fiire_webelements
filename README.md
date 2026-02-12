# FIIRE

**Burn out the noise. Ignite your sound.**

FIIRE is an AI-powered DAW and sample generation studio for music producers. It combines generative AI with a full timeline-based production environment — generate custom sounds, arrange them on tracks, mix with per-track effects, and export. No sample pack digging, no context switching.

## Features

### Studio — DAW Workspace

The studio is a three-section workspace inspired by Ableton Live:

**Base Samples** (top) — A 12-slot curated palette of your working sounds. Click an empty slot to generate a new sample with AI, or import audio files (WAV/MP3/OGG/FLAC) via the upload button or drag-and-drop.

**Sample Bar** (middle) — A quick-access rack that auto-populates with favorited and recently used samples.

**Track Timeline** (bottom) — A multi-track sequencer for arranging samples into a full composition.

#### Core Audio
- **AI Generation** — Text-to-sound via ElevenLabs API with control over instrument, genre, energy, BPM, key, bar length, attack, and timbre
- **Audio Import** — Drag-and-drop or file picker for WAV, MP3, OGG, FLAC
- **Recording** — Record from mic/audio interface directly onto a track (arm track, hit R)
- **Playback Engine** — Look-ahead scheduling (25ms tick, 100ms window) for sample-accurate timing

#### Timeline & Arrangement
- **Multi-track sequencer** with drag-and-drop from base samples to lanes
- **Block editing** — Move, resize, split at playhead (S key), delete
- **Loop region** — Toggle loop mode, set boundaries with Alt+click on ruler
- **Grid snapping** — 1 bar, 1 beat, 1/2 beat, or off
- **Zoom** — Ctrl+scroll to zoom timeline

#### Mixing
- **Per-track volume** fader and **pan** knob
- **Mute/Solo** per track
- **Block gain** — 0–200% per clip via right-click context menu
- **Fades** — Fade-in and fade-out per block with visual overlays
- **Per-track metering** — RMS level + peak hold indicators
- **Master stereo meter** — L/R level bars in the transport

#### Effects
Each track has an independent effects chain with real-time control:
- **3-Band EQ** — Low shelf (320 Hz), peaking mid (1 kHz), high shelf (3.2 kHz), +/-12 dB per band
- **Reverb** — Convolution-based with synthetic impulse response, mix + decay controls
- **Delay** — Time (0.01–2s), feedback (0–90%), wet/dry mix

Effects are accessed via the **FX** button on each track header. Each effect has an on/off toggle.

#### Editing
- **Split** — Press S to split clips at the playhead
- **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z (50-level history)
- **Right-click context menu** — Gain, fades, split, delete per block

### Sound DNA

- **Upload & Analyze** — Drop in 2–10 of your own tracks and FIIRE analyzes them client-side
- **Sound Profile** — Extracts BPM, key, energy, spectral characteristics (brightness, warmth, low end)
- **Personalized Pack Generation** — Builds tailored prompts from your profile and generates a 16-sample pack across Drums, Bass, Melodic, and Textures

### Home Dashboard

- **Project switcher** and overview of recent activity
- **Quick links** to Studio, Sound DNA, and Library

### Library & Organization

- **Project System** — Organize samples across multiple projects
- **Library** — Browse, search, filter, and batch-manage all samples
- **Favorites** — Bookmark samples for quick access
- **Inspector** — View sample details, edit tags and notes
- **WAV Export** — Download any sample as a WAV file

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| S | Split blocks at playhead |
| R | Toggle recording |
| Delete / Backspace | Delete selected blocks |
| Escape | Deselect / close panels |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+Scroll | Zoom timeline |
| Alt+Click ruler | Set loop start |
| Alt+Shift+Click ruler | Set loop end |

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML, CSS |
| Styling | Tailwind CSS (CDN) |
| Icons | Material Symbols (Google Fonts) |
| Typography | Space Grotesk (Google Fonts) |
| Audio Engine | Web Audio API |
| AI Generation | ElevenLabs Sound Generation API |
| AI Chat | Claude API (prompt refinement) |
| Storage | localStorage + IndexedDB |
| Server | Python 3 HTTP server (development) |

No build tools, no package manager, no framework.

## Project Structure

```
fiire.ai/
  index.html          Landing page
  home.html           Home dashboard
  studio.html         DAW workspace
  sounddna.html       Sound DNA analyzer
  onboarding.html     First-run onboarding
  css/
    shared.css        All component styles
  js/
    shared.js         Core infrastructure (state, audio engine, persistence, IndexedDB)
    studio.js         Studio page logic (timeline, generation, effects, recording)
    sounddna.js       Sound DNA analysis and pack generation
    home.js           Home dashboard logic
    blaise.js         Blaise AI chat assistant
  logo.png            FIIRE logo
  serve.sh            Local dev server script
  server.py           Python dev server with CORS
```

## Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge)
- Python 3 (for the local dev server)
- An [ElevenLabs](https://elevenlabs.io) API key (optional — the app works without one using synthetic fallback audio)

### Run Locally

```bash
git clone https://github.com/ejresearch/fiire_v1.git
cd fiire_v1
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) for the landing page or [http://localhost:8000/studio.html](http://localhost:8000/studio.html) to go straight to the studio.

### Set Up API Key

1. Open the studio
2. Click **Settings** in the sidebar
3. Enter your ElevenLabs API key
4. Start generating

## Audio Routing

Per-track signal chain:

```
BufferSource → BlockGain → TrackInput → EQ (3-band) → Reverb (dry/wet) → Delay (dry/wet) → Pan → TrackGain → Analyser → MasterGain → MasterAnalyser → Destination
```

Master output includes a stereo channel splitter for independent L/R metering.

## Data Storage

All data stays in your browser:
- **localStorage** — Sample metadata, arrangement state, project definitions, Sound DNA profiles, API keys, counters
- **IndexedDB** — Audio file blobs (WAV format)

Nothing is sent to any server except the ElevenLabs and Claude APIs for generation and chat.

## License

Proprietary. All rights reserved.
