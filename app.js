// =============================================
//  WAVELY — Main App Logic
//  Spotify OAuth + Search + Playback + Supabase
// =============================================

// ─── State ─────────────────────────────────────
let spotifyToken = null;
let db = null;
let currentTrack = null;
let currentQueue = [];
let currentQueueIndex = 0;
let audio = new Audio();
let isPlaying = false;
let likedSongIds = new Set();
let playlists = [];
let currentPlaylistId = null;
let searchDebounceTimer = null;
let searchTarget = 'home-results';

// ─── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setGreeting();
  initTheme();

  // Hide setup banner if credentials are filled
  const banner = document.getElementById('setup-banner');
  const hasSpotify = CONFIG.SPOTIFY_CLIENT_ID && !CONFIG.SPOTIFY_CLIENT_ID.includes('YOUR_');
  const hasSupabase = CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR_');
  if (hasSpotify && hasSupabase && banner) banner.style.display = 'none';

  // Handle Spotify OAuth callback
  if (window.location.search.includes('code=')) {
    await handleSpotifyCallback();
    return;
  }

  // Check if already authenticated
  spotifyToken = localStorage.getItem('wavely_token');
  const tokenExpiry = localStorage.getItem('wavely_token_expiry');

  if (spotifyToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
    await initApp();
  } else {
    spotifyToken = null;
    localStorage.removeItem('wavely_token');
    showAuthScreen();
  }
});

function setGreeting() {
  const hour = new Date().getHours();
  const greetingEl = document.getElementById('greeting');
  if (!greetingEl) return;
  if (hour < 12) greetingEl.textContent = 'Good morning';
  else if (hour < 17) greetingEl.textContent = 'Good afternoon';
  else greetingEl.textContent = 'Good evening';
}

// ─── Supabase Init ──────────────────────────────
function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_')) return null;
  try {
    return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('Supabase init failed:', e);
    return null;
  }
}

// ─── Spotify Auth (PKCE) ────────────────────────
async function loginWithSpotify() {
  if (!CONFIG.SPOTIFY_CLIENT_ID || CONFIG.SPOTIFY_CLIENT_ID.includes('YOUR_')) {
    showSetupGuide();
    return;
  }

  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
    scope: CONFIG.SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

function generateVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function generateChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) { showAuthScreen(); return; }

  window.history.replaceState({}, '', '/');

  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) { showToast('Login error. Try again.'); showAuthScreen(); return; }

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
        client_id: CONFIG.SPOTIFY_CLIENT_ID,
        code_verifier: verifier,
      }),
    });

    const data = await res.json();
    console.log('Token response:', data);

    if (data.access_token) {
      spotifyToken = data.access_token;
      localStorage.setItem('wavely_token', spotifyToken);
      localStorage.setItem('wavely_token_expiry', Date.now() + data.expires_in * 1000);
      sessionStorage.removeItem('pkce_verifier');
      await initApp();
    } else {
      console.error('Token error:', data);
      showToast('Login failed: ' + (data.error_description || data.error));
      showAuthScreen();
    }
  } catch (e) {
    console.error('Token exchange failed:', e);
    showToast('Login failed. Try again.');
    showAuthScreen();
  }
}



function logout() {
  localStorage.removeItem('wavely_token');
  localStorage.removeItem('wavely_token_expiry');
  spotifyToken = null;
  audio.pause();
  showAuthScreen();
  showToast('Logged out');
}

// ─── App Init ───────────────────────────────────
async function initApp() {
  db = initSupabase();

  // Show app
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('player-bar').classList.remove('hidden');

  // Load user profile
  await loadUserProfile();

  // Load Supabase data
  await Promise.all([
    loadLikedSongs(),
    loadPlaylists(),
  ]);

  setupAudioListeners();
  showView('home');
}

async function loadUserProfile() {
  try {
    const res = await spotifyFetch('https://api.spotify.com/v1/me');
    if (res && res.display_name) {
      document.getElementById('user-display').textContent = `Logged in as ${res.display_name}`;
    }
  } catch (e) {}
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

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('player-bar').classList.add('hidden');
}

