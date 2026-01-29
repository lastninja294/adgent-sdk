/**
 * Platform Adapter
 * Detects Smart TV platform and normalizes key codes
 */

import {
  Platform,
  KeyAction,
  PlatformCapabilities,
  IPlatformAdapter,
  PlatformKeyMap,
  DeviceInfo,
  DEFAULT_KEY_CODES,
  PLATFORM_DETECTION_PATTERNS
} from '@/types/platform';

/**
 * Platform detection and key code normalization for Smart TV runtimes
 */
export class PlatformAdapter implements IPlatformAdapter {
  public readonly platform: Platform;
  public readonly capabilities: PlatformCapabilities;
  public readonly deviceInfo: DeviceInfo;
  
  private readonly keyMap: PlatformKeyMap;
  private readonly reverseKeyMap: Map<KeyAction, number[]>;

  constructor() {
    this.platform = this.detectPlatform();
    this.keyMap = DEFAULT_KEY_CODES[this.platform];
    this.reverseKeyMap = this.buildReverseKeyMap();
    this.capabilities = this.detectCapabilities();
    this.deviceInfo = this.detectDeviceInfo();
  }

  /**
   * Detect the current Smart TV platform using userAgent and global objects
   */
  private detectPlatform(): Platform {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return Platform.Generic;
    }

    const userAgent = navigator.userAgent;

    const win = window as any;

    if (win.tizen) {
      return Platform.Tizen;
    }

    if (win.webOS || win.PalmSystem) {
      return Platform.WebOS;
    }

    for (const [platform, patterns] of Object.entries(PLATFORM_DETECTION_PATTERNS)) {
      if (platform === Platform.Generic) continue;
      
      for (const pattern of patterns) {
        if (pattern.test(userAgent)) {
          return platform as Platform;
        }
      }
    }

