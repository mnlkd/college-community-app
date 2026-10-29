import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ImageProcessor, MAX_IMAGE_BYTES } from '../../src/infrastructure/image-processor.js'
import { ValidationError } from '../../src/kernel/index.js'

const processor = new ImageProcessor()

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
}

describe('ImageProcessor', () => {
  it('shrinks a post image to a 1600 px long edge and strips metadata', async () => {
    const input = await solid(3200, 1600)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner', Artist: 'someone' } })
      .toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()

    const output = await processor.process(input, 'POST')
    expect(output).toMatchObject({ width: 1600, height: 800, contentType: 'image/jpeg', extension: 'jpg' })
    const metadata = await sharp(output.bytes).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(output.bytes.includes(Buffer.from('secret-owner'))).toBe(false)
  })

  it('shrinks a profile image to 512 px and never enlarges a small one', async () => {
    const big = await processor.process(await solid(1000, 2000).webp().toBuffer(), 'PROFILE')
    expect(big).toMatchObject({ width: 256, height: 512, contentType: 'image/webp' })
    const small = await processor.process(await solid(100, 80).png().toBuffer(), 'POST')
    expect(small).toMatchObject({ width: 100, height: 80, contentType: 'image/png' })
  })

  it('applies the EXIF orientation before removing it', async () => {
    const rotated = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const output = await processor.process(rotated, 'POST')
    expect(output).toMatchObject({ width: 100, height: 200 })
  })

  it.each([
    ['a GIF', () => solid(10, 10).gif().toBuffer()],
    ['bytes that are not an image', async () => Buffer.from('not an image at all')],
    ['an empty file', async () => Buffer.alloc(0)],
    ['a file over 5 MB', async () => Buffer.alloc(MAX_IMAGE_BYTES + 1)],
    ['an image over 20 megapixels', () => solid(5000, 4001).png({ compressionLevel: 9 }).toBuffer()],
  ])('rejects %s with a ValidationError on the field', async (_label, make) => {
    const error = await processor.process(await make(), 'POST', 'images.0').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ValidationError)
    expect(Object.keys((error as ValidationError).fields)).toEqual(['images.0'])
  })
})
