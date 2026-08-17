/* =============================================
   CAMPUS HUB — App Logic
   ============================================= */

let supabaseClient = null;

const SUPABASE_URL = "https://atdwjnctisnxeroeqjeo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0ZHdqbmN0aXNueGVyb2VxamVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MTQ4NDAsImV4cCI6MjEwMjM5MDg0MH0.OTwpy7FSCNlJWHHMh8pLgvxUCPGUoWmAjK4BnpxppDI";

function getSupabase() {
  if (!window.supabaseClient && window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return window.supabaseClient;
}

// Protected Page Authentication Check
async function checkAuth() {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { data: { session } } = await supabase.auth.getSession();
  
  const path = window.location.pathname.toLowerCase();
  const isLoginPage = path.includes("login.html") || path.includes("account.html");

  if (!session && !isLoginPage) {
    window.location.replace("account.html");
    return false;
  }

  if (session && isLoginPage) {
    window.location.replace("index.html");
    return true;
  }

  return !!session;
}

// Global State
let clubs = [];
let currentUser = null;
let selectedRole = "student";
let ticketQty = 1;
let currentTicketPrice = 0;

// Static Events Data
const events = [
  { id: 1, name: "HackFest 2026", emoji: "💡", type: "hackathon", club: "CodeCraft", date: "Sep 14, 2026", time: "9:00 AM", venue: "Main Auditorium", price: 199, seats: 48 },
  { id: 2, name: "Annual Theatre Night", emoji: "🎭", type: "event", club: "Drama & Theatre", date: "Sep 20, 2026", time: "6:30 PM", venue: "Open Air Stage", price: 0, seats: 200 },
  { id: 3, name: "AI/ML Workshop", emoji: "🤖", type: "workshop", club: "CodeCraft", date: "Sep 28, 2026", time: "11:00 AM", venue: "Lab Block 3", price: 99, seats: 30 },
  { id: 4, name: "Battle of Bands", emoji: "🎸", type: "event", club: "Music Society", date: "Oct 5, 2026", time: "5:00 PM", venue: "College Grounds", price: 149, seats: 0 },
  { id: 5, name: "Robo Wars", emoji: "⚙️", type: "hackathon", club: "Robotics Club", date: "Oct 12, 2026", time: "10:00 AM", venue: "Engineering Block", price: 249, seats: 22 },
  { id: 6, name: "Photography Walk", emoji: "📸", type: "event", club: "Photography Club", date: "Oct 18, 2026", time: "7:00 AM", venue: "Campus Lake", price: 0, seats: 50 }
];

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
  const path = window.location.pathname.toLowerCase();
  const isLoginPage = path.includes("login.html") || path.includes("account.html");
  
  bindFormEvents();

  const isLoggedIn = await checkAuth();

  if (!isLoggedIn || isLoginPage) {
    return;
  }

  await restoreSupabaseSession();

  renderEvents();
  await loadReels(); 
  renderTickets();
  initNavScroll();
  initSmoothLinks();

  await loadClubs();
  await loadNavUserProfile();
});

// Form submit listener bindings
function bindFormEvents() {
  const loginForm = document.getElementById("loginForm");
  if (loginForm && !loginForm.hasAttribute("onsubmit")) {
    loginForm.addEventListener("submit", handleSignIn);
  }

  const signupForm = document.getElementById("signupForm");
  if (signupForm && !signupForm.hasAttribute("onsubmit")) {
    signupForm.addEventListener("submit", handleSignUp);
  }

  const ticketForm = document.getElementById("ticketForm");
  if (ticketForm) {
    ticketForm.addEventListener("submit", handleTicketPurchase);
  }
}

// ---------------------------------------------
// DYNAMIC SUPABASE REELS LOADER & POPUP PLAYER
// ---------------------------------------------

let reelsById = new Map();
let ytPlayer = null;
let currentReelId = null;
let currentReelLiked = false;
let currentReelLikeCount = 0;
let currentReelWatchUrl = "";
const LIKED_REELS_KEY = "campushub_liked_reels";

async function loadReels() {
  const grid = document.getElementById("reelsGrid");
  if (!grid) return;

  try {
    const supabase = getSupabase();
    if (!supabase) return;

    const { data: reelsData, error } = await supabase
      .from("reels")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    renderReelsGrid(reelsData || []);
  } catch (err) {
    console.error("Error loading reels:", err);
  }
}

