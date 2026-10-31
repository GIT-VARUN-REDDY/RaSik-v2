import { v2 as cloudinary } from 'cloudinary';
import { config } from './config.js';

if (config.cloudinary.cloudName) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

/**
 * Upload a readable stream directly to Cloudinary.
 * @param {import('node:stream').Readable} stream
 * @param {object} options Cloudinary upload options (folder, resource_type, etc.)
 * @returns {Promise<{ url: string, public_id: string }>}
 */
export function uploadStream(stream, options = {}) {
  return new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: 'rasik',
        resource_type: 'auto',
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.pipe(upload);
  });
}

/**
 * Delete a file from Cloudinary by public ID.
 * @param {string} publicId
 * @param {string} resourceType 'image' | 'video' | 'raw'
 */
export async function deleteCloudinaryMedia(publicId, resourceType = 'image') {
  try {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.warn('[cloudinary] Failed to delete media', publicId, err.message);
  }
}

export { cloudinary };
