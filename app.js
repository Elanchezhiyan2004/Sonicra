// =============================================
//  WAVELY — Deezer Edition
//  Free music search + 30s previews + Supabase
// =============================================

// ─── State ─────────────────────────────────────
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

// ─── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setGreeting();
  initTheme();
  db = initSupabase();
  await Promise.all([loadLikedSongs(), loadPlaylists()]);
  setupAudioListeners();
  showView('home');
  // Hide auth screen, show app directly — no login needed!
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('player-bar').classList.remove('hidden');
  document.getElementById('setup-banner').style.display = 'none';
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
  } catch (e) {
    console.warn('Supabase init failed:', e);
    return null;
  }
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

function showAuthScreen() {}

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

function logout() {
  showToast('No login needed with Deezer!');
}

// ─── Deezer API ──────────────────────────────────
async function deezerFetch(endpoint) {
  const url = CONFIG.DEEZER_PROXY + encodeURIComponent(CONFIG.DEEZER_API + endpoint);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Deezer API error');
  return res.json();
}

function normalizeDeezerTrack(t) {
  return {
    id: String(t.id),
    name: t.title,
    artists: [{ name: t.artist?.name || 'Unknown' }],
    album: {
      name: t.album?.title || '',
      images: [{ url: t.album?.cover_medium || t.album?.cover || '' }]
    },
    preview_url: t.preview,
    duration_ms: (t.duration || 30) * 1000,
  };
}

// ─── Search ─────────────────────────────────────
function debounceSearch(query, targetId = 'home-results') {
  clearTimeout(searchDebounceTimer);
  if (!query.trim()) {
    const el = document.getElementById(targetId);
    if (el) el.innerHTML = '';
    return;
  }
  searchDebounceTimer = setTimeout(() => doSearch(query, targetId), 450);
}

