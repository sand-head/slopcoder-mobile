/**
 * Images for a prompt, from the photo library or the camera.
 *
 * The seam carries an image inline — a media type and its bytes in base64,
 * `ImageAttachment` — and the web caps a prompt at four of them, two megabytes
 * each, before it will send. A phone's photos are three to twelve megabytes
 * of HEIC, so the picker is asked to bring each one back re-encoded and no
 * longer than 1568 pixels on a side: the edge past which a model downsizes
 * the image anyway, and the point at which a photo fits under the cap with
 * room to spare. Both platforms hand back JPEG when asked to resize.
 *
 * The picker is the system's — PHPicker on iOS, the Photo Picker on Android
 * — so choosing from the library needs no permission and no prompt. The
 * camera does, and iOS asks on the app's behalf; Android only asks when the
 * app itself does, and the pairing scanner already made this app one that
 * declares the camera, so the request is made here before the camera opens.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { launchCamera, launchImageLibrary, type Asset, type ImagePickerResponse } from 'react-native-image-picker';
import type { ImageAttachment } from '../api/contracts';

/** What the web allows per prompt — the seam sets no cap of its own. */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** The long edge a model sees at full resolution; larger only costs bytes. */
export const MAX_EDGE = 1568;

/** An image attached to the next prompt, keyed so a chip can remove it. */
export interface PendingImage extends ImageAttachment {
  key: string;
}

export type ImageSource = 'library' | 'camera';

export interface PickResult {
  images: PendingImage[];
  /** What was refused, in a sentence for the person; null when everything came through. */
  error: string | null;
}

/** Base64 says a length; the seam's cap is on the bytes it decodes to. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * What the picker reports is not always what the wire wants. iOS names a
 * re-encoded JPEG `image/jpg`, which is no registered type at all, and a
 * model API that checks the media type would refuse it.
 */
export function normalizeMediaType(type: string | undefined): string | null {
  const lower = (type ?? '').toLowerCase();
  if (lower === 'image/jpg' || lower === 'image/jpeg') return 'image/jpeg';
  if (lower === 'image/png' || lower === 'image/gif' || lower === 'image/webp') return lower;
  return null;
}

/**
 * Turn the picker's answer into attachments, refusing what the seam would
 * not take. Exported so the caps can be tested without a picker: the picker
 * runs only on a device.
 */
export function collect(response: ImagePickerResponse, room: number): PickResult {
  if (response.didCancel) return { images: [], error: null };
  if (response.errorCode === 'camera_unavailable') {
    return { images: [], error: 'No camera on this device.' };
  }
  if (response.errorCode === 'permission') {
    return { images: [], error: 'Camera access is off for slopcoder in Settings.' };
  }
  if (response.errorCode) {
    return { images: [], error: response.errorMessage || 'Could not read that image.' };
  }

  const images: PendingImage[] = [];
  let error: string | null = null;
  for (const asset of response.assets ?? []) {
    if (images.length >= room) {
      error = `At most ${MAX_IMAGES} images per prompt.`;
      break;
    }
    const attached = toAttachment(asset);
    if (typeof attached === 'string') {
      error = attached;
      continue;
    }
    images.push(attached);
  }
  return { images, error };
}

function toAttachment(asset: Asset): PendingImage | string {
  const name = asset.fileName || 'That image';
  const mediaType = normalizeMediaType(asset.type);
  if (!mediaType) return `${name} is not an image the agent can read.`;
  if (!asset.base64) return `${name} could not be read.`;
  if (decodedBytes(asset.base64) > MAX_IMAGE_BYTES) return `${name} is over 2 MB.`;
  return {
    key: `${Date.now()}:${asset.uri ?? name}:${asset.base64.length}`,
    mediaType,
    base64Data: asset.base64,
  };
}

/**
 * Open the library or the camera and bring back up to `room` images.
 * Never throws: a refusal is a sentence in the result.
 */
export async function pickImages(source: ImageSource, room: number): Promise<PickResult> {
  if (room <= 0) return { images: [], error: `At most ${MAX_IMAGES} images per prompt.` };

  const shared = {
    mediaType: 'photo' as const,
    includeBase64: true,
    maxWidth: MAX_EDGE,
    maxHeight: MAX_EDGE,
    // Under 1 is what makes iOS re-encode a HEIC as JPEG at all.
    quality: 0.8 as const,
  };

  try {
    if (source === 'camera') {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          return { images: [], error: 'Camera access is off for slopcoder in Settings.' };
        }
      }
      return collect(await launchCamera({ ...shared, cameraType: 'back', saveToPhotos: false }), room);
    }
    return collect(await launchImageLibrary({ ...shared, selectionLimit: room }), room);
  } catch (e) {
    return { images: [], error: e instanceof Error ? e.message : String(e) };
  }
}
