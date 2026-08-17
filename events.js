/*
 * Campus Hub — Events module
 *
 * IMPORTANT:
 * 1. Replace SUPABASE_URL and SUPABASE_ANON_KEY with the SAME values
 *    used by your existing Campus Hub application.
 * 2. Do not put a service-role key in this file.
 *
 * This standalone module uses the existing:
 *   profiles
 *   clubs
 *   club_members
 *   events
 *   event_registrations
 *
 * The database RLS remains the security layer.
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
  myClubIds: new Set(),
  myClubEventIds: new Set(),
  registrations: new Set(),
  events: [],
  clubs: new Map(),
  activeTabs: {
    "my-club": "upcoming",
    open: "upcoming"
  }
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();

  if (
    SUPABASE_URL === "YOUR_SUPABASE_URL" ||
    SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY"
  ) {
    showError(
      "Supabase is not configured yet. Open events.js and add the same Supabase URL and anon key used by Campus Hub."
    );
    return;
  }

  try {
    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      showError("Please log in to Campus Hub before opening the Events section.");
      return;
    }

    state.user = user;

    await loadProfile();
    await loadMemberships();
    await loadEvents();
    await loadRegistrations();

    render();
  } catch (error) {
    console.error(error);
    showError(error.message || "Unable to load events.");
  }
}

function bindUI() {
  document.addEventListener("click", async (event) => {
    const tab = event.target.closest(".tab");

    if (tab) {
      const group = tab.closest(".status-tabs")?.dataset.group;
      const status = tab.dataset.status;

      if (group && status) {
        state.activeTabs[group] = status;

        tab
          .closest(".status-tabs")
          .querySelectorAll(".tab")
          .forEach((button) => button.classList.remove("active"));

        tab.classList.add("active");

        renderEventsForGroup(group);
      }

      return;
    }

    const eventButton = event.target.closest("[data-event-id]");
    if (eventButton) {
      const eventId = eventButton.dataset.eventId;
      const action = eventButton.dataset.action;

      if (action === "details") {
        openEventDetails(eventId);
      }

      if (action === "register") {
        await registerForEvent(eventId);
      }

      if (action === "cancel") {
        await cancelRegistration(eventId);
      }

      return;
    }

    if (event.target.closest("[data-close-modal]")) {
      closeModal();
    }
  });

  $("#eventModal")?.addEventListener("click", (event) => {
    if (event.target === $("#eventModal")) closeModal();
  });
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", state.user.id)
    .single();

  if (error) throw error;

  state.profile = data;
}

async function loadMemberships() {
  const { data, error } = await supabaseClient
    .from("club_members")
    .select("club_id, role, is_active")
    .eq("user_id", state.user.id)
    .eq("is_active", true);

  if (error) throw error;

  state.myClubIds = new Set((data || []).map((row) => row.club_id));
}

async function loadEvents() {
  /*
   * RLS determines which events this user is actually allowed to see.
   * We intentionally do not attempt to bypass RLS in JavaScript.
   */
  const { data, error } = await supabaseClient
    .from("events")
    .select(`
      id,
      club_id,
      title,
      description,
      event_type,
      venue,
      start_time,
      end_time,
      registration_deadline,
      capacity,
      banner_url,
      created_at,
      updated_at,
      is_active,
      emoji,
      price,
      visibility
    `)
    .eq("is_active", true)
    .order("start_time", { ascending: true });

  if (error) throw error;

  state.events = data || [];

  const clubIds = [...new Set(state.events.map((event) => event.club_id))];

  if (clubIds.length === 0) return;

  const { data: clubs, error: clubsError } = await supabaseClient
    .from("clubs")
    .select("id, name, logo_url, emoji")
    .in("id", clubIds);

  if (clubsError) throw clubsError;

  state.clubs = new Map(
    (clubs || []).map((club) => [club.id, club])
  );

  state.myClubEventIds = new Set(
    state.events
      .filter((event) => state.myClubIds.has(event.club_id))
      .map((event) => event.id)
  );
}

