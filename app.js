// =============================================
//  SONICRA — YouTube Edition
//  Full song playback via YouTube IFrame API
// =============================================

// ─── State ──────────────────────────────────────
let db = null;
let ytPlayer = null;
let ytReady = false;
let currentTrack = null;
let currentQueue = [];
let currentQueueIndex = 0;
let isPlaying = false;
let likedSongIds = new Set();
let playlists = [];
let currentPlaylistId = null;
let searchDebounceTimer = null;
let progressTimer = null;

// ─── YouTube IFrame API Ready ────────────────────
function onYouTubeIframeAPIReady() {
  console.log('✅ YouTube IFrame API Ready');
  ytPlayer = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      origin: window.location.origin,
    },
    events: {
      onReady: (e) => {
        ytReady = true;
        console.log('✅ YT Player ready');
        e.target.setVolume(80);
      },
      onStateChange: onPlayerStateChange,
      onError: (e) => {
        console.error('YT Error:', e.data);
        // Error codes: 2=bad param, 5=HTML5 error, 100=not found, 101/150=embed not allowed
        showToast('Video unavailable, skipping...');
        setTimeout(() => nextTrack(), 1000);
      },
    },
  });
}

function onPlayerStateChange(event) {
  const S = YT.PlayerState;
  if (event.data === S.PLAYING) {
    isPlaying = true;
    document.getElementById('play-pause-btn').textContent = '⏸';
    startProgressTimer();
  } else if (event.data === S.PAUSED) {
    isPlaying = false;
    document.getElementById('play-pause-btn').textContent = '▶';
    stopProgressTimer();
  } else if (event.data === S.ENDED) {
    stopProgressTimer();
    nextTrack();
  } else if (event.data === S.BUFFERING) {
    document.getElementById('play-pause-btn').textContent = '⏳';
  } else if (event.data === -1) {
    // Unstarted - check after 3s if still not playing, skip
    setTimeout(() => {
      if (ytPlayer && ytPlayer.getPlayerState() === -1) {
        console.warn('Video stuck/unavailable, trying next...');
        nextTrack();
      }
    }, 3000);
  }
}

function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (!ytPlayer || !ytReady) return;
    const current = ytPlayer.getCurrentTime() || 0;
    const duration = ytPlayer.getDuration() || 0;
    if (duration > 0) {
      document.getElementById('progress-fill').style.width = `${(current / duration) * 100}%`;
      document.getElementById('current-time').textContent = formatTime(current);
      document.getElementById('duration-label').textContent = formatTime(duration);
    }
  }, 500);
}

function stopProgressTimer() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

// ─── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setGreeting();
  initTheme();
  db = initSupabase();
  await Promise.all([loadLikedSongs(), loadPlaylists()]);
  showView('home');
});

function setGreeting() {
  const hour = new Date().getHours();
  const el = document.getElementById('greeting');
  if (!el) return;
  if (hour < 12) el.textContent = 'Good morning';
  else if (hour < 17) el.textContent = 'Good afternoon';
  else el.textContent = 'Good evening';
}

// ─── Supabase ────────────────────────────────────
function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_')) return null;
  try {
    return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) { return null; }
}

// ─── Mobile Nav ─────────────────────────────────
function showViewMobile(name) {
  showView(name);
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`[data-mv="${name}"]`);
  if (activeBtn) activeBtn.classList.add('active');
}

// ─── Theme ──────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('sonicra_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('sonicra_theme', next);
  updateThemeIcon(next);
  const mobileIcon = document.getElementById('theme-icon-mobile');
  if (mobileIcon) mobileIcon.textContent = next === 'dark' ? '☀️' : '🌙';
}
function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─── Views ──────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  const btn = document.querySelector(`[data-view="${name}"]`);
  if (view) view.classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'liked') renderLikedSongs();
  if (name === 'playlists') renderPlaylistsGrid();
}

// ─── YouTube Search ──────────────────────────────
function debounceSearch(query, targetId = 'home-results') {
  clearTimeout(searchDebounceTimer);
  if (!query.trim()) {
    const el = document.getElementById(targetId);
    if (el) el.innerHTML = '';
    return;
  }
  searchDebounceTimer = setTimeout(() => doSearch(query, targetId), 500);
}

