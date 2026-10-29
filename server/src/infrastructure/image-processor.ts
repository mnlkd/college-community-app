import type { ImagePurpose } from '@hilcoe/shared'
import sharp from 'sharp'
import { ValidationError } from '../kernel/index.js'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 20_000_000
export const LONG_EDGE: Record<ImagePurpose, number> = { POST: 1600, PROFILE: 512 }

const FORMATS = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
} as const

type AcceptedFormat = keyof typeof FORMATS

export interface ProcessedImage {
  bytes: Buffer
  contentType: (typeof FORMATS)[AcceptedFormat]['contentType']
  extension: (typeof FORMATS)[AcceptedFormat]['extension']
  width: number
  height: number
}

/** Prepares uploaded images with Sharp (ODD Table 5). */
export class ImageProcessor {
  async process(bytes: Uint8Array, purpose: ImagePurpose, field = 'image'): Promise<ProcessedImage> {
    const invalid = (message: string) => new ValidationError({ [field]: message })
    if (bytes.byteLength === 0) throw invalid('The image is empty.')
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw invalid('The image must be 5 MB or smaller.')

    const input = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' as const }
    let format: AcceptedFormat
    try {
      const metadata = await sharp(bytes, input).metadata()
      if (!metadata.format || !(metadata.format in FORMATS)) {
        throw invalid('Use a JPEG, PNG or WebP image.')
      }
      if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        throw invalid('The image must be 20 megapixels or smaller.')
      }
      format = metadata.format as AcceptedFormat
    } catch (error) {
      if (error instanceof ValidationError) throw error
      throw invalid('The file is not a readable JPEG, PNG or WebP image.')
    }

    const edge = LONG_EDGE[purpose]
    try {
      // Sharp writes no metadata (EXIF, GPS, ICC) unless asked to keep it.
      const { data, info } = await sharp(bytes, input)
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .toFormat(format)
        .toBuffer({ resolveWithObject: true })
      return { bytes: data, ...FORMATS[format], width: info.width, height: info.height }
    } catch {
      throw invalid('The file is not a readable JPEG, PNG or WebP image.')
    }
  }
}
