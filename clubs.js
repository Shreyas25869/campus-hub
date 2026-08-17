/*
 * Campus Hub — Clubs module
 *
 * Uses:
 *   profiles
 *   clubs
 *   club_members
 *   club_applications
 *   events
 *   notifications
 *
 * This file uses the public/anon key only.
 * RLS remains the real security layer.
 */

const SUPABASE_URL = "https://atdwjnctisnxeroeqjeo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0ZHdqbmN0aXNueGVyb2VxamVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MTQ4NDAsImV4cCI6MjEwMjM5MDg0MH0.OTwpy7FSCNlJWHHMh8pLgvxUCPGUoWmAjK4BnpxppDI";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const state = {
  user: null,
  profile: null,
  clubs: [],
  clubMap: new Map(),
  memberships: [],
  myClubIds: new Set(),
  leaderClubIds: new Set(),
  pendingApplications: new Map(),
  notifications: [],
  profiles: [],
  selectedCategory: "all",
  search: "",
  realtimeChannel: null
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();

  try {
    const {
      data: { user },
      error
    } = await supabaseClient.auth.getUser();

    if (error) throw error;

    if (!user) {
      showError("Please log in to Campus Hub before opening the Clubs section.");
      return;
    }

    state.user = user;

    await loadProfile();
    await loadClubs();
    await loadMemberships();
    await loadApplications();
    await loadNotifications();

    if (isAdmin() || isLeader()) {
      await loadAllProfiles();
    }

    render();
    subscribeToNotifications();
  } catch (error) {
    console.error(error);
    showError(error.message || "Unable to load clubs.");
  }
}

function bindUI() {
  document.addEventListener("click", async (event) => {
    const tab = event.target.closest(".tab");

    if (tab) {
      state.selectedCategory = tab.dataset.category || "all";
      document.querySelectorAll("#categoryTabs .tab").forEach(btn => {
        btn.classList.toggle("active", btn === tab);
      });
      renderExplore();
      return;
    }

    const action = event.target.closest("[data-action]");

    if (action) {
      const actionName = action.dataset.action;
      const clubId = action.dataset.clubId;
      const userId = action.dataset.userId;

      if (actionName === "details") openClubDetails(clubId);
      if (actionName === "apply") await applyToClub(clubId);
      if (actionName === "add-member") openMemberForm(clubId);
      if (actionName === "remove-member") await removeMember(clubId, userId);
      if (actionName === "assign-leader") openLeaderForm(clubId);
      if (actionName === "remove-leader") await removeLeader(clubId);
      if (actionName === "admin-edit-club") openClubForm(clubId);
      if (actionName === "admin-remove-club") await deactivateClub(clubId);
      if (actionName === "create-event") openEventForm(clubId);
      if (actionName === "approve-application") await decideApplication(action.dataset.applicationId, "approved");
      if (actionName === "reject-application") await decideApplication(action.dataset.applicationId, "rejected");
      return;
    }

    if (event.target.closest("#adminAddClubBtn")) openClubForm();
    if (event.target.closest("#notificationBtn")) openNotifications();

    if (event.target.closest("[data-close-modal]")) closeModal("#clubModal");
    if (event.target.closest("[data-close-notifications]")) closeModal("#notificationModal");
    if (event.target.closest("[data-close-club-form]")) closeModal("#clubFormModal");
    if (event.target.closest("[data-close-member-form]")) closeModal("#memberFormModal");
    if (event.target.closest("[data-close-leader-form]")) closeModal("#leaderFormModal");
    if (event.target.closest("[data-close-event-form]")) closeModal("#eventFormModal");

    if (event.target.closest("#markAllReadBtn")) await markAllNotificationsRead();
  });

  $("#clubSearch")?.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderExplore();
  });

  $("#clubForm")?.addEventListener("submit", saveClub);
  $("#memberForm")?.addEventListener("submit", addMember);
  $("#leaderForm")?.addEventListener("submit", assignLeader);
  $("#clubEventForm")?.addEventListener("submit", createClubEvent);

  ["clubModal", "notificationModal", "clubFormModal", "memberFormModal", "leaderFormModal", "eventFormModal"]
    .forEach(id => {
      const element = document.getElementById(id);
      element?.addEventListener("click", (event) => {
        if (event.target === element) closeModal(`#${id}`);
      });
    });
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, student_id, department, branch, year, role, profile_photo, photo_url")
    .eq("id", state.user.id)
    .single();

  if (error) throw error;
  state.profile = data;
}

async function loadClubs() {
  const { data, error } = await supabaseClient
    .from("clubs")
    .select(`
      id,
      name,
      description,
      category,
      logo_url,
      cover_image_url,
      created_by,
      created_at,
      updated_at,
      is_active,
      instagram_url,
      youtube_url,
      emoji,
      tagline,
      leader_id,
      leader:profiles!clubs_leader_id_fkey (
        id,
        full_name,
        email,
        department,
        branch,
        year,
        profile_photo,
        photo_url
      )
    `)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  state.clubs = await enrichClubStats(data || []);
  state.clubMap = new Map(state.clubs.map(club => [club.id, club]));
}

