/* ========================================
   VINYLIFY STUDIO — Main Application
   ======================================== */

/* ---- INDEXED DB STORAGE ENGINE ---- */
const DB_NAME = 'VinylifyStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_files';

function openAudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudioBlob(id, blob) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAudioBlob(id) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteAudioBlob(id) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- DEFAULT DATA ---- */
const DEFAULT_DATA = {
  activePlaylistId: 'pl-1',
  playlists: [
    {
      id: 'pl-1',
      name: 'Lofi & Chill Beats',
      songs: [
        {
          id: 'song-demo-1',
          title: 'Lofi Hip Hop Chill Study Beat',
          artist: 'Free Sound Library',
          type: 'file',
          url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
          duration: '2:25'
        },
        {
          id: 'song-demo-2',
          title: 'Lofi Chill Hop Stream',
          artist: 'ChillHop Music',
          type: 'youtube',
          ytId: '5qap5aO4i9A',
          duration: 'Music'
        }
      ]
    },
    {
      id: 'pl-2',
      name: 'Synthwave Night Ride',
      songs: []
    }
  ]
};

/* ---- APPLICATION STATE ---- */
let appData = loadState();
let currentTrack = null;
let isPlaying = false;
let audioType = null;
let ytPlayer = null;
let isYtReady = false;
let currentRPM = 33;

let audioCtx = null;
let audioSourceNode = null;
let biquadFilter = null;
let bassEQ = null;
let midEQ = null;
let trebleEQ = null;
let crackleNode = null;
let crackleGain = null;
let analyserNode = null;
let isLofiFilterOn = false;
let sleepTimerTimeout = null;
let crackleStarted = false;

/* ---- DOM ELEMENTS ---- */
const html5Audio = document.getElementById('html5-audio');
const vinylRecord = document.getElementById('vinyl-record');
const tonearm = document.getElementById('tonearm');
const playPauseBtn = document.getElementById('play-pause-btn');
const playPauseIcon = document.getElementById('play-pause-icon');
const playerSongTitle = document.getElementById('player-song-title');
const playerSongArtist = document.getElementById('player-song-artist');
const vinylLabelTitle = document.getElementById('vinyl-label-title');
const vinylLabelArtist = document.getElementById('vinyl-label-artist');
const currentTimeEl = document.getElementById('current-time');
const totalDurationEl = document.getElementById('total-duration');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
const pitchSlider = document.getElementById('pitch-slider');
const pitchValueLabel = document.getElementById('pitch-value-label');
const muteBtn = document.getElementById('mute-btn');
const muteIcon = document.getElementById('mute-icon');
const lofiFilterBtn = document.getElementById('lofi-filter-btn');
const lofiStatusText = document.getElementById('lofi-status-text');
const songsListEl = document.getElementById('songs-list');
const emptySongsState = document.getElementById('empty-songs-state');
const audioSourceBadge = document.getElementById('audio-source-badge');

/* ---- LYRICS DOM ELEMENTS ---- */
const lyricsPanel = document.getElementById('lyrics-panel');
const lyricsContent = document.getElementById('lyrics-content');
const lyricsSongTitle = document.getElementById('lyrics-song-title');
const lyricsSourceStatus = document.getElementById('lyrics-source-status');
const lyricsSyncStatus = document.getElementById('lyrics-sync-status');
const lyricsManualInput = document.getElementById('lyrics-manual-input');
const lrcFileInput = document.getElementById('lrc-file-input');

/* ---- LYRICS STATE ---- */
let currentLyrics = [];
let currentLrcData = [];
let lyricsUpdateInterval = null;
let lyricsCurrentIndex = -1;

/* ---- STATE HELPERS ---- */
function loadState() {
  try {
    const saved = localStorage.getItem('vinylify_app_state');
    if (saved) return JSON.parse(saved);
  } catch (e) { console.error(e); }
  return DEFAULT_DATA;
}

function saveState() {
  try {
    localStorage.setItem('vinylify_app_state', JSON.stringify(appData));
  } catch (e) { console.error(e); }
}

function getCurrentPlaylist() {
  return appData.playlists.find(p => p.id === appData.activePlaylistId) || appData.playlists[0];
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/* ---- TOAST NOTIFICATION ---- */
function showToast(msg, type = 'info') {
  const toastContainer = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-emerald-900/90 border-emerald-700 text-emerald-200' :
             type === 'error' ? 'bg-rose-900/90 border-rose-700 text-rose-200' :
             'bg-slate-800/90 border-slate-700 text-amber-300';
  toast.className = `px-4 py-2.5 rounded-xl border ${bg} text-xs font-medium shadow-2xl backdrop-blur-md transition transform translate-y-2 pointer-events-auto flex items-center gap-2`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i><span>${escapeHtml(msg)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* ========================================
   YOUTUBE IFRAME API
   ======================================== */

window.onYouTubeIframeAPIReady = function() {
  const playerParams = {
    autoplay: 0,
    controls: 0,
    disablekb: 1,
    modestbranding: 1,
    enablejsapi: 1,
    rel: 0
  };
  if (window.location.origin && window.location.origin !== 'null' && window.location.protocol.startsWith('http')) {
    playerParams.origin = window.location.origin;
  }
  ytPlayer = new YT.Player('yt-player', {
    height: '180',
    width: '320',
    host: 'https://www.youtube-nocookie.com',
    playerVars: playerParams,
    events: {
      onReady: () => { isYtReady = true; },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) handleNextTrack();
      },
      onError: (e) => {
        console.error('YouTube Error:', e.data);
        handleYouTubeError(e.data);
      }
    }
  });
};
const ytScript = document.createElement('script');
ytScript.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytScript);

/* ========================================
   YOUTUBE ERROR HANDLER
   ======================================== */

