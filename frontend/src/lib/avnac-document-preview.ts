import type { AvnacDocumentV1 } from './avnac-document'
import { loadCanvasGoogleFontsAndRelayout } from './avnac-canvas-google-fonts'
import { ensureAvnacLayerId } from './ensure-avnac-layer-id'
import { linearGradientForBox } from './fabric-linear-gradient'
import { migrateLegacyImageBlurFilters, installAvnacObjectCanvasBlur } from './avnac-object-blur'
import { normalizeCanvasImagesForExport } from './avnac-image-proxy'
import { refreshAllVectorBoardInstances } from './avnac-vector-board-fabric'
import { loadVectorBoardDocs } from './avnac-vector-boards-storage'

const OBJECT_SERIAL_KEYS = [
  'avnacShape',
  'avnacLocked',
  'avnacBlur',
  'avnacFill',
  'avnacStroke',
  'avnacLayerId',
  'avnacLayerName',
  'avnacVectorBoardId',
] as const

const previewCache = new Map<string, string>()
const PREVIEW_CACHE_MAX = 48

function trimPreviewCache() {
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const first = previewCache.keys().next().value as string | undefined
    if (first === undefined) break
    previewCache.delete(first)
  }
}

export function avnacDocumentPreviewCacheKey(
  persistId: string,
  updatedAt: number,
): string {
  return `${persistId}:${updatedAt}`
}

export function avnacDocumentPreviewEvictPersistId(persistId: string) {
  for (const k of [...previewCache.keys()]) {
    if (k.startsWith(`${persistId}:`)) previewCache.delete(k)
  }
}

export async function renderAvnacDocumentPreviewDataUrl(
  doc: AvnacDocumentV1,
  persistId: string,
  options?: { maxCssPx?: number; cacheKey?: string },
): Promise<string | null> {
  const maxCssPx = options?.maxCssPx ?? 400
  const cacheKey = options?.cacheKey
  if (cacheKey) {
    const hit = previewCache.get(cacheKey)
    if (hit) return hit
  }

  const el = document.createElement('canvas')
  let staticCanvas: InstanceType<
    typeof import('fabric').StaticCanvas
  > | null = null

  try {
    const mod = await import('fabric')
    mod.config.configure({
      maxCacheSideLimit: 8192,
      perfLimitSizeTotal: 16 * 1024 * 1024,
    })
    Object.assign(mod.IText.ownDefaults, { objectCaching: false })
    for (const k of OBJECT_SERIAL_KEYS) {
      if (!mod.FabricObject.customProperties.includes(k)) {
        mod.FabricObject.customProperties.push(k)
      }
    }
    installAvnacObjectCanvasBlur(mod)

    const aw = doc.artboard.width
    const ah = doc.artboard.height
    if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw < 1 || ah < 1) {
      return null
    }

    staticCanvas = new mod.StaticCanvas(el, {
      width: aw,
      height: ah,
      preserveObjectStacking: true,
    })

    if (doc.bg.type === 'solid') {
      staticCanvas.backgroundColor = doc.bg.color
    } else {
      staticCanvas.backgroundColor = linearGradientForBox(
        mod,
        doc.bg.stops,
        doc.bg.angle,
        aw,
        ah,
      )
    }

    await staticCanvas.loadFromJSON(doc.fabric)
    await normalizeCanvasImagesForExport(staticCanvas, mod)
    for (const o of staticCanvas.getObjects()) ensureAvnacLayerId(o)
    try {
      migrateLegacyImageBlurFilters(staticCanvas, mod)
    } catch {
      /* ignore */
    }

    const vectorDocs = loadVectorBoardDocs(persistId)
    refreshAllVectorBoardInstances(staticCanvas, mod, vectorDocs)

    try {
      await loadCanvasGoogleFontsAndRelayout(staticCanvas, mod)
    } catch {
      /* best-effort */
    }

    staticCanvas.requestRenderAll()

    const scale = Math.min(1, maxCssPx / Math.max(aw, ah))
    const dataUrl = staticCanvas.toDataURL({
      format: 'png',
      multiplier: scale,
    })

    if (cacheKey) {
      previewCache.set(cacheKey, dataUrl)
      trimPreviewCache()
    }
    return dataUrl
  } catch (err) {
    console.error('[avnac] document preview failed', err)
    return null
  } finally {
    staticCanvas?.dispose()
  }
}
