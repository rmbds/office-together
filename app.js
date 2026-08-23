// ============================================================
// НАСТРОЙКИ FIREBASE
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6Xb0NrbUQOHufmTQ6zpRwT9_NnrdNbO0",
  authDomain: "office-together-418bf.firebaseapp.com",
  databaseURL: "https://office-together-418bf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "office-together-418bf",
  storageBucket: "office-together-418bf.firebasestorage.app",
  messagingSenderId: "472762810414",
  appId: "1:472762810414:web:40f519a83756a5f2fd5fbf"
};

const BASE_VIDEO_URL =
  "https://v.officeserial.ru/Office.s{season}e{episode}.OfficeSerial.ru.mp4";

const EPISODES_PER_SEASON = [6, 22, 25, 19, 28, 26, 27, 24, 25];

const CURSOR_COLORS = [
  "#ff7b72", "#79c0ff", "#7ee787", "#e3b341",
  "#d2a8ff", "#ffa657", "#56d4dd", "#f778ba"
];


// ============================================================
// DOM
// ============================================================

const video = document.getElementById("video");
const videoSource = document.getElementById("videoSource");
const videoMessage = document.getElementById("videoMessage");
const videoWrapper = document.getElementById("videoWrapper");
const videoContainer = document.getElementById("videoContainer");
const createRoomButton = document.getElementById("createRoomButton");
const copyButton = document.getElementById("copyButton");
const roomCodeElement = document.getElementById("roomCode");
const roomStatus = document.getElementById("roomStatus");
const leaderStatus = document.getElementById("leaderStatus");
const participantsElement = document.getElementById("participants");
const connectionStatus = document.getElementById("connectionStatus");
const episodeLabel = document.getElementById("episodeLabel");
const prevEpisodeBtn = document.getElementById("prevEpisodeBtn");
const nextEpisodeBtn = document.getElementById("nextEpisodeBtn");
const seasonSelect = document.getElementById("seasonSelect");
const episodeSelect = document.getElementById("episodeSelect");

const nicknameInput = document.getElementById("nicknameInput");
const saveNicknameBtn = document.getElementById("saveNicknameBtn");
const myUidEl = document.getElementById("myUid");
const copyUidBtn = document.getElementById("copyUidBtn");
const friendUidInput = document.getElementById("friendUidInput");
const addFriendBtn = document.getElementById("addFriendBtn");
const friendsListEl = document.getElementById("friendsList");
const invitesCard = document.getElementById("invitesCard");
const invitesListEl = document.getElementById("invitesList");
const inviteFriendBtn = document.getElementById("inviteFriendBtn");
const inviteModal = document.getElementById("inviteModal");
const inviteFriendsListEl = document.getElementById("inviteFriendsList");
const closeInviteModal = document.getElementById("closeInviteModal");

const pointerToggle = document.getElementById("pointerToggle");
const pointerOverlay = document.getElementById("pointerOverlay");


// ============================================================
// СОСТОЯНИЕ
// ============================================================

let db = null;
let auth = null;
let userId = null;
let userName = "Гость";

let roomId = null;
let currentSeason = 1;
let currentEpisode = 1;
let applyingRemoteState = false;

let roomStateRef = null;
let roomEventsRef = null;
let roomParticipantsRef = null;
let roomPointersRef = null;
let myPointerRef = null;
let presenceOnDisconnect = null;

let stateSyncTimer = null;
let progressSaveTimer = null;

// --- Указка ---
let pointerMode = false;
let lastPointerSend = 0;
const remoteCursors = {};
let pointersListener = null;
let mouseInContainer = false;


// ============================================================
// UI
// ============================================================

function showToast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2500);
}

function setConnectionStatus(text, type) {
  connectionStatus.textContent = text;
  connectionStatus.className = "status " + type;
}

function setRoomStatus(text) {
  roomStatus.textContent = text;
}

function updateEpisodeUI() {
  episodeLabel.textContent = `Сезон ${currentSeason}, Серия ${currentEpisode}`;
}

function updateEpisodeControls() {
  const ok = !!roomId;
  prevEpisodeBtn.disabled = !ok;
  nextEpisodeBtn.disabled = !ok;
  seasonSelect.disabled = !ok;
  episodeSelect.disabled = !ok;
}


// ============================================================
// FIREBASE INIT
// ============================================================

