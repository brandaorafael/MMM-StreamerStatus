/* global Module, Log */

Module.register("MMM-StreamerStatus", {
  defaults: {
    streamers: [],
    // Twitch + Kick poll interval (2 min default)
    updateInterval: 2 * 60 * 1000,
    // YouTube poll interval — keep ≥15 min to avoid hitting quota (10,000 units/day)
    // Each check costs ~101 units per YouTube channel
    youtubeUpdateInterval: 15 * 60 * 1000,
    showOffline: false,
    // "list" = compact table rows | "card" = boxed cards per streamer
    displayStyle: "list",
    twitchClientId: "",
    twitchClientSecret: "",
    kickClientId: "",
    kickClientSecret: "",
    youtubeApiKey: "",
    animationSpeed: 1000,
  },

  // Keyed by "platform:name" for O(1) merging across partial updates
  streamersMap: {},

  lastYoutubeCheck: 0,

  getStyles() {
    return ["font-awesome.css", "MMM-StreamerStatus.css"];
  },

  start() {
    Log.log(`[${this.name}] Starting`);
    this.fetchStreamers();
    setInterval(() => this.fetchStreamers(), this.config.updateInterval);
  },

  fetchStreamers() {
    const now = Date.now();
    const checkYoutube = now - this.lastYoutubeCheck >= this.config.youtubeUpdateInterval;
    if (checkYoutube) this.lastYoutubeCheck = now;

    this.sendSocketNotification("CHECK_STREAMERS", {
      streamers: this.config.streamers,
      checkYoutube,
      twitchClientId: this.config.twitchClientId,
      twitchClientSecret: this.config.twitchClientSecret,
      kickClientId: this.config.kickClientId,
      kickClientSecret: this.config.kickClientSecret,
      youtubeApiKey: this.config.youtubeApiKey,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "STREAMERS_DATA") return;

    // Merge new data into the map; YouTube entries survive partial updates
    for (const streamer of payload.data) {
      this.streamersMap[`${streamer.platform}:${streamer.name}`] = streamer;
    }

    this.updateDom(this.config.animationSpeed);
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-streamer-status";

    // Preserve config order; skip entries not yet fetched
    const all = this.config.streamers
      .map((s) => this.streamersMap[`${s.platform}:${s.name}`])
      .filter(Boolean);

    if (!all.length) {
      wrapper.innerHTML = "<span class='dimmed light small'>Loading...</span>";
      return wrapper;
    }

    const toShow = this.config.showOffline ? all : all.filter((s) => s.live);

    if (!toShow.length) {
      wrapper.innerHTML = "<span class='dimmed light small'>No streamers live</span>";
      return wrapper;
    }

    wrapper.appendChild(
      this.config.displayStyle === "card"
        ? this.buildCards(toShow)
        : this.buildList(toShow)
    );

    return wrapper;
  },

  // ── List View ─────────────────────────────────────────────────────────────

  buildList(streamers) {
    const table = document.createElement("table");
    table.className = "streamer-list small";

    for (const s of streamers) {
      const row = table.insertRow();
      row.className = s.live ? "streamer-live" : "streamer-offline";

      // Platform icon
      const platformCell = row.insertCell();
      platformCell.className = "col-platform";
      platformCell.appendChild(this.platformIcon(s.platform));

      // Live dot
      const dotCell = row.insertCell();
      dotCell.className = "col-dot";
      const dot = document.createElement("span");
      dot.className = `live-dot ${s.live ? "is-live" : "is-offline"}`;
      dotCell.appendChild(dot);

      // Name
      const nameCell = row.insertCell();
      nameCell.className = "col-name bright";
      nameCell.textContent = s.displayName || s.name;

      // Game / category
      const gameCell = row.insertCell();
      gameCell.className = "col-game dimmed";
      gameCell.textContent = s.live ? (s.game || "") : "Offline";

      // Viewers
      const viewersCell = row.insertCell();
      viewersCell.className = "col-viewers dimmed";
      if (s.live && s.viewers != null) {
        viewersCell.textContent = this.formatViewers(s.viewers);
      }
    }

    return table;
  },

  // ── Card View ─────────────────────────────────────────────────────────────

  buildCards(streamers) {
    const grid = document.createElement("div");
    grid.className = "streamer-cards";

    for (const s of streamers) {
      const card = document.createElement("div");
      card.className = `streamer-card platform-${s.platform} ${s.live ? "is-live" : "is-offline"}`;

      // Header: icon + name + LIVE badge
      const header = document.createElement("div");
      header.className = "card-header";

      header.appendChild(this.platformIcon(s.platform));

      const name = document.createElement("span");
      name.className = "card-name bright";
      name.textContent = s.displayName || s.name;
      header.appendChild(name);

      if (s.live) {
        const badge = document.createElement("span");
        badge.className = "live-badge";
        badge.textContent = "LIVE";
        header.appendChild(badge);
      }

      card.appendChild(header);

      // Body
      if (s.live) {
        if (s.game) {
          const game = document.createElement("div");
          game.className = "card-game dimmed small";
          game.textContent = s.game;
          card.appendChild(game);
        }

        if (s.title) {
          const title = document.createElement("div");
          title.className = "card-title xsmall";
          title.textContent = s.title;
          card.appendChild(title);
        }

        if (s.viewers != null) {
          const viewers = document.createElement("div");
          viewers.className = "card-viewers xsmall dimmed";
          viewers.textContent = `${this.formatViewers(s.viewers)} viewers`;
          card.appendChild(viewers);
        }
      } else {
        const offline = document.createElement("div");
        offline.className = "card-offline xsmall dimmed";
        offline.textContent = "Offline";
        card.appendChild(offline);
      }

      grid.appendChild(card);
    }

    return grid;
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  platformIcon(platform) {
    const el = document.createElement("i");

    if (platform === "twitch") {
      el.className = "fa fa-twitch icon-platform icon-twitch";
    } else if (platform === "youtube") {
      el.className = "fa fa-youtube icon-platform icon-youtube";
    } else {
      // Kick has no Font Awesome icon — use a small styled badge
      el.className = "icon-platform icon-kick";
      el.textContent = "K";
    }

    return el;
  },

  formatViewers(count) {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
  },
});
