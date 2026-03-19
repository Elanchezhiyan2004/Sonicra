// =============================================
//  SONICRA — Full Featured Music App
//  YouTube API + Supabase + User Auth
// =============================================

// ─── State ──────────────────────────────────────
let db = null;
let currentUser = null;
let ytPlayer = null;
let ytReady = false;
let currentTrack = null;
let currentQueue = [];
let currentQueueIndex = 0;
let manualQueue = [];
let playedInShuffle = new Set();
let isPlaying = false;
let isShuffle = false;
let sleepTimer = null;
let sleepAfterSong = false;
let likedSongIds = new Set();
let playlists = [];
let currentPlaylistId = null;
let searchDebounceTimer = null;
let currentKeyIndex = 0;

function getApiKey() {
  const keys = CONFIG.YT_API_KEYS;
  if (!keys || keys.length === 0) return null;
  return keys[currentKeyIndex % keys.length];
}

function rotateApiKey() {
  const keys = CONFIG.YT_API_KEYS;
  if (!keys || keys.length <= 1) return false;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  console.warn(`Rotated to API key ${currentKeyIndex + 1} of ${keys.length}`);
  return true;
}
let progressTimer = null;
let contextMenuTrack = null;
let selectMode = false;
let selectedTracks = new Set();

// ─── YouTube IFrame API ──────────────────────────
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('yt-player', {
    height: '1', width: '1',
    playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: (e) => { ytReady = true; e.target.setVolume(80); },
      onStateChange: onPlayerStateChange,
      onError: () => setTimeout(playNextInQueue, 1500),
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
    if (sleepAfterSong) {
      sleepAfterSong = false;
      showToast('Song ended — sleep timer stopped music 😴');
      return; // don't play next
    }
    playNextInQueue();
  } else if (event.data === S.BUFFERING) {
    document.getElementById('play-pause-btn').textContent = '⏳';
  } else if (event.data === -1) {
    setTimeout(() => { if (ytPlayer?.getPlayerState() === -1) playNextInQueue(); }, 3000);
  }
}

function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (!ytPlayer || !ytReady) return;
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;
    if (dur > 0) {
      document.getElementById('progress-fill').style.width = `${(cur/dur)*100}%`;
      document.getElementById('current-time').textContent = formatTime(cur);
      document.getElementById('duration-label').textContent = formatTime(dur);
    }
  }, 500);
}
function stopProgressTimer() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

// ─── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setGreeting();
  initTheme();
  db = initSupabase();
  if (!db) { showView('home'); return; }

  // Check session
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    await onLoggedIn();
  } else {
    showAuthScreen();
  }

  // Listen for auth changes
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await onLoggedIn();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showAuthScreen();
    }
  });
});

async function onLoggedIn() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('player-bar').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  const emailEl = document.getElementById('user-email');
  if (emailEl) emailEl.textContent = currentUser.email;
  await Promise.all([loadLikedSongs(), loadPlaylists()]);
  showView('home');
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('player-bar').classList.add('hidden');
  document.getElementById('bottom-nav').classList.add('hidden');
}

function setGreeting() {
  const h = new Date().getHours();
  const el = document.getElementById('greeting');
  if (el) el.textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function initSupabase() {
  if (!CONFIG.SUPABASE_URL?.includes('supabase')) return null;
  try { return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY); }
  catch { return null; }
}

// ─── Auth ────────────────────────────────────────
async function handleAuth(mode) {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }

  let result;
  if (mode === 'login') {
    result = await db.auth.signInWithPassword({ email, password });
  } else {
    result = await db.auth.signUp({ email, password });
    if (!result.error) { errEl.style.color = 'var(--accent)'; errEl.textContent = 'Account created! Check your email to confirm, then log in.'; return; }
  }

  if (result.error) { errEl.style.color = '#ef4444'; errEl.textContent = result.error.message; }
}

async function logout() {
  if (sleepTimer) clearTimeout(sleepTimer);
  await db.auth.signOut();
  showToast('Logged out');
}