async function doSearch(query, targetId = 'home-results') {
  if (!query.trim()) return;
  const container = document.getElementById(targetId);
  if (!container) return;

  if (!CONFIG.YT_API_KEY || CONFIG.YT_API_KEY.includes('YOUR_')) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔑</div><p>Add your YouTube API key to <strong>config.js</strong></p></div>`;
    return;
  }

  container.innerHTML = `<div class="empty-state"><p>Searching...</p></div>`;

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(query)}&maxResults=20&key=${CONFIG.YT_API_KEY}&videoEmbeddable=true`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${data.error.message}</p></div>`;
      return;
    }

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No results for "<strong>${query}</strong>"</p></div>`;
      return;
    }

    const tracks = data.items.map(item => ({
      id: item.id.videoId,
      name: cleanTitle(item.snippet.title),
      artist: item.snippet.channelTitle.replace(' - Topic', '').replace('VEVO', ''),
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      videoId: item.id.videoId,
    }));

    currentQueue = tracks;
    container.innerHTML = '';

    if (targetId === 'home-results') {
      container.className = 'track-grid';
      tracks.forEach((track, i) => container.appendChild(createTrackCard(track, i)));
    } else {
      container.className = 'track-list-container';
      tracks.forEach((track, i) => container.appendChild(createTrackRow(track, i, tracks)));
    }
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state"><p>Search failed. Check your API key.</p></div>`;
  }
}

function cleanTitle(title) {
  return title
    .replace(/\(Official\s*(Music|Audio|Video|Lyric)?\s*(Video|Audio|Lyric)?\)/gi, '')
    .replace(/\[Official\s*(Music|Audio|Video|Lyric)?\s*(Video|Audio|Lyric)?\]/gi, '')
    .replace(/\(Audio\)/gi, '')
    .replace(/\(Lyric\s*Video\)/gi, '')
    .replace(/\|.*$/, '')
    .trim();
}

// ─── Track UI ────────────────────────────────────
function createTrackCard(track, index) {
  const div = document.createElement('div');
  div.className = 'track-card';
  div.innerHTML = `
    <img class="track-card-art" src="${track.thumbnail}" alt="${track.name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-card-play">▶</div>
    <div class="track-card-name">${track.name}</div>
    <div class="track-card-artist">${track.artist}</div>
  `;
  div.onclick = () => playTrack(track, currentQueue, index);
  div.querySelector('.track-card-play').onclick = (e) => {
    e.stopPropagation();
    playTrack(track, currentQueue, index);
  };
  return div;
}

function createTrackRow(track, index, queue = [], showRemove = false, removeCallback = null) {
  const thumb = track.thumbnail || track.album_art || '';
  const name = track.name || track.track_name || 'Unknown';
  const artist = track.artist || track.artist_name || 'Unknown';
  const trackId = track.id || track.track_id || track.videoId;
  const isLiked = likedSongIds.has(String(trackId));

  const div = document.createElement('div');
  div.className = 'track-row';
  div.dataset.trackId = String(trackId);
  div.innerHTML = `
    <span class="track-row-num">${index + 1}</span>
    <img class="track-row-art" src="${thumb}" alt="${name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-row-info">
      <div class="track-row-name">${name}</div>
      <div class="track-row-artist">${artist}</div>
    </div>
    <span class="track-row-duration">—</span>
    <div class="track-row-actions">
      <button class="row-action-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}">
        ${isLiked ? '♥' : '♡'}
      </button>
      ${showRemove ? `<button class="row-action-btn remove-btn" title="Remove">✕</button>` : ''}
    </div>
  `;

  div.onclick = () => playTrack(track, queue, index);
  div.querySelector('.row-action-btn').onclick = (e) => {
    e.stopPropagation();
    toggleLike(div.querySelector('.row-action-btn'), track);
  };
  if (showRemove && removeCallback) {
    div.querySelector('.remove-btn').onclick = (e) => { e.stopPropagation(); removeCallback(); };
  }
  return div;
}

