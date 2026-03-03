import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env['REGION'] ?? 'us-west-2' });
const HIPAA_BUCKET = process.env['HIPAA_BUCKET'] ?? '';

/** Generate a presigned PUT URL for uploading to the HIPAA bucket with SSE */
export async function getHipaaUploadUrl(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: HIPAA_BUCKET,
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  });
  return getSignedUrl(s3, cmd, { expiresIn: 60 }); // 60-second upload window
}

/** Generate a presigned GET URL for downloading from the HIPAA bucket */
export async function getHipaaDownloadUrl(key: string, expiresIn = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: HIPAA_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn }); // default 15 min
}

/** Strip EXIF metadata from an image stored in the HIPAA bucket */
export async function stripExifMetadata(key: string): Promise<void> {
  const getCmd = new GetObjectCommand({ Bucket: HIPAA_BUCKET, Key: key });
  const response = await s3.send(getCmd);
  const bodyBytes = await response.Body?.transformToByteArray();
  if (!bodyBytes || bodyBytes.length === 0) return;

  const contentType = response.ContentType ?? 'image/jpeg';

  // Only strip EXIF from JPEG images
  if (!contentType.includes('jpeg') && !contentType.includes('jpg')) {
    return; // PNG, GIF, etc. — no EXIF to strip
  }

  const stripped = removeJpegExif(bodyBytes);

  const putCmd = new PutObjectCommand({
    Bucket: HIPAA_BUCKET,
    Key: key,
    Body: stripped,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  });
  await s3.send(putCmd);
}

/**
 * Remove EXIF data from a JPEG byte array.
 * JPEG structure: SOI (FFD8) → APP1 (FFE1, contains EXIF) → ... → image data
 * We remove the APP1 segment entirely if it contains EXIF.
 */
function removeJpegExif(data: Uint8Array): Uint8Array {
  // Check for JPEG SOI marker
  if (data[0] !== 0xFF || data[1] !== 0xD8) return data;

  let offset = 2;
  const segments: Uint8Array[] = [data.slice(0, 2)]; // Keep SOI

  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;

    const marker = data[offset + 1];

    // SOS (Start of Scan) — rest is image data, keep everything
    if (marker === 0xDA) {
      segments.push(data.slice(offset));
      break;
    }

    // Markers without length (standalone markers)
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      segments.push(data.slice(offset, offset + 2));
      offset += 2;
      continue;
    }

    // Read segment length
    if (offset + 3 >= data.length) break;
    const segLen = (data[offset + 2] << 8) | data[offset + 3];
    const segEnd = offset + 2 + segLen;

    // APP1 (FFE1) — skip if it contains EXIF
    if (marker === 0xE1) {
      const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00]; // "Exif\0"
      let isExif = true;
      for (let i = 0; i < exifHeader.length && offset + 4 + i < data.length; i++) {
        if (data[offset + 4 + i] !== exifHeader[i]) { isExif = false; break; }
      }
      if (isExif) {
        // Skip this EXIF segment
        offset = segEnd;
        continue;
      }
    }

    // Keep all other segments
    segments.push(data.slice(offset, segEnd));
    offset = segEnd;
  }

  // Concatenate all kept segments
  const totalLen = segments.reduce((sum, s) => sum + s.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const seg of segments) {
    result.set(seg, pos);
    pos += seg.length;
  }
  return result;
}