function initFirebase() {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
  auth = firebase.auth();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      userId = user.uid;
      myUidEl.textContent = userId;
      await loadProfile();
      initFriends();
      initInvites();
      startApp();
    } else {
      try { await auth.signInAnonymously(); }
      catch (e) { console.error("Auth error:", e); setConnectionStatus("Ошибка входа", "error"); }
    }
  });
}


// ============================================================
// ПРОФИЛЬ
// ============================================================

async function loadProfile() {
  const snap = await db.ref(`users/${userId}/name`).once("value");
  const saved = snap.val();
  if (saved) {
    userName = saved;
    nicknameInput.value = saved;
  } else {
    const local = localStorage.getItem("wt_name");
    if (local) {
      userName = local;
      nicknameInput.value = local;
      await db.ref(`users/${userId}/name`).set(local);
    }
  }
}

async function saveProfile() {
  const name = nicknameInput.value.trim();
  if (!name) { showToast("Введи ник"); return; }
  if (name.length > 30) { showToast("Максимум 30 символов"); return; }
  userName = name;
  localStorage.setItem("wt_name", name);
  await db.ref(`users/${userId}/name`).set(name);
  showToast("Ник сохранён");
  if (roomId && roomParticipantsRef) {
    await roomParticipantsRef.child(userId).update({ name });
  }
}

saveNicknameBtn.addEventListener("click", saveProfile);
nicknameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveProfile(); });


// ============================================================
// ID / КОПИРОВАНИЕ
// ============================================================

copyUidBtn.addEventListener("click", async () => {
  if (!userId) return;
  try { await navigator.clipboard.writeText(userId); showToast("ID скопирован"); }
  catch { showToast("Не удалось скопировать"); }
});


// ============================================================
// ДРУЗЬЯ
// ============================================================

function initFriends() {
  db.ref(`users/${userId}/friends`).on("value", async (snap) => {
    const data = snap.val() || {};
    const ids = Object.keys(data);
    if (!ids.length) { friendsListEl.innerHTML = '<div class="muted">Пока нет друзей</div>'; return; }
    friendsListEl.innerHTML = "";
    for (const fid of ids) {
      const nameSnap = await db.ref(`users/${fid}/name`).once("value");
      const fname = nameSnap.val() || "Без имени";
      const row = document.createElement("div");
      row.className = "friend-row";
      row.innerHTML = `<span>${escapeHtml(fname)}</span><span class="muted" style="font-size:11px;">${fid.slice(0,8)}…</span>`;
      friendsListEl.appendChild(row);
    }
  });
}

async function addFriend() {
  const fid = friendUidInput.value.trim();
  if (!fid) { showToast("Введи ID"); return; }
  if (fid === userId) { showToast("Это твой ID"); return; }
  const snap = await db.ref(`users/${fid}`).once("value");
  if (!snap.exists()) { showToast("Пользователь не найден"); return; }
  const nameSnap = await db.ref(`users/${fid}/name`).once("value");
  const fname = nameSnap.val() || "Без имени";
  await db.ref(`users/${userId}/friends/${fid}`).set({ name: fname, addedAt: Date.now() });
  friendUidInput.value = "";
  showToast(`${escapeHtml(fname)} добавлен в друзья`);
}

addFriendBtn.addEventListener("click", addFriend);
friendUidInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });


// ============================================================
// ПРИГЛАШЕНИЯ
// ============================================================

function initInvites() {
  db.ref(`users/${userId}/invites`).on("value", (snap) => {
    const data = snap.val() || {};
    const entries = Object.entries(data);
    if (!entries.length) { invitesCard.style.display = "none"; return; }
    invitesCard.style.display = "block";
    invitesListEl.innerHTML = "";
    for (const [rid, info] of entries) {
      const row = document.createElement("div");
      row.className = "invite-row";
      row.innerHTML = `<div><div style="font-weight:600;">Комната ${rid}</div><div class="muted" style="font-size:12px;">от ${escapeHtml(info.fromName || "друг")}</div></div><button class="secondary small" data-room="${rid}">Войти</button>`;
      row.querySelector("button").addEventListener("click", () => acceptInvite(rid));
      invitesListEl.appendChild(row);
    }
  });
}

