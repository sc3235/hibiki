# Audio-Sub Player

## Objective

A self-hosted, single-file web app for Japanese immersion study on iPhone/iPad Safari. The app plays audio alongside a SRT transcript, displays the current subtitle as selectable HTML text so Yomikiri (Safari extension) can perform dictionary lookups and export words to AnkiMobile. 

Works on desktop too with Yomikiri (Safari extension) replaced by Yomitan (Chrome extension), and the AnkiMobile process replaced by desktop Anki with AnkiConnect.

## Context: the broader study stack

- **Reading (iPad/iPhone)**: ttu-reader (EPUB via Safari) + Yomikiri + AnkiMobile. Already working.
- **Video (desktop)**: asbplayer + Yomitan + desktop Anki with AnkiConnect. Already working.
- **Audio (iPhone/iPad)**: this app fills the gap. Whisper transcription is done offline on Mac (`whisper-cli`), producing an SRT file alongside the audio. Both are loaded into this app.

## Target devices / browsers

- Primary: iPhone/iPad, Safari (latest iPadOS)

## Transcription pipeline (when done offline on Mac)

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

## UI aesthetics

Already done, looks good.

## Features to add

### P0 — basic

**Audio source** (pick one per episode):

1. Direct file upload — done. Fix iOS Safari: replace `accept="audio/*"` with explicit types:
   `accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav,.aac"`
2. **MP3 URL** — paste a direct URL; set as `audio.src` directly. Note: depends on the host sending permissive CORS headers. Most podcast CDNs (Anchor, Libsyn, Buzzsprout, Transistor) do. No workaround if they don't.
3. **Apple Podcasts episode link** — see P6 below.

**Subtitle source** (pick one per episode):

1. Direct file upload — done. Fix iOS Safari: replace accept attribute with:
   `accept=".srt,.vtt,text/plain"`
2. **SRT URL** — paste a direct URL; app fetches and parses it. Recommended hosting: push SRT files to a `subtitles/` folder in this GitHub repo; raw URL (`https://raw.githubusercontent.com/...`) works with no CORS issues.
3. **Whisper API transcription** — see P5 below.

### P1 — key features

- Subtitle display: subtitles are displaced in a large text box, with current subtitle in the middle and bolded, previous above, upcoming below. Timestamps are included.
- Tap to jump to given subtitle
- Previous/next subtitle buttons
- Loop current subtitle toggle (replay until dismissed)
- Auto-pause at end of current subtitle toggle
- Adjust subtitle font size
- Make play/pause closer to subtitles for better UX

### P2 — IndexedDB storage and library UI

- Episode library: save audio (as Blob, or as URL string if sourced from URL) + SRT + metadata to IndexedDB via idb-keyval
- Library UI: list of saved episodes, tap to load, swipe/button to delete, add episodes
- Export library backup (zip of all audio + SRT files + metadata, downloadable)
- Import library backup

### P3 — playback features

- Resume from last position: save `audio.currentTime` per episode, restore on load, able to reset
- Persist offset and playback speed per episode, able to reset

### P4 — nice to have

- Media Session API: lock-screen play/pause controls and episode title on iOS
- Auto-delete episodes older than N days (configurable)
- Visual waveform or progress bar with subtitle markers
- `episodes.json` catalogue in repo: a hardcoded list of episodes with pre-filled audio + SRT URLs, loaded on app start so no manual pasting needed for known episodes

### P5 — in-browser Whisper API transcription

Calls OpenAI's Whisper API directly from the browser. User supplies their own API key (stored in IndexedDB, never leaves the device).

```javascript
async function transcribeWithWhisper(audioFile, apiKey) {
  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja');
  formData.append('response_format', 'srt');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  return await response.text(); // returns SRT directly
}
```

**Cost**: ~$0.006/min of audio. A 1-hour episode ≈ $0.36.

**File size limit**: OpenAI enforces a 25 MB cap per request (~26 min at 128 kbps, ~52 min at 64 kbps). For longer episodes, either use local `whisper-cli` instead, or split the audio before uploading.

**Advantage over local whisper-cli**: works on iPad with no Mac involved. Transcribe → study in one flow on device.

### P6 - Apple Podcast episode link to mp3 url

Paste an Apple Podcasts URL; app resolves the MP3 URL automatically via the iTunes lookup API + Cloudflare Worker proxy (see infrastructure section below).

