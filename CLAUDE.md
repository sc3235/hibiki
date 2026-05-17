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

1. Direct file upload — done. 
   `accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav,.aac"`
2. **MP3 URL** — paste a direct URL; set as `audio.src` directly. Note: depends on the host sending permissive CORS headers. Most podcast CDNs (Anchor, Libsyn, Buzzsprout, Transistor) do. No workaround if they don't.

**Subtitle source** (pick one per episode):

1. Direct file upload — done.
2. **SRT URL** — paste a direct URL; app fetches and parses it. Recommended hosting: push SRT files to a `subtitles/` folder in this GitHub repo; raw URL (`https://raw.githubusercontent.com/...`) works with no CORS issues.
3. **Whisper API transcription** — see P4 below.

### P1 — key features

- Subtitle display: subtitles are displaced in a large text box, with current subtitle in the middle and bolded, previous above, upcoming below. Timestamps are included.
- Tap to jump to given subtitle
- Previous/next subtitle buttons
- Loop current subtitle toggle (replay until dismissed)
- Auto-pause at end of current subtitle toggle
- Adjust subtitle font size
- Offset and playpack options
- Make play/pause closer to subtitles for better UX
- Media Session API: lock-screen play/pause controls and episode title on iOS

#### P1.5 — Per-episode wordlist

A lightweight vocabulary list attached to each episode. While listening, the user highlights a word in the subtitle (which also triggers Yomikiri for dictionary lookup), then taps **"+ Word"** to save it. The highlighted text is captured via `window.getSelection().toString()`. The current sentence and playback timestamp are saved automatically as context.

**Storage**: add `wordlist` array to the episode schema in IndexedDB:

javascript

```javascript
wordlist: [
  { word: "言語学", sentence: "言語学は面白い", timestamp: 342.5, addedAt: 1234567890 },
  ...
]
```

**Add flow** (~20 lines):

javascript

```javascript
document.getElementById('add-word-btn').addEventListener('click', () => {
  const word = window.getSelection().toString().trim();
  if (!word) return;
  const sentence = document.getElementById('subtitle').textContent.trim();
  const timestamp = audio.currentTime;
  episode.wordlist.push({ word, sentence, timestamp, addedAt: Date.now() });
  saveEpisode(episode); // persist to IndexedDB
  renderWordlist();
});
```

**Wordlist panel** (~50 lines): a toggleable panel showing the current episode's words as rows of `word | sentence | timestamp | delete button`. Tapping the word text makes it an inline editable input. Timestamp is a clickable link that seeks the audio to that position.

**UI**: a **"+ Word"** button near the subtitle display, and a **"Words (N)"** toggle button in the episode header that shows/hides the panel. The count updates live as words are added.

**Yomikiri compatibility note**: the highlight that triggers Yomikiri is the same selection captured by `getSelection()` — no extra gesture needed. The user highlights → Yomikiri shows definition → taps "+ Word" → both Anki export and wordlist addition are available from the same highlight.

### P2 — IndexedDB storage and library UI

- Build Library: save show, episode, audio (as Blob or URL string), SRT (as file or URL string), metadata to IndexedDB via idb-keyval
- Library UI: list of saved episodes grouped by show, tap to load, swipe/button to delete, add episodes
- `episodes.json` catalogue in repo: a hardcoded list of episodes with pre-filled audio + SRT URLs, loaded on app start so no manual pasting needed for known episodes
- Bulk Import for new episodes where both audio and sub are URL: show, episode, audio_url, sub_url

### P3 — persist meta and export/import

- Resume from last position: save `audio.currentTime` per episode, restore on load
- Persist offset and playback speed per episode, able to reset
- Export/import library backup without audio files

### P3.5[TODO] — export/import with audio

Full library backup as a downloadable zip (audio Blobs + SRT files + metadata + wordlists).

**Scope decisions** (already settled):
- Target library size: small (~100MB, few episodes). In-memory zip with JSZip is fine; no streaming needed.
- Export scope: entire library, single button (no per-show or per-episode selection).
- Import conflicts: overwrite existing episodes with imported version (no prompt).
- URL-only episodes (no downloaded audio Blob): include metadata + `audioUrl` in manifest, no audio file in zip. Don't fetch at export time.

**Estimated work**: ~130–170 lines + JSZip CDN import. A few hours of focused work.

**Implementation sketch**:

- CDN import: `import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm'`
- Use STORE method (no compression) — audio is already compressed, zip compression buys nothing and slows export.
- Zip layout:
  ```
  manifest.json
  audio/<safe-name>.<ext>      (only for episodes with a downloaded Blob)
  subtitles/<safe-name>.srt
  ```
- Manifest schema:
  ```json
  {
    "version": 1,
    "exportedAt": 1731600000000,
    "episodes": [
      {
        "key": "episode:foo",
        "audioFile": "audio/foo.mp3",   // null if URL-only
        "audioMimeType": "audio/mpeg",  // preserve for Blob reconstruction
        "audioUrl": null,
        "srtFile": "subtitles/foo.srt",
        "offset": 0,
        "lastPosition": 342.5,
        "speed": 1,
        "addedAt": 1731000000000,
        "notes": "",
        "wordlist": [...]
      }
    ]
  }
  ```
  `version` field enables forward-compatible schema changes.

**Gotchas to remember**:
- Preserve audio Blob MIME type on extract: `new Blob([data], { type: manifest.audioMimeType })` — JSZip strips MIME on extract.
- Sanitize episode keys before using as filenames (slashes/colons break some filesystems).
- Wordlist (P1.5) must roundtrip — include in the manifest record.
- iOS Safari handles `.zip` downloads at this size reliably; no workaround needed.

### P4 — download audio for offline use

For URL-sourced episodes, add a **Download** button in the library episode row. Tapping it fetches the audio URL and stores the response as a Blob in IndexedDB. Keep `audioUrl` (and `srtUrl`) in the record even after downloading — they serve as the canonical source reference for export/import.

- Show a progress indicator while fetching (audio files are large — user needs feedback)
- After download, swap the button to a "Downloaded ✓" state (or hide it)
- SRT text is already fetched and stored in IndexedDB at import time, so it's already offline; `srtUrl` is just retained for reference

Side: within library, allow edit show/episode name; allow refresh url (removes download) 

### P5[TODO] — in-browser Whisper API transcription

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

**Hallucination handling**: Whisper can hallucinate text over silence, music, or low-quality audio. Partial mitigation is possible by switching `response_format` from `'srt'` to `'verbose_json'`, which exposes per-segment confidence fields: `no_speech_prob` (filter if > 0.5), `avg_logprob` (filter if < -1.0), and `compression_ratio` (flag abnormally high values indicating repetitive output). Filtered segments would then be converted to SRT manually (~20 lines). Ceiling: this only catches obvious non-speech segments — Whisper hallucinating plausible Japanese text during noise produces normal confidence scores and cannot be detected automatically. A user-facing note to review the SRT before studying is still advisable.

## Infrastructure

### GitHub-hosted SRT files

SRT files are small (~100–200 KB per hour of audio). Store them in this repo:

```
hibiki/
  index.html
  subtitles/
    episode-name.srt
    ...
  cloudflare-worker/
    index.js
```

Raw URL format (no CORS issues):

```
https://raw.githubusercontent.com/sc3235/hibiki/main/subtitles/episode-name.srt
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
- **No backend**: everything runs client-side.
- **Yomikiri/Yomitan compatibility**: subtitle text must be plain DOM text in a `<div>` or `<p>`. Never use canvas, SVG text, or JS-rendered non-selectable elements for subtitle display.
- **Anki export**: handled entirely by Yomikiri (iOS) or Yomitan (desktop) — no AnkiConnect integration needed in the app itself. The app just needs to display selectable text.

## Deployment

GitHub Pages, single `index.html` at repo root. Push to `main` branch to deploy.

URL: `https://sc3235.github.io/hibiki/`

---

## Appendix

### A1 — Apple Podcasts → MP3 URL resolution (not implemented)

Would enable pasting an Apple Podcasts episode URL directly as the audio source. Requires a Cloudflare Worker to proxy the iTunes lookup API (which doesn't send CORS headers).

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
5. **Fallback**: if `episodeUrl` is absent, fetch the show's `feedUrl` via the Worker, parse the RSS `<enclosure url="">` for the matching episode by title or date.

**Cloudflare Worker** (free tier: 100k requests/day, no credit card required):

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) return new Response('Missing url param', { status: 400 });

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

Deploy via Cloudflare dashboard or `wrangler`. Store the URL as `const CORS_PROXY = 'https://your-worker.your-name.workers.dev'` at the top of `index.html`.