async function acceptInvite(rid) {
  await db.ref(`users/${userId}/invites/${rid}`).remove();
  await joinRoom(rid);
}

async function sendInviteToFriend(friendId) {
  if (!roomId) return;
  await db.ref(`users/${friendId}/invites/${roomId}`).set({
    from: userId, fromName: userName, roomId, timestamp: Date.now()
  });
  showToast("Приглашение отправлено");
}

inviteFriendBtn.addEventListener("click", async () => {
  const snap = await db.ref(`users/${userId}/friends`).once("value");
  const friends = snap.val() || {};
  const ids = Object.keys(friends);
  if (!ids.length) { showToast("Сначала добавь друзей"); return; }
  inviteFriendsListEl.innerHTML = "";
  for (const fid of ids) {
    const nameSnap = await db.ref(`users/${fid}/name`).once("value");
    const fname = nameSnap.val() || "Без имени";
    const row = document.createElement("div");
    row.className = "friend-row-modal";
    row.innerHTML = `<span>${escapeHtml(fname)}</span><span class="muted" style="font-size:12px;">Пригласить</span>`;
    row.addEventListener("click", () => { sendInviteToFriend(fid); inviteModal.classList.remove("active"); });
    inviteFriendsListEl.appendChild(row);
  }
  inviteModal.classList.add("active");
});

closeInviteModal.addEventListener("click", () => inviteModal.classList.remove("active"));


// ============================================================
// УТИЛИТЫ
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function getRoomFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room")?.trim().toUpperCase() || null;
}

function setRoomInUrl(room) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", room);
  window.history.replaceState(null, "", url);
}

function getUserColor(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}


// ============================================================
// ЭПИЗОДЫ
// ============================================================

function getVideoUrl(s, e) {
  return BASE_VIDEO_URL
    .replace("{season}", String(s).padStart(2, "0"))
    .replace("{episode}", String(e).padStart(2, "0"));
}

function populateSeasons() {
  seasonSelect.innerHTML = "";
  for (let s = 1; s <= EPISODES_PER_SEASON.length; s++) {
    const o = document.createElement("option");
    o.value = s; o.textContent = "Сезон " + s;
    seasonSelect.appendChild(o);
  }
}

function populateEpisodes(season) {
  episodeSelect.innerHTML = "";
  const c = EPISODES_PER_SEASON[season - 1] || 0;
  for (let e = 1; e <= c; e++) {
    const o = document.createElement("option");
    o.value = e; o.textContent = "Серия " + e;
    episodeSelect.appendChild(o);
  }
}

function loadEpisode(season, episode, { broadcast = true } = {}) {
  currentSeason = season;
  currentEpisode = episode;
  const url = getVideoUrl(season, episode);

  // Safari/Mac fix: полностью сбрасываем video перед сменой src
  video.pause();
  video.removeAttribute("src");
  videoSource.removeAttribute("src");
  video.load();

  // Небольшая задержка для Safari, чтобы он успел сбросить
  requestAnimationFrame(() => {
    video.src = url;
    videoSource.src = url;
    video.load();
  });

  updateEpisodeUI();
  seasonSelect.value = season;
  populateEpisodes(season);
  episodeSelect.value = episode;

  if (broadcast && roomId) {
    sendEvent("episode", { season, episode, time: 0, playing: false });
  }
}

function nextEpisode() {
  let s = currentSeason, e = currentEpisode + 1;
  if (e > EPISODES_PER_SEASON[s - 1]) { s++; e = 1; }
  if (s > EPISODES_PER_SEASON.length) { showToast("Последняя серия"); return; }
  loadEpisode(s, e);
  showToast(`Сезон ${s}, Серия ${e}`);
}

function prevEpisode() {
  let s = currentSeason, e = currentEpisode - 1;
  if (e < 1) { s--; if (s < 1) { showToast("Первая серия"); return; } e = EPISODES_PER_SEASON[s - 1]; }
  loadEpisode(s, e);
  showToast(`Сезон ${s}, Серия ${e}`);
}

seasonSelect.addEventListener("change", () => {
  const s = parseInt(seasonSelect.value, 10);
  populateEpisodes(s);
  loadEpisode(s, 1);
});

episodeSelect.addEventListener("change", () => {
  const s = parseInt(seasonSelect.value, 10);
  const e = parseInt(episodeSelect.value, 10);
  loadEpisode(s, e);
});