function switchAuthMode(mode) {
  const isLogin = mode === 'login';
  document.getElementById('auth-title').textContent = isLogin ? 'Welcome back' : 'Create account';
  document.getElementById('auth-submit-login').classList.toggle('hidden', !isLogin);
  document.getElementById('auth-submit-register').classList.toggle('hidden', isLogin);
  document.getElementById('auth-switch-text').innerHTML = isLogin
    ? `Don't have an account? <button onclick="switchAuthMode('register')" class="auth-link">Sign up</button>`
    : `Already have an account? <button onclick="switchAuthMode('login')" class="auth-link">Log in</button>`;
  document.getElementById('auth-error').textContent = '';
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
}
function updateThemeIcon(theme) {
  document.querySelectorAll('.theme-icon').forEach(el => el.textContent = theme === 'dark' ? '☀️' : '🌙');
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
  if (name === 'queue') renderQueuePanel();
}
function showViewMobile(name) {
  showView(name);
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-mv="${name}"]`)?.classList.add('active');
}

// ─── Context Menu ─────────────────────────────────
function showContextMenu(event, track) {
  event.preventDefault();
  event.stopPropagation();
  contextMenuTrack = track;

  const menu = document.getElementById('context-menu');
  menu.classList.remove('hidden');

  // Position menu
  const x = event.clientX || (event.touches?.[0]?.clientX) || 0;
  const y = event.clientY || (event.touches?.[0]?.clientY) || 0;
  const mw = 220, mh = 280;
  menu.style.left = `${Math.min(x, window.innerWidth - mw - 10)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - mh - 10)}px`;

  // Update liked state in menu
  const trackId = String(track.videoId || track.id || track.track_id);
  const likeItem = document.getElementById('ctx-like');
  if (likeItem) likeItem.textContent = likedSongIds.has(trackId) ? '💔 Unlike' : '♥ Like';
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
  contextMenuTrack = null;
}

function ctxPlay() { if (contextMenuTrack) playTrack(contextMenuTrack, currentQueue, currentQueue.indexOf(contextMenuTrack)); hideContextMenu(); }
function ctxPlayNext() {
  if (!contextMenuTrack) return;
  manualQueue.unshift(contextMenuTrack);
  showToast('Plays next ✅'); updateQueueBadge(); renderQueuePanel(); hideContextMenu();
}
function ctxAddToQueue() {
  if (!contextMenuTrack) return;
  manualQueue.push(contextMenuTrack);
  showToast('Added to queue'); updateQueueBadge(); renderQueuePanel(); hideContextMenu();
}
function ctxAddToPlaylist() {
  if (!contextMenuTrack) return;
  const track = { ...contextMenuTrack }; // snapshot to avoid reference issues
  hideContextMenu();
  openAddToPlaylist(track);
}
function ctxLike() { if (contextMenuTrack) { toggleLike(null, contextMenuTrack); hideContextMenu(); } }
function ctxSleepTimer() { hideContextMenu(); openSleepTimer(); }

// ─── Sleep Timer ─────────────────────────────────
function openSleepTimer() {
  const modal = document.getElementById('sleep-modal');
  modal.classList.remove('hidden');
}
function closeSleepTimer() {
  document.getElementById('sleep-modal').classList.add('hidden');
}
function setSleepTimer(minutes) {
  if (sleepTimer) clearTimeout(sleepTimer);
  if (minutes === 0) {
    // End of current song — set flag checked in onPlayerStateChange
    sleepAfterSong = true;
    showToast('Will stop after current song ends 🎵');
    closeSleepTimer();
    return;
  }
  sleepAfterSong = false;
  sleepTimer = setTimeout(() => {
    if (ytPlayer && ytReady) ytPlayer.pauseVideo();
    showToast('Sleep timer — music paused 😴');
    sleepTimer = null;
  }, minutes * 60 * 1000);
  showToast(`Sleep timer set for ${minutes} min ⏱`);
  closeSleepTimer();
}
function cancelSleepTimer() {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  sleepAfterSong = false;
  showToast('Sleep timer cancelled');
  closeSleepTimer();
}

// ─── Search ─────────────────────────────────────
function debounceSearch(query, targetId = 'home-results') {
  clearTimeout(searchDebounceTimer);
  if (!query.trim()) { const el = document.getElementById(targetId); if (el) el.innerHTML = ''; return; }
  searchDebounceTimer = setTimeout(() => doSearch(query, targetId), 500);
}

async function doSearch(query, targetId = 'home-results', retryCount = 0) {
  if (!query.trim()) return;
  const container = document.getElementById(targetId);
  if (!container) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔑</div><p>No API key configured in config.js</p></div>`;
    return;
  }

  if (retryCount === 0) container.innerHTML = `<div class="empty-state"><p>Searching...</p></div>`;

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(query)}&maxResults=20&key=${apiKey}&videoEmbeddable=true`;
    const res = await fetch(url);
    const data = await res.json();

    // Quota exceeded — try next key
    if (data.error?.code === 403 || data.error?.errors?.[0]?.reason === 'quotaExceeded' || data.error?.errors?.[0]?.reason === 'dailyLimitExceeded') {
      console.warn(`Key ${currentKeyIndex + 1} quota exceeded`);
      if (rotateApiKey() && retryCount < CONFIG.YT_API_KEYS.length - 1) {
        showToast(`Switching to backup API key...`);
        return doSearch(query, targetId, retryCount + 1);
      } else {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>All API keys have hit their daily quota.<br>Quota resets at midnight US Pacific Time.<br><br>To get more searches, add more API keys in config.js</p></div>`;
        return;
      }
    }

    if (data.error) { container.innerHTML = `<div class="empty-state"><p>⚠️ ${data.error.message}</p></div>`; return; }
    if (!data.items?.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No results for "<strong>${query}</strong>"</p></div>`; return; }

    const tracks = data.items.map(item => ({
      id: item.id.videoId, videoId: item.id.videoId,
      name: cleanTitle(item.snippet.title),
      artist: item.snippet.channelTitle.replace(/ - Topic| VEVO/gi, '').trim(),
      thumbnail: item.snippet.thumbnails?.medium?.url || '',
    }));

    currentQueue = [...tracks];
    container.innerHTML = '';
    if (targetId === 'home-results') {
      container.className = 'track-grid';
      tracks.forEach((t, i) => container.appendChild(createTrackCard(t, i)));
    } else {
      container.className = 'track-list-container';
      tracks.forEach((t, i) => container.appendChild(createTrackRow(t, i, tracks)));
    }
  } catch { container.innerHTML = `<div class="empty-state"><p>Search failed. Check your connection.</p></div>`; }
}

async function fetchRelatedTracks(track) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(track.artist)}&maxResults=10&key=${getApiKey()}&videoEmbeddable=true`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.items || [])
      .map(item => ({ id: item.id.videoId, videoId: item.id.videoId, name: cleanTitle(item.snippet.title), artist: item.snippet.channelTitle.replace(/ - Topic| VEVO/gi, '').trim(), thumbnail: item.snippet.thumbnails?.medium?.url || '' }))
      .filter(t => t.videoId !== track.videoId);
  } catch { return []; }
}

