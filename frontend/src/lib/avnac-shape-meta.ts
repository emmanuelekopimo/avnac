import type { FabricObject } from 'fabric'

export type AvnacShapeKind =
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'

export type ArrowLineStyle = 'solid' | 'dashed' | 'dotted'

export type AvnacShapeMeta = {
  kind: AvnacShapeKind
  polygonSides?: number
  starPoints?: number
  arrowHead?: number
  /** Scene-space tail → tip; kept in sync when editing arrow endpoints. */
  arrowEndpoints?: { x1: number; y1: number; x2: number; y2: number }
  arrowStrokeWidth?: number
  arrowLineStyle?: ArrowLineStyle
  arrowRoundedEnds?: boolean
}

export function getAvnacShapeMeta(
  obj: FabricObject | undefined | null,
): AvnacShapeMeta | null {
  if (!obj) return null
  const m = (obj as FabricObject & { avnacShape?: AvnacShapeMeta }).avnacShape
  return m && typeof m === 'object' && 'kind' in m ? m : null
}

export function setAvnacShapeMeta(
  obj: FabricObject,
  meta: AvnacShapeMeta | null,
): void {
  ;(obj as FabricObject & { avnacShape?: AvnacShapeMeta | null }).avnacShape =
    meta
}
