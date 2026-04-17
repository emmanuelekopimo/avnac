import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CircleIcon,
  Delete02Icon,
  Pen01Icon,
  PenTool03Icon,
  PolygonIcon,
  Cursor02Icon,
  SolidLine01Icon,
  SquareIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BgValue } from './background-popover'
import PaintPopoverControl from './paint-popover-control'
import StrokeToolbarPopover from './stroke-toolbar-popover'
import {
  FloatingToolbarDivider,
  FloatingToolbarShell,
  floatingToolbarIconButton,
} from './floating-toolbar-shell'
import {
  applySmoothPlacementHandles,
  ctrlInAbs,
  ctrlOutAbs,
  type VectorPenAnchor,
} from '../lib/avnac-vector-pen-bezier'
import {
  applyTranslateStrokeInDoc,
  createVectorBoardLayer,
  emptyVectorBoardDocument,
  findTopStrokeAt,
  getActiveLayer,
  normBoundsForStroke,
  updateVectorStrokeInDoc,
  vectorDocHasRenderableStrokes,
  type VectorBoardDocument,
  type VectorBoardStroke,
  type VectorStrokeKind,
} from '../lib/avnac-vector-board-document'

const GRID_STEP = 24
const POINT_EPS = 0.002
const DRAFT_SHAPE_EDGE = 'rgba(15,23,42,0.32)'
const PEN_HIT_R = 0.017
const PEN_HIT_R_SQ = PEN_HIT_R * PEN_HIT_R
const PEN_CORNER_DRAG = 0.005

const CURSOR_PEN_ADD =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Cpath d='M11 4v14M4 11h14' stroke='%231e293b' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\") 11 11, crosshair"

const CURSOR_PEN_REMOVE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Cpath d='M5 5l12 12M17 5L5 17' stroke='%23dc2626' stroke-width='2.2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\") 11 11, not-allowed"

function releasePointerIfCaptured(
  el: HTMLElement | null,
  pointerId: number,
) {
  if (!el || pointerId < 0) return
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
  } catch {
    /* ignore */
  }
}

function strokePaintVisible(stroke: string): boolean {
  return Boolean(stroke) && stroke !== 'transparent'
}

function bgValuePreferSolid(v: BgValue): string {
  if (v.type === 'solid') return v.color
  return v.stops[0]?.color ?? '#1a1a1a'
}

type DrawTool =
  | 'move'
  | 'pencil'
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'polygon'

type DocStrokeSelection = { layerId: string; strokeId: string }

type ShapeDraftTool = 'line' | 'rect' | 'ellipse' | 'arrow'

type ShapeDraft = {
  kind: 'shape'
  tool: ShapeDraftTool
  a: [number, number]
  b?: [number, number]
}

type PenBezierDrag =
  | {
      type: 'place'
      anchorIndex: number
      startX: number
      startY: number
    }
  | {
      type: 'handle'
      anchorIndex: number
      which: 'in' | 'out'
    }

type PenBezierDraftState = {
  kind: 'pen-bezier'
  anchors: VectorPenAnchor[]
  selectedAnchor: number | null
  drag: PenBezierDrag | null
}

type PolylineDraftState = {
  kind: 'polyline'
  tool: 'pencil' | 'polygon'
  points: [number, number][]
}

type DraftState = PolylineDraftState | PenBezierDraftState | ShapeDraft

function hitTestPenBezier(
  d: PenBezierDraftState,
  nx: number,
  ny: number,
):
  | { type: 'handle'; anchorIndex: number; which: 'in' | 'out' }
  | { type: 'anchor'; anchorIndex: number }
  | null {
  for (let i = d.anchors.length - 1; i >= 0; i--) {
    const a = d.anchors[i]!
    if (a.outX != null && a.outY != null) {
      const dx = nx - a.outX
      const dy = ny - a.outY
      if (dx * dx + dy * dy <= PEN_HIT_R_SQ) {
        return { type: 'handle', anchorIndex: i, which: 'out' }
      }
    }
    if (a.inX != null && a.inY != null) {
      const dx = nx - a.inX
      const dy = ny - a.inY
      if (dx * dx + dy * dy <= PEN_HIT_R_SQ) {
        return { type: 'handle', anchorIndex: i, which: 'in' }
      }
    }
  }
  for (let i = d.anchors.length - 1; i >= 0; i--) {
    const a = d.anchors[i]!
    const dx = nx - a.x
    const dy = ny - a.y
    if (dx * dx + dy * dy <= PEN_HIT_R_SQ * 1.44) {
      return { type: 'anchor', anchorIndex: i }
    }
  }
  return null
}

function removePenAnchorAt(
  anchors: VectorPenAnchor[],
  idx: number,
): VectorPenAnchor[] {
  if (idx < 0 || idx >= anchors.length) return anchors
  const copy = anchors.map((a) => ({ ...a }))
  copy.splice(idx, 1)
  if (idx > 0) {
    const prev = copy[idx - 1]!
    delete prev.outX
    delete prev.outY
  }
  if (idx < copy.length) {
    const next = copy[idx]!
    delete next.inX
    delete next.inY
  }
  return copy
}

function paintHandleDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
) {
  const s = 4
  ctx.fillStyle = '#2563eb'
  ctx.strokeStyle = '#1e40af'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, cy - s)
  ctx.lineTo(cx + s, cy)
  ctx.lineTo(cx, cy + s)
  ctx.lineTo(cx - s, cy)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function paintPenBezierDraft(
  ctx: CanvasRenderingContext2D,
  draft: PenBezierDraftState,
  w: number,
  h: number,
  strokeColor: string,
  strokeWidthPx: number,
  fillColor: string,
  removeHintIndex: number | null,
  closeHover: boolean,
) {
  const { anchors, selectedAnchor } = draft
  if (anchors.length >= 2) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (
      closeHover &&
      fillColor &&
      fillColor !== 'transparent' &&
      anchors.length >= 3
    ) {
      ctx.beginPath()
      ctx.moveTo(anchors[0]!.x * w, anchors[0]!.y * h)
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i]!
        const b = anchors[i + 1]!
        const [x1, y1] = ctrlOutAbs(a)
        const [x2, y2] = ctrlInAbs(b)
        ctx.bezierCurveTo(
          x1 * w,
          y1 * h,
          x2 * w,
          y2 * h,
          b.x * w,
          b.y * h,
        )
      }
      const last = anchors[anchors.length - 1]!
      const first = anchors[0]!
      const [lx1, ly1] = ctrlOutAbs(last)
      const [lx2, ly2] = ctrlInAbs(first)
      ctx.bezierCurveTo(
        lx1 * w,
        ly1 * h,
        lx2 * w,
        ly2 * h,
        first.x * w,
        first.y * h,
      )
      ctx.fillStyle = fillColor
      ctx.globalAlpha = 0.35
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = Math.max(1, strokeWidthPx)
    ctx.beginPath()
    ctx.moveTo(anchors[0]!.x * w, anchors[0]!.y * h)
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i]!
      const b = anchors[i + 1]!
      const [x1, y1] = ctrlOutAbs(a)
      const [x2, y2] = ctrlInAbs(b)
      ctx.bezierCurveTo(
        x1 * w,
        y1 * h,
        x2 * w,
        y2 * h,
        b.x * w,
        b.y * h,
      )
    }
    ctx.stroke()
  }

  if (closeHover && anchors.length >= 2) {
    const last = anchors[anchors.length - 1]!
    const first = anchors[0]!
    ctx.save()
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)'
    ctx.lineWidth = Math.max(1, strokeWidthPx)
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(last.x * w, last.y * h)
    const [cx1, cy1] = ctrlOutAbs(last)
    const [cx2, cy2] = ctrlInAbs(first)
    ctx.bezierCurveTo(
      cx1 * w,
      cy1 * h,
      cx2 * w,
      cy2 * h,
      first.x * w,
      first.y * h,
    )
    ctx.stroke()
    ctx.restore()
  }

  const ax = (x: number) => x * w
  const ay = (y: number) => y * h
  for (let i = 0; i < anchors.length; i++) {
    const p = anchors[i]!
    if (p.inX != null && p.inY != null) {
      ctx.strokeStyle = 'rgba(100,116,139,0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ax(p.x), ay(p.y))
      ctx.lineTo(ax(p.inX), ay(p.inY))
      ctx.stroke()
      paintHandleDiamond(ctx, ax(p.inX), ay(p.inY))
    }
    if (p.outX != null && p.outY != null) {
      ctx.strokeStyle = 'rgba(100,116,139,0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ax(p.x), ay(p.y))
      ctx.lineTo(ax(p.outX), ay(p.outY))
      ctx.stroke()
      paintHandleDiamond(ctx, ax(p.outX), ay(p.outY))
    }
    const r = selectedAnchor === i ? 5 : 4
    ctx.fillStyle = selectedAnchor === i ? '#2563eb' : '#ffffff'
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(ax(p.x), ay(p.y), r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (removeHintIndex === i) {
      const cx = ax(p.x)
      const cy = ay(p.y)
      const k = 6
      ctx.strokeStyle = '#dc2626'
      ctx.lineWidth = 1.75
      ctx.beginPath()
      ctx.moveTo(cx - k, cy - k)
      ctx.lineTo(cx + k, cy + k)
      ctx.moveTo(cx + k, cy - k)
      ctx.lineTo(cx - k, cy + k)
      ctx.stroke()
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f8f8f7'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(10,10,10,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= w; x += GRID_STEP) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
  }
  for (let y = 0; y <= h; y += GRID_STEP) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()
}

function paintStroke(
  ctx: CanvasRenderingContext2D,
  s: VectorBoardStroke,
  w: number,
  h: number,
) {
  const m = Math.max(1, Math.min(w, h))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const hasFill =
    s.fill && s.fill.length > 0 && s.fill !== 'transparent'
  const drawStroke = strokePaintVisible(s.stroke)
  if (drawStroke) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = Math.max(1, s.strokeWidthN * m)
  }

  if (s.kind === 'pen') {
    if (s.penAnchors && s.penAnchors.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(s.penAnchors[0]!.x * w, s.penAnchors[0]!.y * h)
      for (let i = 0; i < s.penAnchors.length - 1; i++) {
        const a = s.penAnchors[i]!
        const b = s.penAnchors[i + 1]!
        const [x1, y1] = ctrlOutAbs(a)
        const [x2, y2] = ctrlInAbs(b)
        ctx.bezierCurveTo(
          x1 * w,
          y1 * h,
          x2 * w,
          y2 * h,
          b.x * w,
          b.y * h,
        )
      }
      if (s.penClosed === true && s.penAnchors.length >= 2) {
        const last = s.penAnchors[s.penAnchors.length - 1]!
        const first = s.penAnchors[0]!
        const [lx1, ly1] = ctrlOutAbs(last)
        const [lx2, ly2] = ctrlInAbs(first)
        ctx.bezierCurveTo(
          lx1 * w,
          ly1 * h,
          lx2 * w,
          ly2 * h,
          first.x * w,
          first.y * h,
        )
      }
      if (hasFill && s.penClosed === true) {
        ctx.fillStyle = s.fill
        ctx.fill()
      }
      if (drawStroke) ctx.stroke()
      return
    }
    if (s.points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(s.points[0]![0] * w, s.points[0]![1] * h)
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i]![0] * w, s.points[i]![1] * h)
    }
    if (s.penClosed === true && s.points.length >= 3) ctx.closePath()
    if (hasFill && s.penClosed === true && s.points.length >= 3) {
      ctx.fillStyle = s.fill
      ctx.fill()
    }
    if (drawStroke) ctx.stroke()
    return
  }

  if (s.kind === 'polygon') {
    if (s.points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(s.points[0]![0] * w, s.points[0]![1] * h)
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i]![0] * w, s.points[i]![1] * h)
    }
    if (s.points.length >= 3) ctx.closePath()
    if (hasFill) {
      ctx.fillStyle = s.fill
      ctx.fill()
    }
    if (drawStroke) ctx.stroke()
    return
  }

  if (s.points.length < 2) return
  const [ax, ay] = s.points[0]!
  const [bx, by] = s.points[1]!
  const x0 = ax * w
  const y0 = ay * h
  const x1 = bx * w
  const y1 = by * h

  if (s.kind === 'line') {
    if (!drawStroke) return
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    return
  }

  if (s.kind === 'rect') {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    ctx.beginPath()
    ctx.rect(minX, minY, maxX - minX, maxY - minY)
    if (hasFill) {
      ctx.fillStyle = s.fill
      ctx.fill()
    }
    if (drawStroke) ctx.stroke()
    return
  }

  if (s.kind === 'ellipse') {
    const minX = Math.min(ax, bx)
    const maxX = Math.max(ax, bx)
    const minY = Math.min(ay, by)
    const maxY = Math.max(ay, by)
    const cx = ((minX + maxX) / 2) * w
    const cy = ((minY + maxY) / 2) * h
    const rx = ((maxX - minX) / 2) * w
    const ry = ((maxY - minY) / 2) * h
    if (rx < 0.5 || ry < 0.5) return
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    if (hasFill) {
      ctx.fillStyle = s.fill
      ctx.fill()
    }
    if (drawStroke) ctx.stroke()
    return
  }

  if (s.kind === 'arrow') {
    if (!drawStroke) return
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    let dx = x1 - x0
    let dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 2) return
    dx /= len
    dy /= len
    const head = Math.min(len * 0.35, 28)
    const wing = head * 0.45
    const bx0 = x1 - dx * head
    const by0 = y1 - dy * head
    const px = -dy
    const py = dx
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(bx0 + px * wing, by0 + py * wing)
    ctx.moveTo(x1, y1)
    ctx.lineTo(bx0 - px * wing, by0 - py * wing)
    ctx.stroke()
  }
}

