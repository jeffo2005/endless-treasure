# Endless Treasure

> **Infinite Scripture Audio & Cross-Reference Explorer**

Endless Treasury is an interactive, continuous Scripture listening and non-linear exploration application. Starting from any verse or topical theme, it continuously journeys through the King James Bible by following the cross-reference pathways of the **Treasury of Scripture Knowledge (TSK)**, reading each verse aloud using your browser's native Text-to-Speech engine.

---

## Features

- **Realistic Cloud Neural Narration**: Uses browser-integrated AI speech (AWS Polly Neural and OpenAI high-fidelity voices like Onyx, Fable, Matthew) with zero API keys or subscriptions required.
- **Mobile Background Audio & Lock Screen**: Plays through an HTML5 `<audio>` pipeline so audio keeps streaming on mobile Safari when the phone is locked or browser is exited, complete with lock screen controls via the `MediaSession` API.
- **Offline Fallback**: Seamlessly falls back to local device voices if offline.
- **Continuous Scripture Stream**: Plays verses continuously, deciding whether to read consecutive verses or jump across cross-references based on your chosen settings.
- **Personalized PageRank (PPR)**: Uses graph search and personalized PageRank to keep the listening journey anchored tightly or loosely around your chosen theme or starting verse.
- **Original Hebrew & Greek Word Studies**: Explore the Strong's concordance root words behind English terms (e.g. *love*, *grace*, *forgiveness*), chaining occurrences in biblical or shuffled order.
- **Native Browser Text-to-Speech**: Uses the Web Speech API with automatic voice detection and fallback to timed reading when silent.
- **Customizable Experience Dials**:
  - **Jumpiness**: Adjust the probability of following cross-references vs. reading consecutively.
  - **Focus**: Control the PageRank candidate pool size (tight on topic vs. wide exploration).
  - **Speed**: Adjust narration playback speed (0.70× to 1.40×).
  - **Pause**: Set pause length between verses.
- **Interactive Branching & Trail**:
  - **"Where it can go from here"**: Click any outgoing cross-reference to steer the journey.
  - **"Path so far"**: History log of verses visited; click any past verse to re-anchor and continue from there.
- **Hardware & Media Key Support**: Integrates with the `MediaSession` API (play/pause/skip via headphones or lock screen) and keyboard shortcuts.
- **Light / Dark / Auto Theme**: Seamless support with custom theme switching.
- **100% Offline / Portable**: All 31,102 verses and 13,905 Strong's entries are bundled locally. Zero external runtime dependencies.

---

## Directory Structure

```text
endless-treasury/
├── index.html               # Modular production web app
├── standalone.html          # Self-contained single-file distribution (offline portable)
├── css/
│   └── style.css            # Stylesheet (CSS variables, layout, light & dark theme)
├── js/
│   ├── data.js              # Full KJV text, TSK graph, and Strong's lexicon
│   └── app.js               # Application logic, audio engine, search & PageRank walk
├── icons/
│   └── icon.svg             # Vector app icon
├── manifest.webmanifest     # PWA manifest for desktop/mobile installation
├── sw.js                    # Service worker for offline asset caching
└── README.md                # Project documentation
```

---

## How to Run

### Option 1: Direct File Access (No Server Required)
You can directly open `index.html` or `standalone.html` in any web browser (Chrome, Edge, Safari, Firefox) by double-clicking the file in your file explorer. Because `js/data.js` uses standard script loading, there are no CORS restrictions.

### Option 2: Run via Local Web Server
To test PWA installation and Service Worker caching:
```bash
# Using Python:
python -m http.server 8000

# Using Node (npx):
npx serve .
```
Then visit `http://localhost:8000` in your browser.

---

## Deploying to the Web

Because the project is completely static, you can deploy it to any static hosting provider for free in seconds:

- **GitHub Pages**: Push this directory to a GitHub repository, go to **Settings > Pages**, and select the branch root.
- **Netlify / Vercel / Cloudflare Pages**: Drag and drop this folder or connect your Git repository.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `ArrowRight` | Skip to next verse |
| `c` | Copy current verse and reference to clipboard |

---

## Credits & Public Domain Sources

- **Text**: King James Version (public domain).
- **Cross-References**: The *Treasury of Scripture Knowledge* (R. A. Torrey, public domain), scored in the OpenBible.info cross-reference dataset (CC BY 4.0).
- **Hebrew & Greek Tagging**: STEPBible Tagged texts (CC BY 4.0, STEP Bible / Tyndale House).
- **Word Definitions**: Strong's Dictionary via Open Scriptures (CC BY-SA).
