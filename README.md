# Adgent SDK

<div align="center">

[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![VAST 4.x](https://img.shields.io/badge/VAST-4.x-green.svg)](https://www.iab.com/guidelines/vast/)
[![Size](https://img.shields.io/badge/Size-<20KB-blueviolet.svg)](#performance)

</div>

Lightweight, framework-agnostic VAST Player SDK for Smart TV platforms.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Basic Setup](#basic-setup)
  - [Event Handling](#event-handling)
  - [Platform Detection](#platform-detection)
- [API Reference](#api-reference)
  - [AdgentSDK Class](#adgetsdk-class)
  - [Configuration Options](#configuration-options)
  - [Events](#events)
- [Platform Support](#platform-support)
- [Performance](#performance)
- [Development](#development)
- [License](#license)

---

## Overview

Adgent SDK is a high-performance, lightweight VAST (Video Ad Serving Template) player SDK designed specifically for Smart TV platforms. It provides a robust foundation for displaying video advertisements with full VAST 4.x compliance while maintaining minimal footprint.

### Why Adgent SDK?

- **Zero Framework Dependencies**: Works with any JavaScript/TypeScript project
- **Smart TV Optimized**: Purpose-built for WebOS, Tizen, Vidaa, and WhaleOS
- **Production Ready**: Battle-tested error handling and recovery mechanisms
- **Type-Safe**: Full TypeScript support with typed APIs

---

## Features

| Feature | Description |
|---------|-------------|
| **VAST 4.x Compliance** | Full wrapper resolution, tracking events, and smart media file selection |
| **Multi-Platform** | Native adapters for WebOS, Tizen, Vidaa, WhaleOS, and generic web environments |
| **Minimal Footprint** | Target size under 20KB gzipped, single dependency (`fast-xml-parser`) |
| **Fault Tolerant** | Nuclear Mute autoplay strategy with soft-fail recovery mechanisms |
| **Remote Control Ready** | Built-in focus management and key code normalization |
| **Event Driven** | Comprehensive event system for granular ad playback control |

---

## Quick Start

Get up and running in 3 simple steps:

```bash
# 1. Install the SDK
npm install adgent-sdk

# 2. Import and initialize
import { AdgentSDK } from 'adgent-sdk';

const sdk = new AdgentSDK({
  container: document.getElementById('ad-container'),
  vastUrl: 'https://example.com/vast.xml',
});

await sdk.init();

# 3. Start ad playback
await sdk.play();
```

---

## Installation

### NPM

```bash
npm install adgent-sdk
```

### Yarn

```bash
yarn add adgent-sdk
```

### CDN

```html
<script src="https://cdn.example.com/adgent-sdk.min.js"></script>
```

---

## Configuration

### Configuration Options

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `container` | `HTMLElement` | Yes | - | Container element for the ad player |
| `vastUrl` | `string` | Yes | - | VAST tag URL to fetch ad data |
| `targetBitrate` | `number` | No | `2500` | Preferred bitrate in kbps (2500 ≈ 1080p) |
| `maxWrapperDepth` | `number` | No | `5` | Maximum VAST wrapper chain depth |
| `timeout` | `number` | No | `10000` | Request timeout in milliseconds |
| `debug` | `boolean` | No | `false` | Enable debug logging for development |
| `skipOffset` | `number` | No | - | Override skip offset in seconds |
| `skipButtonText` | `string` | No | `'Skip Ad'` | Custom skip button text |
| `mutedAutoplay` | `boolean` | No | `true` | Enable muted autoplay for compliance |

### Callback Events

| Callback | Type | Description |
|----------|------|-------------|
| `onStart` | `() => void` | Triggered when ad starts playing |
| `onProgress` | `(progress: AdProgress) => void` | Periodic progress updates |
| `onComplete` | `() => void` | Triggered when ad finishes normally |
| `onSkip` | `() => void` | Triggered when user skips the ad |
| `onError` | `(error: AdError) => void` | Triggered on any ad-related error |
| `onPause` | `() => void` | Triggered when ad is paused |
| `onResume` | `() => void` | Triggered when ad resumes from pause |
| `onClick` | `(url: string) => void` | Triggered when user clicks the ad |

---

## Usage

### Basic Setup

```typescript
import { AdgentSDK } from 'adgent-sdk';

// Initialize the SDK
const sdk = new AdgentSDK({
  container: document.getElementById('ad-container')!,
  vastUrl: 'https://example.com/vast.xml',
  targetBitrate: 2500,
  mutedAutoplay: true,
  skipButtonText: 'Skip in 5s',
  onStart: () => {
    console.log('Ad playback started');
  },
  onComplete: () => {
    console.log('Ad completed successfully');
    // Resume main content playback
  },
  onError: (err) => {
    console.error('Ad error:', err);
    // Graceful fallback - resume main content
  },
  onSkip: () => {
    console.log('User skipped the ad');
  }
});

// Initialize and prepare
await sdk.init();

// Play the ad
await sdk.play();
```

### Event Handling

#### Using Callbacks

```typescript
const sdk = new AdgentSDK({
  container: document.getElementById('ad-container')!,
  vastUrl: 'https://example.com/vast.xml',
  onStart: () => console.log('Ad started'),
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percent}%`);
    console.log(`Current time: ${progress.currentTime}s`);
    console.log(`Duration: ${progress.duration}s`);
  },
  onComplete: () => console.log('Ad completed'),
  onSkip: () => console.log('Ad skipped'),
  onPause: () => console.log('Ad paused'),
  onResume: () => console.log('Ad resumed'),
  onClick: (url) => {
    console.log(`Clicked: ${url}`);
    window.open(url, '_blank');
  },
  onError: (error) => {
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
  }
});
```

#### Using Event Listener API

```typescript
// Subscribe to events
const unsubscribe = sdk.on((event) => {
  switch (event.type) {
    case 'start':
      console.log('Ad playback started');
      break;
    case 'quartile':
      console.log(`Quartile reached: ${event.data.quartile}`);
      console.log(`Progress: ${event.data.percent}%`);
      break;
    case 'complete':
      console.log('Ad completed successfully');
      break;
    case 'skip':
      console.log('User skipped the ad');
      break;
    case 'error':
      console.error('Ad error:', event.data);
      break;
    case 'click':
      console.log('Ad clicked, URL:', event.data.url);
      break;
  }
});

// Unsubscribe when done
unsubscribe();
```

#### Event Types

| Event Type | Data | Description |
|------------|------|-------------|
| `start` | `{ timestamp: number }` | Ad started playing |
| `quartile` | `{ quartile: number, percent: number }` | Quartile milestone reached (25, 50, 75, 100) |
| `complete` | `{ timestamp: number }` | Ad finished successfully |
| `skip` | `{ timestamp: number }` | User skipped the ad |
| `error` | `{ code: number, message: string }` | An error occurred |
| `click` | `{ url: string }` | User clicked the ad |
| `pause` | `{ timestamp: number }` | Ad was paused |
| `resume` | `{ timestamp: number }` | Ad resumed from pause |

### Platform Detection

```typescript
import { getPlatformAdapter, Platform } from 'adgent-sdk';

// Get platform-specific adapter
const adapter = getPlatformAdapter();

console.log('Platform:', adapter.platform);
// Output: 'tizen' | 'webos' | 'vidaa' | 'whaleos' | 'generic'

// Check platform capabilities
if (adapter.capabilities.sendBeacon) {
  console.log('Beacon API available for tracking');
}

if (adapter.capabilities.hdr) {
  console.log('HDR playback supported');
}

// Access platform-specific utilities
adapter.utils.normalizeKeyCode('ArrowRight'); // Returns platform-specific key code
adapter.utils.focusElement(element);
```

---

## API Reference

### AdgentSDK Class

#### Constructor

```typescript
new AdgentSDK(config: AdgentConfig): AdgentSDK
```

Creates a new AdgentSDK instance with the specified configuration.

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `init()` | `Promise<void>` | Initializes SDK, fetches VAST, prepares player |
| `play()` | `Promise<void>` | Starts ad playback |
| `pause()` | `Promise<void>` | Pauses ad playback |
| `resume()` | `Promise<void>` | Resumes ad playback |
| `stop()` | `Promise<void>` | Stops ad playback |
| `skip()` | `Promise<void>` | Skips the current ad |
| `destroy()` | `Promise<void>` | Cleans up resources, removes event listeners |
| `on(callback)` | `UnsubscribeFn` | Subscribe to ad events |
| `getState()` | `AdState` | Get current ad playback state |

#### Usage Example

```typescript
const sdk = new AdgentSDK({
  container: document.getElementById('ad-container')!,
  vastUrl: 'https://example.com/vast.xml',
});

// Initialize
await sdk.init();

// Play
await sdk.play();

// Pause after 5 seconds
setTimeout(() => {
  await sdk.pause();
  
  // Resume after 2 seconds
  setTimeout(() => {
    sdk.resume();
  }, 2000);
}, 5000);

// Cleanup when done
sdk.destroy();
```

---

## Platform Support

### Supported Platforms

| Platform | Version | Status |
|----------|---------|--------|
| **WebOS** | 3.0+ | ✅ Fully Supported |
| **Tizen** | 4.0+ | ✅ Fully Supported |
| **Vidaa** | 2.0+ | ✅ Fully Supported |
| **WhaleOS** | 1.0+ | ✅ Fully Supported |
| **Generic Web** | Modern browsers | ✅ Fully Supported |

### Platform-Specific Features

#### WebOS
- Native video player integration
- LG remote control support
- WebOS specific tracking endpoints

#### Tizen
- Tizen TV Player API
- Samsung remote control mapping
- Tizen analytics integration

#### Vidaa
- HisenseVidaa OS support
- Vidaa remote control codes
- Lightweight implementation

#### WhaleOS
- Naver Whale browser support
- Whale-specific optimizations

---

## Performance

### Size Comparison

| Metric | Value |
|--------|-------|
| Gzipped Size | < 20 KB |
| Minified Size | ~50 KB |
| Dependencies | 1 (`fast-xml-parser`) |

### Optimization Tips

1. **Enable Tree Shaking**: Use ES modules for optimal bundle size
2. **Lazy Load**: Only load SDK when ad playback is needed
3. **VAST Caching**: Cache VAST responses to reduce network requests
4. **Bitrate Selection**: Set appropriate `targetBitrate` for your platform

```typescript
// Example: Optimized configuration
const sdk = new AdgentSDK({
  container: document.getElementById('ad-container')!,
  vastUrl: cachedVastUrl, // Use cached VAST when available
  targetBitrate: 1500, // Appropriate for most Smart TVs
  timeout: 5000, // Faster timeout for better UX
});
```

---

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/adgent-sdk.git

# Navigate to project directory
cd adgent-sdk

# Install dependencies
npm install

# Install dev dependencies
npm run install:dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build the library for production |
| `npm run build:watch` | Build in watch mode for development |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Lint the codebase |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run dev` | Start development server |
| `npm run docs` | Generate documentation |

### Project Structure

```
adgent-sdk/
├── src/
│   ├── core/           # Core SDK functionality
│   ├── adapters/       # Platform-specific adapters
│   ├── utils/          # Utility functions
│   ├── types/          # TypeScript type definitions
│   └── index.ts        # Main entry point
├── test/               # Test files
├── dist/               # Built output
├── docs/               # Documentation
└── package.json
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

Proprietary - All rights reserved.

This software and its source code are the exclusive property of the copyright holder. No part of this software may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without the prior written permission of the copyright holder, except in the case of brief quotations embodied in critical reviews and certain other non-commercial uses permitted by copyright law.

For licensing inquiries, please contact: license@example.com
# adgent-sdk