function cleanTitle(t) {
  return t.replace(/\(Official\s*(Music|Audio|Video|Lyric)?\s*(Video|Audio)?\)/gi,'')
    .replace(/\[Official.*?\]/gi,'').replace(/\(Audio\)|\(Lyric.*?\)/gi,'').replace(/\|.*$/,'').trim();
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
    <button class="track-card-menu" title="More options">⋮</button>
  `;
  div.onclick = () => playTrack(track, currentQueue, index);
  div.querySelector('.track-card-play').onclick = (e) => { e.stopPropagation(); playTrack(track, currentQueue, index); };
  div.querySelector('.track-card-menu').onclick = (e) => { e.stopPropagation(); showContextMenu(e, track); };
  return div;
}

function createTrackRow(track, index, queue = [], showRemove = false, removeCallback = null) {
  const thumb = track.thumbnail || track.album_art || '';
  const name = track.name || track.track_name || 'Unknown';
  const artist = track.artist || track.artist_name || 'Unknown';
  const trackId = String(track.id || track.track_id || track.videoId);
  const isSelected = selectedTracks.has(trackId);

  const div = document.createElement('div');
  div.className = `track-row${isSelected ? ' selected' : ''}`;
  div.dataset.trackId = trackId;
  div.innerHTML = `
    ${selectMode ? `<input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''}>` : `<span class="track-row-num">${index + 1}</span>`}
    <img class="track-row-art" src="${thumb}" alt="${name}" onerror="this.style.background='var(--bg4)';this.src='';">
    <div class="track-row-info">
      <div class="track-row-name">${name}</div>
      <div class="track-row-artist">${artist}</div>
    </div>
    <button class="row-menu-btn" title="More options">⋮</button>
    ${showRemove ? `<button class="row-action-btn remove-btn" title="Remove">✕</button>` : ''}
  `;

  div.onclick = (e) => {
    if (selectMode) { toggleSelectTrack(trackId, track, div); return; }
    if (e.target.closest('.row-menu-btn') || e.target.closest('.remove-btn')) return;
    playTrack(track, queue, index);
  };

  div.querySelector('.row-menu-btn').onclick = (e) => { e.stopPropagation(); showContextMenu(e, track); };
  if (showRemove && removeCallback) {
    div.querySelector('.remove-btn').onclick = (e) => { e.stopPropagation(); removeCallback(); };
  }
  return div;
}

// ─── Selection Mode (for adding songs to playlist) ─
function toggleSelectMode() {
  selectMode = !selectMode;
  selectedTracks.clear();
  const btn = document.getElementById('select-mode-btn');
  const addBtn = document.getElementById('add-selected-btn');
  if (btn) btn.classList.toggle('active', selectMode);
  if (addBtn) addBtn.style.display = selectMode ? 'flex' : 'none';
  // Re-render playlist tracks
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (pl) openPlaylistDetail(pl);
}

function toggleSelectTrack(trackId, track, rowEl) {
  if (selectedTracks.has(trackId)) {
    selectedTracks.delete(trackId);
    rowEl.classList.remove('selected');
    rowEl.querySelector('.track-checkbox').checked = false;
  } else {
    selectedTracks.add(trackId);
    selectedTracks.set ? null : null; // Set is fine
    rowEl.classList.add('selected');
    rowEl.querySelector('.track-checkbox').checked = true;
  }
  const addBtn = document.getElementById('add-selected-btn');
  if (addBtn) addBtn.textContent = `Add ${selectedTracks.size} songs to playlist`;
}

function addSelectedToPlaylist() {
  if (selectedTracks.size === 0) { showToast('Select at least one song'); return; }
  openAddToPlaylistBulk([...selectedTracks]);
}

function openAddToPlaylistBulk(trackIds) {
  // For bulk add, we'll add all selected songs (they are already in current playlist view)
  // This is for adding songs from search to a playlist
  showToast(`${trackIds.length} songs selected — feature for search view`);
}

// ─── Queue ───────────────────────────────────────
function addToQueue(track) { manualQueue.push(track); showToast(`Added to queue`); updateQueueBadge(); renderQueuePanel(); }
function removeFromQueue(index) { manualQueue.splice(index, 1); renderQueuePanel(); updateQueueBadge(); }
function clearQueue() { manualQueue = []; renderQueuePanel(); updateQueueBadge(); showToast('Queue cleared'); }
function updateQueueBadge() {
  const b = document.getElementById('queue-badge');
  if (b) { b.textContent = manualQueue.length || ''; b.style.display = manualQueue.length ? 'flex' : 'none'; }
}

function renderQueuePanel() {
  const container = document.getElementById('queue-list');
  if (!container) return;
  if (manualQueue.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>Queue is empty.<br>Use ⋮ on any song → "Add to Queue"</p></div>`;
    return;
  }
  container.innerHTML = '';
  manualQueue.forEach((track, i) => {
    const div = createTrackRow(track, i, manualQueue, true, () => removeFromQueue(i));
    container.appendChild(div);
  });
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
    const wait = setInterval(() => { if (ytReady && ytPlayer) { clearInterval(wait); doPlay(); } }, 200);
    setTimeout(() => clearInterval(wait), 10000);
    return;
  }

  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    ytPlayer.cueVideoById(videoId);
    showTapToPlay(doPlay);
  } else { doPlay(); }
}