function handleYouTubeError(errorCode) {
  let title = '⚠️ YouTube Playback Error';
  let message = '';
  let suggestions = [];
  let icon = 'fa-brands fa-youtube text-red-500';
  
  switch (errorCode) {
    case 2:
    case 100:
      title = '❌ Invalid YouTube Video';
      message = 'This video ID is invalid or the link doesn\'t point to a valid YouTube video.';
      suggestions = [
        'Double-check the URL for typos',
        'Make sure the video is publicly available',
        'Try a different video link'
      ];
      icon = 'fa-solid fa-link text-red-400';
      break;
      
    case 101:
    case 150:
      title = '🚫 Playback Restricted';
      message = 'This video can\'t be played in Vinylify because embedded playback has been restricted by the uploader or rights holder.';
      suggestions = [
        'Open the video directly on YouTube',
        'Try a different upload of the same song',
        'Search for an official audio version (often allows embedding)',
        'Upload an MP3 file instead'
      ];
      icon = 'fa-solid fa-lock text-amber-400';
      break;
      
    case 153:
      title = '🌐 Embedding Blocked';
      message = 'YouTube embedding is blocked. This is often due to browser privacy settings, ad-blockers, or network restrictions.';
      suggestions = [
        'Try disabling ad-blockers or privacy extensions for this site',
        'Try a different browser (Chrome, Firefox, Edge, Safari)',
        'Check if your network (VPN, firewall, school/work) blocks YouTube embeds',
        'If on mobile, try using the YouTube app or mobile browser',
        'Open the video directly on YouTube'
      ];
      icon = 'fa-solid fa-shield-halved text-blue-400';
      break;
      
    default:
      title = '❓ Unknown YouTube Error';
      message = 'An unexpected error occurred while trying to play this YouTube video.';
      suggestions = [
        'Try refreshing the page',
        'Open the video directly on YouTube',
        'Try a different video link',
        'Upload an MP3 file instead'
      ];
      icon = 'fa-solid fa-circle-exclamation text-slate-400';
  }
  
  showYouTubeErrorModal(title, message, suggestions, icon);
  showToast(message.split('.')[0] + '.', 'error');
  setPlayingState(false);
}

