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
import {
  installCanvaArrowControls,
  installCanvaLineControls,
  ensureAvnacArrowEndpoints,
  syncAvnacArrowCurveControlVisibility,
  syncAvnacArrowEndpointsFromGeometry,
} from '../lib/fabric-canva-line-arrow-controls'
import {
  attachFabricCanvaHoverOutline,
  installFabricSelectionChrome,
} from '../lib/fabric-selection-chrome'
import { bboxMinRadius, regularPolygonPoints, starPolygonPoints } from '../lib/avnac-shape-geometry'
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

const ARTBOARD_W = 4000
const ARTBOARD_H = 4000

const DEFAULT_PAINT: BgValue = { type: 'solid', color: '#262626' }

const FIT_PADDING = 32
const FONT_SIZE = Math.round(ARTBOARD_W * 0.04)
const RECT_W = Math.round(ARTBOARD_W * 0.2)
const RECT_H = Math.round(ARTBOARD_H * 0.12)
const RECT_RX = Math.round(ARTBOARD_W * 0.004)

/** Screen px: space between toolbar bottom and visual clearance above the text box. */
const TEXT_TOOLBAR_GAP_PX = 12

/** Max extra lift (screen px) so the bar clears tall glyphs when the AABB sits low. */
const TEXT_TOOLBAR_ASCENDER_MAX_PX = 56