prevEpisodeBtn.addEventListener("click", prevEpisode);
nextEpisodeBtn.addEventListener("click", nextEpisode);

video.addEventListener("loadeddata", () => videoMessage.classList.add("hidden"));
video.addEventListener("error", () => {
  videoMessage.textContent = "Видео не загрузилось. Проверь URL и CORS.";
  videoMessage.classList.remove("hidden");
});


// ============================================================
// FULLSCREEN HIJACK — делаем fullscreen на контейнере
// ============================================================

function hijackFullscreen() {
  if (!video || !videoContainer) return;

  // Перехватываем нативный fullscreen video -> делаем fullscreen на контейнере
  const orig = video.requestFullscreen?.bind(video);
  if (orig) {
    video.requestFullscreen = function() {
      return videoContainer.requestFullscreen?.() || orig();
    };
  }

  const origWebkit = video.webkitRequestFullscreen?.bind(video);
  if (origWebkit) {
    video.webkitRequestFullscreen = function() {
      return videoContainer.webkitRequestFullscreen?.() || origWebkit();
    };
  }

  const origWebkitFull = video.webkitRequestFullScreen?.bind(video);
  if (origWebkitFull) {
    video.webkitRequestFullScreen = function() {
      return videoContainer.webkitRequestFullScreen?.() || origWebkitFull();
    };
  }

  // Для iOS — там нельзя сделать fullscreen на div, оставляем как есть
}

hijackFullscreen();


// ============================================================
// УКАЗКА (POINTER)
// ============================================================

pointerToggle.addEventListener("click", () => {
  pointerMode = !pointerMode;
  pointerToggle.classList.toggle("active", pointerMode);
  pointerToggle.title = pointerMode ? "Режим указки включён" : "Режим указки";
  showToast(pointerMode ? "Режим указки включён" : "Режим указки выключен");

  if (!pointerMode) {
    if (myPointerRef) {
      myPointerRef.remove().catch(() => {});
    }
  }
});

function getPointerPos(clientX, clientY) {
  const rect = videoContainer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))
  };
}

function sendPointer(x, y, visible) {
  if (!roomId || !userId || !myPointerRef) return;
  const now = Date.now();
  if (now - lastPointerSend < 50) return;
  lastPointerSend = now;

  myPointerRef.set({
    x, y, visible,
    name: userName,
    timestamp: now
  }).catch(() => {});
}

// Mouse
videoContainer.addEventListener("mouseenter", () => { mouseInContainer = true; });

videoContainer.addEventListener("mousemove", (e) => {
  if (!pointerMode) return;
  mouseInContainer = true;
  const pos = getPointerPos(e.clientX, e.clientY);
  sendPointer(pos.x, pos.y, true);
});

videoContainer.addEventListener("mouseleave", () => {
  mouseInContainer = false;
  if (pointerMode) sendPointer(0, 0, false);
});

// Global fallback — если мышь ушла за пределы окна
window.addEventListener("blur", () => {
  if (pointerMode) sendPointer(0, 0, false);
});

document.addEventListener("mouseout", (e) => {
  if (pointerMode && e.relatedTarget === null) {
    sendPointer(0, 0, false);
  }
});

// Touch
videoContainer.addEventListener("touchstart", (e) => {
  if (!pointerMode) return;
  const t = e.touches[0];
  const pos = getPointerPos(t.clientX, t.clientY);
  sendPointer(pos.x, pos.y, true);
}, { passive: true });

videoContainer.addEventListener("touchmove", (e) => {
  if (!pointerMode) return;
  const t = e.touches[0];
  const pos = getPointerPos(t.clientX, t.clientY);
  sendPointer(pos.x, pos.y, true);
}, { passive: true });

videoContainer.addEventListener("touchend", () => {
  if (!pointerMode) return;
  sendPointer(0, 0, false);
});

videoContainer.addEventListener("touchcancel", () => {
  if (!pointerMode) return;
  sendPointer(0, 0, false);
});

// --- Отрисовка чужих курсоров ---

function createCursor(uid, name, color) {
  const el = document.createElement("div");
  el.className = "pointer-cursor";
  el.dataset.uid = uid;
  el.innerHTML = `
    <svg class="cursor-icon" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
    </svg>
    <span class="cursor-label" style="background:${color}">${escapeHtml(name || "Гость")}</span>
  `;
  pointerOverlay.appendChild(el);
  remoteCursors[uid] = { element: el };
}