## Infrastructure

### Cloudflare Worker (CORS proxy for iTunes API)

Needed for P0 audio method 3 (Apple Podcasts link → MP3 URL resolution).

The iTunes lookup API doesn't send CORS headers, so it can't be called directly from the browser. A Cloudflare Worker proxies the request server-side and adds CORS headers on the response.

**Free tier**: 100,000 requests/day. No credit card required.

Worker source lives at `cloudflare-worker/index.js` in this repo. Deploy via Cloudflare dashboard or `wrangler`. Store the deployed Worker URL as a constant at the top of `index.html`:

```javascript
const CORS_PROXY = 'https://your-worker.your-name.workers.dev';
```

Worker code:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) return new Response('Missing url param', { status: 400 });

    // Allowlist: only proxy Apple/iTunes domains
    const allowed = ['itunes.apple.com', 'podcasts.apple.com'];
    const targetHost = new URL(target).hostname;
    if (!allowed.some(d => targetHost.endsWith(d))) {
      return new Response('Domain not allowed', { status: 403 });
    }

    const response = await fetch(target);
    const body = await response.text();

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
```

### Apple Podcasts → MP3 URL resolution

Apple Podcasts episode URLs look like:

```
https://podcasts.apple.com/us/podcast/show-name/id123456789?i=1000612345678
```

- Show ID: `123456789` (from `id...` segment)
- Episode ID: `1000612345678` (from `?i=` param)

Resolution flow:

1. Parse show ID and episode ID from the URL with a regex.

2. Call iTunes lookup API via the Cloudflare Worker:

   ```
   GET {CORS_PROXY}/?url=https://itunes.apple.com/lookup?id={showId}&entity=podcastEpisode&limit=200
   ```

3. Find the episode in the JSON response by matching `trackId` to the episode ID.

4. Use `episodeUrl` field as the direct MP3 URL.

5. **Fallback**: if `episodeUrl` is absent, fetch the show's `feedUrl` (also in the response) via the Worker, parse the RSS `<enclosure url="">` for the matching episode by title or date.

### GitHub-hosted SRT files

SRT files are small (~100–200 KB per hour of audio). Store them in this repo:

```
audio-sub-player/
  index.html
  subtitles/
    episode-name.srt
    ...
  cloudflare-worker/
    index.js
```

Raw URL format (no CORS issues):

```
https://raw.githubusercontent.com/sc3235/audio-sub-player/main/subtitles/episode-name.srt
```

## Storage design

Use **idb-keyval** (CDN import, ~3 KB):

```js
import { set, get, keys, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
```

Key schema:

```
episode:{name} → {
  audio: Blob | null,      // null if sourced from URL
  audioUrl: string | null, // URL if not a local file
  srt: string,
  offset: number,          // seconds, default 0
  lastPosition: number,    // seconds, default 0
  speed: number,           // default 1
  addedAt: number,         // Date.now()
  notes: string            // default ''
}
```

### Storage caveats

- Safari grants ~1 GB per origin; a 128 kbps 1-hour MP3 is ~60 MB → ~15 episodes comfortably.
- Episodes sourced from URL store no audio Blob — negligible storage, no quota concerns.
- Safari may evict IndexedDB after 7 days of non-use (ITP). Mitigate with the export/import backup feature (P2).
- Revoke Blob URLs with `URL.revokeObjectURL()` when switching episodes to avoid memory leaks.

## Architecture notes

- **Single HTML file**: inline all JS and CSS. No build step, no bundler. CDN imports are fine (idb-keyval).
- **No backend**: everything runs client-side except the Cloudflare Worker (stateless, trivial).
- **Yomikiri/Yomitan compatibility**: subtitle text must be plain DOM text in a `<div>` or `<p>`. Never use canvas, SVG text, or JS-rendered non-selectable elements for subtitle display.
- **Anki export**: handled entirely by Yomikiri (iOS) or Yomitan (desktop) — no AnkiConnect integration needed in the app itself. The app just needs to display selectable text.
- **Offline**: once loaded, the page should work offline. Add a service worker to cache `index.html` and the idb-keyval CDN import. Audio/SRT in IndexedDB are offline. URL-sourced audio requires network.

## Deployment

GitHub Pages, single `index.html` at repo root. Push to `main` branch to deploy.

URL: `https://sc3235.github.io/audio-sub-player/`