function showYouTubeErrorModal(title, message, suggestions, icon) {
  const existingModal = document.getElementById('youtube-error-modal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'youtube-error-modal';
  modal.className = 'fixed inset-0 bg-slate-950/85 backdrop-blur-lg z-[60] flex items-center justify-center p-4';
  modal.style.animation = 'fadeIn 0.25s ease';
  
  let suggestionsHTML = '';
  if (suggestions && suggestions.length > 0) {
    suggestionsHTML = `
      <div class="mt-3 space-y-1.5">
        <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">💡 Suggestions</p>
        <ul class="space-y-1.5">
          ${suggestions.map((s, i) => `
            <li class="flex items-start gap-2.5 text-xs text-slate-300">
              <span class="text-emerald-400 font-bold text-[10px] mt-0.5">${i + 1}.</span>
              <span>${s}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }
  
  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative" style="animation: slideUp 0.3s ease;">
      <button onclick="closeYouTubeErrorModal()" class="absolute top-4 right-4 text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition" aria-label="Close">
        <i class="fa-solid fa-xmark text-lg"></i>
      </button>
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-xl bg-slate-800/80 flex items-center justify-center shrink-0 text-2xl">
          <i class="${icon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-display font-bold text-base text-white">${title}</h3>
          <p class="text-sm text-slate-300 mt-1 leading-relaxed">${message}</p>
          ${suggestionsHTML}
        </div>
      </div>
      <div class="mt-5 flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-700/50">
        <button onclick="openYouTubeInNewTab()" class="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition flex items-center gap-2">
          <i class="fa-brands fa-youtube"></i> Open in YouTube
        </button>
        <button onclick="closeYouTubeErrorModal()" class="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition">
          Dismiss
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  if (currentTrack && currentTrack.ytId) {
    modal.dataset.ytId = currentTrack.ytId;
  }
}

function closeYouTubeErrorModal() {
  const modal = document.getElementById('youtube-error-modal');
  if (modal) modal.remove();
}

function openYouTubeInNewTab() {
  const modal = document.getElementById('youtube-error-modal');
  if (modal && modal.dataset.ytId) {
    window.open(`https://www.youtube.com/watch?v=${modal.dataset.ytId}`, '_blank');
  } else if (currentTrack && currentTrack.ytId) {
    window.open(`https://www.youtube.com/watch?v=${currentTrack.ytId}`, '_blank');
  }
}

/* ---- CSS animations ---- */
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
`;
document.head.appendChild(styleSheet);

/* ---- RENDER FUNCTIONS ---- */
function renderPlaylists() {
  const container = document.getElementById('playlist-tabs-container');
  container.innerHTML = '';
  appData.playlists.forEach((pl) => {
    const isActive = pl.id === appData.activePlaylistId;
    const btn = document.createElement('button');
    btn.className = `px-3.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 shrink-0 border ${
      isActive ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow-sm' : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/60'
    }`;
    btn.innerHTML = `<i class="fa-solid fa-compact-disc text-[10px]"></i><span>${escapeHtml(pl.name)}</span>`;
    btn.onclick = () => {
      appData.activePlaylistId = pl.id;
      saveState();
      renderPlaylists();
      renderSongsList();
    };
    container.appendChild(btn);
  });
  const currentPl = getCurrentPlaylist();
  if (currentPl) document.getElementById('current-playlist-title').innerText = currentPl.name;
}

function renderSongsList() {
  const currentPl = getCurrentPlaylist();
  songsListEl.innerHTML = '';
  if (!currentPl || !currentPl.songs || currentPl.songs.length === 0) {
    emptySongsState.classList.remove('hidden');
    document.getElementById('songs-count-label').innerText = '0 Songs';
    return;
  }
  emptySongsState.classList.add('hidden');
  document.getElementById('songs-count-label').innerText = `${currentPl.songs.length} Track${currentPl.songs.length > 1 ? 's' : ''}`;
  currentPl.songs.forEach((song) => {
    const isCurrent = currentTrack && currentTrack.id === song.id;
    const card = document.createElement('div');
    card.className = `p-3 rounded-xl border transition flex items-center justify-between gap-3 ${
      isCurrent ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 shadow-md' : 'bg-slate-900/90 hover:bg-slate-800/80 border-slate-800 text-slate-200'
    }`;
    const typeIcon = song.type === 'youtube' ? 'fa-brands fa-youtube text-red-400' : 'fa-solid fa-file-audio';
    const typeLabel = song.type === 'youtube' ? 'YT' : 'MP3';
    card.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onclick="playSongAt('${song.id}')">
        <div class="w-8 h-8 rounded-lg ${isCurrent ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0 font-bold text-xs">
          ${isCurrent && isPlaying ? '<i class="fa-solid fa-compact-disc animate-spin"></i>' : `<i class="${typeIcon}"></i>`}
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-medium text-xs md:text-sm text-white truncate ${isCurrent ? 'text-amber-300 font-bold' : ''}">${escapeHtml(song.title)}</h2>
          <p class="text-[11px] text-slate-400 truncate">${escapeHtml(song.artist || 'Unknown Artist')}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[9px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">${typeLabel}</span>
        <button onclick="deleteSong('${song.id}')" class="text-slate-400 hover:text-rose-400 p-1.5 rounded-md hover:bg-slate-800 transition text-xs" aria-label="Delete Track">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    songsListEl.appendChild(card);
  });
}

/* ---- WEB AUDIO API ---- */
function initWebAudio() {
  if (audioCtx) return;
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtxClass();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;
    biquadFilter = audioCtx.createBiquadFilter();
    biquadFilter.type = 'lowpass';
    biquadFilter.frequency.value = isLofiFilterOn ? 1800 : 22000;
    bassEQ = audioCtx.createBiquadFilter();
    bassEQ.type = 'lowshelf';
    bassEQ.frequency.value = 250;
    midEQ = audioCtx.createBiquadFilter();
    midEQ.type = 'peaking';
    midEQ.frequency.value = 1500;
    trebleEQ = audioCtx.createBiquadFilter();
    trebleEQ.type = 'highshelf';
    trebleEQ.frequency.value = 4000;
    audioSourceNode = audioCtx.createMediaElementSource(html5Audio);
    audioSourceNode.connect(biquadFilter);
    biquadFilter.connect(bassEQ);
    bassEQ.connect(midEQ);
    midEQ.connect(trebleEQ);
    trebleEQ.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
    startVisualizerAnimation();
  } catch (e) { console.warn('Web Audio limited:', e); }
}

/* ---- VINYL CRACKLE ---- */
function startVinylCrackle() {
  if (!audioCtx || crackleStarted) return;
  try {
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const isPop = Math.random() < 0.0008;
      output[i] = isPop ? (Math.random() * 2 - 1) * 0.7 : (Math.random() * 2 - 1) * 0.02;
    }
    crackleNode = audioCtx.createBufferSource();
    crackleNode.buffer = noiseBuffer;
    crackleNode.loop = true;
    crackleGain = audioCtx.createGain();
    crackleGain.gain.value = parseFloat(document.getElementById('crackle-volume').value);
    crackleNode.connect(crackleGain);
    crackleGain.connect(audioCtx.destination);
    crackleNode.start();
    crackleStarted = true;
  } catch (e) { console.warn('Crackle init error:', e); }
}

function updateCrackleState(playing) {
  if (playing && audioCtx && !crackleStarted) {
    startVinylCrackle();
    if (crackleGain) crackleGain.gain.value = parseFloat(document.getElementById('crackle-volume').value);
  } else if (crackleGain) {
    crackleGain.gain.value = playing ? parseFloat(document.getElementById('crackle-volume').value) : 0;
  }
}

/* ---- PLAYBACK CONTROLS ---- */
async function playSongAt(songId) {
  const currentPl = getCurrentPlaylist();
  const song = currentPl.songs.find(s => s.id === songId);
  if (!song) return;
  currentTrack = song;
  audioType = song.type || 'file';
  playerSongTitle.innerText = song.title;
  playerSongArtist.innerText = song.artist || 'Unknown Artist';
  vinylLabelTitle.innerText = song.title;
  vinylLabelArtist.innerText = song.artist || 'Vinylify Studio';

  if (audioType === 'file') {
    audioSourceBadge.innerHTML = `<i class="fa-solid fa-file-audio text-amber-400"></i> MP3 LOCAL`;
    if (ytPlayer && isYtReady && ytPlayer.stopVideo) ytPlayer.stopVideo();
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    try {
      if (song.id.startsWith('song-demo')) html5Audio.src = song.url;
      else {
        const blob = await getAudioBlob(song.id);
        if (blob) html5Audio.src = URL.createObjectURL(blob);
        else if (song.url) html5Audio.src = song.url;
      }
      applyPlaybackSpeed();
      await html5Audio.play();
      setPlayingState(true);
      updateMediaSession(song);
      setTimeout(() => searchLyricsLRCLIB(song), 500);
    } catch (e) { console.error('Playback error:', e); showToast('Could not play audio track', 'error'); }
  } else if (audioType === 'youtube') {
    audioSourceBadge.innerHTML = `<i class="fa-brands fa-youtube text-red-500"></i> YOUTUBE`;
    html5Audio.pause();
    if (ytPlayer && isYtReady) {
      ytPlayer.loadVideoById(song.ytId);
      ytPlayer.setPlaybackRate(parseFloat(pitchSlider.value) * (currentRPM === 45 ? 1.35 : currentRPM === 78 ? 2.34 : 1.0));
      ytPlayer.playVideo();
      setPlayingState(true);
      updateMediaSession(song);
      setTimeout(() => searchLyricsLRCLIB(song), 1500);
    } else showToast('YouTube player initializing...', 'info');
  }
  renderSongsList();
}

function togglePlayPause() {
  if (!currentTrack) {
    const currentPl = getCurrentPlaylist();
    if (currentPl && currentPl.songs.length > 0) playSongAt(currentPl.songs[0].id);
    else showToast('Playlist is empty. Add a track first!', 'info');
    return;
  }
  if (isPlaying) pauseCurrentAudio();
  else resumeCurrentAudio();
}

function pauseCurrentAudio() {
  if (audioType === 'file') html5Audio.pause();
  else if (audioType === 'youtube' && ytPlayer && isYtReady) ytPlayer.pauseVideo();
  setPlayingState(false);
  updateCrackleState(false);
}

function resumeCurrentAudio() {
  if (audioType === 'file') {
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    html5Audio.play();
  } else if (audioType === 'youtube' && ytPlayer && isYtReady) ytPlayer.playVideo();
  setPlayingState(true);
  updateCrackleState(true);
}

function setPlayingState(playing) {
  isPlaying = playing;
  if (playing) {
    vinylRecord.classList.add('animate-spin-slow');
    tonearm.classList.remove('tonearm-idle');
    tonearm.classList.add('tonearm-playing');
    playPauseIcon.className = 'fa-solid fa-pause';
    updateCrackleState(true);
  } else {
    vinylRecord.classList.remove('animate-spin-slow');
    tonearm.classList.remove('tonearm-playing');
    tonearm.classList.add('tonearm-idle');
    playPauseIcon.className = 'fa-solid fa-play ml-1';
    updateCrackleState(false);
  }
  renderSongsList();
}

function applyPlaybackSpeed() {
  const pitchFactor = parseFloat(pitchSlider.value);
  const rpmMultiplier = currentRPM === 45 ? 1.35 : currentRPM === 78 ? 2.34 : 1.0;
  html5Audio.playbackRate = pitchFactor * rpmMultiplier;
}

function handleNextTrack() {
  const currentPl = getCurrentPlaylist();
  if (!currentPl || currentPl.songs.length === 0) return;
  const currentIndex = currentPl.songs.findIndex(s => s.id === (currentTrack ? currentTrack.id : ''));
  const nextIndex = (currentIndex + 1) % currentPl.songs.length;
  playSongAt(currentPl.songs[nextIndex].id);
}

function handlePrevTrack() {
  const currentPl = getCurrentPlaylist();
  if (!currentPl || currentPl.songs.length === 0) return;
  const currentIndex = currentPl.songs.findIndex(s => s.id === (currentTrack ? currentTrack.id : ''));
  const prevIndex = (currentIndex - 1 + currentPl.songs.length) % currentPl.songs.length;
  playSongAt(currentPl.songs[prevIndex].id);
}

function updateMediaSession(song) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist || 'Vinylify Studio', album: 'Vinylify Retro Studio' });
    navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => handleNextTrack());
  }
}

/* ---- PROGRESS & SEEK ---- */
html5Audio.ontimeupdate = () => {
  if (audioType === 'file' && html5Audio.duration) updateProgressUI(html5Audio.currentTime, html5Audio.duration);
};
html5Audio.onended = () => { if (audioType === 'file') handleNextTrack(); };

setInterval(() => {
  if (isPlaying && audioType === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;
    updateProgressUI(cur, dur);
  }
}, 500);

function updateProgressUI(current, duration) {
  currentTimeEl.innerText = formatTime(current);
  totalDurationEl.innerText = duration ? formatTime(duration) : '0:00';
  if (duration) seekBar.value = (current / duration) * 100;
}

/* ---- EVENT LISTENERS ---- */
seekBar.oninput = () => {
  const pct = parseFloat(seekBar.value) / 100;
  if (audioType === 'file' && html5Audio.duration) html5Audio.currentTime = pct * html5Audio.duration;
  else if (audioType === 'youtube' && ytPlayer && ytPlayer.getDuration) ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
};

volumeBar.oninput = () => {
  html5Audio.volume = parseFloat(volumeBar.value);
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(parseFloat(volumeBar.value) * 100);
  muteIcon.className = html5Audio.volume === 0 ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
};

muteBtn.onclick = () => {
  if (volumeBar.value > 0) { volumeBar.dataset.oldVal = volumeBar.value; volumeBar.value = 0; }
  else { volumeBar.value = volumeBar.dataset.oldVal || 0.8; }
  volumeBar.oninput();
};

pitchSlider.oninput = () => {
  pitchValueLabel.innerText = `${parseFloat(pitchSlider.value).toFixed(2)}x`;
  applyPlaybackSpeed();
  if (audioType === 'youtube' && ytPlayer && ytPlayer.setPlaybackRate) {
    const rate = parseFloat(pitchSlider.value) * (currentRPM === 45 ? 1.35 : currentRPM === 78 ? 2.34 : 1.0);
    ytPlayer.setPlaybackRate(rate);
  }
};

document.querySelectorAll('.rpm-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.rpm-btn').forEach(b => b.className = 'rpm-btn px-2 py-0.5 rounded hover:bg-slate-800 text-slate-400');
    btn.className = 'rpm-btn px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold';
    currentRPM = parseInt(btn.dataset.rpm);
    applyPlaybackSpeed();
    if (audioType === 'youtube' && ytPlayer && ytPlayer.setPlaybackRate) {
      const rate = parseFloat(pitchSlider.value) * (currentRPM === 45 ? 1.35 : currentRPM === 78 ? 2.34 : 1.0);
      ytPlayer.setPlaybackRate(rate);
    }
    showToast(`Turntable Speed set to ${currentRPM} RPM`, 'info');
  };
});

document.getElementById('eq-bass').oninput = (e) => {
  if (bassEQ) bassEQ.gain.value = e.target.value;
  document.getElementById('eq-bass-val').innerText = `${e.target.value}dB`;
};
document.getElementById('eq-mid').oninput = (e) => {
  if (midEQ) midEQ.gain.value = e.target.value;
  document.getElementById('eq-mid-val').innerText = `${e.target.value}dB`;
};
document.getElementById('eq-treble').oninput = (e) => {
  if (trebleEQ) trebleEQ.gain.value = e.target.value;
  document.getElementById('eq-treble-val').innerText = `${e.target.value}dB`;
};

document.getElementById('crackle-volume').oninput = (e) => {
  const val = parseFloat(e.target.value);
  document.getElementById('crackle-val').innerText = val === 0 ? 'Silent' : 'Warm';
  if (crackleGain) {
    crackleGain.gain.value = isPlaying ? val : 0;
  }
};

lofiFilterBtn.onclick = () => {
  isLofiFilterOn = !isLofiFilterOn;
  if (biquadFilter) biquadFilter.frequency.value = isLofiFilterOn ? 1800 : 22000;
  if (isLofiFilterOn) {
    lofiStatusText.innerText = 'LO-FI: WARM';
    lofiFilterBtn.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500/40');
    showToast('Lo-Fi Vintage Warmth Filter Enabled', 'info');
  } else {
    lofiStatusText.innerText = 'LO-FI: OFF';
    lofiFilterBtn.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/40');
  }
};

/* ---- VISUALIZER ---- */
function startVisualizerAnimation() {
  const canvas = document.getElementById('visualizer-canvas');
  const ctx = canvas.getContext('2d');
  function draw() {
    requestAnimationFrame(draw);
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!analyserNode || !isPlaying) return;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);
    const barWidth = (canvas.width / bufferLength) * 1.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }
  draw();
}

/* ---- ADD TRACK MODAL ---- */
const addSongModal = document.getElementById('add-song-modal');
const tabFile = document.getElementById('modal-tab-file');
const tabYoutube = document.getElementById('modal-tab-youtube');
const fileForm = document.getElementById('file-upload-form');
const ytForm = document.getElementById('youtube-url-form');
const mp3FileInput = document.getElementById('mp3-file-input');
const dropZone = document.getElementById('drop-zone');

document.getElementById('open-add-song-modal').onclick = () => addSongModal.classList.remove('hidden');
document.getElementById('empty-add-song-btn').onclick = () => addSongModal.classList.remove('hidden');
document.getElementById('close-add-modal').onclick = () => addSongModal.classList.add('hidden');

tabFile.onclick = () => {
  tabFile.className = 'py-2 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 transition';
  tabYoutube.className = 'py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition';
  fileForm.classList.remove('hidden');
  ytForm.classList.add('hidden');
};
tabYoutube.onclick = () => {
  tabYoutube.className = 'py-2 text-xs font-semibold rounded-lg bg-red-600 text-white transition';
  tabFile.className = 'py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition';
  ytForm.classList.remove('hidden');
  fileForm.classList.add('hidden');
};

dropZone.onclick = () => mp3FileInput.click();
mp3FileInput.onchange = (e) => {
  if (e.target.files.length > 0) {
    document.getElementById('file-title-input').value = e.target.files[0].name.replace(/\.[^/.]+$/, "");
  }
};

/* ---- FILE UPLOAD — WITH REQUIRED ARTIST ---- */
fileForm.onsubmit = async (e) => {
  e.preventDefault();
  
  const title = document.getElementById('file-title-input').value.trim();
  const artist = document.getElementById('file-artist-input').value.trim();
  const file = mp3FileInput.files[0];
  
  if (!title) {
    showToast('Please enter a song title', 'error');
    document.getElementById('file-title-input').focus();
    return;
  }
  
  if (!artist) {
    showToast('Please enter the artist name (required for lyrics search)', 'error');
    document.getElementById('file-artist-input').focus();
    return;
  }
  
  if (!file) {
    showToast('Select an MP3 audio file first', 'error');
    return;
  }
  
  const songId = 'song-' + Date.now();
  
  try {
    await saveAudioBlob(songId, file);
    const currentPl = getCurrentPlaylist();
    currentPl.songs.push({ 
      id: songId, 
      title: title, 
      artist: artist,
      type: 'file', 
      duration: '3:00' 
    });
    saveState();
    renderSongsList();
    addSongModal.classList.add('hidden');
    fileForm.reset();
    showToast(`"${title}" by ${artist} saved!`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Storage error when saving MP3', 'error');
  }
};

/* ---- YOUTUBE UPLOAD — WITH REQUIRED ARTIST ---- */
ytForm.onsubmit = (e) => {
  e.preventDefault();
  
  const url = document.getElementById('yt-url-input').value.trim();
  const title = document.getElementById('yt-title-input').value.trim();
  const artist = document.getElementById('yt-artist-input').value.trim();
  
  if (!url) {
    showToast('Please enter a YouTube URL', 'error');
    document.getElementById('yt-url-input').focus();
    return;
  }
  
  if (!title) {
    showToast('Please enter a song title', 'error');
    document.getElementById('yt-title-input').focus();
    return;
  }
  
  if (!artist) {
    showToast('Please enter the artist name (required for lyrics search)', 'error');
    document.getElementById('yt-artist-input').focus();
    return;
  }
  
  const ytId = extractYoutubeId(url);
  if (!ytId) {
    showToast('Invalid YouTube URL!', 'error');
    return;
  }
  
  const currentPl = getCurrentPlaylist();
  currentPl.songs.push({ 
    id: 'song-yt-' + Date.now(), 
    title: title, 
    artist: artist,
    type: 'youtube', 
    ytId: ytId, 
    duration: 'YouTube' 
  });
  
  saveState();
  renderSongsList();
  addSongModal.classList.add('hidden');
  ytForm.reset();
  showToast(`"${title}" by ${artist} added!`, 'success');
};

function extractYoutubeId(url) {
  if (!url) return null;
  const regExp = /(?:youtube(?:-nocookie)?\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

/* ---- DELETE SONG ---- */
async function deleteSong(songId) {
  const currentPl = getCurrentPlaylist();
  const idx = currentPl.songs.findIndex(s => s.id === songId);
  if (idx !== -1) {
    const song = currentPl.songs[idx];
    if (song.type === 'file' && !song.id.startsWith('song-demo')) await deleteAudioBlob(song.id);
    currentPl.songs.splice(idx, 1);
    saveState();
    renderSongsList();
    showToast('Track removed', 'info');
  }
}

/* ---- PLAYLIST MANAGEMENT ---- */
document.getElementById('add-playlist-btn').onclick = () => {
  const newId = 'pl-' + Date.now();
  appData.playlists.push({ id: newId, name: `Playlist ${appData.playlists.length + 1}`, songs: [] });
  appData.activePlaylistId = newId;
  saveState();
  renderPlaylists();
  renderSongsList();
  showToast('New playlist created!', 'success');
};

document.getElementById('delete-playlist-btn').onclick = () => {
  if (appData.playlists.length <= 1) { showToast('Keep at least one playlist!', 'error'); return; }
  appData.playlists = appData.playlists.filter(p => p.id !== appData.activePlaylistId);
  appData.activePlaylistId = appData.playlists[0].id;
  saveState();
  renderPlaylists();
  renderSongsList();
  showToast('Playlist deleted', 'info');
};

const renameModal = document.getElementById('rename-playlist-modal');
document.getElementById('rename-playlist-btn').onclick = () => {
  document.getElementById('rename-input').value = getCurrentPlaylist().name;
  renameModal.classList.remove('hidden');
};
document.getElementById('cancel-rename-btn').onclick = () => renameModal.classList.add('hidden');
document.getElementById('save-rename-btn').onclick = () => {
  const name = document.getElementById('rename-input').value.trim();
  if (name) {
    getCurrentPlaylist().name = name;
    saveState();
    renderPlaylists();
    renameModal.classList.add('hidden');
  }
};

/* ---- SLEEP TIMER ---- */
const sleepModal = document.getElementById('sleep-timer-modal');
document.getElementById('sleep-timer-btn').onclick = () => sleepModal.classList.remove('hidden');
document.getElementById('close-sleep-modal').onclick = () => sleepModal.classList.add('hidden');

document.querySelectorAll('.sleep-option-btn').forEach(btn => {
  btn.onclick = () => {
    const mins = parseInt(btn.dataset.minutes);
    if (sleepTimerTimeout) clearTimeout(sleepTimerTimeout);
    showToast(`Sleep timer set for ${mins} minutes`, 'success');
    document.getElementById('sleep-timer-label').innerText = `${mins}m Timer`;
    sleepModal.classList.add('hidden');
    sleepTimerTimeout = setTimeout(() => {
      if (isPlaying) { pauseCurrentAudio(); showToast('Sleep timer expired. Audio stopped.', 'info'); document.getElementById('sleep-timer-label').innerText = 'Sleep Timer'; }
    }, mins * 60 * 1000);
  };
});
document.getElementById('cancel-sleep-btn').onclick = () => {
  if (sleepTimerTimeout) clearTimeout(sleepTimerTimeout);
  document.getElementById('sleep-timer-label').innerText = 'Sleep Timer';
  sleepModal.classList.add('hidden');
  showToast('Sleep timer cancelled', 'info');
};

/* ---- VINYL STYLE CUSTOMIZER ---- */
const themeModal = document.getElementById('vinyl-theme-modal');
document.getElementById('theme-customizer-btn').onclick = () => themeModal.classList.remove('hidden');
document.getElementById('close-theme-modal').onclick = () => themeModal.classList.add('hidden');

document.querySelectorAll('.vinyl-color-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.vinyl-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const color = btn.dataset.vinylColor;
    if (color === 'ruby') {
      vinylRecord.style.background = 'radial-gradient(circle at 35% 30%, #e11d48 0%, #881337 30%, #4c0519 60%, #0a0a0a 100%)';
    } else if (color === 'cyan') {
      vinylRecord.style.background = 'radial-gradient(circle at 35% 30%, #22d3ee 0%, #0e7490 30%, #164e63 60%, #0a0a0a 100%)';
    } else if (color === 'gold') {
      vinylRecord.style.background = 'radial-gradient(circle at 35% 30%, #fbbf24 0%, #b45309 30%, #78350f 60%, #0a0a0a 100%)';
    } else {
      vinylRecord.style.background = '';
    }
  };
});

document.querySelectorAll('.label-gradient-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.label-gradient-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const grad = btn.dataset.labelBg;
    const centerLabel = document.getElementById('vinyl-center-label');
    centerLabel.className = `absolute inset-0 bg-gradient-to-tr ${grad} flex flex-col items-center justify-center text-center p-2 text-slate-950`;
  };
});

/* ---- EXPORT / IMPORT ---- */
document.getElementById('export-btn').onclick = () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
  const anchor = document.createElement('a');
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute("download", `vinylify_playlists_backup.json`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  showToast('Playlists backup exported!', 'success');
};

document.getElementById('import-btn').onclick = () => document.getElementById('import-file-input').click();
document.getElementById('import-file-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (imported && imported.playlists) {
        appData = imported;
        saveState();
        renderPlaylists();
        renderSongsList();
        showToast('Playlists restored successfully!', 'success');
      }
    } catch (err) { showToast('Invalid JSON file', 'error'); }
  };
  reader.readAsText(file);
};

/* ---- KEYBOARD SHORTCUTS ---- */
const shortcutsModal = document.getElementById('shortcuts-modal');
document.getElementById('shortcuts-btn').onclick = () => shortcutsModal.classList.remove('hidden');
document.getElementById('close-shortcuts-modal').onclick = () => shortcutsModal.classList.add('hidden');

window.onkeydown = (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
  if (e.code === 'KeyN') handleNextTrack();
  if (e.code === 'KeyP') handlePrevTrack();
  if (e.code === 'KeyL') lofiFilterBtn.click();
  if (e.code === 'ArrowRight' && html5Audio.duration) html5Audio.currentTime = Math.min(html5Audio.duration, html5Audio.currentTime + 5);
  if (e.code === 'ArrowLeft' && html5Audio.duration) html5Audio.currentTime = Math.max(0, html5Audio.currentTime - 5);
  if (e.key === 'Escape') {
    closeYouTubeErrorModal();
    closeLyricsPanel();
  }
};

/* ---- TRANSPORT EVENT BINDINGS ---- */
playPauseBtn.onclick = togglePlayPause;
vinylRecord.onclick = togglePlayPause;
document.getElementById('next-btn').onclick = handleNextTrack;
document.getElementById('prev-btn').onclick = handlePrevTrack;

/* ---- INITIALIZATION ---- */
window.onload = () => {
  renderPlaylists();
  renderSongsList();
  if (window.location.protocol === 'file:') {
    setTimeout(() => showToast('YouTube API requires a web server to play videos.', 'error'), 1200);
  }
};

/* ========================================
   STORAGE INDICATOR — TOOLTIP BEHAVIOR
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
  const storageIndicator = document.getElementById('storage-indicator');
  if (!storageIndicator) return;

  let tooltipVisible = false;
  let tooltipTimeout = null;
  const tooltip = storageIndicator.querySelector('.group-hover\\:opacity-100');
  
  storageIndicator.addEventListener('click', (e) => {
    if (window.innerWidth < 1024) {
      e.preventDefault();
      e.stopPropagation();
      if (!tooltip) return;
      tooltipVisible = !tooltipVisible;
      if (tooltipVisible) {
        tooltip.classList.add('tooltip-visible');
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => {
          tooltip.classList.remove('tooltip-visible');
          tooltipVisible = false;
        }, 5000);
      } else {
        tooltip.classList.remove('tooltip-visible');
        clearTimeout(tooltipTimeout);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth < 1024 && tooltipVisible) {
      if (!storageIndicator.contains(e.target)) {
        if (tooltip) {
          tooltip.classList.remove('tooltip-visible');
          tooltipVisible = false;
          clearTimeout(tooltipTimeout);
        }
      }
    }
  });

  updateStorageSpace();
});

/* ---- STORAGE SPACE CHECKER ---- */
async function updateStorageSpace() {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage / 1024 / 1024).toFixed(1);
      const totalGB = (estimate.quota / 1024 / 1024 / 1024).toFixed(1);
      const percentUsed = ((estimate.usage / estimate.quota) * 100).toFixed(0);
      
      const spaceText = document.getElementById('storage-space-text');
      if (spaceText) {
        spaceText.textContent = `${usedMB} MB / ${totalGB} GB (${percentUsed}%)`;
        spaceText.title = `Used: ${usedMB} MB · Total: ${totalGB} GB · ${percentUsed}% used`;
      }
      return { usedMB, totalGB, percentUsed };
    }
  } catch (e) {
    console.warn('Storage API not available:', e);
    const spaceText = document.getElementById('storage-space-text');
    if (spaceText) spaceText.textContent = 'Not available';
  }
  return null;
}

/* ========================================
   LYRICS ENGINE — LRCLIB API (FIXED)
   ======================================== */

/* ---- Close Lyrics Panel ---- */
function closeLyricsPanel() {
  lyricsPanel.classList.add('hidden');
  if (lyricsUpdateInterval) {
    clearInterval(lyricsUpdateInterval);
    lyricsUpdateInterval = null;
  }
}

/* ---- Set Empty State ---- */
function setLyricsEmptyState(title, message) {
  lyricsSongTitle.textContent = title || 'No song selected';
  lyricsContent.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full text-slate-500">
      <i class="fa-regular fa-music text-3xl text-slate-700 mb-3"></i>
      <p>${message || 'No lyrics available'}</p>
      <p class="text-xs text-slate-600 mt-1">Click "Search" to find lyrics or paste them below</p>
    </div>
  `;
  lyricsSourceStatus.textContent = '📝 No lyrics loaded';
  lyricsSyncStatus.textContent = '⏸️ Not playing';
}