function updateCursor(uid, x, y) {
  if (!remoteCursors[uid]) return;
  remoteCursors[uid].element.style.display = "flex";
  remoteCursors[uid].element.style.left = x + "%";
  remoteCursors[uid].element.style.top = y + "%";
}

function hideCursor(uid) {
  if (remoteCursors[uid]) {
    remoteCursors[uid].element.style.display = "none";
  }
}

function removeCursor(uid) {
  if (remoteCursors[uid]) {
    remoteCursors[uid].element.remove();
    delete remoteCursors[uid];
  }
}

function clearAllCursors() {
  pointerOverlay.innerHTML = "";
  for (const uid in remoteCursors) delete remoteCursors[uid];
}

function attachPointersListener(rid) {
  if (pointersListener) {
    db.ref(`rooms/${rid}/pointers`).off("value", pointersListener);
  }

  roomPointersRef = db.ref(`rooms/${rid}/pointers`);

  pointersListener = roomPointersRef.on("value", (snap) => {
    const data = snap.val() || {};
    const now = Date.now();

    for (const uid in remoteCursors) {
      const p = data[uid];
      if (!p || !p.visible || (now - p.timestamp > 5000) || uid === userId) {
        removeCursor(uid);
      }
    }

    for (const uid in data) {
      if (uid === userId) continue;
      const p = data[uid];
      if (!p || !p.visible || (now - p.timestamp > 5000)) continue;

      if (!remoteCursors[uid]) {
        createCursor(uid, p.name, getUserColor(uid));
      }
      updateCursor(uid, p.x, p.y);
    }
  });
}


// ============================================================
// ПРОГРЕСС ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function savePersonalProgress() {
  if (!userId) return;
  try {
    await db.ref(`users/${userId}/progress`).set({
      season: currentSeason,
      episode: currentEpisode,
      time: video.currentTime || 0,
      updatedAt: Date.now()
    });
  } catch (e) { console.error("saveProgress:", e); }
}

async function loadPersonalProgress() {
  if (!userId) return null;
  const snap = await db.ref(`users/${userId}/progress`).once("value");
  return snap.val();
}

function startProgressSave() {
  clearInterval(progressSaveTimer);
  progressSaveTimer = setInterval(() => { if (roomId) savePersonalProgress(); }, 5000);
}

function stopProgressSave() {
  clearInterval(progressSaveTimer);
  progressSaveTimer = null;
}

window.addEventListener("beforeunload", () => {
  if (userId && roomId) savePersonalProgress();
});


// ============================================================
// СИНХРОНИЗАЦИЯ
// ============================================================

function startStateSync() {
  clearInterval(stateSyncTimer);
  stateSyncTimer = setInterval(() => { if (roomId) updateState(); }, 5000);
}

function stopStateSync() {
  clearInterval(stateSyncTimer);
  stateSyncTimer = null;
}

async function updateState() {
  if (!roomId || !roomStateRef) return;
  await roomStateRef.set({
    time: video.currentTime || 0,
    playing: !video.paused,
    season: currentSeason,
    episode: currentEpisode,
    updatedBy: userId,
    updatedAt: Date.now()
  });
}

async function sendEvent(action, data) {
  if (!roomId || !roomEventsRef) return;
  await roomEventsRef.push({
    action, ...data, senderId: userId, timestamp: Date.now()
  });
  await updateState();
  await savePersonalProgress();
}

async function applyState(state) {
  applyingRemoteState = true;

  if (state.season && state.episode) {
    if (state.season !== currentSeason || state.episode !== currentEpisode) {
      currentSeason = state.season;
      currentEpisode = state.episode;
      const url = getVideoUrl(state.season, state.episode);
      video.pause();
      video.removeAttribute("src");
      videoSource.removeAttribute("src");
      video.load();
      requestAnimationFrame(() => {
        video.src = url;
        videoSource.src = url;
        video.load();
      });
      updateEpisodeUI();
      seasonSelect.value = state.season;
      populateEpisodes(state.season);
      episodeSelect.value = state.episode;
      await waitForMeta();
    }
  }

  if (typeof state.time === "number") {
    if (!video.duration || !Number.isFinite(video.duration)) await waitForMeta();
    let t = state.time;
    if (video.duration && Number.isFinite(video.duration)) {
      t = Math.min(Math.max(0, t), video.duration);
    }
    video.currentTime = t;
  }

  if ("playing" in state) {
    if (state.playing) {
      try { await video.play(); } catch (e) { showToast("Тапни на видео, чтобы запустить"); }
    } else {
      video.pause();
    }
  }

  await new Promise(r => setTimeout(r, 200));
  applyingRemoteState = false;
}

