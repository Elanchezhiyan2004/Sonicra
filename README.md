# 🎵 Sonicra

> Fed up with ads interrupting my music. So I built my own streaming app.

[![Live](https://img.shields.io/badge/Live-sonicra.netlify.app-1ed760?style=for-the-badge&logo=netlify&logoColor=white)](https://sonicra.netlify.app)
![HTML](https://img.shields.io/badge/HTML-E34F26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)
![Netlify](https://img.shields.io/badge/Netlify-00C7B7?style=flat&logo=netlify&logoColor=white)

Sonicra is a personal music streaming web app — full song playback via YouTube, personal library via Supabase, installable as a PWA. No ads. No frameworks. No nonsense.

---

## ✨ Features

- 🔍 Search any song, artist or album instantly
- ▶ Full song playback — completely ad-free
- 👤 User accounts — sign up & log in with email
- ♥ Liked Songs saved to your personal cloud library
- 🎵 Create & manage playlists — no duplicates
- ⏭ Manual queue with Play Next support
- 🔀 Shuffle — plays each song once before repeating
- ⏱ Sleep timer — by minutes or end of current song
- ⋮ Context menu on every song — play, queue, like, add to playlist
- 🌗 Dark & Light theme toggle
- 📱 PWA — install on your phone, no app store needed
- 🔑 Multiple API keys — auto-rotates on quota exceeded

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript |
| Music | YouTube Data API v3 + IFrame Player API |
| Backend | Supabase (Auth + PostgreSQL) |
| Hosting | Netlify |
| PWA | Web App Manifest + Service Worker |

---

## 🚀 Getting Started

### 1. Clone & Setup

```bash
git clone https://github.com/yourusername/sonicra.git
cd sonicra
```

### 2. Get your API keys

- **YouTube** — [console.cloud.google.com](https://console.cloud.google.com) → New Project → Enable YouTube Data API v3 → Create API Key
- **Supabase** — [supabase.com](https://supabase.com) → New Project → copy Project URL & Anon Key

### 3. Configure

Edit `config.js`:

```js
const CONFIG = {
  YT_API_KEYS: [
    'YOUR_YOUTUBE_API_KEY',
    // add more keys for more daily searches
  ].filter(k => !k.includes('YOUR_')),

  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_xxxx',
};
```

### 4. Run locally (HTTPS required for YouTube)

```bash
# Install mkcert
winget install FiloSottile.mkcert
mkcert -install
mkcert localhost

# Start
node server.js
```

Open **`https://localhost:3000`**

### 5. Deploy

Drag your project folder to [app.netlify.com/drop](https://app.netlify.com/drop) — live in 60 seconds.

---

## 🗄️ Database

Three tables in Supabase, all scoped per user:

```
auth.users
  ├── liked_songs       (track_id, track_name, artist_name, album_art)
  ├── playlists         (name)
  └── playlist_tracks   (playlist_id → playlists, track details)
```

---

## ⚙️ How It Works

Search calls YouTube Data API v3 (music category, embeddable only). Clicking a song loads it in a hidden 1×1px YouTube IFrame player — you hear audio, no YouTube UI, no ads. When the queue ends, it auto-fetches related songs by the same artist.

**Queue priority:** Manual queue → Shuffle → Search/playlist queue → Auto-related

---

## 📲 Install as App (PWA)

**Android** — Open in Chrome → 3-dot menu → Add to Home Screen

**iPhone** — Open in Safari → Share → Add to Home Screen

---

## ⚠️ Limitations

- YouTube API free tier: ~100 searches/day per key (add multiple keys to extend)
- Audio quality: ~128kbps (YouTube stream)
- No YouTube Music API exists — YouTube Data API v3 is the only legitimate free option
- Mobile autoplay requires one tap due to browser security policy

---

## 🔮 Roadmap

- [ ] Recently played history
- [ ] Repeat one / repeat all
- [ ] Artist pages
- [ ] Lyrics display
- [ ] Playlist sharing

---

<div align="center">
Built with 💚 — <a href="https://sonicra.netlify.app">sonicra.netlify.app</a>
</div>
