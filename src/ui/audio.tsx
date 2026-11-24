/**
 * Private audio, played without handing the bearer key to a web page.
 *
 * Fetch the bytes with the key, then give a WebView a bounded in-memory data
 * URL inside a generated document. Media subrequests do not inherit WebView
 * source headers, and injecting the key into an `<audio>` element would widen
 * the artifact trust boundary; a data URL avoids both and survives platform
 * range requests. Shared by the artifact screen and the transcript's inline
 * player, so the two cannot drift on the caps or the WebView's lockdown.
 */
import React from 'react';
import { WebView } from 'react-native-webview';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function isAudioContentType(contentType: string): boolean {
  return /^audio\/[a-z0-9.+-]+$/i.test(contentType.split(';', 1)[0].trim());
}

export function isVideoContentType(contentType: string): boolean {
  return /^video\/[a-z0-9.+-]+$/i.test(contentType.split(';', 1)[0].trim());
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid audio data'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read audio'));
    reader.onabort = () => reject(new Error('Audio read aborted'));
    reader.readAsDataURL(blob);
  });
}

/** The player document for one private audio file. Throws on any failure or over the cap. */
export async function loadAudioDocument(
  url: string,
  apiKey: string | null,
  contentType: string,
  signal: AbortSignal,
): Promise<string> {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    signal,
  });
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) throw new Error('Audio is too large');
  const blob = await response.blob();
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('Audio is too large');
  const dataUrl = await blobAsDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error('Invalid audio data');
  if (!isAudioContentType(mime)) throw new Error('Not audio');
  const safeDataUrl = `data:${mime};base64,${payload}`;
  return `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;background:transparent"><audio controls preload="metadata" style="width:100%" src="${safeDataUrl}"></audio></body>`;
}

/** The locked-down WebView a player document runs in: no script, no cookies, no navigation. */
export function AudioPlayerView({
  document,
  label,
  playerID,
  style,
  onError,
}: {
  document: string;
  label: string;
  /** The WebView's testID (named apart so a test finds the view, not this wrapper). */
  playerID?: string;
  style: object;
  onError: () => void;
}) {
  return (
    <WebView
      testID={playerID}
      accessibilityLabel={label}
      source={{ html: document, baseUrl: 'about:blank' }}
      style={style}
      originWhitelist={['about:blank', 'data:*']}
      javaScriptEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      cacheEnabled={false}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      mediaPlaybackRequiresUserAction
      webviewDebuggingEnabled={false}
      scrollEnabled={false}
      onError={onError}
      // Android: a WebView whose renderer dies leaves a blank rectangle and
      // no error. Seen on a device (the emulator's renderer crashes on start);
      // say the audio could not play instead of showing nothing.
      onRenderProcessGone={onError}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
    />
  );
}