async function enrichClubStats(clubs) {
  if (!clubs.length) return [];

  const clubIds = clubs.map(c => c.id);

  const [{ data: members, error: memberError }, { data: events, error: eventError }] =
    await Promise.all([
      supabaseClient
        .from("club_members")
        .select("id, club_id, user_id, role, joined_at, is_active")
        .in("club_id", clubIds)
        .eq("is_active", true),

      supabaseClient
        .from("events")
        .select("id, club_id, title, description, venue, start_time, end_time, emoji, is_active")
        .in("club_id", clubIds)
        .eq("is_active", true)
        .order("start_time", { ascending: true })
    ]);

  if (memberError) throw memberError;
  if (eventError) throw eventError;

  const memberUserIds = [...new Set((members || []).map(member => member.user_id))];

  let memberProfiles = [];

  if (memberUserIds.length) {
    const { data: profiles, error: profileError } = await supabaseClient
      .from("profiles")
      .select("id, full_name, email, department, branch, year, profile_photo, photo_url")
      .in("id", memberUserIds);

    if (profileError) throw profileError;
    memberProfiles = profiles || [];
  }

  const profileMap = new Map(memberProfiles.map(profile => [profile.id, profile]));

  const membersWithProfiles = (members || []).map(member => ({
    ...member,
    profile: profileMap.get(member.user_id) || null
  }));

  const memberCounts = new Map();
  const eventCounts = new Map();

  (members || []).forEach(member => {
    memberCounts.set(member.club_id, (memberCounts.get(member.club_id) || 0) + 1);
  });

  (events || []).forEach(event => {
    if (new Date(event.start_time).getTime() >= Date.now()) {
      eventCounts.set(event.club_id, (eventCounts.get(event.club_id) || 0) + 1);
    }
  });

  return clubs.map(club => ({
    ...club,
    members: membersWithProfiles.filter(m => m.club_id === club.id),
    events: (events || []).filter(e => e.club_id === club.id),
    member_count: memberCounts.get(club.id) || 0,
    upcoming_event_count: eventCounts.get(club.id) || 0
  }));
}

async function loadMemberships() {
  const { data, error } = await supabaseClient
    .from("club_members")
    .select("id, club_id, user_id, role, joined_at, is_active")
    .eq("user_id", state.user.id)
    .eq("is_active", true);

  if (error) throw error;

  state.memberships = data || [];
  state.myClubIds = new Set(state.memberships.map(row => row.club_id));
  state.leaderClubIds = new Set(
    state.memberships
      .filter(row => row.role === "leader")
      .map(row => row.club_id)
  );
}

async function loadApplications() {
  const { data, error } = await supabaseClient
    .from("club_applications")
    .select("id, user_id, club_id, status, unique_code, created_at")
    .eq("user_id", state.user.id);

  if (error) {
    console.warn("Applications could not be loaded:", error);
    return;
  }

  state.pendingApplications.clear();

  (data || []).forEach(application => {
    state.pendingApplications.set(application.club_id, application);
  });
}

async function loadNotifications() {
  const { data, error } = await supabaseClient
    .from("notifications")
    .select("id, recipient_id, actor_id, club_id, application_id, type, title, message, is_read, created_at")
    .eq("recipient_id", state.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("Notifications could not be loaded:", error);
    state.notifications = [];
    return;
  }

  state.notifications = data || [];
  updateNotificationCount();
}

async function loadAllProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, student_id, department, branch, year, role")
    .order("full_name", { ascending: true });

  if (error) throw error;

  state.profiles = data || [];
}

function render() {
  $("#loadingState")?.classList.add("hidden");
  $("#errorState")?.classList.add("hidden");
  $("#clubsContent")?.classList.remove("hidden");

  const admin = isAdmin();
  const hasMyClub = state.myClubIds.size > 0;

  $("#notificationBtn")?.classList.remove("hidden");
  $("#adminAddClubBtn")?.classList.toggle("hidden", !admin);
  $("#adminSection")?.classList.toggle("hidden", !admin);
  $("#myClubSection")?.classList.toggle("hidden", !hasMyClub);

  if (admin) {
    renderAdmin();
  }

  if (hasMyClub) {
    renderMyClub();
  }

  renderCategoryTabs();
  renderExplore();

  $("#rankingSection")?.classList.toggle("hidden", state.profile?.role !== "student" || hasMyClub);
}