/* ---- Toggle Lyrics Panel ---- */
document.getElementById('lyrics-toggle-btn').addEventListener('click', () => {
  const isHidden = lyricsPanel.classList.contains('hidden');
  if (isHidden) {
    lyricsPanel.classList.remove('hidden');
    if (currentTrack) {
      searchLyricsLRCLIB(currentTrack);
    } else {
      showToast('No song is currently playing', 'info');
      setLyricsEmptyState('No song selected', 'Select a track to search for lyrics');
    }
  } else {
    closeLyricsPanel();
  }
});

document.getElementById('lyrics-close-btn').addEventListener('click', closeLyricsPanel);

/* ---- Search Button ---- */
document.getElementById('lyrics-auto-search').addEventListener('click', () => {
  if (currentTrack) {
    searchLyricsLRCLIB(currentTrack);
  } else {
    showToast('No song is currently playing', 'info');
  }
});

/* ---- LRCLIB API — SEARCH LYRICS ---- */
async function searchLyricsLRCLIB(song) {
  if (!song) {
    showToast('No song is currently playing', 'info');
    setLyricsEmptyState('No song selected', 'Select a track to search for lyrics');
    return;
  }

  const title = song.title || 'Unknown';
  const artist = song.artist || 'Unknown Artist';
  
  // Check if we have a valid artist name
  if (!artist || artist === 'Unknown Artist' || artist === 'Local Audio' || artist === 'YouTube Stream') {
    lyricsContent.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-slate-500">
        <i class="fa-regular fa-pen-to-square text-3xl text-slate-600 mb-3"></i>
        <p class="text-sm">Artist name missing</p>
        <p class="text-xs text-slate-600 mt-1 max-w-xs text-center">
          LRCLIB needs the artist name to find lyrics.<br>
          Please edit the track and add the artist name.
        </p>
        <button onclick="promptArtistName()" class="mt-3 px-4 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-medium transition border border-amber-500/20">
          <i class="fa-solid fa-pen mr-1.5"></i>Add Artist Name
        </button>
      </div>
    `;
    lyricsSourceStatus.textContent = '❌ Artist name missing';
    return;
  }
  
  lyricsSourceStatus.textContent = '🔍 Searching LRCLIB...';
  lyricsContent.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full text-slate-500">
      <i class="fa-solid fa-spinner fa-spin text-2xl text-rose-400 mb-3"></i>
      <p class="text-sm">Searching LRCLIB for lyrics...</p>
      <p class="text-xs text-slate-600 mt-1">"${escapeHtml(title)}" by ${escapeHtml(artist)}</p>
    </div>
  `;

  try {
    // Get duration
    let duration = 0;
    if (audioType === 'file' && html5Audio.duration) {
      duration = Math.round(html5Audio.duration);
    } else if (audioType === 'youtube' && ytPlayer && ytPlayer.getDuration) {
      duration = Math.round(ytPlayer.getDuration());
    }
    
    // Build URL
    const params = new URLSearchParams();
    params.set('track_name', title);
    params.set('artist_name', artist);
    
    if (duration > 0 && duration < 3600) {
      params.set('duration', duration);
    }

    const url = `https://lrclib.net/api/get?${params.toString()}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Vinylify Studio v1.0'
      }
    });

    if (response.status === 404) {
      setLyricsEmptyState(title, `No lyrics found for "${title}" by ${artist} on LRCLIB`);
      lyricsSourceStatus.textContent = '❌ Not in LRCLIB database';
      showToast('No lyrics found in LRCLIB database', 'info');
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data && (data.plainLyrics || data.syncedLyrics)) {
      let lyricsText = '';
      let source = 'LRCLIB';
      let isSynced = false;
      
      if (data.syncedLyrics) {
        lyricsText = data.syncedLyrics;
        source = 'LRCLIB (synced)';
        isSynced = true;
      } else if (data.plainLyrics) {
        lyricsText = data.plainLyrics;
        source = 'LRCLIB (plain)';
        isSynced = false;
      }
      
      if (lyricsText) {
        displayLyricsWithSource(
          lyricsText, 
          source, 
          data.trackName || title, 
          data.artistName || artist, 
          isSynced
        );
        showToast(`Found lyrics for "${title}" by ${artist}!`, 'success');
        return;
      }
    }
    
    setLyricsEmptyState(title, `No lyrics found for "${title}" on LRCLIB`);
    lyricsSourceStatus.textContent = '❌ No lyrics found';
    
  } catch (error) {
    console.warn('LRCLIB search error:', error);
    setLyricsEmptyState(title, 'Could not fetch lyrics from LRCLIB');
    lyricsSourceStatus.textContent = '❌ Search failed';
    showToast('Failed to search for lyrics', 'error');
  }
}

/* ---- Display Lyrics ---- */
function displayLyricsWithSource(text, source, title, artist, isSynced) {
  if (isSynced && text.includes('[') && text.match(/\[\d{2}:\d{2}/)) {
    const parsed = parseLrcText(text);
    if (parsed.lines && parsed.lines.length > 0) {
      currentLrcData = parsed.lines;
      currentLyrics = parsed.lines.map(l => l.text);
      lyricsSongTitle.textContent = `${title}${artist ? ` — ${artist}` : ''}`;
      lyricsSourceStatus.textContent = `📝 Source: ${source}`;
      renderLyricsLines(currentLyrics);
      if (isPlaying) {
        startLyricsSync();
      }
      return;
    }
  }
  
  currentLyrics = text.split('\n').filter(line => line.trim().length > 0);
  currentLrcData = [];
  lyricsSongTitle.textContent = `${title}${artist ? ` — ${artist}` : ''}`;
  lyricsSourceStatus.textContent = `📝 Source: ${source}`;
  lyricsSyncStatus.textContent = '⏸️ Not synced';
  renderLyricsLines(currentLyrics);
}

/* ---- Parse LRC Text ---- */
function parseLrcText(text) {
  const lines = text.split('\n');
  const lrcLines = [];
  const plainLines = [];
  
  const timestampRegex = /\[(\d{2}):(\d{2})(?:[:.](\d{2}))?\]/;
  
  for (const line of lines) {
    const match = line.match(timestampRegex);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const centiseconds = parseInt(match[3] || '00');
      const time = minutes * 60 + seconds + centiseconds / 100;
      const textContent = line.replace(timestampRegex, '').trim();
      
      if (textContent) {
        lrcLines.push({ time, text: textContent });
      }
    } else if (line.trim()) {
      plainLines.push(line.trim());
    }
  }
  
  if (lrcLines.length > 0) {
    return { lines: lrcLines };
  }
  
  return { lines: plainLines.map((text, i) => ({ time: i * 3, text })) };
}

/* ---- Render Lyrics Lines ---- */
function renderLyricsLines(lines) {
  if (!lines || lines.length === 0) {
    setLyricsEmptyState(lyricsSongTitle.textContent, 'No lyrics available');
    return;
  }
  
  lyricsContent.innerHTML = lines.map((line, i) => `
    <div class="lyrics-line" data-index="${i}">${escapeHtml(line)}</div>
  `).join('');
}

/* ---- Manual Lyrics Input ---- */
document.getElementById('lyrics-manual-add').addEventListener('click', () => {
  const text = lyricsManualInput.value.trim();
  if (!text) {
    showToast('Please paste some lyrics first', 'info');
    return;
  }
  
  if (text.includes('[') && text.match(/\[\d{2}:\d{2}/)) {
    const parsed = parseLrcText(text);
    if (parsed.lines && parsed.lines.length > 0) {
      currentLrcData = parsed.lines;
      currentLyrics = parsed.lines.map(l => l.text);
      lyricsSongTitle.textContent = currentTrack?.title || 'Untitled';
      lyricsSourceStatus.textContent = '📝 Source: Manual (synced)';
      renderLyricsLines(currentLyrics);
      if (isPlaying) startLyricsSync();
      showToast(`Loaded ${currentLrcData.length} synced lines`, 'success');
      lyricsManualInput.value = '';
      return;
    }
  }
  
  displayLyricsWithSource(text, 'Manual', currentTrack?.title || 'Untitled', currentTrack?.artist || '', false);
  lyricsManualInput.value = '';
  showToast('Lyrics added manually', 'success');
});

/* ---- LRC File Upload ---- */
document.querySelector('.flex.items-center.gap-1\\.5.cursor-pointer')?.addEventListener('click', () => {
  lrcFileInput.click();
});

lrcFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target.result;
    const parsed = parseLrcText(content);
    
    if (parsed.lines && parsed.lines.length > 0) {
      currentLrcData = parsed.lines;
      currentLyrics = parsed.lines.map(l => l.text);
      lyricsSongTitle.textContent = currentTrack?.title || 'Untitled';
      lyricsSourceStatus.textContent = '📝 Source: LRC File (synced)';
      renderLyricsLines(currentLyrics);
      if (isPlaying) startLyricsSync();
      showToast(`Loaded ${currentLrcData.length} synced lines from LRC file`, 'success');
    } else {
      showToast('Invalid LRC file format', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---- Clear Lyrics ---- */
document.getElementById('lyrics-clear-btn')?.addEventListener('click', () => {
  currentLyrics = [];
  currentLrcData = [];
  lyricsCurrentIndex = -1;
  if (lyricsUpdateInterval) {
    clearInterval(lyricsUpdateInterval);
    lyricsUpdateInterval = null;
  }
  setLyricsEmptyState(currentTrack?.title || 'No song selected', 'Lyrics cleared');
  lyricsSourceStatus.textContent = '🗑️ Cleared';
  showToast('Lyrics cleared', 'info');
});

/* ---- Prompt for Artist Name ---- */
function promptArtistName() {
  const currentPl = getCurrentPlaylist();
  if (!currentTrack) return;
  
  const newArtist = prompt(`Enter artist name for "${currentTrack.title}":`, currentTrack.artist || '');
  if (newArtist && newArtist.trim()) {
    const song = currentPl.songs.find(s => s.id === currentTrack.id);
    if (song) {
      song.artist = newArtist.trim();
      currentTrack.artist = newArtist.trim();
      saveState();
      renderSongsList();
      showToast(`Artist updated to "${newArtist.trim()}"`, 'success');
      searchLyricsLRCLIB(currentTrack);
    }
  }
}

/* ---- Start Lyrics Sync ---- */
function startLyricsSync() {
  if (lyricsUpdateInterval) {
    clearInterval(lyricsUpdateInterval);
    lyricsUpdateInterval = null;
  }
  
  if (!isPlaying || currentLrcData.length === 0) {
    lyricsSyncStatus.textContent = !isPlaying ? '⏸️ Paused' : '⏸️ Not synced';
    return;
  }
  
  lyricsUpdateInterval = setInterval(() => {
    if (!isPlaying || currentLrcData.length === 0) {
      lyricsSyncStatus.textContent = !isPlaying ? '⏸️ Paused' : '⏸️ Not synced';
      return;
    }
    
    let currentTime = 0;
    if (audioType === 'file' && html5Audio.currentTime) {
      currentTime = html5Audio.currentTime;
    } else if (audioType === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
      currentTime = ytPlayer.getCurrentTime() || 0;
    }
    
    let activeIndex = -1;
    for (let i = 0; i < currentLrcData.length; i++) {
      if (currentLrcData[i].time <= currentTime) {
        activeIndex = i;
      } else {
        break;
      }
    }
    
    if (activeIndex !== lyricsCurrentIndex) {
      lyricsCurrentIndex = activeIndex;
      updateLyricsHighlight(activeIndex);
      
      if (activeIndex >= 0) {
        const activeLine = document.querySelector(`.lyrics-line[data-index="${activeIndex}"]`);
        if (activeLine) {
          activeLine.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
    
    if (activeIndex >= 0) {
      const nextTime = currentLrcData[activeIndex + 1]?.time || Infinity;
      lyricsSyncStatus.textContent = `▶️ ${formatTime(currentTime)} / ${nextTime !== Infinity ? formatTime(nextTime) : '--:--'}`;
    } else {
      lyricsSyncStatus.textContent = `▶️ ${formatTime(currentTime)}`;
    }
  }, 200);
}

/* ---- Update Lyrics Highlight ---- */
function updateLyricsHighlight(activeIndex) {
  document.querySelectorAll('.lyrics-line').forEach((el, i) => {
    if (i === activeIndex && activeIndex >= 0) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

/* ---- Monitor play state for lyrics sync ---- */
const originalSetPlayingState = setPlayingState;
setPlayingState = function(playing) {
  originalSetPlayingState(playing);
  if (!playing && lyricsUpdateInterval) {
    clearInterval(lyricsUpdateInterval);
    lyricsUpdateInterval = null;
    lyricsSyncStatus.textContent = '⏸️ Paused';
  } else if (playing && currentLrcData.length > 0 && !lyricsPanel.classList.contains('hidden')) {
    startLyricsSync();
  }
};

/* ---- Auto-search when song changes and panel is open ---- */
const originalPlaySongAt = playSongAt;
playSongAt = async function(songId) {
  await originalPlaySongAt(songId);
  
  if (currentTrack && !lyricsPanel.classList.contains('hidden')) {
    setTimeout(() => {
      searchLyricsLRCLIB(currentTrack);
    }, 800);
  }
};

/* ---- Update duration for LRCLIB when metadata loads ---- */
html5Audio.onloadedmetadata = function() {
  if (currentTrack && !lyricsPanel.classList.contains('hidden')) {
    setTimeout(() => {
      searchLyricsLRCLIB(currentTrack);
    }, 300);
  }
};