// ─── Theme ──────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('wavely_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('wavely_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─── Spotify API ─────────────────────────────────
async function spotifyFetch(url, options = {}) {
  if (!spotifyToken) return null;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${spotifyToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    logout();
    showToast('Session expired. Please log in again.');
    return null;
  }

  if (!res.ok) return null;
  if (res.status === 204) return {};
  return res.json();
}

// ─── Search ─────────────────────────────────────
function debounceSearch(query, targetId = 'home-results') {
  searchTarget = targetId;
  clearTimeout(searchDebounceTimer);
  if (!query.trim()) {
    const el = document.getElementById(searchTarget);
    if (el) el.innerHTML = '';
    return;
  }
  searchDebounceTimer = setTimeout(() => doSearch(query, targetId), 450);
}

async function doSearch(query, targetId = searchTarget) {
  if (!query.trim()) return;

  const container = document.getElementById(targetId);
  if (!container) return;

  container.innerHTML = '<div class="empty-state"><div class="empty-icon shimmer" style="width:60px;height:60px;margin:0 auto 12px;border-radius:50%;"></div><p>Searching...</p></div>';

  try {
    const data = await spotifyFetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20`
    );

    if (!data || !data.tracks || data.tracks.items.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No results for "<strong>${query}</strong>"</p></div>`;
      return;
    }

    const tracks = data.tracks.items;
    currentQueue = tracks;

    if (targetId === 'home-results') {
      container.innerHTML = '';
      container.className = 'track-grid';
      tracks.forEach((track, i) => {
        container.appendChild(createTrackCard(track, i));
      });
    } else {
      container.innerHTML = '';
      container.className = 'track-list-container';
      tracks.forEach((track, i) => {
        container.appendChild(createTrackRow(track, i, currentQueue));
      });
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Search failed. Check your connection.</p></div>`;
  }
}

// ─── Track UI Builders ───────────────────────────
function createTrackCard(track, index) {
  const art = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '';
  const div = document.createElement('div');
  div.className = 'track-card';
  div.innerHTML = `
    <img class="track-card-art" src="${art}" alt="${track.name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-card-play" onclick="event.stopPropagation(); playTrack(currentQueue[${index}], currentQueue, ${index})">▶</div>
    <div class="track-card-name">${track.name}</div>
    <div class="track-card-artist">${track.artists.map(a => a.name).join(', ')}</div>
  `;
  div.onclick = () => playTrack(track, currentQueue, index);
  return div;
}

function createTrackRow(track, index, queue = [], showRemove = false, removeCallback = null) {
  const art = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || track.album_art || '';
  const name = track.name || track.track_name || 'Unknown';
  const artist = (track.artists?.map(a => a.name).join(', ')) || track.artist_name || 'Unknown';
  const duration = formatDuration(track.duration_ms || 0);
  const isLiked = likedSongIds.has(track.id || track.track_id);

  const div = document.createElement('div');
  div.className = 'track-row';
  div.dataset.trackId = track.id || track.track_id;
  div.innerHTML = `
    <span class="track-row-num">${index + 1}</span>
    <img class="track-row-art" src="${art}" alt="${name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-row-info">
      <div class="track-row-name">${name}</div>
      <div class="track-row-artist">${artist}</div>
    </div>
    <span class="track-row-duration">${duration}</span>
    <div class="track-row-actions">
      <button class="row-action-btn ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation(); toggleLike(this, buildTrackObj(${JSON.stringify(track).replace(/"/g, '&quot;')}))" title="${isLiked ? 'Unlike' : 'Like'}">
        ${isLiked ? '♥' : '♡'}
      </button>
      ${showRemove ? `<button class="row-action-btn" onclick="event.stopPropagation(); ${removeCallback}" title="Remove">✕</button>` : ''}
    </div>
  `;
  div.onclick = () => playTrack(track, queue, index);
  return div;
}

function buildTrackObj(track) {
  return {
    id: track.id || track.track_id,
    name: track.name || track.track_name,
    artists: track.artists || [{ name: track.artist_name }],
    album: track.album || {
      name: track.album_name,
      images: [{ url: track.album_art }]
    },
    preview_url: track.preview_url,
    duration_ms: track.duration_ms || 0,
  };
}

// ─── Playback ────────────────────────────────────
function playTrack(track, queue = [], queueIndex = 0) {
  const previewUrl = track.preview_url;

  if (!previewUrl) {
    showToast('No preview available for this track');
    return;
  }

  currentTrack = track;
  currentQueue = queue;
  currentQueueIndex = queueIndex;

  audio.pause();
  audio.src = previewUrl;
  audio.volume = parseFloat(document.getElementById('volume-slider').value);
  audio.play().catch(() => showToast('Playback blocked. Click play to start.'));

  updatePlayerUI(track);
  highlightPlayingRow(track.id || track.track_id);
}

function updatePlayerUI(track) {
  const name = track.name || track.track_name || '—';
  const artist = (track.artists?.map(a => a.name).join(', ')) || track.artist_name || '—';
  const art = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || track.album_art || '';

  document.getElementById('player-name').textContent = name;
  document.getElementById('player-artist').textContent = artist;

  const artEl = document.getElementById('player-art');
  artEl.innerHTML = art ? `<img src="${art}" alt="${name}">` : '';

  const likeBtn = document.getElementById('like-btn');
  const trackId = track.id || track.track_id;
  likeBtn.classList.toggle('liked', likedSongIds.has(trackId));
  likeBtn.textContent = likedSongIds.has(trackId) ? '♥' : '♡';

  document.getElementById('play-pause-btn').textContent = '⏸';
  isPlaying = true;
}

function highlightPlayingRow(trackId) {
  document.querySelectorAll('.track-row').forEach(row => {
    row.classList.toggle('playing', row.dataset.trackId === trackId);
  });
}

function togglePlayPause() {
  if (!currentTrack) return;
  if (isPlaying) {
    audio.pause();
  } else {
    audio.play();
  }
}

function nextTrack() {
  if (currentQueue.length === 0) return;
  const nextIndex = (currentQueueIndex + 1) % currentQueue.length;
  playTrack(currentQueue[nextIndex], currentQueue, nextIndex);
}

function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (currentQueue.length === 0) return;
  const prevIndex = (currentQueueIndex - 1 + currentQueue.length) % currentQueue.length;
  playTrack(currentQueue[prevIndex], currentQueue, prevIndex);
}

function seekTo(event) {
  if (!audio.duration) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  audio.currentTime = ratio * audio.duration;
}

function setVolume(val) {
  audio.volume = parseFloat(val);
}

function setupAudioListeners() {
  audio.addEventListener('play', () => {
    isPlaying = true;
    document.getElementById('play-pause-btn').textContent = '⏸';
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    document.getElementById('play-pause-btn').textContent = '▶';
  });

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const ratio = (audio.currentTime / audio.duration) * 100;
    document.getElementById('progress-fill').style.width = `${ratio}%`;
    document.getElementById('current-time').textContent = formatTime(audio.currentTime);
    document.getElementById('duration-label').textContent = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    nextTrack();
  });
}

// ─── Liked Songs ─────────────────────────────────
async function loadLikedSongs() {
  if (!db) return;
  try {
    const { data } = await db.from('liked_songs').select('track_id');
    if (data) {
      likedSongIds = new Set(data.map(r => r.track_id));
    }
  } catch (e) {}
}

async function toggleLike(btn, track) {
  const trackId = track.id;
  const isLiked = likedSongIds.has(trackId);

  if (!db) {
    showToast('Configure Supabase to save liked songs');
    return;
  }

  if (isLiked) {
    // Unlike
    likedSongIds.delete(trackId);
    btn.textContent = '♡';
    btn.classList.remove('liked');

    await db.from('liked_songs').delete().eq('track_id', trackId);
    showToast('Removed from Liked Songs');
  } else {
    // Like
    likedSongIds.add(trackId);
    btn.textContent = '♥';
    btn.classList.add('liked');

    await db.from('liked_songs').insert({
      track_id: track.id,
      track_name: track.name,
      artist_name: track.artists?.map(a => a.name).join(', '),
      album_name: track.album?.name,
      album_art: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url,
      preview_url: track.preview_url,
      duration_ms: track.duration_ms,
    });
    showToast('Added to Liked Songs ♥');
  }

  // Sync like button in player
  const likeBtn = document.getElementById('like-btn');
  if (currentTrack && (currentTrack.id === trackId)) {
    likeBtn.classList.toggle('liked', likedSongIds.has(trackId));
    likeBtn.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
  }
}

async function toggleLikeCurrent() {
  if (!currentTrack) return;
  const fakeBtn = { textContent: '', classList: { add: () => {}, remove: () => {}, toggle: () => {} } };
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
    id: s.track_id,
    name: s.track_name,
    artists: [{ name: s.artist_name }],
    album: { name: s.album_name, images: [{ url: s.album_art }] },
    preview_url: s.preview_url,
    duration_ms: s.duration_ms,
  }));

  container.innerHTML = '';
  songs.forEach((song, i) => {
    container.appendChild(createTrackRow(song, i, queue));
  });
}

function playAllLiked() {
  const container = document.getElementById('liked-list');
  const firstRow = container.querySelector('.track-row');
  if (firstRow) firstRow.click();
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
      <button class="playlist-card-delete" onclick="event.stopPropagation(); deletePlaylist('${pl.id}')" title="Delete">✕</button>
    `;
    card.onclick = () => openPlaylistDetail(pl);
    grid.appendChild(card);
  });
}

