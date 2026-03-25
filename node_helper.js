"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");

const VALID_PLATFORMS = new Set(["twitch", "kick", "youtube"]);
const KICK_BATCH_SIZE = 50;

module.exports = NodeHelper.create({
  twitchToken: null,
  twitchTokenExpiry: 0,

  kickToken: null,
  kickTokenExpiry: 0,

  // Credentials stored on first socket notification; never change at runtime
  twitchClientId: "",
  twitchClientSecret: "",
  kickClientId: "",
  kickClientSecret: "",
  youtubeApiKey: "",

  start() {
    Log.log("[MMM-StreamerStatus] Node helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "CHECK_STREAMERS") {
      this.checkStreamers(payload).catch((err) => {
        Log.error("[MMM-StreamerStatus] checkStreamers error:", err);
      });
    }
  },

  async checkStreamers(payload) {
    // Store credentials on first receipt (they don't change at runtime)
    if (payload.twitchClientId)     this.twitchClientId     = payload.twitchClientId;
    if (payload.twitchClientSecret) this.twitchClientSecret = payload.twitchClientSecret;
    if (payload.kickClientId)       this.kickClientId       = payload.kickClientId;
    if (payload.kickClientSecret)   this.kickClientSecret   = payload.kickClientSecret;
    if (payload.youtubeApiKey)      this.youtubeApiKey      = payload.youtubeApiKey;

    const { streamers, checkYoutube } = payload;

    // Validate each streamer entry before processing
    const validStreamers = [];
    for (const s of streamers) {
      if (!VALID_PLATFORMS.has(s.platform)) {
        Log.warn(`[MMM-StreamerStatus] Unknown platform "${s.platform}" for streamer "${s.name}" — skipping`);
        continue;
      }
      if (s.platform === "youtube" && !s.channelId) {
        Log.warn(`[MMM-StreamerStatus] YouTube streamer "${s.name}" is missing channelId — skipping`);
        continue;
      }
      validStreamers.push(s);
    }

    const twitchStreamers  = validStreamers.filter((s) => s.platform === "twitch");
    const kickStreamers    = validStreamers.filter((s) => s.platform === "kick");
    const youtubeStreamers = validStreamers.filter((s) => s.platform === "youtube");

    const fetches = [
      this.fetchTwitch(twitchStreamers),
      this.fetchKick(kickStreamers),
    ];

    if (checkYoutube) {
      fetches.push(this.fetchYoutube(youtubeStreamers));
    }

    const [twitchResult, kickResult, youtubeResult] = await Promise.allSettled(fetches);

    const data = [
      ...(twitchResult.status === "fulfilled" ? twitchResult.value : this.makeOffline(twitchStreamers, "twitch")),
      ...(kickResult.status === "fulfilled"   ? kickResult.value   : this.makeOffline(kickStreamers, "kick")),
    ];

    if (checkYoutube) {
      data.push(...(youtubeResult.status === "fulfilled" ? youtubeResult.value : this.makeOffline(youtubeStreamers, "youtube")));
    }

    this.sendSocketNotification("STREAMERS_DATA", { data, partial: !checkYoutube });
  },

  makeOffline(streamers, platform) {
    return streamers.map((s) => ({ name: s.name, displayName: s.name, platform, live: false }));
  },

  // ── Twitch ────────────────────────────────────────────────────────────────

  async getTwitchToken() {
    if (this.twitchToken && Date.now() < this.twitchTokenExpiry) {
      return this.twitchToken;
    }

    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${this.twitchClientId}&client_secret=${this.twitchClientSecret}&grant_type=client_credentials`,
      { method: "POST" }
    );

    if (res.status === 429) throw new Error("Twitch token request rate-limited (429)");
    if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);

    const json = await res.json();
    this.twitchToken = json.access_token;
    this.twitchTokenExpiry = Date.now() + (json.expires_in - 300) * 1000;
    return this.twitchToken;
  },

  async fetchTwitch(streamers) {
    if (!streamers.length) return [];

    if (!this.twitchClientId || !this.twitchClientSecret) {
      Log.warn("[MMM-StreamerStatus] Twitch credentials not set — skipping Twitch");
      return this.makeOffline(streamers, "twitch");
    }

    const token = await this.getTwitchToken();
    const query = streamers.map((s) => `user_login=${encodeURIComponent(s.name)}`).join("&");

    const res = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
      headers: {
        "Client-ID": this.twitchClientId,
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 429) {
      Log.warn("[MMM-StreamerStatus] Twitch rate limit hit (429) — skipping this cycle");
      return this.makeOffline(streamers, "twitch");
    }
    if (!res.ok) throw new Error(`Twitch streams request failed: ${res.status}`);

    const { data: liveStreams } = await res.json();

    const liveMap = {};
    for (const s of liveStreams) {
      liveMap[s.user_login.toLowerCase()] = s;
    }

    return streamers.map((s) => {
      const stream = liveMap[s.name.toLowerCase()];
      if (stream) {
        return {
          name: s.name,
          displayName: stream.user_name,
          platform: "twitch",
          live: true,
          title: stream.title,
          game: stream.game_name || null,
          viewers: stream.viewer_count,
          url: `https://twitch.tv/${stream.user_login}`,
        };
      }
      return { name: s.name, displayName: s.name, platform: "twitch", live: false };
    });
  },

  // ── Kick ──────────────────────────────────────────────────────────────────

  async getKickToken() {
    if (this.kickToken && Date.now() < this.kickTokenExpiry) {
      return this.kickToken;
    }

    const res = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.kickClientId,
        client_secret: this.kickClientSecret,
      }),
    });

    if (res.status === 429) throw new Error("Kick token request rate-limited (429)");
    if (!res.ok) throw new Error(`Kick token request failed: ${res.status}`);

    const json = await res.json();
    this.kickToken = json.access_token;
    this.kickTokenExpiry = Date.now() + (json.expires_in - 300) * 1000;
    return this.kickToken;
  },

  async fetchKick(streamers) {
    if (!streamers.length) return [];

    if (!this.kickClientId || !this.kickClientSecret) {
      Log.warn("[MMM-StreamerStatus] Kick credentials not set — skipping Kick");
      return this.makeOffline(streamers, "kick");
    }

    const token = await this.getKickToken();
    const channels = [];

    // Kick API supports up to 50 slugs per request
    for (let i = 0; i < streamers.length; i += KICK_BATCH_SIZE) {
      const batch = streamers.slice(i, i + KICK_BATCH_SIZE);
      const query = batch.map((s) => `slug=${encodeURIComponent(s.name)}`).join("&");

      const res = await fetch(`https://api.kick.com/public/v1/channels?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        Log.warn("[MMM-StreamerStatus] Kick rate limit hit (429) — skipping this batch");
        continue;
      }
      if (!res.ok) throw new Error(`Kick channels request failed: ${res.status}`);

      const { data } = await res.json();
      channels.push(...data);
    }

    const channelMap = {};
    for (const ch of channels) {
      channelMap[ch.slug.toLowerCase()] = ch;
    }

    return streamers.map((s) => {
      const ch = channelMap[s.name.toLowerCase()];

      if (ch?.stream?.is_live) {
        return {
          name: s.name,
          displayName: ch.slug,
          platform: "kick",
          live: true,
          title: ch.stream_title || null,
          game: ch.category?.name || null,
          viewers: ch.stream.viewer_count ?? null,
          url: `https://kick.com/${ch.slug}`,
        };
      }

      return { name: s.name, displayName: ch?.slug || s.name, platform: "kick", live: false };
    });
  },

  // ── YouTube ───────────────────────────────────────────────────────────────

  async fetchYoutube(streamers) {
    if (!streamers.length) return [];

    if (!this.youtubeApiKey) {
      Log.warn("[MMM-StreamerStatus] YouTube API key not set — skipping YouTube");
      return this.makeOffline(streamers, "youtube");
    }

    const results = await Promise.allSettled(streamers.map((s) => this.fetchYoutubeChannel(s)));

    return results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      Log.error(`[MMM-StreamerStatus] YouTube error for ${streamers[i].name}:`, result.reason);
      return { name: streamers[i].name, displayName: streamers[i].name, platform: "youtube", live: false };
    });
  },

  async fetchYoutubeChannel(streamer) {
    // Search for active live stream on channel (costs 100 quota units)
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${streamer.channelId}&eventType=live&type=video&key=${this.youtubeApiKey}`
    );

    if (searchRes.status === 429) throw new Error("YouTube quota exhausted (429) — increase youtubeUpdateInterval");
    if (!searchRes.ok) throw new Error(`YouTube search failed: ${searchRes.status}`);

    const searchData = await searchRes.json();
    const items = searchData.items || [];

    if (!items.length) {
      return { name: streamer.name, displayName: streamer.name, platform: "youtube", live: false };
    }

    const videoId = items[0].id.videoId;
    const channelTitle = items[0].snippet.channelTitle;
    const title = items[0].snippet.title;

    // Fetch concurrent viewer count (costs 1 quota unit)
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${this.youtubeApiKey}`
    );
    const videoData = await videoRes.json();
    const viewers = parseInt(videoData.items?.[0]?.liveStreamingDetails?.concurrentViewers ?? "0", 10) || null;

    return {
      name: streamer.name,
      displayName: channelTitle,
      platform: "youtube",
      live: true,
      title,
      game: null,
      viewers,
      url: `https://youtube.com/watch?v=${videoId}`,
    };
  },
});
