/**
 * Platform Detection Types
 * For Smart TV web runtimes (WebOS, Tizen, Vidaa, WhaleOS) and streaming devices
 */

/** Supported Smart TV platforms */
export enum Platform {
  WebOS = 'webos',
  Tizen = 'tizen',
  Vidaa = 'vidaa',
  WhaleOS = 'whaleos',
  FireTV = 'firetv',
  Roku = 'roku',
  Xbox = 'xbox',
  PlayStation = 'playstation',
  AndroidTV = 'androidtv',
  Vizio = 'vizio',
  Generic = 'generic'
}

/** Remote control key actions */
export enum KeyAction {
  Enter = 'enter',
  Back = 'back',
  Left = 'left',
  Right = 'right',
  Up = 'up',
  Down = 'down',
  Play = 'play',
  Pause = 'pause',
  PlayPause = 'playPause',
  Stop = 'stop',
  FastForward = 'fastForward',
  Rewind = 'rewind',
  Menu = 'menu',
  Info = 'info',
  Red = 'red',
  Green = 'green',
  Yellow = 'yellow',
  Blue = 'blue',
  ChannelUp = 'channelUp',
  ChannelDown = 'channelDown',
  VolumeUp = 'volumeUp',
  VolumeDown = 'volumeDown',
  Mute = 'mute'
}

/** Platform-specific key code mapping */
export interface PlatformKeyMap {
  [keyCode: number]: KeyAction;
}

/** Platform capability flags */
export interface PlatformCapabilities {
  /** Supports sendBeacon API */
  sendBeacon: boolean;
  /** Supports fetch with keepalive */
  fetchKeepalive: boolean;
  /** Requires muted autoplay */
  mutedAutoplayRequired: boolean;
  /** Supports fullscreen API */
  fullscreen: boolean;
  /** Supports hardware video decode info */
  hardwareDecodeInfo: boolean;
  /** Supports HDR playback */
  hdr: boolean;
  /** Supports HDR10+ */
  hdr10Plus: boolean;
  /** Supports Dolby Vision */
  dolbyVision: boolean;
  /** Supports Dolby Atmos */
  dolbyAtmos: boolean;
  /** Supports HEVC/H.265 */
  hevc: boolean;
  /** Supports VP9 */
  vp9: boolean;
  /** Supports AV1 */
  av1: boolean;
  /** Maximum supported resolution */
  maxResolution: '4k' | '1080p' | '720p' | 'unknown';
  /** Device has touch support */
  touch: boolean;
  /** Device has voice control */
  voice: boolean;
}

/** Device info */
export interface DeviceInfo {
  platform: Platform;
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  firmwareVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  devicePixelRatio?: number;
}

/** Platform adapter interface */
export interface IPlatformAdapter {
  /** Current detected platform */
  readonly platform: Platform;
  
  /** Platform capabilities */
  readonly capabilities: PlatformCapabilities;
  
  /** Device information */
  readonly deviceInfo: DeviceInfo;
  
  /**
   * Normalize a raw key code to a KeyAction
   * @param keyCode - Raw keyboard/remote key code
   */
  normalizeKeyCode(keyCode: number): KeyAction | null;
  
  /**
   * Get platform-specific key codes for an action
   * @param action - The key action to get codes for
   */
  getKeyCodesForAction(action: KeyAction): number[];
  
  /**
   * Check if a specific codec is supported
   * @param codec - MIME type with codec (e.g., 'video/mp4; codecs="hvc1"')
   */
  isCodecSupported(codec: string): boolean;
}

