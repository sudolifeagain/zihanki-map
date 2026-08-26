import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from '../src/photoPolicy'

export { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES }

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function extensionForType(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType] ?? 'bin'
}

export async function putPhotoObject(
  bucket: R2Bucket,
  machineId: string,
  id: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const objectKey = `photos/${machineId}/${id}.${extensionForType(contentType)}`
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType },
  })
  return objectKey
}
