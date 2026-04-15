import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  BackgroundIcon,
  Delete02Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons'
import type { Canvas, FabricObject, IText } from 'fabric'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useViewportAwarePopoverPlacement } from '../hooks/use-viewport-aware-popover'
import { installArtboardCenterSnap } from '../lib/fabric-artboard-center-snap'
import {
  ensureAvnacArrowEndpoints,
  installArrowEndpointControls,
  installLineEndpointControls,
  syncAvnacArrowCurveControlVisibility,
  syncAvnacArrowEndpointsFromGeometry,
} from '../lib/fabric-line-arrow-controls'
import {
  attachFabricHoverOutline,
  EDITOR_ACCENT_PURPLE,
  installFabricSelectionChrome,
} from '../lib/fabric-selection-chrome'
import { regularPolygonPoints, starPolygonPoints } from '../lib/avnac-shape-geometry'
import {
  arrowDisplayColor,
  createArrowGroup,
  getArrowParts,
  layoutArrowGroup,
} from '../lib/avnac-stroke-arrow'
import {
  getAvnacShapeMeta,
  setAvnacShapeMeta,
  type ArrowLineStyle,
  type ArrowPathType,
  type AvnacShapeMeta,
} from '../lib/avnac-shape-meta'
import {
  applyBgValueToFill,
  applyBgValueToStroke,
  bgValueFromFabricFill,
  bgValueFromFabricStroke,
  bgValueSolidFallback,
  getAvnacStroke,
  setAvnacStroke,
} from '../lib/avnac-fill-paint'
import {
  disableTextboxAutoWidth,
  enableTextboxAutoWidth,
  fitTextboxWidthToContent,
  textboxUsesAutoWidth,
} from '../lib/avnac-textbox-autowidth'
import { linearGradientForBox } from '../lib/fabric-linear-gradient'
import { loadGoogleFontFamily } from '../lib/load-google-font'
import ShapeOptionsToolbar from './shape-options-toolbar'
import ShapesPopover, {
  iconForShapesQuickAdd,
  type PopoverShapeKind,
  type ShapesQuickAddKind,
} from './shapes-popover'
import TextFormatToolbar from './text-format-toolbar'
import type { TextFormatToolbarValues } from './text-format-toolbar'
import BackgroundPopover, {
  bgValueToSwatch,
  type BgValue,
} from './background-popover'
import CanvasZoomSlider from './canvas-zoom-slider'
import CanvasElementToolbar, {
  type CanvasAlignKind,
} from './canvas-element-toolbar'
import { getAvnacLocked, setAvnacLocked } from '../lib/avnac-object-lock'

const ARTBOARD_W = 4000
const ARTBOARD_H = 4000
const ARTBOARD_ALIGN_PAD = 32
const ARTBOARD_ALIGN_ALREADY_EPS = 2
const ZOOM_MIN_PCT = 5
const ZOOM_MAX_PCT = 100

const OBJECT_SERIAL_KEYS = ['avnacShape', 'avnacLocked'] as const

const DEFAULT_PAINT: BgValue = { type: 'solid', color: '#262626' }

const FIT_PADDING = 32
const FONT_SIZE = Math.round(ARTBOARD_W * 0.04)
const RECT_W = Math.round(ARTBOARD_W * 0.2)
const RECT_H = Math.round(ARTBOARD_H * 0.12)
const RECT_RX = Math.round(ARTBOARD_W * 0.004)

function artboardAlignAlreadySatisfied(br: {
  left: number
  top: number
  width: number
  height: number
}): Record<CanvasAlignKind, boolean> {
  const pad = ARTBOARD_ALIGN_PAD
  const eps = ARTBOARD_ALIGN_ALREADY_EPS
  return {
    left: Math.abs(br.left - pad) <= eps,
    centerH: Math.abs(br.left + br.width / 2 - ARTBOARD_W / 2) <= eps,
    right: Math.abs(br.left + br.width - (ARTBOARD_W - pad)) <= eps,
    top: Math.abs(br.top - pad) <= eps,
    centerV: Math.abs(br.top + br.height / 2 - ARTBOARD_H / 2) <= eps,
    bottom: Math.abs(br.top + br.height - (ARTBOARD_H - pad)) <= eps,
  }
}

const QUICK_SHAPE_TITLE: Record<ShapesQuickAddKind, string> = {
  generic: 'Add rectangle',
  rect: 'Add rectangle',
  ellipse: 'Add ellipse',
  polygon: 'Add polygon',
  star: 'Add star',
  line: 'Add line',
  arrow: 'Add arrow',
}

function toolbarIconBtn(disabled?: boolean) {
  const base =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 outline-none transition-colors hover:bg-black/[0.06]'
  if (disabled) {
    return `${base} pointer-events-none cursor-not-allowed opacity-35`
  }
  return base
}

function backgroundTopBtn(disabled?: boolean) {
  const base =
    'flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-neutral-700 outline-none transition-colors hover:bg-black/[0.06]'
  if (disabled) {
    return `${base} pointer-events-none cursor-not-allowed opacity-35`
  }
  return base
}

function isEventOnFabricCanvas(canvas: Canvas, target: EventTarget | null) {
  if (!(target instanceof Node)) return false
  const lower = canvas.getElement()
  const upper = canvas.upperCanvasEl
  return lower.contains(target) || upper.contains(target)
}

/** Local outer radius for centered polygon/star points after scaling is baked into geometry. */
function outerRadiusFromScaledPolygon(obj: FabricObject) {
  return Math.max(
    24,
    Math.min(obj.getScaledWidth(), obj.getScaledHeight()) / 2,
  )
}