/** Default key codes (varies by platform) */
export const DEFAULT_KEY_CODES: Record<Platform, PlatformKeyMap> = {
  [Platform.WebOS]: {
    13: KeyAction.Enter,
    461: KeyAction.Back, // WebOS specific
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    415: KeyAction.Play,
    19: KeyAction.Pause,
    413: KeyAction.Stop,
    417: KeyAction.FastForward,
    412: KeyAction.Rewind,
    457: KeyAction.Info,
    403: KeyAction.Red,
    404: KeyAction.Green,
    405: KeyAction.Yellow,
    406: KeyAction.Blue,
    33: KeyAction.ChannelUp,
    34: KeyAction.ChannelDown
  },
  [Platform.Tizen]: {
    13: KeyAction.Enter,
    10009: KeyAction.Back, // Tizen specific
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    415: KeyAction.Play,
    19: KeyAction.Pause,
    10252: KeyAction.PlayPause,
    413: KeyAction.Stop,
    417: KeyAction.FastForward,
    412: KeyAction.Rewind,
    457: KeyAction.Info,
    403: KeyAction.Red,
    404: KeyAction.Green,
    405: KeyAction.Yellow,
    406: KeyAction.Blue,
    427: KeyAction.ChannelUp,
    428: KeyAction.ChannelDown,
    447: KeyAction.VolumeUp,
    448: KeyAction.VolumeDown,
    449: KeyAction.Mute
  },
  [Platform.Vidaa]: {
    13: KeyAction.Enter,
    8: KeyAction.Back,
    27: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    415: KeyAction.Play,
    19: KeyAction.Pause,
    413: KeyAction.Stop,
    417: KeyAction.FastForward,
    412: KeyAction.Rewind
  },
  [Platform.WhaleOS]: {
    13: KeyAction.Enter,
    27: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    415: KeyAction.Play,
    19: KeyAction.Pause,
    413: KeyAction.Stop
  },
  [Platform.FireTV]: {
    13: KeyAction.Enter,
    4: KeyAction.Back, // Android back
    27: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    85: KeyAction.PlayPause,
    126: KeyAction.Play,
    127: KeyAction.Pause,
    89: KeyAction.Rewind,
    90: KeyAction.FastForward,
    82: KeyAction.Menu
  },
  [Platform.Roku]: {
    13: KeyAction.Enter,
    27: KeyAction.Back,
    8: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    179: KeyAction.PlayPause,
    178: KeyAction.Stop,
    228: KeyAction.FastForward,
    227: KeyAction.Rewind
  },
  [Platform.Xbox]: {
    13: KeyAction.Enter, // A button
    27: KeyAction.Back,  // B button
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    195: KeyAction.Menu, // Menu button
    196: KeyAction.Menu  // View button
  },
  [Platform.PlayStation]: {
    13: KeyAction.Enter, // X button
    27: KeyAction.Back,  // Circle button
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down
  },
  [Platform.AndroidTV]: {
    13: KeyAction.Enter,
    4: KeyAction.Back, // Android back
    27: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    85: KeyAction.PlayPause,
    126: KeyAction.Play,
    127: KeyAction.Pause,
    89: KeyAction.Rewind,
    90: KeyAction.FastForward,
    82: KeyAction.Menu
  },
  [Platform.Vizio]: {
    13: KeyAction.Enter,
    27: KeyAction.Back,
    8: KeyAction.Back,
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    415: KeyAction.Play,
    19: KeyAction.Pause
  },
  [Platform.Generic]: {
    13: KeyAction.Enter,
    27: KeyAction.Back, // Escape
    8: KeyAction.Back,  // Backspace
    37: KeyAction.Left,
    38: KeyAction.Up,
    39: KeyAction.Right,
    40: KeyAction.Down,
    32: KeyAction.PlayPause, // Space
    80: KeyAction.Play,      // P key
    83: KeyAction.Stop,      // S key
    77: KeyAction.Mute       // M key
  }
};

/** Platform detection patterns */
export const PLATFORM_DETECTION_PATTERNS: Record<Platform, RegExp[]> = {
  [Platform.Tizen]: [
    /Tizen/i,
    /SMART-TV.*Samsung/i
  ],
  [Platform.WebOS]: [
    /Web0S/i,
    /WebOS/i,
    /LG.*NetCast/i,
    /LGE.*TV/i
  ],
  [Platform.Vidaa]: [
    /Vidaa/i,
    /VIDAA/i,
    /Hisense/i
  ],
  [Platform.WhaleOS]: [
    /WhaleTV/i,
    /Whale/i
  ],
  [Platform.FireTV]: [
    /AFT/i,     // Amazon Fire TV
    /AFTS/i,    // Fire TV Stick
    /AFTM/i,    // Fire TV specific models
    /Amazon.*Fire/i
  ],
  [Platform.Roku]: [
    /Roku/i
  ],
  [Platform.Xbox]: [
    /Xbox/i,
    /Edge.*Xbox/i
  ],
  [Platform.PlayStation]: [
    /PlayStation/i,
    /PS4/i,
    /PS5/i
  ],
  [Platform.AndroidTV]: [
    /Android.*TV/i,
    /Chromecast/i,
    /BRAVIA/i,    // Sony
    /SHIELD/i     // NVIDIA Shield
  ],
  [Platform.Vizio]: [
    /VIZIO/i,
    /SmartCast/i
  ],
  [Platform.Generic]: []
};
