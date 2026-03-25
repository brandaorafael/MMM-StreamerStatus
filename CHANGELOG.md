# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] – 2026-03-24

### Added
- Pulse animation on the live indicator dot
- Card hover effect (subtle background lift)
- Input validation: unknown `platform` values are warned and skipped
- Input validation: YouTube streamers missing `channelId` are warned and skipped
- Rate-limit (HTTP 429) handling on Twitch, Kick, and YouTube — falls back to offline gracefully instead of throwing
- Kick batch requests capped at 50 slugs per call (API limit)
- `.gitignore`, `LICENSE`, `CHANGELOG.md`
- Quick credential reference table in README
- Troubleshooting section in README

### Changed
- Credentials are stored in the node helper on first receipt instead of being re-read from every socket notification
- `package.json` filled out with `main`, `author`, `repository`, `bugs`, `homepage`, and `keywords`
- Kick now uses the official `api.kick.com` public API instead of the unofficial `kick.com/api/v2` endpoint

### Fixed
- Kick live status now correctly detected using the `slug` query parameter (the unofficial API was returning 403)

## [1.0.0] – 2026-03-24

### Added
- Initial release
- Live streamer status for Twitch, Kick, and YouTube
- List and card display styles
- Per-platform OAuth2 token caching with automatic refresh
- Configurable poll intervals with YouTube quota-aware separate interval
- Viewer count, game/category, and stream title display