async function doSearch(query, targetId = 'home-results') {
  if (!query.trim()) return;
  const container = document.getElementById(targetId);
  if (!container) return;

  container.innerHTML = `<div class="empty-state"><p>Searching...</p></div>`;

  try {
    const data = await deezerFetch(`/search?q=${encodeURIComponent(query)}&limit=20`);

    if (!data.data || data.data.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No results for "<strong>${query}</strong>"</p></div>`;
      return;
    }

    const tracks = data.data.map(normalizeDeezerTrack);
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
    container.innerHTML = `<div class="empty-state"><p>Search failed. Check your connection.</p></div>`;
  }
}

// ─── Track UI ────────────────────────────────────
function createTrackCard(track, index) {
  const art = track.album?.images?.[0]?.url || '';
  const div = document.createElement('div');
  div.className = 'track-card';
  div.innerHTML = `
    <img class="track-card-art" src="${art}" alt="${track.name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-card-play">▶</div>
    <div class="track-card-name">${track.name}</div>
    <div class="track-card-artist">${track.artists[0].name}</div>
  `;
  div.onclick = () => playTrack(track, currentQueue, index);
  div.querySelector('.track-card-play').onclick = (e) => {
    e.stopPropagation();
    playTrack(track, currentQueue, index);
  };
  return div;
}

function createTrackRow(track, index, queue = [], showRemove = false, removeCallback = null) {
  const art = track.album?.images?.[0]?.url || track.album_art || '';
  const name = track.name || track.track_name || 'Unknown';
  const artist = track.artists?.[0]?.name || track.artist_name || 'Unknown';
  const duration = formatDuration(track.duration_ms || 30000);
  const trackId = track.id || track.track_id;
  const isLiked = likedSongIds.has(String(trackId));

  const div = document.createElement('div');
  div.className = 'track-row';
  div.dataset.trackId = String(trackId);
  div.innerHTML = `
    <span class="track-row-num">${index + 1}</span>
    <img class="track-row-art" src="${art}" alt="${name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-row-info">
      <div class="track-row-name">${name}</div>
      <div class="track-row-artist">${artist}</div>
    </div>
    <span class="track-row-duration">${duration}</span>
    <div class="track-row-actions">
      <button class="row-action-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}">
        ${isLiked ? '♥' : '♡'}
      </button>
      ${showRemove ? `<button class="row-action-btn remove-btn" title="Remove">✕</button>` : ''}
    </div>
  `;

  div.onclick = () => playTrack(track, queue, index);

  const likeBtn = div.querySelector('.row-action-btn');
  likeBtn.onclick = (e) => { e.stopPropagation(); toggleLike(likeBtn, track); };

  if (showRemove && removeCallback) {
    const removeBtn = div.querySelector('.remove-btn');
    if (removeBtn) removeBtn.onclick = (e) => { e.stopPropagation(); removeCallback(); };
  }

  return div;
}

// ─── Playback ────────────────────────────────────
function playTrack(track, queue = [], queueIndex = 0) {
  if (!track.preview_url) {
    showToast('No preview available for this track');
    return;
  }

  currentTrack = track;
  currentQueue = queue;
  currentQueueIndex = queueIndex;

  audio.pause();
  audio.src = track.preview_url;
  audio.volume = parseFloat(document.getElementById('volume-slider').value);
  audio.play().catch(() => showToast('Click play to start'));

  updatePlayerUI(track);
  highlightPlayingRow(String(track.id || track.track_id));
}

function updatePlayerUI(track) {
  const name = track.name || track.track_name || '—';
  const artist = track.artists?.[0]?.name || track.artist_name || '—';
  const art = track.album?.images?.[0]?.url || track.album_art || '';
  const trackId = String(track.id || track.track_id);

  document.getElementById('player-name').textContent = name;
  document.getElementById('player-artist').textContent = artist;
  document.getElementById('player-art').innerHTML = art ? `<img src="${art}" alt="${name}">` : '';

  const likeBtn = document.getElementById('like-btn');
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
  if (isPlaying) audio.pause();
  else audio.play();
}

function nextTrack() {
  if (!currentQueue.length) return;
  const next = (currentQueueIndex + 1) % currentQueue.length;
  playTrack(currentQueue[next], currentQueue, next);
}

function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (!currentQueue.length) return;
  const prev = (currentQueueIndex - 1 + currentQueue.length) % currentQueue.length;
  playTrack(currentQueue[prev], currentQueue, prev);
}

function seekTo(event) {
  if (!audio.duration) return;
  const rect = event.currentTarget.getBoundingClientRect();
  audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
}

function setVolume(val) { audio.volume = parseFloat(val); }

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
    document.getElementById('progress-fill').style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    document.getElementById('current-time').textContent = formatTime(audio.currentTime);
    document.getElementById('duration-label').textContent = formatTime(audio.duration);
  });
  audio.addEventListener('ended', nextTrack);
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
  const trackId = String(track.id || track.track_id);
  const isLiked = likedSongIds.has(trackId);

  if (!db) { showToast('Supabase not connected'); return; }

  if (isLiked) {
    likedSongIds.delete(trackId);
    btn.textContent = '♡';
    btn.classList.remove('liked');
    await db.from('liked_songs').delete().eq('track_id', trackId);
    showToast('Removed from Liked Songs');
  } else {
    likedSongIds.add(trackId);
    btn.textContent = '♥';
    btn.classList.add('liked');
    await db.from('liked_songs').insert({
      track_id: trackId,
      track_name: track.name || track.track_name,
      artist_name: track.artists?.[0]?.name || track.artist_name,
      album_name: track.album?.name || track.album_name,
      album_art: track.album?.images?.[0]?.url || track.album_art,
      preview_url: track.preview_url,
      duration_ms: track.duration_ms,
    });
    showToast('Added to Liked Songs ♥');
  }

  // Sync player like button
  if (currentTrack && String(currentTrack.id) === trackId) {
    const playerBtn = document.getElementById('like-btn');
    playerBtn.classList.toggle('liked', likedSongIds.has(trackId));
    playerBtn.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
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
    id: s.track_id, name: s.track_name,
    artists: [{ name: s.artist_name }],
    album: { name: s.album_name, images: [{ url: s.album_art }] },
    preview_url: s.preview_url, duration_ms: s.duration_ms,
  }));

  container.innerHTML = '';
  songs.forEach((song, i) => container.appendChild(createTrackRow(song, i, queue)));
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
    card.querySelector('.playlist-card-delete').onclick = (e) => {
      e.stopPropagation();
      deletePlaylist(pl.id);
    };
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

  const queue = tracks.map(t => ({
    id: t.track_id, name: t.track_name,
    artists: [{ name: t.artist_name }],
    album: { name: t.album_name, images: [{ url: t.album_art }] },
    preview_url: t.preview_url, duration_ms: t.duration_ms,
  }));

  container.innerHTML = '';
  tracks.forEach((track, i) => {
    const row = createTrackRow(track, i, queue, true, () => removeFromPlaylist(pl.id, track.track_id));
    container.appendChild(row);
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

// ─── Add to Playlist Modal ───────────────────────
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
    track_id: String(track.id),
    track_name: track.name,
    artist_name: track.artists?.[0]?.name,
    album_name: track.album?.name,
    album_art: track.album?.images?.[0]?.url,
    preview_url: track.preview_url,
    duration_ms: track.duration_ms,
  });

  if (!error) showToast(`Added to "${playlistName}"`);
  else if (error.code === '23505') showToast('Already in this playlist');
  else showToast('Failed to add to playlist');
}

// ─── Setup / Modals ──────────────────────────────
function showSetupGuide() {
  document.getElementById('setup-modal').classList.remove('hidden');
}
function closeSetupGuide() {
  document.getElementById('setup-modal').classList.add('hidden');
}

// ─── Helpers ─────────────────────────────────────
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function formatDuration(ms) { return formatTime(ms / 1000); }

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