// Robust YouTube ID Extractor
function extractYouTubeId(rawUrl) {
  if (!rawUrl) return "";
  const trimmed = String(rawUrl).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,   
    /youtube\.com\/watch\?.*[?&]v=([a-zA-Z0-9_-]{11})/, 
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,    
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,     
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,              
    /[?&]v=([a-zA-Z0-9_-]{11})/                    
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function isDirectVideoUrl(rawUrl) {
  if (!rawUrl) return false;
  const trimmed = String(rawUrl).trim();
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(trimmed) || trimmed.includes("/storage/v1/object/");
}

// Unified Reels Grid Renderer 
// Unified Reels Grid Renderer 
function renderReelsGrid(list) {
  const grid = document.getElementById("reelsGrid");
  if (!grid) return;

  reelsById.clear();

  if (!list || !list.length) {
    grid.innerHTML = `
      <div class="club-empty">
        <strong>No reels available</strong>
        <span>Post a new Short to display it here.</span>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(reel => {
    reelsById.set(String(reel.id), reel);

    const title = reel.caption || reel.title || "Campus Reel";
    const subtext = reel.club_name || "Campus Community";
    const rawUrl = reel.video_url || reel.youtube_video_id || reel.yt_id || "";
    
    // Extract YT ID to attempt fetching a thumbnail automatically
    const ytId = extractYouTubeId(rawUrl);
    
    let thumbStyle = `background: linear-gradient(135deg,#1a2035,#2d1b69);`;
    let thumbImgHtml = `<span style="position: relative; z-index: 1;">🎬</span>`;
    
    // Check for a custom thumbnail in DB first, fallback to YouTube default thumbnail
    if (reel.thumbnail) {
      thumbStyle = `background: #000;`;
      thumbImgHtml = `<img src="${escapeHtml(reel.thumbnail)}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0;" alt="Thumbnail">`;
    } else if (ytId) {
      thumbStyle = `background: #000;`;
      thumbImgHtml = `<img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0;" alt="Thumbnail">`;
    }

    return `
      <div class="reel-card" onclick="openReel('${escapeJs(reel.id)}')">
        <div class="reel-thumb" style="${thumbStyle} position: relative; overflow: hidden;">
          ${thumbImgHtml}
          <div class="reel-platform" style="position: absolute; z-index: 2;">▶️</div>
          <div class="reel-play-btn" style="position: absolute; z-index: 2;">▶</div>
        </div>
        <div class="reel-info">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtext)}</small>
        </div>
      </div>
    `;
  }).join("");
}

// YouTube API callback function - Runs once automatically when YT script loads
function onYouTubeIframeAPIReady() {
  console.log("YouTube Player API Ready");
  
  const container = document.getElementById("youtube-player-container");
  if (!container) return;

  // Crucial Fix: Create an inner target div so the main container isn't destroyed by the iframe
  container.innerHTML = '<div id="yt-iframe-target"></div>';

  ytPlayer = new window.YT.Player("yt-iframe-target", {
    width: "100%",
    height: "100%",
    videoId: "", 
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onError: handleReelPlayerError
    }
  });
}

function handleReelPlayerError(event) {
  console.warn("YouTube embed error code:", event?.data, "for:", currentReelWatchUrl);
  showReelPlaybackError(currentReelWatchUrl);
}

function showReelPlaybackError(watchUrl) {
  const container = document.getElementById("youtube-player-container");
  if (!container) return;

  container.innerHTML = `
    <div class="reel-unavailable" style="color: white; padding: 20px; text-align: center; display: flex; flex-direction: column; justify-content: center; height: 100%;">
      <span style="font-size: 2rem;">⚠️</span>
      <strong style="margin-top: 10px;">This video can't be played here</strong>
      <p style="font-size: 0.85rem; color: #aaa; margin-bottom: 15px;">The creator has disabled embedding for this video.</p>
      <a href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="text-decoration:none;">Watch on YouTube ↗</a>
    </div>
  `;
  ytPlayer = null; 
}

function getLikedReelsSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKED_REELS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveLikedReelsSet(set) {
  localStorage.setItem(LIKED_REELS_KEY, JSON.stringify([...set]));
}

function updateLikeUI() {
  const icon = document.getElementById("reelLikeIcon");
  const count = document.getElementById("reelLikeCount");
  const btn = document.getElementById("reelLikeBtn");
  if (icon) icon.textContent = currentReelLiked ? "♥" : "♡";
  if (btn) btn.classList.toggle("liked", currentReelLiked);
  if (count) count.textContent = currentReelLikeCount;
}

async function toggleReelLike() {
  if (!currentReelId) return;

  const likedSet = getLikedReelsSet();
  const key = String(currentReelId);
  const wasLiked = likedSet.has(key);

  currentReelLiked = !wasLiked;
  currentReelLikeCount = Math.max(0, currentReelLikeCount + (currentReelLiked ? 1 : -1));

  if (currentReelLiked) likedSet.add(key); else likedSet.delete(key);
  saveLikedReelsSet(likedSet);
  updateLikeUI();

  try {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase
        .from("reels")
        .update({ likes: currentReelLikeCount })
        .eq("id", currentReelId);
      if (error) throw error;
      const cached = reelsById.get(key);
      if (cached) cached.likes = currentReelLikeCount;
    }
  } catch (err) {
    console.warn("Like count not synced to Supabase (add a numeric 'likes' column to reels to enable this):", err.message);
  }
}

// Unified function to open the reel modal and play the video
// Unified function to open the reel modal and play the video
function openReel(reelId) {
  const reel = reelsById.get(String(reelId));
  if (!reel) {
    showToast("⚠️ Reel not found", "error");
    return;
  }

  const title = reel.caption || reel.title || "Campus Reel";
  const subtext = reel.club_name || "Campus Community";
  const rawUrl = reel.video_url || reel.youtube_video_id || reel.yt_id || "";

  const titleEl = document.getElementById("ytModalTitle");
  if (titleEl) titleEl.textContent = title;

  const subtextEl = document.getElementById("reelModalSubtext");
  if (subtextEl) subtextEl.textContent = subtext;

  currentReelId = reel.id;
  currentReelLikeCount = Number(reel.likes) || 0;
  currentReelLiked = getLikedReelsSet().has(String(reel.id));
  updateLikeUI();

  const container = document.getElementById("youtube-player-container");
  const ytId = extractYouTubeId(rawUrl);

  if (ytId) {
    currentReelWatchUrl = `https://www.youtube.com/watch?v=${ytId}`;

    // If player exists, just load the new ID
    if (ytPlayer && typeof ytPlayer.loadVideoById === "function") {
      ytPlayer.loadVideoById(ytId);
    } else {
      // Re-initialize player if it was destroyed by direct video or error
      container.innerHTML = '<div id="yt-iframe-target"></div>';
      ytPlayer = new window.YT.Player("yt-iframe-target", {
        width: "100%",
        height: "100%",
        videoId: ytId,
        playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onError: handleReelPlayerError }
      });
    }
  } else if (isDirectVideoUrl(rawUrl)) {
    // Handle .mp4 direct uploads by destroying YT player and injecting <video> tag
    if (ytPlayer && typeof ytPlayer.destroy === "function") {
      ytPlayer.destroy();
      ytPlayer = null;
    }
    
    // Apply a thumbnail (poster) to native video if available in your database
    const posterAttr = reel.thumbnail ? `poster="${escapeHtml(reel.thumbnail)}"` : "";
    
    container.innerHTML = `
      <video controls autoplay playsinline ${posterAttr} style="width:100%; height:100%; object-fit:contain; background:#000;">
        <source src="${escapeHtml(rawUrl)}">
        Your browser does not support the video tag.
      </video>`;
  } else {
    console.warn("CampusHub: could not resolve a playable video from:", rawUrl);
    showToast("⚠️ This reel doesn't have a valid video link", "error");
    return;
  }

  const modal = document.getElementById("reelVideoModal");
  if (modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

// Stop video playback and hide modal
function closeReelPlayer() {
  if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
    ytPlayer.stopVideo();
  }
  
  // Also stop native video if playing
  const container = document.getElementById("youtube-player-container");
  const nativeVideo = container?.querySelector("video");
  if (nativeVideo) {
    nativeVideo.pause();
    nativeVideo.src = "";
  }

  const modal = document.getElementById("reelVideoModal");
  if (modal) {
    modal.classList.add("hidden");
  }
  document.body.style.overflow = "";
  currentReelId = null;
}