async function applyRemoteEvent(ev) {
  applyingRemoteState = true;

  if (ev.action === "episode" && ev.season && ev.episode) {
    if (ev.season !== currentSeason || ev.episode !== currentEpisode) {
      currentSeason = ev.season;
      currentEpisode = ev.episode;
      const url = getVideoUrl(ev.season, ev.episode);
      video.pause();
      video.removeAttribute("src");
      videoSource.removeAttribute("src");
      video.load();
      requestAnimationFrame(() => {
        video.src = url;
        videoSource.src = url;
        video.load();
      });
      updateEpisodeUI();
      seasonSelect.value = ev.season;
      populateEpisodes(ev.season);
      episodeSelect.value = ev.episode;
      await waitForMeta();
    }
    video.currentTime = ev.time || 0;
    video.pause();
    showToast(`Переключено: Сезон ${ev.season}, Серия ${ev.episode}`);
    await new Promise(r => setTimeout(r, 200));
    applyingRemoteState = false;
    return;
  }

  if (typeof ev.time === "number") {
    if (!video.duration || !Number.isFinite(video.duration)) await waitForMeta();
    let t = ev.time;
    if (video.duration && Number.isFinite(video.duration)) t = Math.min(Math.max(0, t), video.duration);
    video.currentTime = t;
  }

  if (ev.action === "play") {
    try { await video.play(); } catch (e) { showToast("Тапни на видео, чтобы запустить"); }
  } else if (ev.action === "pause") {
    video.pause();
  }

  await new Promise(r => setTimeout(r, 150));
  applyingRemoteState = false;
}

function waitForMeta() {
  return new Promise(resolve => {
    if (Number.isFinite(video.duration)) { resolve(); return; }
    const h = () => { video.removeEventListener("loadedmetadata", h); resolve(); };
    video.addEventListener("loadedmetadata", h);
    setTimeout(resolve, 5000);
  });
}


// ============================================================
// КОМНАТА
// ============================================================

async function createRoom() {
  const rid = generateRoomId();
  roomId = rid;
  setRoomInUrl(rid);
  roomCodeElement.textContent = rid;
  copyButton.disabled = false;
  inviteFriendBtn.disabled = false;
  setRoomStatus("Комната " + rid);
  setConnectionStatus("Подключено", "connected");
  updateEpisodeControls();
  await connectRoomListeners(rid);
  showToast("Комната создана");
}

async function joinRoom(rid) {
  rid = rid.toUpperCase();
  if (roomId) await leaveRoom();
  roomId = rid;
  setRoomInUrl(rid);
  roomCodeElement.textContent = rid;
  copyButton.disabled = false;
  inviteFriendBtn.disabled = false;
  setRoomStatus("Комната " + rid);
  setConnectionStatus("Подключено", "connected");
  updateEpisodeControls();
  await connectRoomListeners(rid);
}

async function leaveRoom() {
  await savePersonalProgress();
  stopProgressSave();
  stopStateSync();
  clearAllCursors();

  if (myPointerRef) {
    try { await myPointerRef.remove(); } catch (e) {}
    myPointerRef = null;
  }
  if (pointersListener && roomPointersRef) {
    roomPointersRef.off("value", pointersListener);
    pointersListener = null;
  }

  if (presenceOnDisconnect) {
    try { await presenceOnDisconnect.cancel(); } catch (e) {}
    presenceOnDisconnect = null;
  }
  if (roomParticipantsRef && userId) {
    try { await roomParticipantsRef.child(userId).update({ online: false }); } catch (e) {}
  }
  if (roomStateRef) { roomStateRef.off(); roomStateRef = null; }
  if (roomEventsRef) { roomEventsRef.off(); roomEventsRef = null; }
  if (roomParticipantsRef) { roomParticipantsRef.off(); roomParticipantsRef = null; }

  roomId = null;
  roomCodeElement.textContent = "------";
  copyButton.disabled = true;
  inviteFriendBtn.disabled = true;
  participantsElement.innerHTML = "—";
  setRoomStatus("Комната не выбрана");
  setConnectionStatus("Готово", "disconnected");
  updateEpisodeControls();
}