async function playNextInQueue() {
  // Manual queue first
  if (manualQueue.length > 0) {
    const next = manualQueue.shift();
    updateQueueBadge(); renderQueuePanel();
    playTrack(next, [next], 0);
    return;
  }

  // Shuffle — play each song once before repeating
  if (isShuffle && currentQueue.length > 1) {
    // Filter out already played
    let unplayed = currentQueue.filter((_, i) => !playedInShuffle.has(i));
    if (unplayed.length === 0) {
      // All played — reset and start again
      playedInShuffle.clear();
      unplayed = [...currentQueue];
      showToast('🔀 Replaying shuffled playlist');
    }
    const randIdx = Math.floor(Math.random() * unplayed.length);
    const next = unplayed[randIdx];
    const origIdx = currentQueue.indexOf(next);
    playedInShuffle.add(origIdx);
    currentQueueIndex = origIdx;
    playTrack(next, currentQueue, origIdx);
    return;
  }

  // Next in queue
  if (currentQueue.length > 0 && currentQueueIndex < currentQueue.length - 1) {
    const nextIndex = currentQueueIndex + 1;
    playTrack(currentQueue[nextIndex], currentQueue, nextIndex);
    return;
  }

  // Auto-fetch related
  if (currentTrack) {
    showToast('Loading related songs...');
    const related = await fetchRelatedTracks(currentTrack);
    if (related.length > 0) { currentQueue = related; currentQueueIndex = 0; playTrack(related[0], related, 0); }
  }
}

