/**
 * adgent-sdk
 * Lightweight VAST Player SDK for Smart TV Platforms
 *
 * @example
 * ```typescript
 * import { AdgentSDK } from 'adgent-sdk';
 *
 * const sdk = new AdgentSDK({
 *   container: document.getElementById('ad-container')!,
 *   vastUrl: 'https://example.com/vast.xml',
 *   targetBitrate: 2500, // Prefer 1080p
 *   onComplete: () => console.log('Ad finished'),
 *   onError: (err) => console.error('Ad error:', err),
 * });
 *
 * sdk.init();
 * ```
 */

// Core exports
export { AdPlayer, AdgentSDK } from '@/core/AdPlayer';
export { VASTParser } from '@/core/VASTParser';
export { AdTracker } from '@/core/AdTracker';
export { PlatformAdapter, getPlatformAdapter } from '@/core/PlatformAdapter';

// Type exports
export type {
  // VAST types
  VASTResponse,
  Ad,
  InLine,
  Wrapper,
  Creative,
  Linear,
  MediaFile,
  TrackingEvent,
  TrackingEventType,
  Impression,
  VideoClicks,
  ClickThrough,
  NonLinearAd,
  CompanionAd,
  Icon
} from '@/types/vast';

export { VASTErrorCode } from '@/types/vast';

export type {
  // Player types
  AdPlayerConfig,
  AdPlayerState,
  AdPlayerEvent,
  AdPlayerEventListener,
  AdProgress,
  AdError
} from '@/types/player';

export { PlaybackStatus } from '@/types/player';

export type {
  // Platform types
  PlatformCapabilities,
  PlatformKeyMap,
  IPlatformAdapter,
  DeviceInfo
} from '@/types/platform';

export { 
  Platform, 
  KeyAction, 
  DEFAULT_KEY_CODES,
  PLATFORM_DETECTION_PATTERNS 
} from '@/types/platform';

// Utility exports
export { replaceMacros } from '@/utils/macros';
export type { MacroContext, VastMacro } from '@/utils/macros';