/** Gap (screen px) between the top Background toolbar pill bottom and artboard top. */
const BACKGROUND_BAR_GAP_PX = 6

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
  const viewportRef = useRef<HTMLDivElement>(null)
  const backgroundBarRef = useRef<HTMLDivElement>(null)
  const textToolbarRef = useRef<HTMLDivElement>(null)
  const shapeToolbarRef = useRef<HTMLDivElement>(null)
  const shapeToolSplitRef = useRef<HTMLDivElement>(null)
  const bottomToolbarRef = useRef<HTMLDivElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const fabricModRef = useRef<typeof import('fabric') | null>(null)

  const [ready, setReady] = useState(false)
  const [fitZoomPercent, setFitZoomPercent] = useState<number | null>(null)
  const [bgValue, setBgValue] = useState<BgValue>({ type: 'solid', color: '#ffffff' })
  const [bgPopoverOpen, setBgPopoverOpen] = useState(false)
  const [selectedPaint, setSelectedPaint] = useState<BgValue>(DEFAULT_PAINT)
  const [hasObjectSelected, setHasObjectSelected] = useState(false)
  const [canvasBodySelected, setCanvasBodySelected] = useState(false)
  const [, selectionTick] = useReducer((n: number) => n + 1, 0)
  const [textToolbarValues, setTextToolbarValues] =
    useState<TextFormatToolbarValues | null>(null)
  const [textToolbarLayout, setTextToolbarLayout] = useState<{
    left: number
    top: number
  } | null>(null)
  const [backgroundBarLayout, setBackgroundBarLayout] = useState<{
    left: number
    top: number
  } | null>(null)
  const [shapesPopoverOpen, setShapesPopoverOpen] = useState(false)
  const [shapesQuickAddKind, setShapesQuickAddKind] =
    useState<ShapesQuickAddKind>('generic')
  const [shapeToolbarLayout, setShapeToolbarLayout] = useState<{
    left: number
    top: number
  } | null>(null)
  const [shapeToolbarModel, setShapeToolbarModel] = useState<{
    meta: AvnacShapeMeta
    paint: BgValue
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

  const syncBackgroundBarPosition = useCallback(() => {
    const frame = artboardFrameRef.current
    const canvas = fabricCanvasRef.current
    if (!frame || !canvas || !ready) {
      setBackgroundBarLayout(null)
      return
    }
    const rect = frame.getBoundingClientRect()
    const cx = rect.left + rect.width / 2

    if (canvasBodySelected) {
      setBackgroundBarLayout({
        left: cx,
        top: rect.top - BACKGROUND_BAR_GAP_PX,
      })
    } else {
      setBackgroundBarLayout(null)
    }
  }, [ready, canvasBodySelected])

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
      setTextToolbarLayout(null)
      return
    }

    setTextToolbarValues(readTextFormat(obj))
    obj.setCoords()
    const br = obj.getBoundingRect()
    const canvasEl = canvas.upperCanvasEl
    const rect = canvasEl.getBoundingClientRect()
    const sx = rect.width / canvas.getWidth()
    const sy = rect.height / canvas.getHeight()
    const left = rect.left + (br.left + br.width / 2) * sx
    const bboxTop = rect.top + br.top * sy
    const fs = obj.fontSize ?? FONT_SIZE
    const ascenderLift = Math.min(
      TEXT_TOOLBAR_ASCENDER_MAX_PX,
      Math.round(fs * sy * 0.22),
    )
    setTextToolbarLayout({ left, top: bboxTop - ascenderLift })
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
      setShapeToolbarLayout(null)
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
    const br = obj.getBoundingRect()
    const canvasEl = canvas.upperCanvasEl
    const rect = canvasEl.getBoundingClientRect()
    const sx = rect.width / canvas.getWidth()
    const sy = rect.height / canvas.getHeight()
    const left = rect.left + (br.left + br.width / 2) * sx
    const bboxTop = rect.top + br.top * sy
    setShapeToolbarLayout({ left, top: bboxTop - TEXT_TOOLBAR_GAP_PX })
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

  const fitArtboardToViewport = useCallback(() => {
    const canvas = fabricCanvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return

    const cw = viewport.clientWidth - FIT_PADDING * 2
    const ch = viewport.clientHeight - FIT_PADDING * 2
    if (cw <= 0 || ch <= 0) return

    const raw = Math.min(cw / ARTBOARD_W, ch / ARTBOARD_H) * 0.98
    const scale = Math.min(1, raw)
    const dw = ARTBOARD_W * scale
    const dh = ARTBOARD_H * scale

    canvas.setDimensions({ width: dw, height: dh }, { cssOnly: true })
    canvas.calcOffset()
    canvas.requestRenderAll()
    setFitZoomPercent(Math.max(1, Math.min(100, Math.round(scale * 100))))
    queueMicrotask(() => {
      syncTextToolbar()
      syncShapeToolbar()
      syncBackgroundBarPosition()
    })
  }, [syncTextToolbar, syncShapeToolbar, syncBackgroundBarPosition])

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
      attachFabricCanvaHoverOutline(canvas)

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
        setSelectedPaint(DEFAULT_PAINT)
        setTextToolbarValues(null)
        setTextToolbarLayout(null)
        setShapeToolbarLayout(null)
        setShapeToolbarModel(null)
        selectionTick()
      }

      const onCanvasMouseDown = (opt: { target?: FabricObject | null }) => {
        if (opt.target) {
          setCanvasBodySelected(false)
        } else {
          setCanvasBodySelected(true)
        }
      }

      canvas.on('selection:created', onSelect)
      canvas.on('selection:updated', onSelect)
      canvas.on('selection:cleared', onClear)
      canvas.on('mouse:down', onCanvasMouseDown)

      window.addEventListener('keydown', onKeyDown)
      setReady(true)
      setHasObjectSelected(false)
      setCanvasBodySelected(false)

      if (disposed) {
        canvas.off('selection:created', onSelect)
        canvas.off('selection:updated', onSelect)
        canvas.off('selection:cleared', onClear)
        canvas.off('mouse:down', onCanvasMouseDown)
        window.removeEventListener('keydown', onKeyDown)
        void canvas.dispose()
        fabricCanvasRef.current = null
        fabricModRef.current = null
        setReady(false)
      }
    })()

    return () => {
      disposed = true
      window.removeEventListener('keydown', onKeyDown)
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

    const fit = () => fitArtboardToViewport()
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
      syncTextToolbar()
      syncShapeToolbar()
      syncBackgroundBarPosition()
    }
    vp.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('resize', bump)
    return () => {
      vp.removeEventListener('scroll', bump)
      window.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)
    }
  }, [ready, syncTextToolbar, syncShapeToolbar, syncBackgroundBarPosition])

  useLayoutEffect(() => {
    syncBackgroundBarPosition()
  }, [syncBackgroundBarPosition, fitZoomPercent])

  useLayoutEffect(() => {
    if (!ready) return
    syncShapeToolbar()
  }, [ready, selectionTick, fitZoomPercent, syncShapeToolbar])

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
      if (backgroundBarRef.current?.contains(e.target as Node)) return
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
      if (backgroundBarRef.current?.contains(t)) return
      if (textToolbarRef.current?.contains(t)) return
      if (shapeToolbarRef.current?.contains(t)) return
      if (bottomToolbarRef.current?.contains(t)) return
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
    installCanvaLineControls(line)
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
    installCanvaArrowControls(g)
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
    const br = obj.getBoundingRect()
    const R = bboxMinRadius(br)
    const pts = regularPolygonPoints(n, R)
    obj.set({ points: pts })
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
    const br = obj.getBoundingRect()
    const R = bboxMinRadius(br)
    const pts = starPolygonPoints(n, R)
    obj.set({ points: pts })
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

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="flex h-full min-h-[280px] min-w-0 items-center justify-center overflow-auto rounded-2xl bg-[var(--surface-subtle)] p-4 sm:p-6"
      >
        <div className="flex flex-col items-center justify-center">
          <div className="relative inline-block">
            <div
              ref={artboardFrameRef}
              className="rounded-sm shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
              style={{ lineHeight: 0 }}
            >
              <canvas ref={canvasElRef} className="block max-w-none" />
            </div>
          </div>
        </div>

        {ready && fitZoomPercent !== null ? (
          <div className="pointer-events-none absolute bottom-4 right-5 text-xs tabular-nums text-[var(--text-muted)]">
            {ARTBOARD_W}×{ARTBOARD_H}px · {fitZoomPercent}%
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-5 pt-24">
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

      {ready && canvasBodySelected && backgroundBarLayout ? (
        <div
          ref={backgroundBarRef}
          className="pointer-events-auto fixed z-50"
          style={{
            left: Math.round(backgroundBarLayout.left),
            top: Math.round(backgroundBarLayout.top),
            transform: 'translate3d(-50%, -100%, 0)',
          }}
        >
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
                  backgroundPopoverOpenUpward ? 'bottom-full mb-2' : 'top-full mt-2',
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
        </div>
      ) : null}

      {textToolbarLayout && textToolbarValues ? (
        <div
          ref={textToolbarRef}
          className="pointer-events-auto fixed z-50"
          style={{
            left: Math.round(textToolbarLayout.left),
            top: Math.round(textToolbarLayout.top - TEXT_TOOLBAR_GAP_PX),
            transform: 'translate3d(-50%, -100%, 0)',
          }}
        >
          <TextFormatToolbar
            values={textToolbarValues}
            onChange={onTextFormatChange}
          />
        </div>
      ) : null}

      {shapeToolbarLayout && shapeToolbarModel ? (
        <div
          ref={shapeToolbarRef}
          className="pointer-events-auto fixed z-50"
          style={{
            left: Math.round(shapeToolbarLayout.left),
            top: Math.round(shapeToolbarLayout.top - TEXT_TOOLBAR_GAP_PX),
            transform: 'translate3d(-50%, -100%, 0)',
          }}
        >
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
        </div>
      ) : null}
    </div>
  )
},
)

export default FabricEditor