// ─── Playback ────────────────────────────────────
function playTrack(track, queue = [], queueIndex = 0) {
  const videoId = track.videoId || track.id;
  if (!videoId) { showToast('Cannot play this track'); return; }

  currentTrack = track;
  currentQueue = queue;
  currentQueueIndex = queueIndex;

  updatePlayerUI(track);
  highlightPlayingRow(String(videoId));

  const doPlay = () => {
    ytPlayer.loadVideoById(videoId);
    ytPlayer.setVolume(parseInt(document.getElementById('volume-slider').value));
  };

  if (!ytReady || !ytPlayer) {
    const waitAndPlay = setInterval(() => {
      if (ytReady && ytPlayer) {
        clearInterval(waitAndPlay);
        doPlay();
      }
    }, 200);
    setTimeout(() => clearInterval(waitAndPlay), 10000);
    return;
  }

  // On mobile, autoplay is blocked — cue video and show tap overlay
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    ytPlayer.cueVideoById(videoId);
    showTapToPlay(doPlay);
  } else {
    doPlay();
  }
}

function showTapToPlay(onTap) {
  // Remove existing overlay
  const existing = document.getElementById('tap-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tap-overlay';
  overlay.className = 'tap-overlay';
  overlay.innerHTML = `
    <div class="tap-overlay-inner">
      <div class="tap-play-btn">▶</div>
      <p>Tap to play</p>
    </div>
  `;
  overlay.onclick = () => {
    overlay.remove();
    onTap();
  };
  document.body.appendChild(overlay);
}

function updatePlayerUI(track) {
  const name = track.name || track.track_name || '—';
  const artist = track.artist || track.artist_name || '—';
  const thumb = track.thumbnail || track.album_art || '';
  const trackId = String(track.videoId || track.id || track.track_id);

  document.getElementById('player-name').textContent = name;
  document.getElementById('player-artist').textContent = artist;
  document.getElementById('player-art').innerHTML = thumb ? `<img src="${thumb}" alt="${name}">` : '';

  const likeBtn = document.getElementById('like-btn');
  likeBtn.classList.toggle('liked', likedSongIds.has(trackId));
  likeBtn.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
}

function highlightPlayingRow(trackId) {
  document.querySelectorAll('.track-row').forEach(row => {
    row.classList.toggle('playing', row.dataset.trackId === trackId);
  });
}

function togglePlayPause() {
  if (!currentTrack) return;
  if (!ytReady || !ytPlayer) return;

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile && ytPlayer.getPlayerState() === YT.PlayerState.CUED) {
    // First play on mobile needs direct user gesture
    ytPlayer.playVideo();
    return;
  }

  if (isPlaying) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function nextTrack() {
  if (!currentQueue.length) return;
  const next = (currentQueueIndex + 1) % currentQueue.length;
  playTrack(currentQueue[next], currentQueue, next);
}

function prevTrack() {
  if (ytReady && ytPlayer.getCurrentTime() > 3) { ytPlayer.seekTo(0); return; }
  if (!currentQueue.length) return;
  const prev = (currentQueueIndex - 1 + currentQueue.length) % currentQueue.length;
  playTrack(currentQueue[prev], currentQueue, prev);
}

function seekTo(event) {
  if (!ytReady) return;
  const duration = ytPlayer.getDuration();
  if (!duration) return;
  const rect = event.currentTarget.getBoundingClientRect();
  ytPlayer.seekTo(((event.clientX - rect.left) / rect.width) * duration, true);
}

function setVolume(val) {
  if (ytReady) ytPlayer.setVolume(parseInt(val));
}

// ─── Liked Songs ─────────────────────────────────
async function loadLikedSongs() {
  if (!db) return;
  try {
    const { data } = await db.from('liked_songs').select('track_id');
    if (data) likedSongIds = new Set(data.map(r => String(r.track_id)));
  } catch (e) {}
}

async function toggleLike(btn, track) {
  const trackId = String(track.videoId || track.id || track.track_id);
  const isLiked = likedSongIds.has(trackId);
  if (!db) { showToast('Supabase not connected'); return; }

  if (isLiked) {
    likedSongIds.delete(trackId);
    btn.textContent = '♡'; btn.classList.remove('liked');
    await db.from('liked_songs').delete().eq('track_id', trackId);
    showToast('Removed from Liked Songs');
  } else {
    likedSongIds.add(trackId);
    btn.textContent = '♥'; btn.classList.add('liked');
    await db.from('liked_songs').insert({
      track_id: trackId,
      track_name: track.name || track.track_name,
      artist_name: track.artist || track.artist_name,
      album_art: track.thumbnail || track.album_art,
      preview_url: null,
      duration_ms: 0,
    });
    showToast('Added to Liked Songs ♥');
  }

  if (currentTrack && String(currentTrack.videoId || currentTrack.id) === trackId) {
    const lb = document.getElementById('like-btn');
    lb.classList.toggle('liked', likedSongIds.has(trackId));
    lb.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
  }
}

async function toggleLikeCurrent() {
  if (!currentTrack) return;
  await toggleLike(document.getElementById('like-btn'), currentTrack);
}

async function renderLikedSongs() {
  const container = document.getElementById('liked-list');
  const countEl = document.getElementById('liked-count');
  if (!db) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔌</div><p>Connect Supabase to save liked songs</p></div>`;
    return;
  }
  const { data } = await db.from('liked_songs').select('*').order('created_at', { ascending: false });
  const songs = data || [];
  countEl.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''}`;
  if (songs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">♡</div><p>Songs you like will appear here</p></div>`;
    return;
  }
  const queue = songs.map(s => ({
    id: s.track_id, videoId: s.track_id,
    name: s.track_name, artist: s.artist_name,
    thumbnail: s.album_art,
  }));
  container.innerHTML = '';
  songs.forEach((s, i) => {
    const t = { id: s.track_id, videoId: s.track_id, name: s.track_name, artist: s.artist_name, thumbnail: s.album_art };
    container.appendChild(createTrackRow(t, i, queue));
  });
}

function playAllLiked() {
  const first = document.querySelector('#liked-list .track-row');
  if (first) first.click();
}

// ─── Playlists ───────────────────────────────────
async function loadPlaylists() {
  if (!db) return;
  try {
    const { data } = await db.from('playlists').select('*').order('created_at', { ascending: false });
    playlists = data || [];
    renderSidebarPlaylists();
  } catch (e) {}
}

function renderSidebarPlaylists() {
  const list = document.getElementById('sidebar-playlist-list');
  if (!list) return;
  list.innerHTML = '';
  playlists.forEach(pl => {
    const div = document.createElement('div');
    div.className = 'sp-item';
    div.textContent = pl.name;
    div.onclick = () => openPlaylistDetail(pl);
    list.appendChild(div);
  });
}

function renderPlaylistsGrid() {
  const grid = document.getElementById('playlists-grid');
  if (!db) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔌</div><p>Connect Supabase to manage playlists</p></div>`;
    return;
  }
  if (playlists.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🎵</div><p>Create your first playlist</p></div>`;
    return;
  }
  grid.innerHTML = '';
  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.innerHTML = `
      <div class="playlist-card-icon">🎵</div>
      <div class="playlist-card-name">${pl.name}</div>
      <div class="playlist-card-count">Playlist</div>
      <button class="playlist-card-delete" title="Delete">✕</button>
    `;
    card.onclick = () => openPlaylistDetail(pl);
    card.querySelector('.playlist-card-delete').onclick = (e) => { e.stopPropagation(); deletePlaylist(pl.id); };
    grid.appendChild(card);
  });
}