function nextTrack() { playNextInQueue(); }
function prevTrack() {
  if (ytReady && ytPlayer.getCurrentTime() > 3) { ytPlayer.seekTo(0); return; }
  if (!currentQueue.length) return;
  const prev = (currentQueueIndex - 1 + currentQueue.length) % currentQueue.length;
  playTrack(currentQueue[prev], currentQueue, prev);
}
function togglePlayPause() {
  if (!currentTrack || !ytReady || !ytPlayer) return;
  if (isPlaying) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
}
function toggleShuffle() {
  isShuffle = !isShuffle;
  playedInShuffle.clear();
  document.getElementById('shuffle-btn')?.classList.toggle('active', isShuffle);
  showToast(isShuffle ? '🔀 Shuffle ON' : 'Shuffle OFF');
}
function seekTo(event) {
  if (!ytReady) return;
  const dur = ytPlayer.getDuration();
  if (!dur) return;
  const rect = event.currentTarget.getBoundingClientRect();
  ytPlayer.seekTo(((event.clientX - rect.left) / rect.width) * dur, true);
}
function setVolume(val) { if (ytReady) ytPlayer.setVolume(parseInt(val)); }

function updatePlayerUI(track) {
  const name = track.name || track.track_name || '—';
  const artist = track.artist || track.artist_name || '—';
  const thumb = track.thumbnail || track.album_art || '';
  const trackId = String(track.videoId || track.id || track.track_id);
  document.getElementById('player-name').textContent = name;
  document.getElementById('player-artist').textContent = artist;
  document.getElementById('player-art').innerHTML = thumb ? `<img src="${thumb}" alt="${name}">` : '';
  const lb = document.getElementById('like-btn');
  lb.classList.toggle('liked', likedSongIds.has(trackId));
  lb.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
}
function highlightPlayingRow(trackId) {
  document.querySelectorAll('.track-row').forEach(r => r.classList.toggle('playing', r.dataset.trackId === trackId));
}
function showTapToPlay(onTap) {
  document.getElementById('tap-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'tap-overlay';
  overlay.className = 'tap-overlay';
  overlay.innerHTML = `<div class="tap-overlay-inner"><div class="tap-play-btn">▶</div><p>Tap to play</p></div>`;
  overlay.onclick = () => { overlay.remove(); onTap(); };
  document.body.appendChild(overlay);
}

// ─── Liked Songs ─────────────────────────────────
async function loadLikedSongs() {
  if (!db || !currentUser) return;
  try {
    const { data } = await db.from('liked_songs').select('track_id').eq('user_id', currentUser.id);
    if (data) likedSongIds = new Set(data.map(r => String(r.track_id)));
  } catch {}
}

async function toggleLike(btn, track) {
  if (!currentUser) { showToast('Log in to like songs'); return; }
  const trackId = String(track.videoId || track.id || track.track_id);
  const isLiked = likedSongIds.has(trackId);
  if (isLiked) {
    likedSongIds.delete(trackId);
    if (btn) { btn.textContent = '♡'; btn.classList.remove('liked'); }
    await db.from('liked_songs').delete().eq('track_id', trackId).eq('user_id', currentUser.id);
    showToast('Removed from Liked Songs');
  } else {
    likedSongIds.add(trackId);
    if (btn) { btn.textContent = '♥'; btn.classList.add('liked'); }
    await db.from('liked_songs').insert({ user_id: currentUser.id, track_id: trackId, track_name: track.name || track.track_name, artist_name: track.artist || track.artist_name, album_art: track.thumbnail || track.album_art, preview_url: null, duration_ms: 0 });
    showToast('Added to Liked Songs ♥');
  }
  if (currentTrack && String(currentTrack.videoId || currentTrack.id) === trackId) {
    const lb = document.getElementById('like-btn');
    lb.classList.toggle('liked', likedSongIds.has(trackId));
    lb.textContent = likedSongIds.has(trackId) ? '♥' : '♡';
  }
}

async function toggleLikeCurrent() { if (currentTrack) await toggleLike(document.getElementById('like-btn'), currentTrack); }

async function renderLikedSongs() {
  const container = document.getElementById('liked-list');
  const countEl = document.getElementById('liked-count');
  if (!db || !currentUser) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Log in to see liked songs</p></div>`; return; }
  const { data } = await db.from('liked_songs').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  const songs = data || [];
  countEl.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''}`;
  if (songs.length === 0) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">♡</div><p>Songs you like will appear here</p></div>`; return; }
  const queue = songs.map(s => ({ id: s.track_id, videoId: s.track_id, name: s.track_name, artist: s.artist_name, thumbnail: s.album_art }));
  container.innerHTML = '';
  songs.forEach((s, i) => container.appendChild(createTrackRow({ id: s.track_id, videoId: s.track_id, name: s.track_name, artist: s.artist_name, thumbnail: s.album_art }, i, queue)));
}
function playAllLiked() { document.querySelector('#liked-list .track-row')?.click(); }

// ─── Playlists ───────────────────────────────────
async function loadPlaylists() {
  if (!db || !currentUser) return;
  try {
    const { data } = await db.from('playlists').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    playlists = data || [];
    renderSidebarPlaylists();
  } catch {}
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
  if (!currentUser) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔒</div><p>Log in to manage playlists</p></div>`; return; }
  if (playlists.length === 0) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🎵</div><p>Create your first playlist</p></div>`; return; }
  grid.innerHTML = '';
  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.innerHTML = `<div class="playlist-card-icon">🎵</div><div class="playlist-card-name">${pl.name}</div><div class="playlist-card-count">Playlist</div><button class="playlist-card-delete">✕</button>`;
    card.onclick = () => openPlaylistDetail(pl);
    card.querySelector('.playlist-card-delete').onclick = (e) => { e.stopPropagation(); deletePlaylist(pl.id); };
    grid.appendChild(card);
  });
}

