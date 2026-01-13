# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-01-13

### Added

- **VASTParser**: VAST 4.x compliant XML parser with recursive wrapper resolution
  - Configurable wrapper depth limit (default: 5)
  - Media file selection prioritizing 1080p/720p over 4K
  - Automatic tracking event aggregation from wrapper chains
  - Duration parsing (HH:MM:SS.mmm and percentage formats)

- **AdTracker**: Fire-and-forget pixel tracking
  - `navigator.sendBeacon` with `fetch(keepalive)` and Image fallback
  - VAST macro replacement: `[TIMESTAMP]`, `[CACHEBUSTING]`, `[ADPLAYHEAD]`, etc.
  - Event deduplication to prevent duplicate tracking

- **AdPlayer**: Core video ad player with Smart TV optimizations
  - "Nuclear Mute" strategy: `muted`, `playsinline`, `autoplay` attributes
  - Soft-fail autoplay: graceful fallback to interactive "Start Ad" overlay
  - Focus management: captures remote control keys during ad playback
  - Quartile tracking: `start`, `firstQuartile`, `midpoint`, `thirdQuartile`, `complete`
  - Skip functionality with countdown timer

- **PlatformAdapter**: Smart TV platform detection and normalization
  - Platform detection: WebOS, Tizen, Vidaa, WhaleOS, Generic
  - Remote control key code normalization
  - Capability detection: sendBeacon, fetch keepalive, fullscreen

- **TypeScript Types**: Full VAST 4.x type definitions
  - `VASTResponse`, `Ad`, `Creative`, `Linear`, `MediaFile`, `TrackingEvent`
  - Player configuration and state types
  - Platform capability and key mapping types

### Technical Details

- **Bundle Size**: ESM 9.3KB gzipped, UMD 7.3KB gzipped
- **Dependencies**: `fast-xml-parser` only
- **Target**: ES2020 for Smart TV runtime compatibility
- **Output**: ESM + UMD with TypeScript declarations

[Unreleased]: https://github.com/user/adgent-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/user/adgent-sdk/releases/tag/v0.1.0