function primaryFontFamily(css: string) {
  const first = css.split(',')[0]?.trim() ?? 'Inter'
  return first.replace(/^["']|["']$/g, '')
}

function readTextFormat(obj: IText): TextFormatToolbarValues {
  const fillStyle = bgValueFromFabricFill(obj)
  const ta = obj.textAlign ?? 'left'
  const textAlign =
    ta === 'center' || ta === 'right' || ta === 'justify' ? ta : 'left'
  const w = obj.fontWeight
  const bold =
    w === 'bold' ||
    w === '700' ||
    w === 700 ||
    (typeof w === 'number' && w >= 600)
  return {
    fontFamily: primaryFontFamily(String(obj.fontFamily ?? 'Inter')),
    fontSize: obj.fontSize ?? FONT_SIZE,
    fillStyle,
    textAlign,
    bold,
    italic: obj.fontStyle === 'italic',
    underline: !!obj.underline,
  }
}

export type FabricEditorHandle = {
  exportPng: () => void
}

type FabricEditorProps = {
  onReadyChange?: (ready: boolean) => void
}

const FabricEditor = forwardRef<FabricEditorHandle, FabricEditorProps>(
  function FabricEditor({ onReadyChange }, ref) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const artboardFrameRef = useRef<HTMLDivElement>(null)
  const canvasZoomRef = useRef<HTMLDivElement>(null)
  const elementToolbarRef = useRef<HTMLDivElement>(null)
  const artboardClusterRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const zoomUserAdjustedRef = useRef(false)
  const selectionToolsRef = useRef<HTMLDivElement>(null)
  const shapeToolSplitRef = useRef<HTMLDivElement>(null)
  const bottomToolbarRef = useRef<HTMLDivElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const fabricModRef = useRef<typeof import('fabric') | null>(null)

  const [ready, setReady] = useState(false)
  const [zoomPercent, setZoomPercent] = useState<number | null>(null)
  const [bgValue, setBgValue] = useState<BgValue>({ type: 'solid', color: '#ffffff' })
  const [bgPopoverOpen, setBgPopoverOpen] = useState(false)
  const [selectedPaint, setSelectedPaint] = useState<BgValue>(DEFAULT_PAINT)
  const [hasObjectSelected, setHasObjectSelected] = useState(false)
  const [canvasBodySelected, setCanvasBodySelected] = useState(false)
  const [selectionRev, selectionTick] = useReducer((n: number) => n + 1, 0)
  const [textToolbarValues, setTextToolbarValues] =
    useState<TextFormatToolbarValues | null>(null)
  const [shapesPopoverOpen, setShapesPopoverOpen] = useState(false)
  const [shapesQuickAddKind, setShapesQuickAddKind] =
    useState<ShapesQuickAddKind>('generic')
  const [shapeToolbarModel, setShapeToolbarModel] = useState<{
    meta: AvnacShapeMeta
    paint: BgValue
  } | null>(null)
  const [artboardSnapGuides, setArtboardSnapGuides] = useState({
    vertical: false,
    horizontal: false,
  })
  const [artboardEmptyHovered, setArtboardEmptyHovered] = useState(false)
  const [elementToolbarLayout, setElementToolbarLayout] = useState<{
    left: number
    top: number
    placement: 'above' | 'below'
  } | null>(null)

  const backgroundPopoverAnchorRef = useRef<HTMLDivElement>(null)
  const backgroundPopoverPanelRef = useRef<HTMLDivElement>(null)
  const pickBackgroundPopoverPanel = useCallback(
    () => backgroundPopoverPanelRef.current,
    [],
  )
  const {
    openUpward: backgroundPopoverOpenUpward,
    shiftX: backgroundPopoverShiftX,
  } = useViewportAwarePopoverPlacement(
    bgPopoverOpen,
    backgroundPopoverAnchorRef,
    440,
    pickBackgroundPopoverPanel,
    'center',
  )

  const syncTextToolbar = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return

    const targets = canvas.getActiveObjects()
    const obj = canvas.getActiveObject()
    if (
      targets.length !== 1 ||
      !obj ||
      !(obj instanceof mod.IText)
    ) {
      setTextToolbarValues(null)
      return
    }

    setTextToolbarValues(readTextFormat(obj))
  }, [])

  const syncShapeToolbar = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const targets = canvas.getActiveObjects()
    const obj = canvas.getActiveObject()
    const meta = getAvnacShapeMeta(obj)
    const shapeBarKind =
      meta &&
      (meta.kind === 'rect' ||
        meta.kind === 'ellipse' ||
        meta.kind === 'polygon' ||
        meta.kind === 'star' ||
        meta.kind === 'line' ||
        meta.kind === 'arrow')
    if (targets.length !== 1 || !obj || !shapeBarKind || !meta) {
      setShapeToolbarModel(null)
      return
    }
    let paint: BgValue
    if (meta.kind === 'line') {
      paint = bgValueFromFabricStroke(obj)
    } else if (meta.kind === 'arrow' && obj instanceof mod.Group) {
      paint =
        getAvnacStroke(obj) ??
        ({ type: 'solid', color: arrowDisplayColor(obj) } satisfies BgValue)
    } else {
      paint = bgValueFromFabricFill(obj)
    }
    setShapeToolbarModel({ meta: { ...meta }, paint })
    if (meta.kind === 'arrow' && obj instanceof mod.Group) {
      syncAvnacArrowCurveControlVisibility(obj)
    }
    obj.setCoords()
  }, [])

  const onTextFormatChange = useCallback(
    (patch: Partial<TextFormatToolbarValues>) => {
      const canvas = fabricCanvasRef.current
      const mod = fabricModRef.current
      if (!canvas || !mod) return
      const obj = canvas.getActiveObject()
      if (!(obj instanceof mod.IText)) return

      if (patch.fontFamily !== undefined) {
        loadGoogleFontFamily(patch.fontFamily)
        obj.set('fontFamily', patch.fontFamily)
      }
      if (patch.fontSize !== undefined) obj.set('fontSize', patch.fontSize)
      if (patch.fillStyle !== undefined) {
        applyBgValueToFill(mod, obj, patch.fillStyle)
        setSelectedPaint(patch.fillStyle)
      }
      if (patch.textAlign !== undefined) obj.set('textAlign', patch.textAlign)
      if (patch.bold !== undefined)
        obj.set('fontWeight', patch.bold ? '700' : '400')
      if (patch.italic !== undefined)
        obj.set('fontStyle', patch.italic ? 'italic' : 'normal')
      if (patch.underline !== undefined) obj.set('underline', patch.underline)

      if (obj instanceof mod.Textbox && textboxUsesAutoWidth(obj)) {
        fitTextboxWidthToContent(obj)
      }

      obj.setCoords()
      canvas.requestRenderAll()
      syncTextToolbar()
    },
    [syncTextToolbar],
  )

  const applyPaintToSelection = useCallback(
    (v: BgValue) => {
      setSelectedPaint(v)
      const canvas = fabricCanvasRef.current
      const mod = fabricModRef.current
      if (!canvas || !mod) return
      const obj = canvas.getActiveObject() as FabricObject | undefined
      if (!obj) return
      const meta = getAvnacShapeMeta(obj)

      if (obj instanceof mod.Line || meta?.kind === 'line') {
        applyBgValueToStroke(mod, obj, v)
      } else if (obj instanceof mod.Group && meta?.kind === 'arrow') {
        setAvnacStroke(obj, v)
        const hex = bgValueSolidFallback(v)
        const parts = getArrowParts(obj)
        if (parts) {
          parts.shaft.set('stroke', hex)
          parts.head.set('fill', hex)
        }
      } else if (obj instanceof mod.IText) {
        applyBgValueToFill(mod, obj, v)
      } else {
        applyBgValueToFill(mod, obj, v)
      }

      canvas.requestRenderAll()
      syncTextToolbar()
      syncShapeToolbar()
    },
    [syncTextToolbar, syncShapeToolbar],
  )

  const syncSelection = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas) return
    const obj = canvas.getActiveObject()
    setHasObjectSelected(!!obj)
    if (!obj || !mod) {
      selectionTick()
      return
    }
    if (obj instanceof mod.Line) {
      setSelectedPaint(bgValueFromFabricStroke(obj))
    } else if (
      obj instanceof mod.Group &&
      getAvnacShapeMeta(obj)?.kind === 'arrow'
    ) {
      setSelectedPaint(
        getAvnacStroke(obj) ??
          ({ type: 'solid', color: arrowDisplayColor(obj) } satisfies BgValue),
      )
    } else {
      setSelectedPaint(bgValueFromFabricFill(obj))
    }
    selectionTick()
  }, [])

  const syncFillFromSelection = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!obj) return
    if (obj instanceof mod.Line) {
      setSelectedPaint(bgValueFromFabricStroke(obj))
      return
    }
    if (
      obj instanceof mod.Group &&
      getAvnacShapeMeta(obj)?.kind === 'arrow'
    ) {
      setSelectedPaint(
        getAvnacStroke(obj) ??
          ({ type: 'solid', color: arrowDisplayColor(obj) } satisfies BgValue),
      )
      return
    }
    setSelectedPaint(bgValueFromFabricFill(obj))
  }, [])

  const applyCanvasZoom = useCallback(
    (pct: number) => {
      const canvas = fabricCanvasRef.current
      if (!canvas) return
      const clamped = Math.max(
        ZOOM_MIN_PCT,
        Math.min(ZOOM_MAX_PCT, Math.round(pct)),
      )
      const s = clamped / 100
      const dw = ARTBOARD_W * s
      const dh = ARTBOARD_H * s
      canvas.setDimensions({ width: dw, height: dh }, { cssOnly: true })
      canvas.calcOffset()
      canvas.requestRenderAll()
      setZoomPercent(clamped)
      queueMicrotask(() => {
        syncTextToolbar()
        syncShapeToolbar()
      })
    },
    [syncTextToolbar, syncShapeToolbar],
  )

  const fitArtboardToViewport = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return

    const cw = viewport.clientWidth - FIT_PADDING * 2
    const ch = viewport.clientHeight - FIT_PADDING * 2
    if (cw <= 0 || ch <= 0) return

    const raw = Math.min(cw / ARTBOARD_W, ch / ARTBOARD_H) * 0.98
    const scale = Math.min(1, raw)
    const fitPct = Math.max(
      ZOOM_MIN_PCT,
      Math.min(ZOOM_MAX_PCT, Math.round(scale * 100)),
    )
    applyCanvasZoom(fitPct)
  }, [applyCanvasZoom])

  const onZoomSliderChange = useCallback(
    (pct: number) => {
      zoomUserAdjustedRef.current = true
      applyCanvasZoom(pct)
    },
    [applyCanvasZoom],
  )

  const onZoomFitRequest = useCallback(() => {
    zoomUserAdjustedRef.current = false
    fitArtboardToViewport()
  }, [fitArtboardToViewport])

  const updateElementToolbarLayout = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const frame = artboardFrameRef.current
    if (!canvas || !frame || !ready) {
      setElementToolbarLayout(null)
      return
    }
    const active = canvas.getActiveObject()
    if (!active) {
      setElementToolbarLayout(null)
      return
    }
    if ('isEditing' in active && (active as IText).isEditing) {
      setElementToolbarLayout(null)
      return
    }
    const br = active.getBoundingRect()
    const cw = canvas.getWidth()
    const ch = canvas.getHeight()
    const fw = frame.offsetWidth
    if (cw <= 0 || ch <= 0 || fw <= 0) {
      setElementToolbarLayout(null)
      return
    }
    const sx = fw / cw
    const sy = frame.offsetHeight / ch
    const centerX = (br.left + br.width / 2) * sx
    const topY = br.top * sy
    const bottomY = (br.top + br.height) * sy

    const cluster = artboardClusterRef.current
    const viewport = viewportRef.current
    const estToolbarH = 48
    const gap = 10
    const pad = 8
    let placement: 'above' | 'below' = 'above'
    let anchorY = topY
    if (cluster && viewport) {
      const cr = cluster.getBoundingClientRect()
      const vr = viewport.getBoundingClientRect()
      const anchorTopScreen = cr.top + topY
      const anchorBottomScreen = cr.top + bottomY
      const spaceAbove = anchorTopScreen - vr.top - pad
      const spaceBelow = vr.bottom - anchorBottomScreen - pad
      if (spaceAbove >= estToolbarH + gap) {
        placement = 'above'
        anchorY = topY
      } else if (spaceBelow >= estToolbarH + gap) {
        placement = 'below'
        anchorY = bottomY
      } else {
        placement = spaceAbove >= spaceBelow ? 'above' : 'below'
        anchorY = placement === 'above' ? topY : bottomY
      }
    }

    setElementToolbarLayout({ left: centerX, top: anchorY, placement })
  }, [ready])

  const refreshElementToolbarLayoutRef = useRef(updateElementToolbarLayout)
  refreshElementToolbarLayoutRef.current = updateElementToolbarLayout

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod || !ready) return
    if (bgValue.type === 'solid') {
      canvas.backgroundColor = bgValue.color
    } else {
      canvas.backgroundColor = linearGradientForBox(
        mod,
        bgValue.stops,
        bgValue.angle,
        ARTBOARD_W,
        ARTBOARD_H,
      )
    }
    canvas.requestRenderAll()
  }, [bgValue, ready])

  useEffect(() => {
    const el = canvasElRef.current
    if (!el) return

    let disposed = false
    let canvas: Canvas | null = null
    let removeArtboardCenterSnap: (() => void) | undefined

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      const c = fabricCanvasRef.current
      if (!c) return
      const objs = c.getActiveObjects()
      if (objs.length === 0) return
      e.preventDefault()
      for (const o of objs) {
        c.remove(o)
      }
      c.discardActiveObject()
      c.requestRenderAll()
      setHasObjectSelected(false)
      setCanvasBodySelected(true)
      selectionTick()
    }

    void (async () => {
      const mod = await import('fabric')
      if (disposed || !canvasElRef.current) return

      mod.config.configure({
        maxCacheSideLimit: 8192,
        perfLimitSizeTotal: 16 * 1024 * 1024,
      })
      Object.assign(mod.IText.ownDefaults, { objectCaching: false })

      fabricModRef.current = mod
      installFabricSelectionChrome(mod)
      canvas = new mod.Canvas(canvasElRef.current, {
        width: ARTBOARD_W,
        height: ARTBOARD_H,
        backgroundColor: '#ffffff',
        preserveObjectStacking: true,
      })

      if (disposed) {
        void canvas.dispose()
        fabricModRef.current = null
        return
      }

      fabricCanvasRef.current = canvas
      attachFabricHoverOutline(canvas)
      removeArtboardCenterSnap = installArtboardCenterSnap(canvas, {
        width: ARTBOARD_W,
        height: ARTBOARD_H,
        onGuidesChange: setArtboardSnapGuides,
      })

      const onSelect = () => {
        syncFillFromSelection()
        setHasObjectSelected(true)
        setCanvasBodySelected(false)
        selectionTick()
        syncTextToolbar()
        syncShapeToolbar()
      }
      const onClear = () => {
        setHasObjectSelected(false)
        setCanvasBodySelected(true)
        setSelectedPaint(DEFAULT_PAINT)
        setTextToolbarValues(null)
        setShapeToolbarModel(null)
        selectionTick()
      }

      const onCanvasMouseDown = (opt: { target?: FabricObject | null }) => {
        setArtboardEmptyHovered(!opt.target)
        if (opt.target) {
          setCanvasBodySelected(false)
        } else {
          setCanvasBodySelected(true)
        }
      }

      const onArtboardPointerMove = (opt: { target?: FabricObject | null }) => {
        const overEmpty = !opt.target
        setArtboardEmptyHovered((prev) =>
          prev === overEmpty ? prev : overEmpty,
        )
      }
      const onArtboardPointerOut = () => {
        setArtboardEmptyHovered((prev) => (prev ? false : prev))
      }

      canvas.on('selection:created', onSelect)
      canvas.on('selection:updated', onSelect)
      canvas.on('selection:cleared', onClear)
      canvas.on('mouse:down', onCanvasMouseDown)
      canvas.on('mouse:over', onArtboardPointerMove)
      canvas.on('mouse:move', onArtboardPointerMove)
      canvas.on('mouse:out', onArtboardPointerOut)

      window.addEventListener('keydown', onKeyDown)
      setReady(true)
      setHasObjectSelected(false)
      setCanvasBodySelected(true)

      if (disposed) {
        removeArtboardCenterSnap?.()
        removeArtboardCenterSnap = undefined
        canvas.off('selection:created', onSelect)
        canvas.off('selection:updated', onSelect)
        canvas.off('selection:cleared', onClear)
        canvas.off('mouse:down', onCanvasMouseDown)
        canvas.off('mouse:over', onArtboardPointerMove)
        canvas.off('mouse:move', onArtboardPointerMove)
        canvas.off('mouse:out', onArtboardPointerOut)
        window.removeEventListener('keydown', onKeyDown)
        void canvas.dispose()
        fabricCanvasRef.current = null
        fabricModRef.current = null
        setReady(false)
      }
    })()

    return () => {
      disposed = true
      zoomUserAdjustedRef.current = false
      window.removeEventListener('keydown', onKeyDown)
      removeArtboardCenterSnap?.()
      removeArtboardCenterSnap = undefined
      const c = fabricCanvasRef.current
      fabricCanvasRef.current = null
      fabricModRef.current = null
      setReady(false)
      void c?.dispose()
    }
  }, [syncFillFromSelection, syncTextToolbar, syncShapeToolbar])

  useEffect(() => {
    if (!ready) return
    const viewport = viewportRef.current
    const canvas = fabricCanvasRef.current
    if (!viewport || !canvas) return

    const fit = () => {
      const c = fabricCanvasRef.current
      const v = viewportRef.current
      if (!c || !v) return
      if (!zoomUserAdjustedRef.current) {
        fitArtboardToViewport()
      } else {
        c.calcOffset()
        c.requestRenderAll()
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [ready, fitArtboardToViewport])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod || !ready) return

    const bump = () => {
      refreshElementToolbarLayoutRef.current()
      syncTextToolbar()
      syncShapeToolbar()
    }

    const onTextChanged = (opt: { target: unknown }) => {
      const target = opt.target
      if (
        target instanceof mod.Textbox &&
        textboxUsesAutoWidth(target)
      ) {
        fitTextboxWidthToContent(target)
        canvas.requestRenderAll()
      }
      bump()
    }

    const onModified = (opt: {
      target?: FabricObject
      action?: string
    }) => {
      const target = opt.target
      if (
        target instanceof mod.Textbox &&
        (opt.action === 'resizing' || opt.action === 'scaling')
      ) {
        disableTextboxAutoWidth(target)
      }
      if (
        target instanceof mod.Group &&
        getAvnacShapeMeta(target)?.kind === 'arrow'
      ) {
        syncAvnacArrowEndpointsFromGeometry(target)
      }
      bump()
    }

    canvas.on('object:moving', bump)
    canvas.on('object:scaling', bump)
    canvas.on('object:rotating', bump)
    canvas.on('object:modified', onModified)
    canvas.on('text:changed', onTextChanged)
    return () => {
      canvas.off('object:moving', bump)
      canvas.off('object:scaling', bump)
      canvas.off('object:rotating', bump)
      canvas.off('object:modified', onModified)
      canvas.off('text:changed', onTextChanged)
    }
  }, [ready, syncTextToolbar, syncShapeToolbar])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !ready) return
    const bump = () => {
      refreshElementToolbarLayoutRef.current()
      syncTextToolbar()
      syncShapeToolbar()
    }
    vp.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('resize', bump)
    return () => {
      vp.removeEventListener('scroll', bump)
      window.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)
    }
  }, [ready, syncTextToolbar, syncShapeToolbar])

  useLayoutEffect(() => {
    if (!ready) return
    syncShapeToolbar()
  }, [ready, selectionRev, zoomPercent, syncShapeToolbar])

  useLayoutEffect(() => {
    if (!ready) return
    updateElementToolbarLayout()
  }, [
    ready,
    selectionRev,
    zoomPercent,
    hasObjectSelected,
    updateElementToolbarLayout,
  ])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || !ready) return
    const ed = () => updateElementToolbarLayout()
    canvas.on('text:editing:entered', ed)
    canvas.on('text:editing:exited', ed)
    return () => {
      canvas.off('text:editing:entered', ed)
      canvas.off('text:editing:exited', ed)
    }
  }, [ready, updateElementToolbarLayout])

  useEffect(() => {
    if (!shapesPopoverOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (shapeToolSplitRef.current?.contains(t)) return
      setShapesPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [shapesPopoverOpen])

  useEffect(() => {
    if (!bgPopoverOpen) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (selectionToolsRef.current?.contains(n)) return
      if (elementToolbarRef.current?.contains(n)) return
      setBgPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [bgPopoverOpen])

  useEffect(() => {
    if (!canvasBodySelected) setBgPopoverOpen(false)
  }, [canvasBodySelected])

  useEffect(() => {
    if (!ready) return

    const onDocMouseDown = (e: MouseEvent) => {
      const c = fabricCanvasRef.current
      if (!c) return
      const t = e.target as Node
      if (selectionToolsRef.current?.contains(t)) return
      if (bottomToolbarRef.current?.contains(t)) return
      if (canvasZoomRef.current?.contains(t)) return
      if (elementToolbarRef.current?.contains(t)) return
      if (isEventOnFabricCanvas(c, t)) return

      if (c.getActiveObject()) {
        c.discardActiveObject()
        c.requestRenderAll()
      } else {
        setCanvasBodySelected(false)
      }
    }

    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [ready])

  function addText() {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    loadGoogleFontFamily('Inter')
    const t = new mod.Textbox('Your text', {
      left: ARTBOARD_W / 2,
      top: ARTBOARD_H / 2,
      originX: 'center',
      originY: 'center',
      width: 20,
      fontSize: FONT_SIZE,
      fill: bgValueSolidFallback(selectedPaint),
      fontFamily: 'Inter',
    })
    t.setControlsVisibility({ mt: false, mb: false })
    enableTextboxAutoWidth(t)
    fitTextboxWidthToContent(t)
    applyBgValueToFill(mod, t, selectedPaint)
    canvas.add(t)
    canvas.setActiveObject(t)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addRect() {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const r = new mod.Rect({
      left: ARTBOARD_W / 2 - RECT_W / 2,
      top: ARTBOARD_H / 2 - RECT_H / 2,
      width: RECT_W,
      height: RECT_H,
      fill: bgValueSolidFallback(selectedPaint),
      rx: RECT_RX,
      ry: RECT_RX,
    })
    setAvnacShapeMeta(r, { kind: 'rect' })
    applyBgValueToFill(mod, r, selectedPaint)
    canvas.add(r)
    canvas.setActiveObject(r)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addEllipseShape() {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const r = Math.round(Math.min(RECT_W, RECT_H) / 2)
    const e = new mod.Ellipse({
      left: ARTBOARD_W / 2,
      top: ARTBOARD_H / 2,
      rx: r,
      ry: r,
      fill: bgValueSolidFallback(selectedPaint),
      originX: 'center',
      originY: 'center',
    })
    setAvnacShapeMeta(e, { kind: 'ellipse' })
    applyBgValueToFill(mod, e, selectedPaint)
    canvas.add(e)
    canvas.setActiveObject(e)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addPolygonShape(sides = 6) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const R = Math.round(RECT_W * 0.36)
    const pts = regularPolygonPoints(sides, R)
    const p = new mod.Polygon(pts, {
      left: ARTBOARD_W / 2,
      top: ARTBOARD_H / 2,
      fill: bgValueSolidFallback(selectedPaint),
      originX: 'center',
      originY: 'center',
    })
    setAvnacShapeMeta(p, { kind: 'polygon', polygonSides: sides })
    applyBgValueToFill(mod, p, selectedPaint)
    canvas.add(p)
    canvas.setActiveObject(p)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addStarShape(points = 5) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const R = Math.round(RECT_W * 0.38)
    const pts = starPolygonPoints(points, R)
    const p = new mod.Polygon(pts, {
      left: ARTBOARD_W / 2,
      top: ARTBOARD_H / 2,
      fill: bgValueSolidFallback(selectedPaint),
      originX: 'center',
      originY: 'center',
    })
    setAvnacShapeMeta(p, { kind: 'star', starPoints: points })
    applyBgValueToFill(mod, p, selectedPaint)
    canvas.add(p)
    canvas.setActiveObject(p)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addLineShape() {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const half = Math.round(RECT_W * 0.42)
    const line = new mod.Line([-half, 0, half, 0], {
      left: ARTBOARD_W / 2,
      top: ARTBOARD_H / 2,
      stroke: bgValueSolidFallback(selectedPaint),
      strokeWidth: Math.max(8, RECT_RX * 2.5),
      strokeLineCap: 'round',
      originX: 'center',
      originY: 'center',
    })
    setAvnacShapeMeta(line, { kind: 'line' })
    applyBgValueToStroke(mod, line, selectedPaint)
    installLineEndpointControls(line)
    canvas.add(line)
    canvas.setActiveObject(line)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addArrowShape() {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const head = 1
    const cx = ARTBOARD_W / 2
    const cy = ARTBOARD_H / 2
    const half = Math.round(RECT_W * 0.42)
    const x1 = cx - half
    const y1 = cy
    const x2 = cx + half
    const y2 = cy
    const strokeW = 10
    const g = createArrowGroup(mod, x1, y1, x2, y2, {
      strokeWidth: strokeW,
      headFrac: head,
      color: bgValueSolidFallback(selectedPaint),
    })
    setAvnacStroke(g, selectedPaint)
    setAvnacShapeMeta(g, {
      kind: 'arrow',
      arrowHead: head,
      arrowEndpoints: { x1, y1, x2, y2 },
      arrowStrokeWidth: strokeW,
      arrowLineStyle: 'solid',
      arrowRoundedEnds: false,
      arrowPathType: 'straight',
    })
    installArrowEndpointControls(g)
    canvas.add(g)
    canvas.setActiveObject(g)
    canvas.requestRenderAll()
    syncSelection()
  }

  function addShapeFromPopover(kind: PopoverShapeKind) {
    if (kind === 'rect') addRect()
    else if (kind === 'ellipse') addEllipseShape()
    else if (kind === 'polygon') addPolygonShape(6)
    else if (kind === 'star') addStarShape(5)
    else if (kind === 'line') addLineShape()
    else if (kind === 'arrow') addArrowShape()
  }

  function addQuickShape() {
    const kind: PopoverShapeKind =
      shapesQuickAddKind === 'generic' ? 'rect' : shapesQuickAddKind
    addShapeFromPopover(kind)
  }

  function applyPolygonSides(sides: number) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Polygon)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'polygon') return
    const n = Math.max(3, Math.min(32, Math.round(sides)))
    const R = outerRadiusFromScaledPolygon(obj)
    const pts = regularPolygonPoints(n, R)
    obj.set({ points: pts, scaleX: 1, scaleY: 1 })
    setAvnacShapeMeta(obj, { ...meta, polygonSides: n })
    obj.setCoords()
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  function applyStarPoints(points: number) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Polygon)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'star') return
    const n = Math.max(3, Math.min(24, Math.round(points)))
    const R = outerRadiusFromScaledPolygon(obj)
    const pts = starPolygonPoints(n, R)
    obj.set({ points: pts, scaleX: 1, scaleY: 1 })
    setAvnacShapeMeta(obj, { ...meta, starPoints: n })
    obj.setCoords()
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  function applyArrowLineStyle(style: ArrowLineStyle) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Group)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'arrow') return
    ensureAvnacArrowEndpoints(obj)
    const m = getAvnacShapeMeta(obj)
    const ep = m?.arrowEndpoints
    if (!ep) return
    const strokeW = m?.arrowStrokeWidth ?? 10
    const color = arrowDisplayColor(obj)
    layoutArrowGroup(obj, ep.x1, ep.y1, ep.x2, ep.y2, {
      strokeWidth: strokeW,
      headFrac: m?.arrowHead ?? 1,
      color,
      lineStyle: style,
      roundedEnds: m?.arrowRoundedEnds,
      pathType: m?.arrowPathType ?? 'straight',
      curveBulge: m?.arrowCurveBulge,
      curveT: m?.arrowCurveT,
    })
    setAvnacShapeMeta(obj, { ...m, arrowLineStyle: style })
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  function applyArrowRoundedEnds(rounded: boolean) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Group)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'arrow') return
    ensureAvnacArrowEndpoints(obj)
    const m = getAvnacShapeMeta(obj)
    const ep = m?.arrowEndpoints
    if (!ep) return
    const strokeW = m?.arrowStrokeWidth ?? 10
    const color = arrowDisplayColor(obj)
    layoutArrowGroup(obj, ep.x1, ep.y1, ep.x2, ep.y2, {
      strokeWidth: strokeW,
      headFrac: m?.arrowHead ?? 1,
      color,
      lineStyle: m?.arrowLineStyle,
      roundedEnds: rounded,
      pathType: m?.arrowPathType ?? 'straight',
      curveBulge: m?.arrowCurveBulge,
      curveT: m?.arrowCurveT,
    })
    setAvnacShapeMeta(obj, { ...m, arrowRoundedEnds: rounded })
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  function applyArrowStrokeWidth(w: number) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Group)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'arrow') return
    const strokeW = Math.max(1, Math.min(80, w))
    ensureAvnacArrowEndpoints(obj)
    const m = getAvnacShapeMeta(obj)
    const ep = m?.arrowEndpoints
    if (!ep) return
    const color = arrowDisplayColor(obj)
    layoutArrowGroup(obj, ep.x1, ep.y1, ep.x2, ep.y2, {
      strokeWidth: strokeW,
      headFrac: m?.arrowHead ?? 1,
      color,
      lineStyle: m?.arrowLineStyle,
      roundedEnds: m?.arrowRoundedEnds,
      pathType: m?.arrowPathType ?? 'straight',
      curveBulge: m?.arrowCurveBulge,
      curveT: m?.arrowCurveT,
    })
    setAvnacShapeMeta(obj, { ...m, arrowStrokeWidth: strokeW })
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  function applyArrowPathType(pathType: ArrowPathType) {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!(obj instanceof mod.Group)) return
    const meta = getAvnacShapeMeta(obj)
    if (!meta || meta.kind !== 'arrow') return
    ensureAvnacArrowEndpoints(obj)
    const m = getAvnacShapeMeta(obj)
    const ep = m?.arrowEndpoints
    if (!ep) return
    const strokeW = m?.arrowStrokeWidth ?? 10
    const color = arrowDisplayColor(obj)
    layoutArrowGroup(obj, ep.x1, ep.y1, ep.x2, ep.y2, {
      strokeWidth: strokeW,
      headFrac: m?.arrowHead ?? 1,
      color,
      lineStyle: m?.arrowLineStyle,
      roundedEnds: m?.arrowRoundedEnds,
      pathType,
      curveBulge: pathType === 'curved' ? m?.arrowCurveBulge : undefined,
      curveT: pathType === 'curved' ? m?.arrowCurveT : undefined,
    })
    setAvnacShapeMeta(obj, {
      ...m,
      arrowPathType: pathType,
      ...(pathType === 'straight'
        ? { arrowCurveBulge: undefined, arrowCurveT: undefined }
        : {}),
    })
    syncAvnacArrowCurveControlVisibility(obj)
    canvas.requestRenderAll()
    syncShapeToolbar()
  }

  const duplicateElement = useCallback(async () => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const active = canvas.getActiveObject()
    if (!active) return
    if ('isEditing' in active && (active as IText).isEditing) return

    const dup = await active.clone([...OBJECT_SERIAL_KEYS])
    dup.set({ left: (active.left ?? 0) + 32, top: (active.top ?? 0) + 32 })
    const clearLock = (o: FabricObject) => {
      if (getAvnacLocked(o)) setAvnacLocked(o, false, mod)
    }
    if (mod.ActiveSelection && dup instanceof mod.ActiveSelection) {
      dup.getObjects().forEach(clearLock)
    } else {
      clearLock(dup as FabricObject)
    }
    canvas.discardActiveObject()
    canvas.add(dup)
    canvas.setActiveObject(dup)
    canvas.requestRenderAll()
    selectionTick()
  }, [])

  const toggleElementLock = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const active = canvas.getActiveObject()
    if (!active) return
    if (mod.ActiveSelection && active instanceof mod.ActiveSelection) {
      const objs = active.getObjects()
      const anyUnlocked = objs.some((o) => !getAvnacLocked(o))
      const nextLocked = anyUnlocked
      objs.forEach((o) => setAvnacLocked(o, nextLocked, mod))
    } else {
      setAvnacLocked(active, !getAvnacLocked(active), mod)
    }
    canvas.requestRenderAll()
    selectionTick()
  }, [])

  const copyElementToClipboard = useCallback(async () => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const objs = canvas.getActiveObjects()
    if (objs.length === 0) return
    const objects = objs.map((o) =>
      o.toObject([...OBJECT_SERIAL_KEYS] as unknown as string[]),
    )
    const payload = JSON.stringify({ avnacClip: true, v: 1, objects })
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      /* clipboard may be blocked */
    }
  }, [])

  const pasteFromClipboard = useCallback(async () => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      return
    }
    let parsed: { avnacClip?: boolean; objects?: unknown[] }
    try {
      parsed = JSON.parse(text) as { avnacClip?: boolean; objects?: unknown[] }
    } catch {
      return
    }
    if (!parsed.avnacClip || !Array.isArray(parsed.objects)) return

    const objs = (await mod.util.enlivenObjects(
      parsed.objects as object[],
      {},
    )) as FabricObject[]

    const dx = 32
    const dy = 32
    objs.forEach((o) => {
      o.set({
        left: (o.left ?? 0) + dx,
        top: (o.top ?? 0) + dy,
      })
      canvas.add(o)
    })
    canvas.discardActiveObject()
    if (objs.length === 1) {
      canvas.setActiveObject(objs[0]!)
    } else if (objs.length > 1) {
      const sel = new mod.ActiveSelection(objs, { canvas })
      canvas.setActiveObject(sel)
    }
    canvas.requestRenderAll()
    setHasObjectSelected(true)
    setCanvasBodySelected(false)
    selectionTick()
    syncTextToolbar()
    syncShapeToolbar()
  }, [syncShapeToolbar, syncTextToolbar])

  const alignElementToArtboard = useCallback((kind: CanvasAlignKind) => {
    const canvas = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (!canvas || !mod) return
    const obj = canvas.getActiveObject()
    if (!obj) return
    const pad = ARTBOARD_ALIGN_PAD
    const br = obj.getBoundingRect()
    let dx = 0
    let dy = 0
    if (kind === 'left') dx = pad - br.left
    else if (kind === 'centerH')
      dx = ARTBOARD_W / 2 - br.left - br.width / 2
    else if (kind === 'right') dx = ARTBOARD_W - pad - br.left - br.width
    else if (kind === 'top') dy = pad - br.top
    else if (kind === 'centerV')
      dy = ARTBOARD_H / 2 - br.top - br.height / 2
    else if (kind === 'bottom') dy = ARTBOARD_H - pad - br.top - br.height

    if (mod.ActiveSelection && obj instanceof mod.ActiveSelection) {
      obj.getObjects().forEach((o) => {
        o.set({
          left: (o.left ?? 0) + dx,
          top: (o.top ?? 0) + dy,
        })
        o.setCoords()
      })
      obj.setCoords()
    } else {
      obj.set({
        left: (obj.left ?? 0) + dx,
        top: (obj.top ?? 0) + dy,
      })
      obj.setCoords()
    }
    canvas.requestRenderAll()
    selectionTick()
  }, [])

  function deleteSelection() {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const objs = canvas.getActiveObjects()
    if (objs.length === 0) return
    for (const o of objs) {
      canvas.remove(o)
    }
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    setHasObjectSelected(false)
    setCanvasBodySelected(true)
    selectionTick()
  }

  const exportPng = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const data = canvas.toDataURL({ format: 'png', multiplier: 1 })
    const a = document.createElement('a')
    a.href = data
    a.download = 'avnac-design.png'
    a.click()
  }, [])

  useImperativeHandle(ref, () => ({ exportPng }), [exportPng])

  const onReadyChangeRef = useRef(onReadyChange)
  onReadyChangeRef.current = onReadyChange
  useEffect(() => {
    onReadyChangeRef.current?.(ready)
  }, [ready])

  function onBackgroundPicked(v: BgValue) {
    setBgValue(v)
  }

  let elementToolbarLockedDisplay = false
  let elementToolbarAlignAlready: Record<CanvasAlignKind, boolean> | null = null
  {
    const c = fabricCanvasRef.current
    const mod = fabricModRef.current
    if (c && mod) {
      const a = c.getActiveObject()
      if (a) {
        elementToolbarAlignAlready = artboardAlignAlreadySatisfied(
          a.getBoundingRect(),
        )
        if (mod.ActiveSelection && a instanceof mod.ActiveSelection) {
          const objs = a.getObjects()
          elementToolbarLockedDisplay =
            objs.length > 0 && objs.every((o) => getAvnacLocked(o))
        } else {
          elementToolbarLockedDisplay = getAvnacLocked(a)
        }
      }
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={selectionToolsRef}
        className="pointer-events-auto relative z-30 flex h-14 w-full shrink-0 items-center justify-center px-1 sm:px-2"
      >
        {ready && textToolbarValues ? (
          <TextFormatToolbar
            values={textToolbarValues}
            onChange={onTextFormatChange}
          />
        ) : null}
        {ready && !textToolbarValues && shapeToolbarModel ? (
          <ShapeOptionsToolbar
            meta={shapeToolbarModel.meta}
            paintValue={shapeToolbarModel.paint}
            onPaintChange={applyPaintToSelection}
            onPolygonSides={applyPolygonSides}
            onStarPoints={applyStarPoints}
            onArrowLineStyle={applyArrowLineStyle}
            onArrowRoundedEnds={applyArrowRoundedEnds}
            onArrowStrokeWidth={applyArrowStrokeWidth}
            onArrowPathType={applyArrowPathType}
          />
        ) : null}
        {ready &&
        !textToolbarValues &&
        !shapeToolbarModel &&
        canvasBodySelected ? (
          <div ref={backgroundPopoverAnchorRef} className="relative">
            <div className="flex items-center rounded-full border border-black/[0.08] bg-white/90 px-2 py-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)] backdrop-blur-md">
              <button
                type="button"
                className={backgroundTopBtn(false)}
                onClick={() => setBgPopoverOpen((o) => !o)}
                aria-label="Page background"
                aria-expanded={bgPopoverOpen}
                aria-haspopup="dialog"
                title="Background"
              >
                <HugeiconsIcon
                  icon={BackgroundIcon}
                  size={20}
                  strokeWidth={1.75}
                />
                <span
                  className="h-5 w-5 shrink-0 rounded-md border border-black/15 shadow-inner"
                  style={bgValueToSwatch(bgValue)}
                />
                <span className="pr-0.5">Background</span>
              </button>
            </div>
            {bgPopoverOpen ? (
              <div
                ref={backgroundPopoverPanelRef}
                className={[
                  'absolute left-1/2 z-[60]',
                  backgroundPopoverOpenUpward
                    ? 'bottom-full mb-2'
                    : 'top-full mt-2',
                ].join(' ')}
                style={{
                  transform: `translateX(calc(-50% + ${backgroundPopoverShiftX}px))`,
                }}
              >
                <BackgroundPopover
                  value={bgValue}
                  onChange={(v) => onBackgroundPicked(v)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-auto rounded-2xl bg-[var(--surface-subtle)]"
      >
        <div className="flex min-h-min w-full flex-1 flex-col items-center justify-center px-4 pb-4 pt-0 sm:px-6 sm:pb-6 sm:pt-1">
          <div
            ref={artboardClusterRef}
            className="relative z-0 -mt-4 inline-block sm:-mt-5"
          >
            {ready && hasObjectSelected && elementToolbarLayout ? (
              <CanvasElementToolbar
                ref={elementToolbarRef}
                style={{
                  left: elementToolbarLayout.left,
                  top: elementToolbarLayout.top,
                }}
                placement={elementToolbarLayout.placement}
                viewportRef={viewportRef}
                locked={elementToolbarLockedDisplay}
                onDuplicate={() => void duplicateElement()}
                onToggleLock={toggleElementLock}
                onDelete={deleteSelection}
                onCopy={() => void copyElementToClipboard()}
                onPaste={() => void pasteFromClipboard()}
                onAlign={alignElementToArtboard}
                alignAlreadySatisfied={
                  elementToolbarAlignAlready ?? {
                    left: false,
                    centerH: false,
                    right: false,
                    top: false,
                    centerV: false,
                    bottom: false,
                  }
                }
              />
            ) : null}
            <div
              ref={artboardFrameRef}
              className="relative rounded-sm"
              style={{
                lineHeight: 0,
                boxShadow:
                  artboardEmptyHovered && !hasObjectSelected
                    ? `0 4px 24px rgba(0,0,0,0.08), 0 0 0 2px ${EDITOR_ACCENT_PURPLE}`
                    : '0 4px 24px rgba(0,0,0,0.08)',
              }}
            >
              <canvas ref={canvasElRef} className="block max-w-none" />
              {ready &&
              (artboardSnapGuides.vertical || artboardSnapGuides.horizontal) ? (
                <div
                  className="pointer-events-none absolute inset-0 z-[5]"
                  aria-hidden
                >
                  {artboardSnapGuides.vertical ? (
                    <div
                      className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2"
                      style={{ backgroundColor: EDITOR_ACCENT_PURPLE }}
                    />
                  ) : null}
                  {artboardSnapGuides.horizontal ? (
                    <div
                      className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2"
                      style={{ backgroundColor: EDITOR_ACCENT_PURPLE }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          ref={canvasZoomRef}
          className="pointer-events-auto absolute bottom-4 right-5 z-10 flex flex-col items-end gap-1"
        >
          {ready && zoomPercent !== null ? (
            <>
              <CanvasZoomSlider
                value={zoomPercent}
                min={ZOOM_MIN_PCT}
                max={ZOOM_MAX_PCT}
                onChange={onZoomSliderChange}
                onFitRequest={onZoomFitRequest}
              />
              <div className="pr-1 text-xs tabular-nums text-[var(--text-muted)]">
                {ARTBOARD_W}×{ARTBOARD_H}px
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-2 pt-24">
        <div
          ref={bottomToolbarRef}
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/85 px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.8)_inset] backdrop-blur-xl"
          role="toolbar"
          aria-label="Editor tools"
        >
          <div
            ref={shapeToolSplitRef}
            className="relative flex items-stretch rounded-lg border border-black/[0.06] bg-black/[0.02]"
          >
            <button
              type="button"
              disabled={!ready}
              className={`${toolbarIconBtn(!ready)} rounded-l-lg rounded-r-none border-0`}
              onClick={addQuickShape}
              aria-label={QUICK_SHAPE_TITLE[shapesQuickAddKind]}
              title={QUICK_SHAPE_TITLE[shapesQuickAddKind]}
            >
              <HugeiconsIcon
                icon={iconForShapesQuickAdd(shapesQuickAddKind)}
                size={20}
                strokeWidth={1.75}
              />
            </button>
            <button
              type="button"
              disabled={!ready}
              className={`${toolbarIconBtn(!ready)} rounded-l-none rounded-r-lg border-0 border-l border-black/[0.06]`}
              onClick={() => setShapesPopoverOpen((o) => !o)}
              aria-expanded={shapesPopoverOpen}
              aria-haspopup="menu"
              aria-label="More shapes"
              title="More shapes"
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={16}
                strokeWidth={1.75}
              />
            </button>
            <ShapesPopover
              open={shapesPopoverOpen}
              disabled={!ready}
              anchorRef={shapeToolSplitRef}
              onClose={() => setShapesPopoverOpen(false)}
              onPick={(k) => {
                setShapesQuickAddKind(k)
                addShapeFromPopover(k)
                setShapesPopoverOpen(false)
              }}
            />
          </div>
          <button
            type="button"
            disabled={!ready}
            className={toolbarIconBtn(!ready)}
            onClick={addText}
            aria-label="Add text"
            title="Add text"
          >
            <HugeiconsIcon icon={TextFontIcon} size={20} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={!ready || !hasObjectSelected}
            className={toolbarIconBtn(!ready || !hasObjectSelected)}
            onClick={deleteSelection}
            aria-label="Delete"
            title="Delete"
          >
            <HugeiconsIcon icon={Delete02Icon} size={20} strokeWidth={1.75} />
          </button>

          {!ready ? (
            <span className="px-3 text-xs text-[var(--text-muted)]">
              Loading…
            </span>
          ) : null}
        </div>
      </div>

      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-[var(--text-muted)]">
            Loading canvas…
          </span>
        </div>
      ) : null}
    </div>
  )
},
)

export default FabricEditor