async function createPlaylist() {
  if (!db) { showToast('Configure Supabase to create playlists'); return; }
  const name = prompt('Playlist name:');
  if (!name || !name.trim()) return;

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
  document.getElementById('view-playlist-detail').querySelector('.back-btn').onclick = () => showView('playlists');

  showView('playlist-detail');

  const { data } = await db.from('playlist_tracks').select('*').eq('playlist_id', pl.id).order('added_at', { ascending: true });
  const tracks = data || [];

  document.getElementById('pl-count').textContent = `${tracks.length} song${tracks.length !== 1 ? 's' : ''}`;

  const container = document.getElementById('playlist-track-list');
  if (tracks.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No tracks yet. Play a song and add it with +</p></div>`;
    return;
  }

  const queue = tracks.map(t => ({
    id: t.track_id,
    name: t.track_name,
    artists: [{ name: t.artist_name }],
    album: { name: t.album_name, images: [{ url: t.album_art }] },
    preview_url: t.preview_url,
    duration_ms: t.duration_ms,
  }));

  container.innerHTML = '';
  tracks.forEach((track, i) => {
    const row = createTrackRow(track, i, queue, true, `removeFromPlaylist('${pl.id}', '${track.track_id}')`);
    container.appendChild(row);
  });
}

function playAllPlaylist() {
  const container = document.getElementById('playlist-track-list');
  const firstRow = container.querySelector('.track-row');
  if (firstRow) firstRow.click();
}

async function removeFromPlaylist(playlistId, trackId) {
  await db.from('playlist_tracks').delete().eq('playlist_id', playlistId).eq('track_id', trackId);
  const pl = playlists.find(p => p.id === playlistId);
  if (pl) openPlaylistDetail(pl);
  showToast('Removed from playlist');
}

// ─── Add to Playlist Modal ───────────────────────
function openAddToPlaylist() {
  if (!currentTrack) { showToast('Play a track first'); return; }
  if (!db) { showToast('Configure Supabase to use playlists'); return; }

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
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artists?.map(a => a.name).join(', '),
    album_name: track.album?.name,
    album_art: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url,
    preview_url: track.preview_url,
    duration_ms: track.duration_ms,
  });

  if (!error) {
    showToast(`Added to "${playlistName}"`);
  } else if (error.code === '23505') {
    showToast('Already in this playlist');
  } else {
    showToast('Failed to add to playlist');
  }
}

// ─── Setup Guide ─────────────────────────────────
function showSetupGuide() {
  document.getElementById('setup-modal').classList.remove('hidden');
  document.getElementById('redirect-uri').textContent = window.location.origin + '/callback';
}

function closeSetupGuide() {
  document.getElementById('setup-modal').classList.add('hidden');
}

// ─── Helpers ──────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDuration(ms) {
  return formatTime(ms / 1000);
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