function closeReelModal(e) {
  if (e.target.id === "reelVideoModal") {
    closeReelPlayer();
  }
}

// ---------------------------------------------
// CLUBS AND EVENTS LOGIC
// ---------------------------------------------

async function loadClubs() {
  const grid = document.getElementById("clubsGrid");
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    
    const { data: clubsData, error: clubsError } = await supabase
      .from("clubs")
      .select(`
        id, 
        name, 
        description, 
        category, 
        emoji, 
        tagline, 
        is_active,
        leader_id,
        profiles:leader_id (
          full_name
        )
      `)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (clubsError) throw clubsError;

    clubs = (clubsData || []).map(club => ({
      id: club.id,
      name: club.name || "Unnamed Club",
      emoji: club.emoji || "🏛️",
      category: club.category || "General",
      desc: club.description || "",
      tagline: club.tagline || "",
      leaderName: club.profiles?.full_name || "Campus Hub",
      members: 0
    }));

    renderClubFilters();
    renderClubs(clubs);

  } catch (error) {
    console.error("Supabase loadClubs error:", error);
    if (grid) {
      grid.innerHTML = `
        <div class="club-empty">
          <strong>Unable to load clubs</strong>
          <span>${escapeHtml(error.message || "Database connection error.")}</span>
        </div>`;
    }
  }
}

function renderClubFilters() {
  const container = document.getElementById("clubFilters");
  if (!container) return;

  const categories = [...new Set(clubs.map(c => c.category).filter(Boolean))];
  container.innerHTML = `
    <button class="filter-btn active" onclick="filterClubs('all', this)">All</button>
    ${categories.map(cat => `
      <button class="filter-btn" onclick="filterClubs('${escapeJs(cat)}', this)">
        ${escapeHtml(cat)}
      </button>`).join("")}
  `;
}