    return Platform.Generic;
  }

  /**
   * Detect platform capabilities
   */
  private detectCapabilities(): PlatformCapabilities {
    const hasNavigator = typeof navigator !== 'undefined';
    const hasDocument = typeof document !== 'undefined';
    const hasWindow = typeof window !== 'undefined';
    
    const baseCapabilities: PlatformCapabilities = {
      sendBeacon: hasNavigator && 'sendBeacon' in navigator,
      fetchKeepalive: typeof fetch !== 'undefined',
      mutedAutoplayRequired: true,
      fullscreen: hasDocument && ('fullscreenEnabled' in document || 'webkitFullscreenEnabled' in document),
      hardwareDecodeInfo: false,
      hdr: false,
      hdr10Plus: false,
      dolbyVision: false,
      dolbyAtmos: false,
      hevc: this.isCodecSupported('video/mp4; codecs="hvc1"'),
      vp9: this.isCodecSupported('video/webm; codecs="vp9"'),
      av1: this.isCodecSupported('video/mp4; codecs="av01.0.05M.08"'),
      maxResolution: this.detectMaxResolution(),
      touch: hasWindow && 'ontouchstart' in window,
      voice: false
    };

    switch (this.platform) {
      case Platform.Tizen:
        return {
          ...baseCapabilities,
          hardwareDecodeInfo: true,
          hdr: true,
          hevc: true,
          voice: true
        };
      
      case Platform.WebOS:
        return {
          ...baseCapabilities,
          hardwareDecodeInfo: true,
          hdr: true,
          dolbyVision: true,
          dolbyAtmos: true,
          hevc: true,
          voice: true
        };
      
      case Platform.FireTV:
        return {
          ...baseCapabilities,
          hdr: true,
          hdr10Plus: true,
          dolbyVision: true,
          hevc: true,
          voice: true
        };
      
      case Platform.Roku:
        return {
          ...baseCapabilities,
          hdr: true,
          dolbyVision: true,
          hevc: true,
          voice: true
        };
      
      case Platform.Xbox:
        return {
          ...baseCapabilities,
          hdr: true,
          dolbyVision: true,
          dolbyAtmos: true,
          hevc: true,
          av1: true,
          voice: true
        };
      
      case Platform.PlayStation:
        return {
          ...baseCapabilities,
          hdr: true,
          hevc: true
        };
      
      case Platform.AndroidTV:
        return {
          ...baseCapabilities,
          hdr: true,
          dolbyVision: true,
          hevc: true,
          vp9: true,
          voice: true
        };
      
      default:
        return baseCapabilities;
    }
  }

  /**
   * Detect device information
   */
  private detectDeviceInfo(): DeviceInfo {
    const info: DeviceInfo = {
      platform: this.platform
    };

    if (typeof window !== 'undefined') {
      info.screenWidth = window.screen?.width;
      info.screenHeight = window.screen?.height;
      info.devicePixelRatio = window.devicePixelRatio;
    }

    // Platform-specific device info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    if (this.platform === Platform.Tizen && win.tizen?.systeminfo) {
      try {
        win.tizen.systeminfo.getPropertyValue('BUILD', (build: { model?: string; manufacturer?: string }) => {
          info.model = build.model;
          info.manufacturer = build.manufacturer || 'Samsung';
        });
      } catch {
        info.manufacturer = 'Samsung';
      }
    }

    if (this.platform === Platform.WebOS && win.webOSSystem) {
      try {
        const deviceInfo = win.webOSSystem.deviceInfo;
        info.model = deviceInfo?.modelName;
        info.manufacturer = 'LG';
        info.osVersion = deviceInfo?.version;
      } catch {
        info.manufacturer = 'LG';
      }
    }

    return info;
  }

  /**
   * Detect maximum supported resolution
   */
  private detectMaxResolution(): '4k' | '1080p' | '720p' | 'unknown' {
    if (typeof window === 'undefined') return 'unknown';

    const width = window.screen?.width || 0;
    const height = window.screen?.height || 0;
    const maxDimension = Math.max(width, height);

    if (maxDimension >= 3840) return '4k';
    if (maxDimension >= 1920) return '1080p';
    if (maxDimension >= 1280) return '720p';
    
    return 'unknown';
  }

  /**
   * Build reverse mapping from KeyAction to key codes
   */
  private buildReverseKeyMap(): Map<KeyAction, number[]> {
    const map = new Map<KeyAction, number[]>();
    
    for (const [code, action] of Object.entries(this.keyMap)) {
      const keyCode = parseInt(code, 10);
      const existing = map.get(action) || [];
      existing.push(keyCode);
      map.set(action, existing);
    }
    
    return map;
  }

  /**
   * Normalize a raw key code to a KeyAction
   * @param keyCode - Raw keyboard/remote key code
   * @returns KeyAction or null if not mapped
   */
  normalizeKeyCode(keyCode: number): KeyAction | null {
    return this.keyMap[keyCode] ?? null;
  }

  /**
   * Get all key codes that map to a specific action
   * @param action - The key action
   * @returns Array of key codes
   */
  getKeyCodesForAction(action: KeyAction): number[] {
    return this.reverseKeyMap.get(action) || [];
  }

  /**
   * Check if a specific codec is supported
   * @param codec - MIME type with codec string
   * @returns true if codec is supported
   */
  isCodecSupported(codec: string): boolean {
    if (typeof document === 'undefined') return false;

    try {
      const video = document.createElement('video');
      const support = video.canPlayType(codec);
      return support === 'probably' || support === 'maybe';
    } catch {
      return false;
    }
  }

  /**
   * Register Tizen-specific key handlers
   * Must be called for Tizen apps to receive media keys
   */
  registerTizenKeys(): void {
    if (this.platform !== Platform.Tizen) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tizen = (window as any).tizen;
    if (tizen?.tvinputdevice) {
      const keys = [
        'MediaPlay',
        'MediaPause',
        'MediaStop',
        'MediaFastForward',
        'MediaRewind',
        'MediaPlayPause',
        'ColorF0Red',
        'ColorF1Green',
        'ColorF2Yellow',
        'ColorF3Blue',
        'Info'
      ];
      keys.forEach((key) => {
        try {
          tizen.tvinputdevice.registerKey(key);
        } catch {
          // Key may already be registered
        }
      });
    }
  }

  /**
   * Register WebOS-specific key handlers
   */
  registerWebOSKeys(): void {
    if (this.platform !== Platform.WebOS) return;

    // WebOS handles most keys automatically
    // This is a placeholder for any custom key registration
  }

  /**
   * Get platform-specific video element attributes
   * @returns Object of attributes to set on video element
   */
  getVideoAttributes(): Record<string, string | boolean> {
    const attrs: Record<string, string | boolean> = {
      muted: true,
      playsinline: true,
      autoplay: true,
      'webkit-playsinline': true
    };

    // Platform-specific attributes
    switch (this.platform) {
      case Platform.Tizen:
        attrs['data-samsung-immersive'] = 'true';
        break;
      
      case Platform.WebOS:
        attrs['data-lg-immersive'] = 'true';
        break;
      
      case Platform.FireTV:
      case Platform.AndroidTV:
        // Android-based platforms may need specific attributes
        attrs['x-webkit-airplay'] = 'allow';
        break;
    }

    return attrs;
  }

  /**
   * Get recommended video settings for this platform
   */
  getRecommendedVideoSettings(): {
    maxBitrate: number;
    preferredCodec: string;
    maxResolution: string;
  } {
    switch (this.platform) {
      case Platform.Tizen:
      case Platform.WebOS:
        return {
          maxBitrate: 15000, // 15 Mbps for high-end TVs
          preferredCodec: 'hevc',
          maxResolution: '4k'
        };
      
      case Platform.FireTV:
        return {
          maxBitrate: 10000, // 10 Mbps
          preferredCodec: 'hevc',
          maxResolution: '4k'
        };
      
      case Platform.Roku:
        return {
          maxBitrate: 8000, // 8 Mbps
          preferredCodec: 'h264', // Roku has variable HEVC support
          maxResolution: '4k'
        };
      
      case Platform.Xbox:
      case Platform.PlayStation:
        return {
          maxBitrate: 20000, // 20 Mbps for game consoles
          preferredCodec: 'hevc',
          maxResolution: '4k'
        };
      
      default:
        return {
          maxBitrate: 5000, // 5 Mbps safe default
          preferredCodec: 'h264',
          maxResolution: '1080p'
        };
    }
  }

  /**
   * Open an external link in a new tab/window
   * Safe to call on all platforms (will just log on non-web)
   */
  openExternalLink(url: string): void {
    if (typeof window === 'undefined') {
      this.debug(`[Adgent] Cannot open link (server-side): ${url}`);
      return;
    }

    if (this.platform !== Platform.Generic && this.platform !== Platform.Tizen && this.platform !== Platform.WebOS) {
          // Most Smart TV platforms don't support opening browsers from apps
          this.debug(`[Adgent] Opening external links not supported on ${this.platform}: ${url}`);
          return;
    }

    try {
      const win = window as any;
      win.open(url, '_blank');
      this.debug(`[Adgent] Opened external link: ${url}`);
    } catch (error) {
      this.debug(`[Adgent] Failed to open external link: ${error}`);
    }
  }

  /**
   * Show debug message using platform-specific native notifications
   * Falls back to console.log
   */
  debug(message: string): void {
    console.log(`[Adgent] ${message}`);

    if (this.platform === Platform.WebOS && typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      if (win.webOS && win.webOS.service) {
        win.webOS.service.request('luna://com.webos.notification', {
          method: 'createToast',
          parameters: {
            message: `[Adgent] ${message}`
          },
          onSuccess: () => {},
          onFailure: () => {}
        });
      }
    }
  }
}

// Singleton instance
let platformAdapterInstance: PlatformAdapter | null = null;

/**
 * Get or create the platform adapter singleton
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (!platformAdapterInstance) {
    platformAdapterInstance = new PlatformAdapter();
  }
  return platformAdapterInstance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetPlatformAdapter(): void {
  platformAdapterInstance = null;
}