function paintDocument(
  ctx: CanvasRenderingContext2D,
  doc: VectorBoardDocument,
  w: number,
  h: number,
) {
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    for (const s of layer.strokes) paintStroke(ctx, s, w, h)
  }
}

function paintDraft(
  ctx: CanvasRenderingContext2D,
  draft: DraftState | null,
  w: number,
  h: number,
  strokeColor: string,
  strokeWidthPx: number,
  fillColor: string,
  penRemoveHintIndex: number | null,
  penCloseHover: boolean,
) {
  if (!draft) return
  if (draft.kind === 'pen-bezier') {
    paintPenBezierDraft(
      ctx,
      draft,
      w,
      h,
      strokeColor,
      strokeWidthPx,
      fillColor,
      penRemoveHintIndex,
      penCloseHover,
    )
    return
  }

  if (draft.kind === 'polyline') {
    ctx.strokeStyle =
      draft.tool === 'polygon' ? DRAFT_SHAPE_EDGE : strokeColor
    ctx.lineWidth = Math.max(1, strokeWidthPx)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (draft.points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(draft.points[0]![0] * w, draft.points[0]![1] * h)
    for (let i = 1; i < draft.points.length; i++) {
      ctx.lineTo(draft.points[i]![0] * w, draft.points[i]![1] * h)
    }
    if (draft.tool === 'polygon' && draft.points.length >= 3) {
      ctx.closePath()
      if (fillColor && fillColor !== 'transparent') {
        ctx.fillStyle = fillColor
        ctx.globalAlpha = 0.35
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }
    ctx.stroke()
    return
  }

  const sh = draft
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = Math.max(1, strokeWidthPx)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const b = sh.b ?? sh.a
  const x0 = sh.a[0] * w
  const y0 = sh.a[1] * h
  const x1 = b[0] * w
  const y1 = b[1] * h

  if (sh.tool === 'line') {
    ctx.strokeStyle = strokeColor
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    return
  }

  if (sh.tool === 'rect') {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    ctx.beginPath()
    ctx.rect(minX, minY, maxX - minX, maxY - minY)
    if (fillColor && fillColor !== 'transparent') {
      ctx.fillStyle = fillColor
      ctx.globalAlpha = 0.35
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = DRAFT_SHAPE_EDGE
    ctx.stroke()
    return
  }

  if (sh.tool === 'ellipse') {
    const ax = sh.a[0]
    const ay = sh.a[1]
    const bx = b[0]
    const by = b[1]
    const minX = Math.min(ax, bx)
    const maxX = Math.max(ax, bx)
    const minY = Math.min(ay, by)
    const maxY = Math.max(ay, by)
    const cx = ((minX + maxX) / 2) * w
    const cy = ((minY + maxY) / 2) * h
    const rx = ((maxX - minX) / 2) * w
    const ry = ((maxY - minY) / 2) * h
    if (rx < 0.5 || ry < 0.5) return
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    if (fillColor && fillColor !== 'transparent') {
      ctx.fillStyle = fillColor
      ctx.globalAlpha = 0.35
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = DRAFT_SHAPE_EDGE
    ctx.stroke()
    return
  }

  if (sh.tool === 'arrow') {
    ctx.strokeStyle = strokeColor
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    let dx = x1 - x0
    let dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 2) return
    dx /= len
    dy /= len
    const head = Math.min(len * 0.35, 28)
    const wing = head * 0.45
    const bx0 = x1 - dx * head
    const by0 = y1 - dy * head
    const px = -dy
    const py = dx
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(bx0 + px * wing, by0 + py * wing)
    ctx.moveTo(x1, y1)
    ctx.lineTo(bx0 - px * wing, by0 - py * wing)
    ctx.stroke()
  }
}

function paintDocSelection(
  ctx: CanvasRenderingContext2D,
  doc: VectorBoardDocument,
  sel: DocStrokeSelection | null,
  w: number,
  h: number,
) {
  if (!sel) return
  const layer = doc.layers.find((l) => l.id === sel.layerId)
  if (!layer?.visible) return
  const s = layer.strokes.find((x) => x.id === sel.strokeId)
  if (!s) return
  const b = normBoundsForStroke(s)
  if (!b) return
  const pad = 0.01
  const x0 = (b.minX - pad) * w
  const y0 = (b.minY - pad) * h
  const rw = (b.maxX - b.minX + pad * 2) * w
  const rh = (b.maxY - b.minY + pad * 2) * h
  ctx.save()
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeRect(x0, y0, Math.max(1, rw), Math.max(1, rh))
  ctx.restore()
}

type Props = {
  open: boolean
  boardName: string
  document: VectorBoardDocument
  onDocumentChange: (doc: VectorBoardDocument) => void
  onRequestPlaceOnCanvas: () => void
  onClose: () => void
}

export default function VectorBoardWorkspace({
  open,
  boardName,
  document,
  onDocumentChange,
  onRequestPlaceOnCanvas,
  onClose,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<DrawTool>('pencil')
  const [strokeColor, setStrokeColor] = useState('#1a1a1a')
  const [fillColor, setFillColor] = useState('#94a3b8')
  const [strokeWidthPx, setStrokeWidthPx] = useState(3)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const draftRef = useRef<DraftState | null>(null)
  const [penRemoveHintIndex, setPenRemoveHintIndex] = useState<number | null>(
    null,
  )
  const [penCloseHover, setPenCloseHover] = useState(false)
  const [docSelection, setDocSelection] = useState<DocStrokeSelection | null>(
    null,
  )
  const moveDragRef = useRef<{
    layerId: string
    strokeId: string
    last: [number, number]
    pointerId: number
  } | null>(null)
  const documentRef = useRef(document)
  documentRef.current = document

  const selectionSyncKey = docSelection
    ? `${docSelection.layerId}:${docSelection.strokeId}`
    : null

  const selectedStrokeForUi = useMemo(() => {
    if (!docSelection) return null
    const layer = document.layers.find((l) => l.id === docSelection.layerId)
    return layer?.strokes.find((s) => s.id === docSelection.strokeId) ?? null
  }, [document, docSelection])

  useEffect(() => {
    if (!open || !selectionSyncKey || !docSelection) return
    const layer = documentRef.current.layers.find(
      (l) => l.id === docSelection.layerId,
    )
    const s = layer?.strokes.find((x) => x.id === docSelection.strokeId)
    if (!s) return
    const canvas = canvasRef.current
    const rw = canvas?.getBoundingClientRect().width ?? 1
    const rh = canvas?.getBoundingClientRect().height ?? 1
    const m = Math.max(1, Math.min(rw, rh))
    const nextStroke =
      s.stroke && strokePaintVisible(s.stroke) ? s.stroke : '#1a1a1a'
    const nextFill =
      s.fill && s.fill !== 'transparent' ? s.fill : '#94a3b8'
    const nextW = Math.min(16, Math.max(1, Math.round(s.strokeWidthN * m)))
    setStrokeColor(nextStroke)
    setFillColor(nextFill)
    setStrokeWidthPx(nextW)
  }, [open, selectionSyncKey, docSelection])

  const paintFrame = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = wrap.getBoundingClientRect()
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawGrid(ctx, w, h)
    paintDocument(ctx, document, w, h)
    paintDocSelection(ctx, document, docSelection, w, h)
    paintDraft(
      ctx,
      draftRef.current,
      w,
      h,
      strokeColor,
      strokeWidthPx,
      fillColor,
      penRemoveHintIndex,
      penCloseHover,
    )
  }, [
    document,
    strokeColor,
    strokeWidthPx,
    fillColor,
    penRemoveHintIndex,
    penCloseHover,
    docSelection,
  ])

  useLayoutEffect(() => {
    if (!open) return
    paintFrame()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paintFrame())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [open, paintFrame])

  useEffect(() => {
    draftRef.current = draft
    if (open) paintFrame()
  }, [draft, open, paintFrame])

  useEffect(() => {
    if (!open) {
      const m = moveDragRef.current
      if (m) releasePointerIfCaptured(canvasRef.current, m.pointerId)
      setDocSelection(null)
      moveDragRef.current = null
    }
  }, [open])

  useEffect(() => {
    const m = moveDragRef.current
    if (m) releasePointerIfCaptured(canvasRef.current, m.pointerId)
    moveDragRef.current = null
    if (tool !== 'pen' && draftRef.current?.kind === 'pen-bezier') {
      draftRef.current = null
      setDraft(null)
    }
    setPenRemoveHintIndex(null)
    setPenCloseHover(false)
    const c = canvasRef.current
    if (c) {
      if (tool === 'pen') c.style.cursor = CURSOR_PEN_ADD
      else if (tool === 'move') c.style.cursor = 'grab'
      else c.style.cursor = 'crosshair'
    }
  }, [tool])

  const toNorm = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      const x = (clientX - r.left) / Math.max(1, r.width)
      const y = (clientY - r.top) / Math.max(1, r.height)
      return [
        Math.max(0, Math.min(1, x)),
        Math.max(0, Math.min(1, y)),
      ]
    },
    [],
  )

  const appendPoint = useCallback(
    (pts: [number, number][], p: [number, number]) => {
      const last = pts[pts.length - 1]
      if (!last) return [...pts, p]
      const dx = p[0] - last[0]
      const dy = p[1] - last[1]
      if (dx * dx + dy * dy < POINT_EPS * POINT_EPS) return pts
      return [...pts, p]
    },
    [],
  )

  const commitStrokeToActiveLayer = useCallback(
    (stroke: VectorBoardStroke) => {
      const active = getActiveLayer(document)
      if (!active) return
      onDocumentChange({
        ...document,
        layers: document.layers.map((L) =>
          L.id !== active.id
            ? L
            : { ...L, strokes: [...L.strokes, stroke] },
        ),
      })
    },
    [document, onDocumentChange],
  )

  const strokeWidthNFromCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return 0.004
    const r = canvas.getBoundingClientRect()
    const m = Math.max(1, Math.min(r.width, r.height))
    return strokeWidthPx / m
  }, [strokeWidthPx])

  const commitPenBezierDraft = useCallback(
    (closed = false) => {
      const d = draftRef.current
      if (d?.kind !== 'pen-bezier' || d.anchors.length < 2) return
      const fill =
        closed &&
        fillColor &&
        fillColor !== 'transparent'
          ? fillColor
          : ''
      commitStrokeToActiveLayer({
        id: crypto.randomUUID(),
        kind: 'pen',
        points: [],
        penAnchors: d.anchors.map((q) => ({ ...q })),
        penClosed: closed ? true : undefined,
        stroke: strokeColor,
        strokeWidthN: strokeWidthNFromCanvas(),
        fill,
      })
      draftRef.current = null
      setDraft(null)
      setPenRemoveHintIndex(null)
      setPenCloseHover(false)
    },
    [commitStrokeToActiveLayer, fillColor, strokeColor, strokeWidthNFromCanvas],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Enter' && tool === 'pen') {
        const cur = draftRef.current
        if (cur?.kind === 'pen-bezier' && cur.anchors.length >= 2) {
          e.preventDefault()
          commitPenBezierDraft()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, tool, commitPenBezierDraft])

  const shapeFill = useCallback(() => {
    if (
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'polygon' ||
      tool === 'pen'
    ) {
      return fillColor && fillColor !== 'transparent' ? fillColor : ''
    }
    return ''
  }, [tool, fillColor])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toNorm(e.clientX, e.clientY)
    if (!p) return

    if (tool === 'move') {
      const hit = findTopStrokeAt(document, p[0], p[1])
      if (!hit) {
        setDocSelection(null)
        return
      }
      setDocSelection({ layerId: hit.layerId, strokeId: hit.stroke.id })
      moveDragRef.current = {
        layerId: hit.layerId,
        strokeId: hit.stroke.id,
        last: p,
        pointerId: e.pointerId,
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      const c = canvasRef.current
      if (c) c.style.cursor = 'grabbing'
      return
    }

    const active = getActiveLayer(document)
    if (!active || !active.visible) return

    if (tool === 'pen') {
      const cur = draftRef.current
      if (cur?.kind === 'pen-bezier') {
        const hit = hitTestPenBezier(cur, p[0], p[1])
        if (hit?.type === 'handle') {
          const next: PenBezierDraftState = {
            ...cur,
            selectedAnchor: hit.anchorIndex,
            drag: {
              type: 'handle',
              anchorIndex: hit.anchorIndex,
              which: hit.which,
            },
          }
          draftRef.current = next
          setDraft(next)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
        if (hit?.type === 'anchor') {
          if (e.altKey) {
            const nextAnchors = removePenAnchorAt(cur.anchors, hit.anchorIndex)
            if (nextAnchors.length === 0) {
              draftRef.current = null
              setDraft(null)
            } else {
              const next: PenBezierDraftState = {
                ...cur,
                anchors: nextAnchors,
                selectedAnchor: null,
                drag: null,
              }
              draftRef.current = next
              setDraft(next)
            }
            setPenRemoveHintIndex(null)
            setPenCloseHover(false)
            return
          }
          if (hit.anchorIndex === 0 && cur.anchors.length >= 2) {
            commitPenBezierDraft(true)
            return
          }
          const next: PenBezierDraftState = {
            ...cur,
            selectedAnchor: hit.anchorIndex,
            drag: null,
          }
          draftRef.current = next
          setDraft(next)
          return
        }
      }
      const prevAnchors =
        draftRef.current?.kind === 'pen-bezier'
          ? draftRef.current.anchors.map((a) => ({ ...a }))
          : []
      const anchors: VectorPenAnchor[] = [...prevAnchors, { x: p[0], y: p[1] }]
      const next: PenBezierDraftState = {
        kind: 'pen-bezier',
        anchors,
        selectedAnchor: null,
        drag: {
          type: 'place',
          anchorIndex: anchors.length - 1,
          startX: p[0],
          startY: p[1],
        },
      }
      draftRef.current = next
      setDraft(next)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    if (tool === 'pencil' || tool === 'polygon') {
      const next: PolylineDraftState = { kind: 'polyline', tool, points: [p] }
      draftRef.current = next
      setDraft(next)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    if (
      tool === 'line' ||
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'arrow'
    ) {
      const next: ShapeDraft = { kind: 'shape', tool, a: p }
      draftRef.current = next
      setDraft(next)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = toNorm(e.clientX, e.clientY)
    const canvas = canvasRef.current

    if (tool === 'move' && moveDragRef.current && pt) {
      const m = moveDragRef.current
      const ddx = pt[0] - m.last[0]
      const ddy = pt[1] - m.last[1]
      m.last = pt
      onDocumentChange(
        applyTranslateStrokeInDoc(
          document,
          m.layerId,
          m.strokeId,
          ddx,
          ddy,
        ),
      )
      return
    }

    if (tool === 'pen' && pt && canvas) {
      const cur = draftRef.current
      if (cur?.kind === 'pen-bezier' && e.altKey) {
        const hit = hitTestPenBezier(cur, pt[0], pt[1])
        if (hit?.type === 'anchor') {
          setPenRemoveHintIndex(hit.anchorIndex)
          setPenCloseHover(false)
          canvas.style.cursor = CURSOR_PEN_REMOVE
        } else {
          setPenRemoveHintIndex(null)
          setPenCloseHover(false)
          canvas.style.cursor = CURSOR_PEN_ADD
        }
      } else if (cur?.kind === 'pen-bezier' && !e.altKey && cur.anchors.length >= 2) {
        const hit = hitTestPenBezier(cur, pt[0], pt[1])
        const ch = hit?.type === 'anchor' && hit.anchorIndex === 0
        setPenCloseHover(ch)
        setPenRemoveHintIndex(null)
        canvas.style.cursor = CURSOR_PEN_ADD
      } else {
        setPenRemoveHintIndex(null)
        setPenCloseHover(false)
        canvas.style.cursor = CURSOR_PEN_ADD
      }
    } else if (tool !== 'pen') {
      setPenRemoveHintIndex(null)
      setPenCloseHover(false)
    }

    const d = draftRef.current
    if (!d) return
    if (!pt) return

    if (d.kind === 'pen-bezier' && d.drag) {
      if (d.drag.type === 'place') {
        const nextAnchors = d.anchors.map((a) => ({ ...a }))
        applySmoothPlacementHandles(nextAnchors, d.drag.anchorIndex, pt[0], pt[1])
        const nd: PenBezierDraftState = {
          ...d,
          anchors: nextAnchors,
        }
        draftRef.current = nd
        setDraft(nd)
        return
      }
      if (d.drag.type === 'handle') {
        const nextAnchors = d.anchors.map((a) => ({ ...a }))
        const a = nextAnchors[d.drag.anchorIndex]!
        if (d.drag.which === 'in') {
          a.inX = pt[0]
          a.inY = pt[1]
          a.outX = 2 * a.x - pt[0]
          a.outY = 2 * a.y - pt[1]
        } else {
          a.outX = pt[0]
          a.outY = pt[1]
          a.inX = 2 * a.x - pt[0]
          a.inY = 2 * a.y - pt[1]
        }
        const nd: PenBezierDraftState = { ...d, anchors: nextAnchors }
        draftRef.current = nd
        setDraft(nd)
        return
      }
    }

    if (d.kind === 'pen-bezier') return

    if (d.kind === 'polyline') {
      const next = appendPoint(d.points, pt)
      const nd: PolylineDraftState = { ...d, points: next }
      draftRef.current = nd
      setDraft(nd)
      return
    }

    if (d.kind !== 'shape') return
    const sh = d
    const nd: ShapeDraft = {
      kind: 'shape',
      tool: sh.tool,
      a: sh.a,
      b: pt,
    }
    draftRef.current = nd
    setDraft(nd)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (tool === 'move' && moveDragRef.current) {
      moveDragRef.current = null
      const el = e.target as HTMLElement
      if (
        typeof el.hasPointerCapture === 'function' &&
        el.hasPointerCapture(e.pointerId)
      ) {
        el.releasePointerCapture(e.pointerId)
      }
      const c = canvasRef.current
      if (c) c.style.cursor = 'grab'
      return
    }

    const d = draftRef.current
    if (!d) return

    if (d.kind === 'pen-bezier') {
      const el = e.target as HTMLElement
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId)
      }
      const pt = toNorm(e.clientX, e.clientY)
      if (d.drag?.type === 'place' && pt) {
        const moved = Math.hypot(pt[0] - d.drag.startX, pt[1] - d.drag.startY)
        const nextAnchors = d.anchors.map((a) => ({ ...a }))
        const i = d.drag.anchorIndex
        if (moved < PEN_CORNER_DRAG && i >= 0) {
          const B = nextAnchors[i]!
          delete B.inX
          delete B.inY
          delete B.outX
          delete B.outY
          if (i > 0) {
            const A = nextAnchors[i - 1]!
            delete A.outX
            delete A.outY
          }
        }
        const nd: PenBezierDraftState = {
          ...d,
          anchors: nextAnchors,
          drag: null,
        }
        draftRef.current = nd
        setDraft(nd)
        return
      }
      if (d.drag?.type === 'handle') {
        const nd: PenBezierDraftState = { ...d, drag: null }
        draftRef.current = nd
        setDraft(nd)
        return
      }
      return
    }

    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

    draftRef.current = null
    setDraft(null)

    const swN = strokeWidthNFromCanvas()
    const fill = shapeFill()

    if (d.kind === 'polyline') {
      if (d.tool === 'pencil') {
        if (d.points.length < 2) return
        commitStrokeToActiveLayer({
          id: crypto.randomUUID(),
          kind: 'pen',
          points: d.points,
          stroke: strokeColor,
          strokeWidthN: swN,
          fill: '',
        })
        return
      }
      if (d.tool === 'polygon') {
        if (d.points.length < 3) return
        commitStrokeToActiveLayer({
          id: crypto.randomUUID(),
          kind: 'polygon',
          points: d.points,
          stroke: '',
          strokeWidthN: 0,
          fill,
        })
        return
      }
      return
    }

    const sh = d
    const b = sh.b ?? sh.a
    if (sh.a[0] === b[0] && sh.a[1] === b[1]) return

    const kind: VectorStrokeKind = sh.tool
    const isFilledOnlyShape = kind === 'rect' || kind === 'ellipse'
    commitStrokeToActiveLayer({
      id: crypto.randomUUID(),
      kind,
      points: [sh.a, b],
      stroke: isFilledOnlyShape ? '' : strokeColor,
      strokeWidthN: isFilledOnlyShape ? 0 : swN,
      fill: isFilledOnlyShape ? fill : '',
    })
  }

  const clearActiveLayer = () => {
    const active = getActiveLayer(document)
    if (!active) return
    setDocSelection((prev) =>
      prev && prev.layerId === active.id ? null : prev,
    )
    onDocumentChange({
      ...document,
      layers: document.layers.map((L) =>
        L.id !== active.id ? L : { ...L, strokes: [] },
      ),
    })
  }

  const clearAll = () => {
    setDocSelection(null)
    onDocumentChange(emptyVectorBoardDocument())
  }

  const addLayer = () => {
    const n = document.layers.length + 1
    const L = createVectorBoardLayer(`Layer ${n}`)
    onDocumentChange({
      ...document,
      layers: [...document.layers, L],
      activeLayerId: L.id,
    })
  }

  const deleteLayer = (id: string) => {
    if (document.layers.length <= 1) return
    const next = document.layers.filter((l) => l.id !== id)
    let activeLayerId = document.activeLayerId
    if (activeLayerId === id) activeLayerId = next[0]!.id
    onDocumentChange({ ...document, layers: next, activeLayerId })
  }

  const moveLayer = (id: string, dir: -1 | 1) => {
    const i = document.layers.findIndex((l) => l.id === id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= document.layers.length) return
    const copy = [...document.layers]
    const t = copy[i]!
    copy[i] = copy[j]!
    copy[j] = t
    onDocumentChange({ ...document, layers: copy })
  }

  const setLayerVisible = (id: string, visible: boolean) => {
    onDocumentChange({
      ...document,
      layers: document.layers.map((L) =>
        L.id !== id ? L : { ...L, visible },
      ),
    })
  }

  if (!open) return null

  const canPlace = vectorDocHasRenderableStrokes(document)
  const fillAppliesToSelected =
    selectedStrokeForUi &&
    (selectedStrokeForUi.kind === 'rect' ||
      selectedStrokeForUi.kind === 'ellipse' ||
      selectedStrokeForUi.kind === 'polygon' ||
      (selectedStrokeForUi.kind === 'pen' &&
        selectedStrokeForUi.penClosed === true))
  const showFill =
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'polygon' ||
    tool === 'pen' ||
    (tool === 'move' && Boolean(fillAppliesToSelected))

  return (
    <div
      data-avnac-chrome
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={boardName}
      onClick={onClose}
    >
      <div
        className="flex h-[min(90vh,920px)] w-[min(96vw,1400px)] overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-[13.5rem] shrink-0 flex-col border-r border-black/[0.06] bg-neutral-50/90">
          <div className="border-b border-black/[0.06] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Layers
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2">
            {document.layers.map((L) => {
              const active = L.id === document.activeLayerId
              return (
                <div
                  key={L.id}
                  className={[
                    'flex flex-col rounded-xl border px-2 py-1.5',
                    active
                      ? 'border-[#8B3DFF]/40 bg-[#8B3DFF]/8'
                      : 'border-transparent bg-white/80',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-black/[0.06]"
                      title={L.visible ? 'Hide' : 'Show'}
                      aria-label={L.visible ? 'Hide layer' : 'Show layer'}
                      onClick={() => setLayerVisible(L.id, !L.visible)}
                    >
                      <HugeiconsIcon
                        icon={L.visible ? ViewIcon : ViewOffSlashIcon}
                        size={16}
                        strokeWidth={1.75}
                      />
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-neutral-800"
                      onClick={() =>
                        onDocumentChange({
                          ...document,
                          activeLayerId: L.id,
                        })
                      }
                    >
                      {L.name}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-500 hover:bg-black/[0.06] hover:text-neutral-800"
                      title="Move down"
                      onClick={() => moveLayer(L.id, -1)}
                    >
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-500 hover:bg-black/[0.06] hover:text-neutral-800"
                      title="Move up"
                      onClick={() => moveLayer(L.id, 1)}
                    >
                      <HugeiconsIcon
                        icon={ArrowUp01Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                    </button>
                    <button
                      type="button"
                      disabled={document.layers.length <= 1}
                      className="rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                      title="Delete layer"
                      onClick={() => deleteLayer(L.id)}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-black/[0.06] p-2">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-black/[0.08] bg-white py-2 text-[13px] font-medium text-neutral-800 hover:bg-black/[0.03]"
              onClick={addLayer}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
              Add layer
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
            <h2 className="m-0 min-w-0 truncate text-base font-semibold text-neutral-900 sm:text-lg">
              {boardName}
            </h2>
            <button
              type="button"
              className={floatingToolbarIconButton(false)}
              onClick={onClose}
              aria-label="Close vector workspace"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={20} strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-b border-black/[0.06] bg-[linear-gradient(180deg,rgba(250,250,249,0.9)_0%,rgba(255,255,255,0.5)_100%)] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <FloatingToolbarShell role="toolbar" aria-label="Drawing tools">
                  <div className="flex flex-wrap items-center gap-0.5 py-1 pl-1 pr-2">
                    {(
                      [
                        ['move', 'Move', Cursor02Icon],
                        ['pencil', 'Pencil', Pen01Icon],
                        ['pen', 'Pen', PenTool03Icon],
                        ['line', 'Line', SolidLine01Icon],
                        ['rect', 'Rectangle', SquareIcon],
                        ['ellipse', 'Ellipse', CircleIcon],
                        ['arrow', 'Arrow', ArrowRight01Icon],
                        ['polygon', 'Polygon', PolygonIcon],
                      ] as const
                    ).map(([id, label, icon]) => (
                      <button
                        key={id}
                        type="button"
                        className={floatingToolbarIconButton(tool === id)}
                        title={label}
                        aria-label={label}
                        aria-pressed={tool === id}
                        onClick={() => setTool(id)}
                      >
                        <HugeiconsIcon
                          icon={icon}
                          size={18}
                          strokeWidth={1.75}
                        />
                      </button>
                    ))}
                  </div>
                </FloatingToolbarShell>
                <FloatingToolbarShell role="toolbar" aria-label="Stroke and fill">
                  <div className="flex flex-wrap items-center gap-0.5 py-1 pl-1 pr-2">
                    <StrokeToolbarPopover
                      strokeWidthMin={1}
                      strokeWidthMax={16}
                      strokeWidthPx={strokeWidthPx}
                      strokePaint={{ type: 'solid', color: strokeColor }}
                      onStrokeWidthChange={(px) => {
                        setStrokeWidthPx(px)
                        if (docSelection) {
                          const canvas = canvasRef.current
                          const rw = canvas?.getBoundingClientRect().width ?? 1
                          const rh = canvas?.getBoundingClientRect().height ?? 1
                          const m = Math.max(1, Math.min(rw, rh))
                          onDocumentChange(
                            updateVectorStrokeInDoc(
                              document,
                              docSelection.layerId,
                              docSelection.strokeId,
                              { strokeWidthN: px / m },
                            ),
                          )
                        }
                      }}
                      onStrokePaintChange={(v) => {
                        const hex = bgValuePreferSolid(v)
                        setStrokeColor(hex)
                        if (docSelection) {
                          onDocumentChange(
                            updateVectorStrokeInDoc(
                              document,
                              docSelection.layerId,
                              docSelection.strokeId,
                              { stroke: hex },
                            ),
                          )
                        }
                      }}
                    />
                    {showFill ? (
                      <>
                        <FloatingToolbarDivider />
                        <PaintPopoverControl
                          compact
                          value={{ type: 'solid', color: fillColor }}
                          onChange={(v) => {
                            const hex = bgValuePreferSolid(v)
                            setFillColor(hex)
                            if (docSelection) {
                              const fill =
                                hex && hex !== 'transparent' ? hex : ''
                              onDocumentChange(
                                updateVectorStrokeInDoc(
                                  document,
                                  docSelection.layerId,
                                  docSelection.strokeId,
                                  { fill },
                                ),
                              )
                            }
                          }}
                          title="Fill color"
                          ariaLabel="Fill color"
                        />
                      </>
                    ) : null}
                  </div>
                </FloatingToolbarShell>
              </div>
              <div className="ml-auto flex shrink-0 items-center">
                <FloatingToolbarShell aria-label="Board actions">
                  <div className="flex flex-wrap items-center justify-end gap-0.5 py-1 pl-1 pr-2">
                    <button
                      type="button"
                      className={[
                        floatingToolbarIconButton(false, { wide: true }),
                        'px-2.5 text-[13px] font-medium',
                      ].join(' ')}
                      onClick={clearActiveLayer}
                    >
                      Clear layer
                    </button>
                    <FloatingToolbarDivider />
                    <button
                      type="button"
                      className={[
                        floatingToolbarIconButton(false, { wide: true }),
                        'px-2.5 text-[13px] font-medium',
                      ].join(' ')}
                      onClick={clearAll}
                    >
                      Clear all
                    </button>
                    <FloatingToolbarDivider />
                    <button
                      type="button"
                      disabled={!canPlace}
                      className={[
                        'flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] font-semibold outline-none transition-colors',
                        canPlace
                          ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                          : 'cursor-not-allowed bg-neutral-200/90 text-neutral-500',
                      ].join(' ')}
                      onClick={onRequestPlaceOnCanvas}
                    >
                      Place on canvas
                    </button>
                  </div>
                </FloatingToolbarShell>
              </div>
            </div>
            {tool === 'pen' ? (
              <p className="m-0 text-[11px] leading-snug text-neutral-500">
                Plus cursor adds points; drag while placing for curves. Alt-click
                an anchor to remove it. Click the first point again to close the
                shape (fill applies when closed). Enter finishes without closing.
              </p>
            ) : null}
          </div>

          <div
            ref={wrapRef}
            className="relative min-h-0 flex-1 bg-neutral-200/40 p-3 sm:p-4"
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full max-w-none touch-none rounded-lg border border-black/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)]"
              aria-label="Vector drawing canvas"
              style={{ touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => {
                setPenRemoveHintIndex(null)
                setPenCloseHover(false)
                const c = canvasRef.current
                if (c) {
                  if (tool === 'pen') c.style.cursor = CURSOR_PEN_ADD
                  else if (tool === 'move') c.style.cursor = 'grab'
                  else c.style.cursor = 'crosshair'
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