async function createPlaylist() {
  if (!currentUser) { showToast('Log in to create playlists'); return; }
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const { data } = await db.from('playlists').insert({ name: name.trim(), user_id: currentUser.id }).select().single();
  if (data) { playlists.unshift(data); renderSidebarPlaylists(); renderPlaylistsGrid(); showToast(`Playlist "${name}" created`); }
}

async function deletePlaylist(id) {
  if (!confirm('Delete this playlist?')) return;
  await db.from('playlists').delete().eq('id', id).eq('user_id', currentUser.id);
  playlists = playlists.filter(p => p.id !== id);
  renderSidebarPlaylists(); renderPlaylistsGrid();
  showToast('Playlist deleted');
}

async function openPlaylistDetail(pl) {
  currentPlaylistId = pl.id;
  selectMode = false;
  selectedTracks.clear();
  document.getElementById('pl-name').textContent = pl.name;
  showView('playlist-detail');
  const { data } = await db.from('playlist_tracks').select('*').eq('playlist_id', pl.id).eq('user_id', currentUser.id).order('added_at', { ascending: true });
  const tracks = data || [];
  document.getElementById('pl-count').textContent = `${tracks.length} song${tracks.length !== 1 ? 's' : ''}`;
  const container = document.getElementById('playlist-track-list');
  if (tracks.length === 0) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No tracks yet. Use ⋮ on any song → "Add to Playlist"</p></div>`; return; }
  const queue = tracks.map(t => ({ id: t.track_id, videoId: t.track_id, name: t.track_name, artist: t.artist_name, thumbnail: t.album_art }));
  container.innerHTML = '';
  tracks.forEach((t, i) => {
    const track = { id: t.track_id, videoId: t.track_id, name: t.track_name, artist: t.artist_name, thumbnail: t.album_art };
    container.appendChild(createTrackRow(track, i, queue, true, () => removeFromPlaylist(pl.id, t.track_id)));
  });
  // Update select button
  const btn = document.getElementById('select-mode-btn');
  if (btn) { btn.classList.remove('active'); }
  document.getElementById('add-selected-btn').style.display = 'none';
}

function playAllPlaylist() { document.querySelector('#playlist-track-list .track-row')?.click(); }

function shufflePlaylist() {
  const rows = [...document.querySelectorAll('#playlist-track-list .track-row')];
  if (!rows.length) return;
  const queue = rows.map(r => ({ id: r.dataset.trackId, videoId: r.dataset.trackId, name: r.querySelector('.track-row-name').textContent, artist: r.querySelector('.track-row-artist').textContent, thumbnail: r.querySelector('.track-row-art').src }));
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  playedInShuffle.clear();
  isShuffle = true;
  currentQueue = queue;
  currentQueueIndex = 0;
  playedInShuffle.add(0);
  playTrack(queue[0], queue, 0);
  showToast('🔀 Shuffling playlist!');
}

async function removeFromPlaylist(playlistId, trackId) {
  await db.from('playlist_tracks').delete().eq('playlist_id', playlistId).eq('track_id', trackId).eq('user_id', currentUser.id);
  const pl = playlists.find(p => p.id === playlistId);
  if (pl) openPlaylistDetail(pl);
  showToast('Removed from playlist');
}

// ─── Add to Playlist ─────────────────────────────
function openAddToPlaylist(track) {
  // track must be explicitly passed — never fall back to currentTrack
  if (!track) { showToast('Select a track first'); return; }
  if (!currentUser) { showToast('Log in to use playlists'); return; }

  const modal = document.getElementById('playlist-modal');
  const list = document.getElementById('playlist-modal-list');
  list.innerHTML = '';

  // Store the SPECIFIC track in the modal — not currentTrack
  const trackData = {
    id: track.id || track.videoId || track.track_id,
    videoId: track.videoId || track.id || track.track_id,
    name: track.name || track.track_name || 'Unknown',
    artist: track.artist || track.artist_name || 'Unknown',
    thumbnail: track.thumbnail || track.album_art || ''
  };
  modal.dataset.trackJson = JSON.stringify(trackData);

  if (!playlists.length) {
    list.innerHTML = `<p style="color:var(--text2);font-size:0.85rem;padding:8px 0">No playlists yet.</p>`;
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

function closePlaylistModal() { document.getElementById('playlist-modal').classList.add('hidden'); }

async function createPlaylistFromModal() {
  closePlaylistModal();
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const { data } = await db.from('playlists').insert({ name: name.trim(), user_id: currentUser.id }).select().single();
  if (data) { playlists.unshift(data); renderSidebarPlaylists(); renderPlaylistsGrid(); setTimeout(() => { const modal = document.getElementById('playlist-modal'); if (modal.dataset.trackJson) openAddToPlaylist(JSON.parse(modal.dataset.trackJson)); }, 300); }
}

async function addTrackToPlaylist(playlistId, playlistName) {
  const modal = document.getElementById('playlist-modal');
  const track = JSON.parse(modal.dataset.trackJson || '{}');
  closePlaylistModal();
  if (!track.videoId) return;

  const trackId = String(track.videoId);

  // Check if already in playlist before inserting
  const { data: existing } = await db
    .from('playlist_tracks')
    .select('id')
    .eq('playlist_id', playlistId)
    .eq('track_id', trackId)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (existing) {
    showToast(`Already in "${playlistName}"`);
    return;
  }

  const { error } = await db.from('playlist_tracks').insert({
    playlist_id: playlistId,
    user_id: currentUser.id,
    track_id: trackId,
    track_name: track.name,
    artist_name: track.artist,
    album_art: track.thumbnail,
    preview_url: null,
    duration_ms: 0
  });

  if (!error) showToast(`Added to "${playlistName}" ✅`);
  else showToast('Failed to add to playlist');
}

// ─── Helpers ─────────────────────────────────────
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden'); t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 2800);
}