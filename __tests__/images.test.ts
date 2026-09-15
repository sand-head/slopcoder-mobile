/**
 * The picker itself runs only on a device. What can be proven here is the
 * part that decides what reaches the seam: the caps the web enforces, the
 * media type the wire needs, and that a refusal is a sentence rather than a
 * throw.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import * as picker from 'react-native-image-picker';
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  collect,
  decodedBytes,
  normalizeMediaType,
  pickImages,
} from '../src/ui/images';

const mock = picker as unknown as { __queue: (r: unknown) => void; __reset: () => void };

const tiny = 'iVBORw0KGgo='; // eight bytes of PNG header

beforeEach(() => mock.__reset());

describe('media types', () => {
  it("names iOS's image/jpg what the wire calls it", () => {
    expect(normalizeMediaType('image/jpg')).toBe('image/jpeg');
    expect(normalizeMediaType('IMAGE/JPEG')).toBe('image/jpeg');
  });

  it('refuses what a model cannot read', () => {
    expect(normalizeMediaType('image/heic')).toBeNull();
    expect(normalizeMediaType('application/pdf')).toBeNull();
    expect(normalizeMediaType(undefined)).toBeNull();
  });
});

describe('decodedBytes', () => {
  it('counts the bytes, not the characters', () => {
    expect(decodedBytes(tiny)).toBe(8);
    expect(decodedBytes('QUJD')).toBe(3);
    expect(decodedBytes('QUI=')).toBe(2);
  });
});

describe('collect', () => {
  it('turns assets into attachments keyed for the chips', () => {
    const result = collect(
      { assets: [{ uri: 'file:///a.jpg', type: 'image/jpg', base64: tiny, fileName: 'a.jpg' }] },
      MAX_IMAGES,
    );
    expect(result.error).toBeNull();
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ mediaType: 'image/jpeg', base64Data: tiny });
    expect(result.images[0].key).toBeTruthy();
  });

  it('stops at the room left and says so', () => {
    const asset = { type: 'image/png', base64: tiny };
    const result = collect({ assets: [asset, asset, asset] }, 2);
    expect(result.images).toHaveLength(2);
    expect(result.error).toBe(`At most ${MAX_IMAGES} images per prompt.`);
  });

  it('refuses one over the cap and keeps the rest', () => {
    const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 3) / 3) * 4);
    const result = collect(
      {
        assets: [
          { type: 'image/png', base64: big, fileName: 'huge.png' },
          { type: 'image/png', base64: tiny, fileName: 'ok.png' },
        ],
      },
      MAX_IMAGES,
    );
    expect(result.images).toHaveLength(1);
    expect(result.error).toBe('huge.png is over 2 MB.');
  });

  it('is silent on cancel', () => {
    expect(collect({ didCancel: true }, MAX_IMAGES)).toEqual({ images: [], error: null });
  });

  it('words a permission refusal', () => {
    expect(collect({ errorCode: 'permission' }, MAX_IMAGES).error).toMatch(/Settings/);
  });
});

describe('pickImages', () => {
  it('asks the library for exactly the room left, resized and inline', async () => {
    mock.__queue({ assets: [{ type: 'image/jpeg', base64: tiny }] });
    const result = await pickImages('library', 3);
    expect(result.images).toHaveLength(1);
    expect(picker.launchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionLimit: 3,
        includeBase64: true,
        maxWidth: 1568,
        maxHeight: 1568,
        mediaType: 'photo',
        quality: 0.8,
      }),
    );
  });

  it('refuses without opening anything when there is no room', async () => {
    const result = await pickImages('library', 0);
    expect(result.error).toMatch(/At most/);
    expect(picker.launchImageLibrary).not.toHaveBeenCalled();
  });

  it('asks Android for the camera first, and stops on a no', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    try {
      const result = await pickImages('camera', 1);
      expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
      expect(result.error).toMatch(/Settings/);
      expect(picker.launchCamera).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });
});