async function createPlaylist() {
  if (!db) { showToast('Connect Supabase to create playlists'); return; }
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const { data } = await db.from('playlists').insert({ name: name.trim() }).select().single();
  if (data) {
    playlists.unshift(data);
    renderSidebarPlaylists();
    renderPlaylistsGrid();
    showToast(`Playlist "${name}" created`);
  }
}

async function createPlaylistFromModal() {
  closePlaylistModal();
  await createPlaylist();
  openAddToPlaylist();
}

async function deletePlaylist(id) {
  if (!confirm('Delete this playlist?')) return;
  await db.from('playlists').delete().eq('id', id);
  playlists = playlists.filter(p => p.id !== id);
  renderSidebarPlaylists();
  renderPlaylistsGrid();
  showToast('Playlist deleted');
}

async function openPlaylistDetail(pl) {
  currentPlaylistId = pl.id;
  document.getElementById('pl-name').textContent = pl.name;
  showView('playlist-detail');
  const { data } = await db.from('playlist_tracks').select('*').eq('playlist_id', pl.id).order('added_at', { ascending: true });
  const tracks = data || [];
  document.getElementById('pl-count').textContent = `${tracks.length} song${tracks.length !== 1 ? 's' : ''}`;
  const container = document.getElementById('playlist-track-list');
  if (tracks.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No tracks yet. Play a song and click + to add.</p></div>`;
    return;
  }
  const queue = tracks.map(t => ({ id: t.track_id, videoId: t.track_id, name: t.track_name, artist: t.artist_name, thumbnail: t.album_art }));
  container.innerHTML = '';
  tracks.forEach((t, i) => {
    const track = { id: t.track_id, videoId: t.track_id, name: t.track_name, artist: t.artist_name, thumbnail: t.album_art };
    container.appendChild(createTrackRow(track, i, queue, true, () => removeFromPlaylist(pl.id, t.track_id)));
  });
}

function playAllPlaylist() {
  const first = document.querySelector('#playlist-track-list .track-row');
  if (first) first.click();
}

async function removeFromPlaylist(playlistId, trackId) {
  await db.from('playlist_tracks').delete().eq('playlist_id', playlistId).eq('track_id', trackId);
  const pl = playlists.find(p => p.id === playlistId);
  if (pl) openPlaylistDetail(pl);
  showToast('Removed from playlist');
}

function openAddToPlaylist() {
  if (!currentTrack) { showToast('Play a track first'); return; }
  if (!db) { showToast('Connect Supabase to use playlists'); return; }
  const modal = document.getElementById('playlist-modal');
  const list = document.getElementById('playlist-modal-list');
  list.innerHTML = '';
  if (playlists.length === 0) {
    list.innerHTML = `<p style="color:var(--text2);font-size:0.85rem;">No playlists yet.</p>`;
  } else {
    playlists.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'modal-playlist-item';
      item.innerHTML = `<div class="mp-icon">🎵</div><span>${pl.name}</span>`;
      item.onclick = () => addTrackToPlaylist(pl.id, pl.name);
      list.appendChild(item);
    });
  }
  modal.classList.remove('hidden');
}

function closePlaylistModal() {
  document.getElementById('playlist-modal').classList.add('hidden');
}

async function addTrackToPlaylist(playlistId, playlistName) {
  if (!currentTrack) return;
  closePlaylistModal();
  const track = currentTrack;
  const { error } = await db.from('playlist_tracks').insert({
    playlist_id: playlistId,
    track_id: String(track.videoId || track.id),
    track_name: track.name,
    artist_name: track.artist,
    album_art: track.thumbnail,
    preview_url: null,
    duration_ms: 0,
  });
  if (!error) showToast(`Added to "${playlistName}"`);
  else if (error.code === '23505') showToast('Already in this playlist');
  else showToast('Failed to add');
}

// ─── Tap to Play (mobile fix) ───────────────────
function showTapToPlay() {
  // Remove existing overlay
  const existing = document.getElementById('tap-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tap-overlay';
  overlay.innerHTML = `
    <div class="tap-play-btn">
      <span>▶</span>
      <p>Tap to play</p>
    </div>
  `;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
  `;
  overlay.querySelector('.tap-play-btn').style.cssText = `
    background: var(--accent);
    color: #000;
    border-radius: 50%;
    width: 80px;
    height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    cursor: pointer;
    box-shadow: 0 0 40px rgba(30,215,96,0.5);
  `;
  overlay.querySelector('p').style.cssText = `
    font-size: 0.6rem;
    margin-top: 4px;
    font-family: var(--font-body);
  `;
  overlay.onclick = () => {
    if (ytPlayer) ytPlayer.playVideo();
    overlay.remove();
  };
  document.body.appendChild(overlay);
}

// ─── Helpers ─────────────────────────────────────
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2800);
}