function renderClubs(list) {
  const grid = document.getElementById("clubsGrid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = `
      <div class="club-empty">
        <strong>No clubs found</strong>
        <span>No active clubs are currently available.</span>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(club => `
    <div class="club-card" onclick="openClub('${club.id}')">
      <span class="club-emoji">${escapeHtml(club.emoji)}</span>
      <h3>${escapeHtml(club.name)}</h3>
      <p class="club-category-line">${escapeHtml(club.category)}</p>
      <div class="club-info-row">
        <span>👑 ${escapeHtml(club.leaderName)}</span>
        <span>👥 ${club.members} members</span>
      </div>
      <div class="club-card-footer">
        <span class="club-tag">${escapeHtml(club.category)}</span>
        <button class="btn-primary club-explore" onclick="event.stopPropagation(); openClub('${club.id}');">Explore</button>
      </div>
    </div>
  `).join("");
}

function filterClubs(category, button) {
  document.querySelectorAll("#clubFilters .filter-btn").forEach(btn => btn.classList.remove("active"));
  if (button) button.classList.add("active");

  const filtered = category === "all" ? clubs : clubs.filter(c => c.category === category);
  renderClubs(filtered);
}

function openClub(id) {
  if (!id) return;
  window.location.href = `club.html?id=${encodeURIComponent(id)}`;
}

function renderEvents() {
  const grid = document.getElementById("eventsGrid");
  if (!grid) return;

  grid.innerHTML = events.map(event => {
    const priceLabel = event.price === 0 ? "Free" : `₹${event.price}`;
    const soldOut = event.seats === 0;

    return `
      <div class="event-card">
        <div class="event-banner" style="background: linear-gradient(135deg, #1a2035, ${hashColor(event.name)})">
          <span style="font-size:3rem">${event.emoji}</span>
          <span class="event-type-badge">${event.type}</span>
        </div>
        <div class="event-body">
          <h3>${escapeHtml(event.name)}</h3>
          <div class="event-meta">
            <span>📅 ${event.date} · ${event.time}</span>
            <span>📍 ${escapeHtml(event.venue)}</span>
            <span>🏛️ ${escapeHtml(event.club)}</span>
            <span style="color:${soldOut ? '#fb923c' : '#4ade80'}">
              ${soldOut ? '🔴 Sold Out' : `🟢 ${event.seats} seats left`}
            </span>
          </div>
          <div class="event-footer">
            <span class="event-price">${priceLabel}</span>
            <button class="btn-primary" ${soldOut ? 'disabled' : ''} onclick="openTicketModal(${event.id}, '${escapeJs(event.name)}', ${event.price})">
              ${soldOut ? 'Sold Out' : (event.price === 0 ? 'Register Free' : 'Buy Ticket')}
            </button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderTickets() {
  const grid = document.getElementById("ticketsGrid");
  if (!grid) return;

  grid.innerHTML = events.map(event => {
    const soldOut = event.seats === 0;
    return `
      <div class="ticket-card ${soldOut ? "sold-out" : ""}">
        <div>
          <div class="ticket-event-name">${event.emoji} ${escapeHtml(event.name)}</div>
          <span class="club-tag">${escapeHtml(event.type)}</span>
        </div>
        <div class="ticket-details">
          <span>📅 ${event.date}</span>
          <span>📍 ${escapeHtml(event.venue)}</span>
          <span>🏛️ ${escapeHtml(event.club)}</span>
        </div>
        <div class="ticket-footer">
          <div>
            <div class="ticket-price">${event.price === 0 ? "FREE" : "₹" + event.price}</div>
            <div class="ticket-avail">${soldOut ? "Sold out" : event.seats + " seats left"}</div>
          </div>
          <button class="btn-primary" ${soldOut ? 'disabled' : ''} onclick="openTicketModal(${event.id}, '${escapeJs(event.name)}', ${event.price})">
            ${soldOut ? 'Sold Out' : (event.price === 0 ? 'Register' : 'Buy')}
          </button>
        </div>
      </div>`;
  }).join("");
}

// Modal & Ticket Operations
function openTicketModal(eventId, name, price) {
  if (!currentUser) {
    showToast("⚠️ Please log in to purchase tickets", "error");
    openLogin();
    return;
  }

  ticketQty = 1;
  currentTicketPrice = price;

  const titleEl = document.getElementById("ticketModalTitle");
  const descEl = document.getElementById("ticketModalDesc");
  if (titleEl) titleEl.textContent = name;
  if (descEl) descEl.textContent = price === 0 ? "Free Registration" : `₹${price} per ticket`;

  updateTicketTotal();
  openModal("ticketModal");
}

function changeQty(delta) {
  ticketQty = Math.max(1, Math.min(10, ticketQty + delta));
  const qtyEl = document.getElementById("ticketQty");
  if (qtyEl) qtyEl.textContent = ticketQty;
  updateTicketTotal();
}

function updateTicketTotal() {
  const total = currentTicketPrice === 0 ? "FREE" : `₹${currentTicketPrice * ticketQty}`;
  const totalEl = document.getElementById("ticketTotalPrice");
  if (totalEl) totalEl.textContent = total;
}

function handleTicketPurchase(event) {
  event.preventDefault();
  closeModal("ticketModal");
  showToast(`✅ ${ticketQty} ticket(s) booked!`, "success");
}

// Auth Handlers
function switchAuthMode(mode) {
  const loginEl = document.getElementById('loginForm') || document.getElementById('loginSection');
  const signupEl = document.getElementById('signupForm') || document.getElementById('signupSection');
  const tabLogin = document.getElementById('tabLogin');
  const tabSignup = document.getElementById('tabSignup');

  if (!loginEl || !signupEl) return;

  if (mode === 'signup') {
    signupEl.classList.remove('hidden');
    loginEl.classList.add('hidden');
    if (tabSignup) tabSignup.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
  } else {
    loginEl.classList.remove('hidden');
    signupEl.classList.add('hidden');
    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
  }
}

async function handleSignUp(event) {
  if (event) event.preventDefault();
  const errorBox = document.getElementById('signupError');
  if (errorBox) errorBox.classList.add('hidden');

  const fullName = (document.getElementById('signupName')?.value || "").trim();
  const email = (document.getElementById('signupEmail')?.value || "").trim();
  const password = document.getElementById('signupPassword')?.value || "";
  const statusEl = document.getElementById('signupStatus');
  const role = statusEl ? statusEl.value : "non_club_member";

  if (!fullName || !email || !password) return;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName,
          role: role
        }
      }
    });

    if (error) throw error;
    if (!data.user) throw new Error("Account creation failed.");

    await supabase.from("profiles").upsert({
      id: data.user.id,
      full_name: fullName,
      email: email,
      role: role,
      updated_at: new Date().toISOString()
    });

    closeAllModals();

    if (data.session) {
      currentUser = { id: data.user.id, email, name: fullName, role: role };
      localStorage.setItem("userRole", role);
      updateNavUser();
      showToast("Account created successfully!", "success");
      window.location.href = "index.html";
    } else {
      showToast("Account created! Please check your email to confirm registration.", "success");
    }
  } catch (error) {
    console.error("Signup error:", error);
    const msg = (error.message && error.message.toLowerCase().includes("already registered"))
      ? "Account already exists! Please sign in instead."
      : (error.message || "Unable to create account.");
    
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    } else {
      showToast(msg, "error");
    }
  }
}

async function handleSignIn(event) {
  if (event) event.preventDefault();
  const errorBox = document.getElementById('loginError');
  if (errorBox) errorBox.classList.add('hidden');

  const email = (document.getElementById('loginEmail')?.value || "").trim();
  const password = document.getElementById('loginPassword')?.value || "";

  if (!email || !password) return;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) throw error;

    const user = data.user;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", user.id)
      .maybeSingle();

    let userRole = profile?.role || user.user_metadata?.role || 'non_club_member';
    if (email.toLowerCase().includes('admin') || user.user_metadata?.is_admin) {
      userRole = 'admin';
    }

    currentUser = {
      id: user.id,
      email: user.email,
      name: profile?.full_name || user.user_metadata?.full_name || user.email.split("@")[0],
      role: userRole
    };

    localStorage.setItem('userRole', userRole);
    updateNavUser();
    closeAllModals();

    const path = window.location.pathname.toLowerCase();
    const isAuthPage = path.includes("login.html") || path.includes("account.html");

    if (isAuthPage) {
      switch (userRole) {
        case 'admin':
          window.location.href = 'admin-dashboard.html';
          break;
        case 'club_leader':
          window.location.href = 'leader-dashboard.html';
          break;
        case 'club_member':
          window.location.href = 'member-dashboard.html';
          break;
        default:
          window.location.href = 'index.html';
          break;
      }
    } else {
      showToast(`👋 Welcome back, ${currentUser.name}!`, "success");
    }
  } catch (error) {
    console.error("Login error:", error);
    if (errorBox) {
      errorBox.textContent = error.message || "Unable to sign in.";
      errorBox.classList.remove('hidden');
    } else {
      showToast(error.message || "Unable to sign in.", "error");
    }
  }
}

async function restoreSupabaseSession() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;

    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    const user = data.session.user;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .maybeSingle();

    currentUser = {
      id: user.id,
      email: user.email,
      name: profile?.full_name || user.user_metadata?.full_name || user.email.split("@")[0],
      role: profile?.role || user.user_metadata?.role || "non_club_member"
    };

    updateNavUser();
  } catch (error) {
    console.error("Session restore error:", error);
  }
}

// UI Utilities & Modals
function openLogin() { openModal("loginModal"); }
function closeLogin() { closeModal("loginModal"); }
function openSignup() { openModal("signupModal"); }
function closeSignup() { closeModal("signupModal"); }
function switchToSignup() { switchModal("loginModal", "signupModal"); }
function switchToLogin() { switchModal("signupModal", "loginModal"); }

function openProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) {
    openModal("profileModal");
  } else {
    showToast("👤 Profile modal under construction", "info");
  }
}

function openSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (modal) {
    openModal("settingsModal");
  } else {
    showToast("⚙️ Settings modal under construction", "info");
  }
}

function openModal(id) {
  closeAllModals();
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
  if (!document.querySelector(".modal-overlay:not(.hidden)")) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
  document.body.style.overflow = "";
}

function switchModal(from, to) {
  closeAllModals();
  setTimeout(() => openModal(to), 10);
}

window.addEventListener("click", (event) => {
  if (event.target.classList.contains("modal-overlay")) {
    closeAllModals();
  }
});

async function logout() {
  try {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
  }

  currentUser = null;
  localStorage.removeItem("userRole");
  updateNavUser();
  showToast("👋 Logged out successfully");
  window.location.href = "account.html";
}

function updateNavUser() {
  const navAuth = document.getElementById("navAuth");
  const navUser = document.getElementById("navUser");
  const avatar = document.getElementById("userAvatar");
  const name = document.getElementById("dropdownName");

  if (currentUser) {
    if (navAuth) navAuth.classList.add("hidden");
    if (navUser) navUser.classList.remove("hidden");

    if (avatar) avatar.textContent = currentUser.name?.charAt(0)?.toUpperCase() || "?";
    if (name) name.textContent = currentUser.name || "Student";
  } else {
    if (navAuth) navAuth.classList.remove("hidden");
    if (navUser) navUser.classList.add("hidden");
  }
}

function toggleProfileMenu() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu) menu.classList.toggle('show');
}

window.addEventListener('click', function(e) {
  if (!e.target.closest('.profile-dropdown')) {
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu && menu.classList.contains('show')) {
      menu.classList.remove('show');
    }
  }
});

async function loadNavUserProfile() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: { user } } = await supabase.auth.getUser();

  const menuContainer = document.getElementById('profile-dropdown-menu');
  const nameDisplay = document.getElementById('nav-user-name');
  const avatarDisplay = document.getElementById('user-avatar');

  if (!menuContainer) return;

  if (!user) {
    if (nameDisplay) nameDisplay.textContent = 'Sign In';
    if (avatarDisplay) avatarDisplay.textContent = '?';
    menuContainer.innerHTML = `<a href="account.html">🔑 Sign In / Register</a>`;
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single();

  const role = profile?.role || 'non_club_member';
  const fullName = profile?.full_name || user.email.split('@')[0];

  if (nameDisplay) nameDisplay.textContent = fullName;
  if (avatarDisplay) avatarDisplay.textContent = fullName.charAt(0).toUpperCase();

  let dashboardLink = '';
  if (role === 'admin') {
    dashboardLink = `<a href="admin-dashboard.html">🛡️ Admin Dashboard</a>`;
  } else if (role === 'club_leader') {
    dashboardLink = `<a href="leader-dashboard.html">👑 Leader Dashboard</a>`;
  } else if (role === 'club_member') {
    dashboardLink = `<a href="member-dashboard.html">🎓 Member Dashboard</a>`;
  } else {
    dashboardLink = `<a href="account.html">🏛️ Join Clubs & Portal</a>`;
  }

  menuContainer.innerHTML = `
    <div style="padding: 0.75rem 1rem; background: #13111c; border-bottom: 1px solid #2d283f;">
      <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${escapeHtml(fullName)}</div>
      <div style="font-size: 0.75rem; color: #8b5cf6; text-transform: capitalize;">Role: ${escapeHtml(role.replace('_', ' '))}</div>
    </div>
    ${dashboardLink}
    <a href="#profile" onclick="openProfileModal()">👤 Profile</a>
    <a href="#settings" onclick="openSettingsModal()">⚙️ Settings</a>
    <hr class="dropdown-divider" />
    <button onclick="logout()" style="color: #f87171; background: none; border: none; width: 100%; text-align: left; padding: 0.75rem 1rem; cursor: pointer;">🚪 Sign Out</button>
  `;
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function initNavScroll() {
  const nav = document.getElementById("navbar");
  if (nav) {
    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 40);
    });
  }
}

function initSmoothLinks() {
  document.querySelectorAll(".nav-links a").forEach(link => {
    link.addEventListener("click", e => {
      const target = link.getAttribute("href");
      if (target && target.startsWith("#")) {
        e.preventDefault();
        scrollToSection(target.substring(1));
      }
    });
  });
}

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function escapeHtml(val) {
  return String(val ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeJs(val) {
  return String(val ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function hashColor(str) {
  const colors = ["#2d1b69", "#1b4069", "#1b4d2d", "#4d1b1b", "#3d1b4d", "#1b3d4d"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}