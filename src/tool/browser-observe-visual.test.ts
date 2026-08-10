import assert from 'node:assert'
import { describe, it } from 'node:test'
import { buildVisualPrompt, formatScreenshotMetadata } from './browser-observe-visual'

describe('browser_observe_visual prompt', () => {
  const screenshot = {
    base64: 'image-data',
    format: 'png' as const,
    width: 1280,
    height: 770,
    originalWidth: 1440,
    originalHeight: 866,
    resized: true,
    viewport: { x: 0, y: 94, width: 1440, height: 866, deviceScaleFactor: 1 },
  }

  it('marks GEASS screenshot dimensions as authoritative rather than asking the VLM to infer them', () => {
    const metadata = formatScreenshotMetadata(screenshot)

    assert.match(metadata, /Encoded image dimensions: 1280 x 770 pixels\./)
    assert.match(metadata, /Original captured dimensions before resize: 1440 x 866 pixels\./)
    assert.match(metadata, /Browser viewport: 1440 x 866 at 0,94 @1x\./)
    assert.match(metadata, /not visual inference/)
  })

  it('includes authoritative screenshot metadata before structured page context', () => {
    const prompt = buildVisualPrompt('Audit the image dimensions.', 'URL: https://example.test', screenshot)

    assert.ok(prompt.indexOf('=== Authoritative GEASS Screenshot Metadata ===') < prompt.indexOf('Structured page context from GEASS:'))
    assert.match(prompt, /Audit the image dimensions\./)
    assert.match(prompt, /Encoded image dimensions: 1280 x 770 pixels\./)
  })
})