async function connectRoomListeners(rid) {
  roomStateRef = db.ref(`rooms/${rid}/state`);
  roomEventsRef = db.ref(`rooms/${rid}/events`);
  roomParticipantsRef = db.ref(`rooms/${rid}/participants`);

  myPointerRef = db.ref(`rooms/${rid}/pointers/${userId}`);
  myPointerRef.onDisconnect().remove().catch(() => {});
  attachPointersListener(rid);

  const participantsSnap = await roomParticipantsRef.once("value");
  const participantsData = participantsSnap.val() || {};
  const othersOnline = Object.entries(participantsData).some(
    ([uid, info]) => uid !== userId && info && info.online
  );

  let initialState;
  if (othersOnline) {
    const stateSnap = await roomStateRef.once("value");
    initialState = stateSnap.val();
    if (!initialState) initialState = await loadPersonalProgress();
    if (initialState) {
      await applyState(initialState);
      showToast("Синхронизировано с комнатой");
    }
  } else {
    initialState = await loadPersonalProgress();
    if (!initialState) initialState = { season: 1, episode: 1, time: 0, playing: false };
    await applyState(initialState);
    await roomStateRef.set({ ...initialState, updatedBy: userId, updatedAt: Date.now() });
    showToast("Загружен твой прогресс");
  }

  roomEventsRef.limitToLast(30).on("child_added", (snap) => {
    const ev = snap.val();
    if (ev && ev.senderId !== userId) applyRemoteEvent(ev);
  });

  roomParticipantsRef.on("value", (snap) => {
    renderParticipants(snap.val() || {});
  });

  const meRef = roomParticipantsRef.child(userId);
  await meRef.set({ name: userName, online: true, joinedAt: Date.now() });
  presenceOnDisconnect = meRef.onDisconnect();
  await presenceOnDisconnect.update({ online: false });

  startStateSync();
  startProgressSave();
}


// ============================================================
// ВИДЕО → FIREBASE
// ============================================================

video.addEventListener("play", async () => {
  if (applyingRemoteState || !roomId) return;
  await sendEvent("play", { time: video.currentTime });
});

video.addEventListener("pause", async () => {
  if (applyingRemoteState || !roomId) return;
  await sendEvent("pause", { time: video.currentTime });
});

video.addEventListener("seeked", async () => {
  if (applyingRemoteState || !roomId) return;
  await sendEvent("seek", { time: video.currentTime });
});


// ============================================================
// УЧАСТНИКИ
// ============================================================

function renderParticipants(data) {
  const entries = Object.entries(data)
    .filter(([, v]) => v && v.online)
    .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));

  participantsElement.innerHTML = "";
  if (!entries.length) { participantsElement.textContent = "Никого нет"; return; }

  for (const [uid, info] of entries) {
    const row = document.createElement("div");
    row.className = "participant";
    const name = document.createElement("span");
    name.textContent = info.name || "Гость";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = uid === userId ? "вы" : "онлайн";
    row.appendChild(name);
    row.appendChild(badge);
    participantsElement.appendChild(row);
  }
}


// ============================================================
// КНОПКИ
// ============================================================

createRoomButton.addEventListener("click", createRoom);

copyButton.addEventListener("click", async () => {
  if (!roomId) return;
  try { await navigator.clipboard.writeText(window.location.href); showToast("Ссылка скопирована"); }
  catch { showToast("Не удалось скопировать"); }
});


// ============================================================
// СТАРТ
// ============================================================

async function startApp() {
  populateSeasons();
  populateEpisodes(1);

  const initialUrl = getVideoUrl(1, 1);
  video.src = initialUrl;
  videoSource.src = initialUrl;
  video.load();
  updateEpisodeUI();

  const existing = getRoomFromUrl();
  if (existing) {
    await joinRoom(existing);
  } else {
    setConnectionStatus("Готово", "disconnected");
    setRoomStatus("Нажми «Создать комнату»");
  }
}

initFirebase();
