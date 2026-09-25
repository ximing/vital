import { IMAGE_MIME_TYPES } from '@vital/dto';
import { client } from './api';

/** Pick one photo and upload it. Returns null when the user cancels or the file is unusable. */
export async function pickAndUploadImage(): Promise<{ id: string; name: string } | null> {
  const ImagePicker = await import('expo-image-picker');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const mime = asset.mimeType ?? 'image/jpeg';
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return null;
  const { File } = await import('expo-file-system');
  const size = asset.fileSize ?? new File(asset.uri).size;
  if (!size) return null;
  const uploaded = await client.upload({ file: new File(asset.uri), mime, size });
  return { id: uploaded.id, name: asset.fileName ?? 'image' };
}
