# Audio-Sub Player

## Objective

A self-hosted, single-file web app for Japanese immersion study on iPhone/iPad Safari. The app plays locally-stored podcast audio alongside a Whisper-generated SRT transcript, displays the current subtitle as selectable HTML text so Yomikiri (Safari extension) can perform dictionary lookups and export words to AnkiMobile.

## Context: the broader study stack

- **Reading (iPad/iPhone)**: ttu-reader (EPUB via Safari) + Yomikiri + AnkiMobile. Already working.
- **Video (desktop)**: asbplayer + Yomitan + AnkiConnect + desktop Anki (syncs to AnkiMobile via AnkiWeb). Already working.
- **Audio (iPad/iPhone)**: this app fills the gap. Whisper transcription is done offline on Mac (`whisper-cli`), producing an SRT file alongside the audio. Both are loaded into this app.

## Target devices / browsers

- Primary: iPhone/iPad, Safari (latest iPadOS)

## Transcription pipeline (outside the app)

bash

```bash
whisper-cli -m ~/whisper-models/ggml-large-v3.bin -l ja -osrt episode.mp3
# produces episode.mp3.srt alongside the audio
```

## Current state

A bare-bones `index.html` is live on GitHub Pages. It has:

- Audio file input + SRT file input
- SRT parser
- Playback-synced subtitle display (plain HTML div — Yomikiri can scan it)
- Offset adjustment buttons (+/- 0.5s)
- Works on desktop; audio file input broken on iOS Safari (needs fix)

## iOS file input fix needed

Audio upload is not working on iPhone (it does work on desktop). Needs fix.

Note: subtitle upload is working on both iPhone and desktop.

## Features to add

### P0 — required

- Fix iOS audio file input (see above)

### P1 — key features

- Subtitle list view: a scrollable list of all subtitles with their timestamps, tap to jump
- Previous/next subtitle
- Loop current subtitle (replay until dismissed)
- Auto-pause at end of current subtitle (toggle on/off)

### P2 IndexedDB storage and library UI

- Episode library: save audio (as Blob) + SRT + metadata to IndexedDB via idb-keyval
- Library UI: list of saved episodes, tap to load, swipe/button to delete, add episodes
- Export library backup (zip of all audio + SRT files, downloadable)
- Import library backup

### P3 - playback features

- Resume from last position: save `audio.currentTime` per episode, restore on load
- Persist offset and playback speed per episode

### P4 — nice to have

- Media Session API: lock-screen play/pause controls and episode title on iOS
- Auto-delete episodes older than N days (configurable)
- Visual waveform or progress bar with subtitle markers

### What the app would look like

Same core as before, plus a "library" UI. The flow:

1. **First time using an episode**: tap "Add Episode," pick the audio file and SRT file from iOS Files, give it a name. The app saves both into IndexedDB under that name.
2. **Returning to an episode**: open the app → see a list of saved episodes → tap one → it loads from IndexedDB and starts playing. No re-picking files.
3. **Offset and position persistence**: save the offset and last-played timestamp per episode, so resuming actually resumes.

## Storage design

Use **idb-keyval** (CDN import, ~3 KB):

js

```js
import { set, get, keys, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
```

Key schema:

```
episode:{name} → {
  audio: Blob,
  srt: string,
  offset: number,         // seconds, default 0
  lastPosition: number,   // seconds, default 0
  speed: number,          // default 1
  addedAt: number,        // Date.now()
  notes: string           // default ''
}
```

### Sketch of the storage layer

The IndexedDB API is famously verbose, but for this use case you can either write ~30 lines of wrapper or use a tiny library called **idb-keyval** (3 KB, gives you `set(key, value)` and `get(key)` as Promises). With idb-keyval:

javascript

```javascript
import { set, get, keys, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';

// Save an episode
async function saveEpisode(name, audioFile, srtText) {
  await set(`episode:${name}`, {
    audio: audioFile,           // a Blob; IndexedDB stores it natively
    srt: srtText,
    offset: 0,
    lastPosition: 0,
    addedAt: Date.now()
  });
}

// Load library list
async function listEpisodes() {
  const allKeys = await keys();
  return allKeys.filter(k => k.startsWith('episode:'))
                .map(k => k.replace('episode:', ''));
}

// Open an episode
async function loadEpisode(name) {
  const data = await get(`episode:${name}`);
  audio.src = URL.createObjectURL(data.audio);
  subs = parseSRT(data.srt);
  offset = data.offset;
  audio.currentTime = data.lastPosition;
}

// Update progress (call periodically)
async function saveProgress(name) {
  const data = await get(`episode:${name}`);
  data.offset = offset;
  data.lastPosition = audio.currentTime;
  await set(`episode:${name}`, data);
}
```

That's the whole storage layer. The UI on top is just a list of names with a "play" and "delete" button per row.

### Storage caveats

- Safari grants ~1 GB per origin; a 128 kbps 1-hour MP3 is ~60 MB → ~15 episodes comfortably.
- Safari may evict IndexedDB after 7 days of non-use (ITP). Mitigate with the export/import backup feature.
- Revoke Blob URLs with `URL.revokeObjectURL()` when switching episodes to avoid memory leaks.

## Architecture notes

- **Single HTML file**: inline all JS and CSS. No build step, no bundler. CDN imports are fine (idb-keyval).
- **No backend**: everything runs client-side. GitHub Pages hosts a static file.
- **Yomikiri/Yomitan compatibility**: subtitle text must be plain DOM text in a `<div>` or `<p>`. Never use canvas, SVG text, or JS-rendered non-selectable elements for subtitle display.
- **Anki export**: handled entirely by Yomikiri (iOS) or Yomitan (desktop) — no AnkiConnect integration needed in the app itself. The app just needs to display selectable text.
- **Offline**: once loaded, the page should work offline. Add a service worker to cache `index.html` and the idb-keyval CDN import. Audio/SRT are in IndexedDB so they're already offline.

## Deployment

GitHub Pages, single `index.html` at repo root. Push to `main` branch to deploy. 

URL pattern: `https://sc3235.github.io/audio-sub-player/`