import type { BgValue } from '../components/background-popover'

export const AVNAC_DOC_VERSION = 1 as const
export const AVNAC_STORAGE_KEY = 'avnac-editor-document'

export type AvnacDocumentV1 = {
  v: typeof AVNAC_DOC_VERSION
  artboard: { width: number; height: number }
  bg: BgValue
  fabric: Record<string, unknown>
}

export function parseAvnacDocument(raw: unknown): AvnacDocumentV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<AvnacDocumentV1>
  if (o.v !== AVNAC_DOC_VERSION) return null
  if (
    !o.artboard ||
    typeof o.artboard.width !== 'number' ||
    typeof o.artboard.height !== 'number'
  )
    return null
  if (!o.bg || typeof o.bg !== 'object') return null
  if (!o.fabric || typeof o.fabric !== 'object') return null
  return o as AvnacDocumentV1
}
