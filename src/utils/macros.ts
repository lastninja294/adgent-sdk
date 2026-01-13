/**
 * Macro Replacement Utilities
 * Handles VAST macro substitution for tracking URLs
 */

/** Supported VAST macros */
export type VastMacro =
  | '[TIMESTAMP]'
  | '[CACHEBUSTING]'
  | '[ASSETURI]'
  | '[CONTENTPLAYHEAD]'
  | '[ERRORCODE]'
  | '[BREAKPOSITION]'
  | '[ADPLAYHEAD]'
  | '[ADTYPE]';

/** Macro replacement context */
export interface MacroContext {
  assetUri?: string;
  contentPlayhead?: number;
  adPlayhead?: number;
  errorCode?: number;
  breakPosition?: number;
  adType?: string;
}

/**
 * Replace all VAST macros in a URL
 * @param url - URL containing macros
 * @param context - Values to substitute
 */
export function replaceMacros(url: string, context: MacroContext = {}): string {
  let result = url;

  // [TIMESTAMP] - Current Unix timestamp
  result = result.replace(/\[TIMESTAMP\]/g, Date.now().toString());

  // [CACHEBUSTING] - Random cache buster
  result = result.replace(
    /\[CACHEBUSTING\]/g,
    Math.random().toString(36).substring(2, 15)
  );

  // [ASSETURI] - Current media file URI
  if (context.assetUri) {
    result = result.replace(
      /\[ASSETURI\]/g,
      encodeURIComponent(context.assetUri)
    );
  }

  // [CONTENTPLAYHEAD] - HH:MM:SS.mmm format
  if (context.contentPlayhead !== undefined) {
    result = result.replace(
      /\[CONTENTPLAYHEAD\]/g,
      formatPlayhead(context.contentPlayhead)
    );
  }

  // [ADPLAYHEAD] - HH:MM:SS.mmm format
  if (context.adPlayhead !== undefined) {
    result = result.replace(
      /\[ADPLAYHEAD\]/g,
      formatPlayhead(context.adPlayhead)
    );
  }

  // [ERRORCODE] - VAST error code
  if (context.errorCode !== undefined) {
    result = result.replace(/\[ERRORCODE\]/g, context.errorCode.toString());
  }

  // [BREAKPOSITION] - Position in ad break
  if (context.breakPosition !== undefined) {
    result = result.replace(
      /\[BREAKPOSITION\]/g,
      context.breakPosition.toString()
    );
  }

  // [ADTYPE] - Type of ad (linear, nonlinear)
  if (context.adType) {
    result = result.replace(/\[ADTYPE\]/g, context.adType);
  }

  return result;
}

/**
 * Format seconds into HH:MM:SS.mmm playhead format
 */
function formatPlayhead(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return (
    hours.toString().padStart(2, '0') +
    ':' +
    minutes.toString().padStart(2, '0') +
    ':' +
    secs.toString().padStart(2, '0') +
    '.' +
    ms.toString().padStart(3, '0')
  );
}