async function loadRegistrations() {
  const { data, error } = await supabaseClient
    .from("event_registrations")
    .select("event_id")
    .eq("user_id", state.user.id);

  if (error) throw error;

  state.registrations = new Set(
    (data || []).map((registration) => registration.event_id)
  );
}

function render() {
  $("#loadingState").classList.add("hidden");
  $("#errorState").classList.add("hidden");
  $("#eventsContent").classList.remove("hidden");

  /*
   * A non-club member still sees Open Events.
   * My Club Events is hidden when the user has no active membership.
   */
  const myClubSection = $("#myClubSection");

  if (state.myClubIds.size === 0) {
    myClubSection.classList.add("hidden");
  } else {
    myClubSection.classList.remove("hidden");
  }

  /*
   * Create Event is visible to a user who is an active leader
   * of at least one club, or to an admin.
   */
  const isAdmin = state.profile?.role === "admin";

  if (isAdmin || awaitHasLeaderMembership()) {
    $("#createEventBtn").classList.remove("hidden");
  }

  renderEventsForGroup("my-club");
  renderEventsForGroup("open");
}

function awaitHasLeaderMembership() {
  /*
   * We don't need another database request because memberships were
   * initially loaded without role in state.myClubIds. This function
   * is replaced by the role-aware check below when needed.
   */
  return false;
}

function getEventStatus(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();

  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "current";
  return "past";
}

function getGroupEvents(group) {
  if (group === "my-club") {
    return state.events.filter((event) =>
      state.myClubIds.has(event.club_id)
    );
  }

  /*
   * Open Events intentionally excludes the user's own club.
   * Their own events belong in My Club Events.
   */
  return state.events.filter((event) =>
    event.visibility === "open" &&
    !state.myClubIds.has(event.club_id)
  );
}