function renderAdmin() {
  const container = $("#adminClubGrid");
  if (!container) return;

  if (!state.clubs.length) {
    container.innerHTML = `<div class="empty-state">No active clubs found.</div>`;
    return;
  }

  container.innerHTML = state.clubs.map(club => {
    const leader = club.leader;

    return `
      <article class="club-card">
        <div class="club-top">
          <div class="club-icon">${escapeHTML(club.emoji || "🏛️")}</div>
          <span class="badge">${escapeHTML(club.category || "Other")}</span>
        </div>

        <h3>${escapeHTML(club.name)}</h3>
        <p class="club-category">${escapeHTML(leader?.full_name ? `Leader: ${leader.full_name}` : "Leader not assigned")}</p>
        <p class="club-description">${escapeHTML(club.description || "No description provided.")}</p>

        <div class="club-meta">
          <span>👥 ${club.member_count} active member${club.member_count === 1 ? "" : "s"}</span>
          <span>📅 ${club.upcoming_event_count} upcoming event${club.upcoming_event_count === 1 ? "" : "s"}</span>
        </div>

        <div class="card-actions">
          <button class="secondary-btn" data-action="details" data-club-id="${club.id}">View</button>
          <button class="secondary-btn" data-action="admin-edit-club" data-club-id="${club.id}">Edit</button>
          <button class="secondary-btn" data-action="add-member" data-club-id="${club.id}">Add Member</button>
          <button class="secondary-btn" data-action="assign-leader" data-club-id="${club.id}">Assign Leader</button>
          <button class="primary-btn" data-action="create-event" data-club-id="${club.id}">Create Event</button>
          ${leader ? `<button class="danger-btn" data-action="remove-leader" data-club-id="${club.id}">Remove Leader</button>` : ""}
          <button class="danger-btn" data-action="admin-remove-club" data-club-id="${club.id}">Remove Club</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderMyClub() {
  const club = getMyPrimaryClub();
  if (!club) return;

  const isLeader = state.leaderClubIds.has(club.id);

  $("#myClubHeading").textContent = isLeader ? `${club.name} — Management` : club.name;
  $("#myClubSubtitle").textContent = isLeader
    ? "Manage your club members and review join requests."
    : "Your club information and members.";

  const members = club.members || [];

  $("#myClubContainer").innerHTML = `
    <div class="my-club-card">
      <div class="my-club-icon">${escapeHTML(club.emoji || "🏛️")}</div>

      <div class="my-club-main">
        <span class="badge">${escapeHTML(club.category || "Other")}</span>
        <h3>${escapeHTML(club.name)}</h3>
        <p class="club-tagline">${escapeHTML(club.tagline || "")}</p>
        <p class="detail-text">${escapeHTML(club.description || "No description provided.")}</p>

        <div class="club-meta">
          <span>👑 Leader: ${escapeHTML(club.leader?.full_name || "Not assigned")}</span>
          <span>👥 ${club.member_count} members</span>
          <span>📅 ${club.upcoming_event_count} upcoming events</span>
        </div>
      </div>
    </div>

    <div class="club-detail-grid">
      <section class="detail-panel">
        <div class="section-heading compact">
          <div>
            <h3>Members</h3>
            <p>People currently in ${escapeHTML(club.name)}.</p>
          </div>
          ${isLeader ? `<button class="primary-btn" data-action="add-member" data-club-id="${club.id}">Add Member</button>` : ""}
        </div>

        <div class="member-list">
          ${members.length ? members.map(member => renderMemberRow(member, club, isLeader)).join("") : `<div class="empty-state">No members found.</div>`}
        </div>
      </section>

      <section class="detail-panel">
        <div class="section-heading compact">
          <div>
            <h3>Club Events</h3>
            <p>Upcoming and past events.</p>
          </div>
          ${isLeader ? `<button class="primary-btn" data-action="create-event" data-club-id="${club.id}">Create Event</button>` : ""}
        </div>

        <div class="event-list">
          ${club.events?.length ? club.events.slice(0, 8).map(renderEventRow).join("") : `<div class="empty-state">No events found.</div>`}
        </div>
      </section>

      ${isLeader ? `
        <section class="detail-panel">
          <div class="section-heading compact">
            <div>
              <h3>Join Requests</h3>
              <p>Applications sent to your club.</p>
            </div>
          </div>
          <div id="leaderApplications-${club.id}" class="application-list">
            <div class="empty-state">Loading applications...</div>
          </div>
        </section>
      ` : ""}

      <section class="detail-panel">
        <h3>Club Information</h3>
        <div class="leader-card">
          <strong>Leader</strong>
          <p>${escapeHTML(club.leader?.full_name || "Not assigned")}</p>
          <p class="detail-text">
            ${escapeHTML(club.leader?.department || "")}
            ${club.leader?.branch ? ` • ${escapeHTML(club.leader.branch)}` : ""}
            ${club.leader?.year ? ` • Year ${club.leader.year}` : ""}
          </p>
        </div>
        ${renderSocialLinks(club)}
      </section>
    </div>
  `;

  if (isLeader) {
    loadLeaderApplicationsIntoView(club.id);
  }
}

async function loadLeaderApplicationsIntoView(clubId) {
  const container = document.querySelector(`#leaderApplications-${clubId}`);
  if (!container) return;

  container.innerHTML = await awaitApplicationsForClub(clubId);
}

function renderMemberRow(member, club, isLeader) {
  const profile = member.profile || {};
  const leader = member.role === "leader";

  return `
    <div class="member-row">
      <div class="member-info">
        <strong>${escapeHTML(profile.full_name || profile.email || "Campus User")}</strong>
        <span>
          ${leader ? "Club Leader" : "Club Member"}
          ${profile.branch ? ` • ${escapeHTML(profile.branch)}` : ""}
          ${profile.year ? ` • Year ${profile.year}` : ""}
        </span>
      </div>

      <div class="card-actions">
        <span class="badge ${leader ? "success-badge" : ""}">${leader ? "Leader" : "Member"}</span>
        ${isLeader && !leader && member.user_id !== state.user.id
          ? `<button class="danger-btn" data-action="remove-member" data-club-id="${club.id}" data-user-id="${member.user_id}">Remove</button>`
          : ""}
      </div>
    </div>
  `;
}

function renderEventRow(event) {
  const status = getEventStatus(event);

  return `
    <div class="event-row">
      <strong>${escapeHTML(event.emoji || "📅")} ${escapeHTML(event.title)}</strong>
      <p>${formatDateTime(event.start_time)}${event.venue ? ` • ${escapeHTML(event.venue)}` : ""}</p>
      <span class="badge ${status === "past" ? "" : "success-badge"}">${capitalize(status)}</span>
    </div>
  `;
}

function renderSocialLinks(club) {
  const links = [];

  if (club.instagram_url) {
    links.push(`<a class="secondary-btn" target="_blank" rel="noopener" href="${safeUrl(club.instagram_url)}">Instagram</a>`);
  }

  if (club.youtube_url) {
    links.push(`<a class="secondary-btn" target="_blank" rel="noopener" href="${safeUrl(club.youtube_url)}">YouTube</a>`);
  }

  return links.length
    ? `<div class="social-links">${links.join("")}</div>`
    : "";
}

function renderCategoryTabs() {
  const categories = ["all", ...new Set(state.clubs.map(c => c.category).filter(Boolean))];

  $("#categoryTabs").innerHTML = categories.map(category => `
    <button class="tab ${state.selectedCategory === category ? "active" : ""}" data-category="${escapeHTML(category)}">
      ${escapeHTML(category === "all" ? "All" : category)}
    </button>
  `).join("");
}

function renderExplore() {
  const container = $("#exploreClubGrid");
  if (!container) return;

  let clubs = [...state.clubs];

  if (state.selectedCategory !== "all") {
    clubs = clubs.filter(club => club.category === state.selectedCategory);
  }

  if (state.search) {
    clubs = clubs.filter(club => {
      const text = [
        club.name,
        club.category,
        club.tagline,
        club.description,
        club.leader?.full_name
      ].join(" ").toLowerCase();

      return text.includes(state.search);
    });
  }

  clubs.sort((a, b) => a.name.localeCompare(b.name));

  if (!clubs.length) {
    container.innerHTML = `<div class="empty-state">No clubs match your search.</div>`;
    return;
  }

  const publicApplicant = !isAdmin() && state.myClubIds.size === 0;

  container.innerHTML = clubs.map((club, index) => {
    const isOwnClub = state.myClubIds.has(club.id);
    const application = state.pendingApplications.get(club.id);
    const canApply = publicApplicant && !isOwnClub;

    let applicationButton = "";

    if (canApply && application?.status === "pending") {
      applicationButton = `<button class="secondary-btn" disabled>Application Pending</button>`;
    } else if (canApply && application?.status === "approved") {
      applicationButton = `<button class="secondary-btn" disabled>Member</button>`;
    } else if (canApply) {
      applicationButton = `<button class="primary-btn" data-action="apply" data-club-id="${club.id}">Apply</button>`;
    }

    return `
      <article class="club-card">
        <div class="club-top">
          <div class="club-icon">${escapeHTML(club.emoji || "🏛️")}</div>
          ${isOwnClub ? `<span class="badge success-badge">Your Club</span>` : `<span class="club-rank">#${index + 1}</span>`}
        </div>

        <h3>${escapeHTML(club.name)}</h3>
        <p class="club-category">${escapeHTML(club.category || "Other")}</p>
        <p class="club-tagline">${escapeHTML(club.tagline || "Campus community")}</p>
        <p class="club-description">${escapeHTML(club.description || "No description provided.")}</p>

        <div class="club-meta">
          <span>👑 ${escapeHTML(club.leader?.full_name || "Leader not assigned")}</span>
          <span>👥 ${club.member_count} members</span>
          <span>📅 ${club.upcoming_event_count} upcoming events</span>
        </div>

        <div class="club-footer">
          <button class="secondary-btn" data-action="details" data-club-id="${club.id}">Details</button>
          ${applicationButton}
        </div>
      </article>
    `;
  }).join("");

  renderRanking();
}

function renderRanking() {
  const rankingList = $("#rankingList");
  if (!rankingList || state.profile?.role !== "student" || state.myClubIds.size > 0) return;

  const ranked = [...state.clubs]
    .map(club => ({
      ...club,
      score: club.member_count * 10 + club.upcoming_event_count * 5
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  rankingList.innerHTML = ranked.map((club, index) => `
    <div class="ranking-row">
      <div class="ranking-position">#${index + 1}</div>
      <div>
        <div class="ranking-name">${escapeHTML(club.emoji || "🏛️")} ${escapeHTML(club.name)}</div>
        <div class="ranking-meta">${escapeHTML(club.category || "Other")} • ${club.member_count} members • ${club.upcoming_event_count} upcoming events</div>
      </div>
      <div class="ranking-score">${club.score} pts</div>
    </div>
  `).join("");
}

function openClubDetails(clubId) {
  const club = state.clubMap.get(clubId);
  if (!club) return;

  const publicApplicant = !isAdmin() && state.myClubIds.size === 0;
  const application = state.pendingApplications.get(club.id);

  let action = "";

  if (publicApplicant) {
    if (application?.status === "pending") {
      action = `<button class="secondary-btn" disabled>Application Pending</button>`;
    } else if (application?.status === "approved") {
      action = `<button class="secondary-btn" disabled>Member</button>`;
    } else {
      action = `<button class="primary-btn" data-action="apply" data-club-id="${club.id}">Apply to Join</button>`;
    }
  }

  $("#clubModalContent").innerHTML = `
    <div class="club-modal-header">
      <div class="club-modal-icon">${escapeHTML(club.emoji || "🏛️")}</div>
      <div>
        <span class="badge">${escapeHTML(club.category || "Other")}</span>
        <h2>${escapeHTML(club.name)}</h2>
        <p class="club-tagline">${escapeHTML(club.tagline || "")}</p>
      </div>
    </div>

    <p class="modal-description">${escapeHTML(club.description || "No description provided.")}</p>

    <div class="modal-meta">
      <div><strong>Leader:</strong> ${escapeHTML(club.leader?.full_name || "Not assigned")}</div>
      <div><strong>Members:</strong> ${club.member_count}</div>
      <div><strong>Upcoming events:</strong> ${club.upcoming_event_count}</div>
      ${club.leader?.department ? `<div><strong>Department:</strong> ${escapeHTML(club.leader.department)}</div>` : ""}
      ${club.leader?.branch ? `<div><strong>Branch:</strong> ${escapeHTML(club.leader.branch)}</div>` : ""}
      ${club.leader?.year ? `<div><strong>Year:</strong> ${club.leader.year}</div>` : ""}
    </div>

    <div class="section-heading compact">
      <div>
        <h3>Members</h3>
        <p>Current members of the club.</p>
      </div>
    </div>

    <div class="member-list">
      ${club.members?.length
        ? club.members.map(member => renderMemberRow(member, club, false)).join("")
        : `<div class="empty-state">No members found.</div>`}
    </div>

    <div class="section-heading compact" style="margin-top:22px;">
      <div>
        <h3>Events</h3>
        <p>Events connected to this club.</p>
      </div>
    </div>

    <div class="event-list">
      ${club.events?.length
        ? club.events.map(renderEventRow).join("")
        : `<div class="empty-state">No events found.</div>`}
    </div>

    <div class="card-actions" style="margin-top:20px;">
      ${action}
      ${renderSocialLinks(club)}
    </div>
  `;

  openModal("#clubModal");
}

async function applyToClub(clubId) {
  if (!state.user) return;

  if (state.myClubIds.has(clubId)) {
    showToast("You are already a member of this club.", "error");
    return;
  }

  const existing = state.pendingApplications.get(clubId);

  if (existing?.status === "pending") {
    showToast("Your application is already pending.", "error");
    return;
  }

  const club = state.clubMap.get(clubId);

  if (!club) return;

  try {
    const { data, error } = await supabaseClient
      .from("club_applications")
      .insert({
        user_id: state.user.id,
        club_id: clubId,
        status: "pending"
      })
      .select("id, user_id, club_id, status, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        showToast("You already have a pending application for this club.", "error");
        return;
      }
      throw error;
    }

    state.pendingApplications.set(clubId, data);
    closeModal("#clubModal");
    renderExplore();
    showToast(`Application sent to ${club.name}.`, "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to submit application.", "error");
  }
}

function openMemberForm(clubId) {
  const club = state.clubMap.get(clubId);
  if (!club) return;

  $("#memberClubId").value = clubId;

  const existingIds = new Set((club.members || []).map(m => m.user_id));
  const options = state.profiles
    .filter(profile => !existingIds.has(profile.id))
    .filter(profile => profile.id !== club.leader_id)
    .map(profile => `
      <option value="${profile.id}">
        ${escapeHTML(profile.full_name || profile.email)}${profile.branch ? ` — ${escapeHTML(profile.branch)}` : ""}
      </option>
    `)
    .join("");

  $("#memberUserId").innerHTML = options || `<option value="">No available profiles</option>`;
  openModal("#memberFormModal");
}

async function addMember(event) {
  event.preventDefault();

  const clubId = $("#memberClubId").value;
  const userId = $("#memberUserId").value;

  if (!clubId || !userId) {
    showToast("Select a student first.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("club_members")
      .insert({
        club_id: clubId,
        user_id: userId,
        role: "member",
        is_active: true
      });

    if (error) throw error;

    await createNotificationForUser(
      userId,
      "club_member_added",
      "Added to Club",
      `You were added to ${state.clubMap.get(clubId)?.name || "a club"}.`,
      clubId
    );

    await refreshClubData();
    closeModal("#memberFormModal");
    render();
    showToast("Member added successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to add member. Check your RLS policies.", "error");
  }
}

async function removeMember(clubId, userId) {
  if (!confirm("Remove this member from the club?")) return;

  try {
    const { error } = await supabaseClient
      .from("club_members")
      .update({ is_active: false })
      .eq("club_id", clubId)
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) throw error;

    await createNotificationForUser(
      userId,
      "club_member_removed",
      "Removed from Club",
      `You were removed from ${state.clubMap.get(clubId)?.name || "a club"}.`,
      clubId
    );

    await refreshClubData();
    render();
    showToast("Member removed.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to remove member. Check your RLS policies.", "error");
  }
}

function openLeaderForm(clubId) {
  const club = state.clubMap.get(clubId);
  if (!club) return;

  const members = (club.members || []).filter(member => member.is_active && member.role !== "leader");

  $("#leaderClubId").value = clubId;
  $("#leaderUserId").innerHTML = members.length
    ? members.map(member => `
        <option value="${member.user_id}">
          ${escapeHTML(member.profile?.full_name || member.profile?.email || member.user_id)}
        </option>
      `).join("")
    : `<option value="">No active members available</option>`;

  openModal("#leaderFormModal");
}

async function assignLeader(event) {
  event.preventDefault();

  const clubId = $("#leaderClubId").value;
  const userId = $("#leaderUserId").value;
  const club = state.clubMap.get(clubId);

  if (!club || !userId) return;

  try {
    const previousLeaderId = club.leader_id;

    if (previousLeaderId) {
      await supabaseClient
        .from("club_members")
        .update({ role: "member" })
        .eq("club_id", clubId)
        .eq("user_id", previousLeaderId);
    }

    const { error: memberError } = await supabaseClient
      .from("club_members")
      .update({ role: "leader", is_active: true })
      .eq("club_id", clubId)
      .eq("user_id", userId);

    if (memberError) throw memberError;

    const { error: clubError } = await supabaseClient
      .from("clubs")
      .update({ leader_id: userId, updated_at: new Date().toISOString() })
      .eq("id", clubId);

    if (clubError) throw clubError;

    await createNotificationForUser(
      userId,
      "leader_assigned",
      "You Are Now Club Leader",
      `You have been assigned as leader of ${club.name}.`,
      clubId
    );

    if (previousLeaderId && previousLeaderId !== userId) {
      await createNotificationForUser(
        previousLeaderId,
        "leader_removed",
        "Leader Role Removed",
        `You are no longer the leader of ${club.name}.`,
        clubId
      );
    }

    await refreshClubData();
    closeModal("#leaderFormModal");
    render();
    showToast(`${club.name} leader updated.`, "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to assign leader. Check your RLS policies.", "error");
  }
}

async function removeLeader(clubId) {
  const club = state.clubMap.get(clubId);
  if (!club?.leader_id) return;

  if (!confirm(`Remove ${club.leader?.full_name || "the current leader"} as leader?`)) return;

  try {
    const leaderId = club.leader_id;

    const { error: clubError } = await supabaseClient
      .from("clubs")
      .update({ leader_id: null, updated_at: new Date().toISOString() })
      .eq("id", clubId);

    if (clubError) throw clubError;

    const { error: memberError } = await supabaseClient
      .from("club_members")
      .update({ role: "member" })
      .eq("club_id", clubId)
      .eq("user_id", leaderId);

    if (memberError) throw memberError;

    await createNotificationForUser(
      leaderId,
      "leader_removed",
      "Leader Role Removed",
      `You are no longer the leader of ${club.name}.`,
      clubId
    );

    await refreshClubData();
    render();
    showToast("Leader removed.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to remove leader. Check your RLS policies.", "error");
  }
}

function openClubForm(clubId = "") {
  const club = clubId ? state.clubMap.get(clubId) : null;

  $("#clubFormTitle").textContent = club ? "Edit Club" : "Add Club";
  $("#clubFormId").value = club?.id || "";
  $("#clubName").value = club?.name || "";
  $("#clubCategory").value = club?.category || "";
  $("#clubTagline").value = club?.tagline || "";
  $("#clubEmoji").value = club?.emoji || "🏛️";
  $("#clubDescription").value = club?.description || "";
  $("#clubInstagram").value = club?.instagram_url || "";
  $("#clubYoutube").value = club?.youtube_url || "";

  openModal("#clubFormModal");
}

async function saveClub(event) {
  event.preventDefault();

  const id = $("#clubFormId").value;
  const payload = {
    name: $("#clubName").value.trim(),
    category: $("#clubCategory").value.trim(),
    tagline: $("#clubTagline").value.trim() || null,
    emoji: $("#clubEmoji").value.trim() || "🏛️",
    description: $("#clubDescription").value.trim() || null,
    instagram_url: $("#clubInstagram").value.trim() || null,
    youtube_url: $("#clubYoutube").value.trim() || null,
    updated_at: new Date().toISOString()
  };

  if (!payload.name || !payload.category) {
    showToast("Club name and category are required.", "error");
    return;
  }

  try {
    if (id) {
      const { error } = await supabaseClient
        .from("clubs")
        .update(payload)
        .eq("id", id);

      if (error) throw error;

      const club = state.clubMap.get(id);

      if (club?.leader_id) {
        await createNotificationForUser(
          club.leader_id,
          "club_updated",
          "Club Updated",
          `${club.name} was updated by an administrator.`,
          id
        );
      }

      showToast("Club updated.", "success");
    } else {
      const { error } = await supabaseClient
        .from("clubs")
        .insert({
          ...payload,
          created_by: state.user.id,
          is_active: true
        });

      if (error) throw error;
      showToast("Club created.", "success");
    }

    await refreshClubData();
    closeModal("#clubFormModal");
    render();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to save club. Check your RLS policies.", "error");
  }
}

async function deactivateClub(clubId) {
  const club = state.clubMap.get(clubId);
  if (!club) return;

  if (!confirm(`Deactivate ${club.name}? It will no longer appear as an active club.`)) return;

  try {
    const { error } = await supabaseClient
      .from("clubs")
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", clubId);

    if (error) throw error;

    if (club.leader_id) {
      await createNotificationForUser(
        club.leader_id,
        "club_removed",
        "Club Deactivated",
        `${club.name} was deactivated by an administrator.`,
        clubId
      );
    }

    await refreshClubData();
    render();
    showToast("Club deactivated.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to remove club. Check your RLS policies.", "error");
  }
}

function openEventForm(clubId) {
  $("#eventClubId").value = clubId;
  $("#clubEventForm").reset();
  $("#eventClubId").value = clubId;
  $("#eventType").value = "general";
  $("#eventVisibility").value = "open";
  $("#eventPrice").value = "0";
  openModal("#eventFormModal");
}

async function createClubEvent(event) {
  event.preventDefault();

  const clubId = $("#eventClubId").value;

  const payload = {
    club_id: clubId,
    title: $("#eventTitle").value.trim(),
    description: $("#eventDescription").value.trim() || null,
    event_type: $("#eventType").value.trim() || "general",
    venue: $("#eventVenue").value.trim() || null,
    start_time: new Date($("#eventStart").value).toISOString(),
    end_time: new Date($("#eventEnd").value).toISOString(),
    capacity: $("#eventCapacity").value ? Number($("#eventCapacity").value) : null,
    emoji: "📅",
    price: Number($("#eventPrice").value || 0),
    visibility: $("#eventVisibility").value,
    registration_enabled: false,
    is_active: true
  };

  if (new Date(payload.end_time) <= new Date(payload.start_time)) {
    showToast("End time must be after start time.", "error");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("events")
      .insert(payload);

    if (error) throw error;

    const club = state.clubMap.get(clubId);

    if (isAdmin() && club?.leader_id) {
      await createNotificationForUser(
        club.leader_id,
        "admin_action",
        "New Club Event",
        `An administrator created a new event for ${club.name}.`,
        clubId
      );
    }

    await refreshClubData();
    closeModal("#eventFormModal");
    render();
    showToast("Event created.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to create event. Check your RLS policies and event constraints.", "error");
  }
}

async function decideApplication(applicationId, status) {
  const application = await getApplication(applicationId);
  if (!application) return;

  const club = state.clubMap.get(application.club_id);

  try {
    const { error } = await supabaseClient
      .from("club_applications")
      .update({ status })
      .eq("id", applicationId);

    if (error) throw error;

    if (status === "approved") {
      const { error: memberError } = await supabaseClient
        .from("club_members")
        .upsert({
          club_id: application.club_id,
          user_id: application.user_id,
          role: "member",
          is_active: true
        }, {
          onConflict: "club_id,user_id"
        });

      if (memberError) throw memberError;

      await createNotificationForUser(
        application.user_id,
        "club_application",
        "Application Approved",
        `Your application to join ${club?.name || "the club"} was approved.`,
        application.club_id,
        applicationId
      );
    } else {
      await createNotificationForUser(
        application.user_id,
        "club_application",
        "Application Rejected",
        `Your application to join ${club?.name || "the club"} was rejected.`,
        application.club_id,
        applicationId
      );
    }

    await refreshClubData();
    render();
    showToast(`Application ${status}.`, "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to update application.", "error");
  }
}

async function getApplication(applicationId) {
  const { data, error } = await supabaseClient
    .from("club_applications")
    .select("id, user_id, club_id, status, created_at")
    .eq("id", applicationId)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

async function awaitApplicationsForClub(clubId) {
  const { data, error } = await supabaseClient
    .from("club_applications")
    .select("id, user_id, club_id, status, created_at")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Applications unavailable:", error);
    return `<div class="empty-state">Applications could not be loaded.</div>`;
  }

  if (!data?.length) {
    return `<div class="empty-state">No pending applications.</div>`;
  }

  const profileIds = data.map(item => item.user_id);

  const { data: applicants } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, department, branch, year")
    .in("id", profileIds);

  const applicantMap = new Map((applicants || []).map(profile => [profile.id, profile]));

  return data.map(application => {
    const applicant = applicantMap.get(application.user_id) || {};

    return `
      <div class="application-row">
        <div class="application-info">
          <strong>${escapeHTML(applicant.full_name || applicant.email || "Student")}</strong>
          <span>
            ${escapeHTML(applicant.department || "")}
            ${applicant.branch ? ` • ${escapeHTML(applicant.branch)}` : ""}
            ${applicant.year ? ` • Year ${applicant.year}` : ""}
          </span>
        </div>

        <div class="card-actions">
          <button class="primary-btn" data-action="approve-application" data-application-id="${application.id}">Approve</button>
          <button class="danger-btn" data-action="reject-application" data-application-id="${application.id}">Reject</button>
        </div>
      </div>
    `;
  }).join("");
}

async function createNotificationForUser(recipientId, type, title, message, clubId = null, applicationId = null) {
  if (!recipientId) return;

  const { error } = await supabaseClient
    .from("notifications")
    .insert({
      recipient_id: recipientId,
      actor_id: state.user.id,
      club_id: clubId,
      application_id: applicationId,
      type,
      title,
      message,
      is_read: false
    });

  if (error) {
    console.warn("Notification insert failed:", error);
  }
}

function subscribeToNotifications() {
  if (!state.user) return;

  state.realtimeChannel = supabaseClient
    .channel(`club-notifications-${state.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${state.user.id}`
      },
      payload => {
        state.notifications.unshift(payload.new);
        updateNotificationCount();
        showToast(`🔔 ${payload.new.title}`, "success");

        if (isLeader()) {
          renderMyClub();
        }
      }
    )
    .subscribe();
}

function openNotifications() {
  const list = $("#notificationList");

  list.innerHTML = `
    <div class="card-actions" style="margin-bottom:14px;">
      <button id="markAllReadBtn" class="secondary-btn">Mark all as read</button>
    </div>
  `;

  if (!state.notifications.length) {
    list.innerHTML += `<div class="empty-state">No notifications.</div>`;
  } else {
    list.innerHTML += state.notifications.map(notification => `
      <article class="notification-item ${notification.is_read ? "" : "unread"}">
        <strong>${escapeHTML(notification.title)}</strong>
        <p>${escapeHTML(notification.message)}</p>
        <span class="notification-time">${formatDateTime(notification.created_at)}</span>
      </article>
    `).join("");
  }

  openModal("#notificationModal");
}

async function markAllNotificationsRead() {
  const unreadIds = state.notifications
    .filter(notification => !notification.is_read)
    .map(notification => notification.id);

  if (!unreadIds.length) {
    updateNotificationCount();
    return;
  }

  const { error } = await supabaseClient
    .from("notifications")
    .update({ is_read: true })
    .in("id", unreadIds);

  if (error) {
    showToast(error.message || "Unable to mark notifications as read.", "error");
    return;
  }

  state.notifications = state.notifications.map(notification => ({
    ...notification,
    is_read: true
  }));

  updateNotificationCount();
  openNotifications();
}

function updateNotificationCount() {
  const count = state.notifications.filter(notification => !notification.is_read).length;
  const element = $("#notificationCount");

  if (!element) return;

  element.textContent = count;
  element.classList.toggle("hidden", count === 0);
}

async function refreshClubData() {
  await loadClubs();
  await loadMemberships();
  await loadApplications();

  if (isAdmin()) {
    await loadAllProfiles();
  }
}

function getMyPrimaryClub() {
  const clubId = [...state.myClubIds][0];
  return state.clubMap.get(clubId);
}

function isAdmin() {
  return state.profile?.role === "admin";
}

function isLeader() {
  return state.leaderClubIds.size > 0;
}

function getEventStatus(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();

  if (now < start) return "upcoming";
  if (now <= end) return "current";
  return "past";
}

function formatDateTime(value) {
  if (!value) return "Not specified";

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function openModal(selector) {
  const modal = $(selector);
  if (!modal) return;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(selector) {
  const modal = $(selector);
  if (!modal) return;

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function showError(message) {
  $("#loadingState")?.classList.add("hidden");
  $("#clubsContent")?.classList.add("hidden");

  const error = $("#errorState");
  if (!error) return;

  error.textContent = message;
  error.classList.remove("hidden");
}

let toastTimer;

function showToast(message, type = "") {
  const toast = $("#toast");
  if (!toast) return;

  clearTimeout(toastTimer);

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3500);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (_) {}

  return "#";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