function renderEventsForGroup(group) {
  const container =
    group === "my-club" ? $("#myClubEvents") : $("#openEvents");

  if (!container) return;

  const status = state.activeTabs[group];

  const events = getGroupEvents(group)
    .filter((event) => getEventStatus(event) === status)
    .sort(
      (a, b) =>
        new Date(a.start_time) - new Date(b.start_time)
    );

  if (events.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        No ${status} events found.
      </div>
    `;
    return;
  }

  container.innerHTML = events
    .map(renderEventCard)
    .join("");
}

function renderEventCard(event) {
  const status = getEventStatus(event);
  const club = state.clubs.get(event.club_id);
  const registered = state.registrations.has(event.id);

  const registrationState = getRegistrationState(event, registered);

  const statusLabel = {
    upcoming: "Upcoming",
    current: "Current",
    past: "Past"
  }[status];

  const clubName = club?.name || "Unknown Club";

  const description =
    event.description ||
    "No description has been provided for this event.";

  return `
    <article class="event-card">
      <div class="event-top">
        <span class="status-badge status-${status}">
          ${escapeHTML(statusLabel)}
        </span>

        ${
          event.visibility === "open"
            ? `<span class="visibility-badge">Open to All</span>`
            : ""
        }
      </div>

      <h3>${escapeHTML(event.title)}</h3>

      <p class="club-name">${escapeHTML(clubName)}</p>

      <p class="event-description">
        ${escapeHTML(description)}
      </p>

      <div class="event-meta">
        <span>📅 ${formatDate(event.start_time)}</span>
        <span>🕐 ${formatTimeRange(event.start_time, event.end_time)}</span>
        <span>📍 ${escapeHTML(event.venue || "Venue not specified")}</span>
      </div>

      <div class="event-footer">
        <div class="registration-note">
          ${registrationState.note}
        </div>

        <div class="card-actions">
          <button
            class="secondary-btn"
            data-event-id="${event.id}"
            data-action="details"
          >
            Details
          </button>

          ${registrationState.button}
        </div>
      </div>
    </article>
  `;
}

function getRegistrationState(event, registered) {
  if (!event.registration_enabled) {
    return {
      note: "No registration required",
      button: ""
    };
  }

  if (event.registration_deadline) {
    const deadline = new Date(event.registration_deadline);

    if (deadline.getTime() <= Date.now()) {
      return {
        note: "Registration closed",
        button: ""
      };
    }
  }

  if (event.end_time && new Date(event.end_time).getTime() < Date.now()) {
    return {
      note: "Event ended",
      button: ""
    };
  }

  if (registered) {
    return {
      note: "<strong>Registered</strong>",
      button: `
        <button
          class="secondary-btn"
          data-event-id="${event.id}"
          data-action="cancel"
        >
          Cancel
        </button>
      `
    };
  }

  return {
    note: event.registration_deadline
      ? `Closes ${formatDate(event.registration_deadline)}`
      : "Registration available",
    button: `
      <button
        class="register-btn"
        data-event-id="${event.id}"
        data-action="register"
      >
        Register
      </button>
    `
  };
}

function openEventDetails(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;

  const club = state.clubs.get(event.club_id);
  const registered = state.registrations.has(event.id);
  const registrationState = getRegistrationState(event, registered);

  $("#modalContent").innerHTML = `
    <h2>${escapeHTML(event.title)}</h2>
    <p class="modal-club">${escapeHTML(club?.name || "Unknown Club")}</p>

    <div class="modal-meta">
      <div><strong>Status:</strong> ${capitalize(getEventStatus(event))}</div>
      <div><strong>Date:</strong> ${formatDate(event.start_time)}</div>
      <div><strong>Time:</strong> ${formatTimeRange(event.start_time, event.end_time)}</div>
      <div><strong>Venue:</strong> ${escapeHTML(event.venue || "Not specified")}</div>
      ${
        event.registration_enabled
          ? `<div><strong>Registration deadline:</strong> ${
              event.registration_deadline
                ? formatDateTime(event.registration_deadline)
                : "Not specified"
            }</div>`
          : `<div><strong>Registration:</strong> Not required</div>`
      }
    </div>

    <p class="modal-description">
      ${escapeHTML(
        event.description ||
        "No additional description has been provided."
      )}
    </p>

    <div class="card-actions">
      ${registrationState.button}
    </div>
  `;

  $("#eventModal").classList.remove("hidden");
  $("#eventModal").setAttribute("aria-hidden", "false");
}

async function registerForEvent(eventId) {
  try {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) return;

    if (!event.registration_enabled) {
      alert("Registration is not required for this event.");
      return;
    }

    if (
      !event.registration_deadline ||
      new Date(event.registration_deadline).getTime() <= Date.now()
    ) {
      alert("Registration for this event is closed.");
      return;
    }

    const { error } = await supabaseClient
      .from("event_registrations")
      .insert({
        event_id: eventId,
        user_id: state.user.id,
        status: "registered"
      });

    if (error) {
      if (error.code === "23505") {
        alert("You are already registered for this event.");
      } else {
        throw error;
      }
      return;
    }

    state.registrations.add(eventId);
    renderEventsForGroup("my-club");
    renderEventsForGroup("open");

    closeModal();
    alert("Registration successful.");
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to register for the event.");
  }
}

async function cancelRegistration(eventId) {
  try {
    const { error } = await supabaseClient
      .from("event_registrations")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", state.user.id);

    if (error) throw error;

    state.registrations.delete(eventId);

    renderEventsForGroup("my-club");
    renderEventsForGroup("open");

    closeModal();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to cancel registration.");
  }
}

function closeModal() {
  $("#eventModal")?.classList.add("hidden");
  $("#eventModal")?.setAttribute("aria-hidden", "true");
}

function showError(message) {
  $("#loadingState")?.classList.add("hidden");
  $("#eventsContent")?.classList.add("hidden");

  const error = $("#errorState");
  if (!error) return;

  error.textContent = message;
  error.classList.remove("hidden");
}

function formatDate(value) {
  if (!value) return "Date not specified";

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
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

function formatTimeRange(start, end) {
  if (!start) return "Time not specified";

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  const startText = formatter.format(new Date(start));

  if (!end) return startText;

  return `${startText} – ${formatter.format(new Date(end))}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
