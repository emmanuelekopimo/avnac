import {
  Control,
  Point,
  controlsUtils,
  util,
  type Canvas,
  type Group,
  type InteractiveFabricObject,
  type Line,
  type TransformActionHandler,
} from 'fabric'
import {
  arrowDisplayColor,
  arrowTailTipLocal,
  layoutArrowGroup,
} from './avnac-stroke-arrow'
import { getAvnacShapeMeta, setAvnacShapeMeta } from './avnac-shape-meta'

type ModifyPolyEv = Parameters<typeof controlsUtils.wrapWithFireEvent>[0]
const MODIFY_POLY = 'modifyPoly' as ModifyPolyEv

function canvaEndpointChrome(o: InteractiveFabricObject) {
  o.hasBorders = false
  o.cornerSize = 28
  o.touchCornerSize = 48
  o.transparentCorners = false
  o.cornerStyle = 'circle'
}

function lineEndpointPosition(which: 1 | 2) {
  return (
    _dim: Point,
    _finalMatrix: number[],
    fabricObject: InteractiveFabricObject,
  ) => {
    const line = fabricObject as Line
    const { x1, y1, x2, y2 } = line.calcLinePoints()
    const p = which === 1 ? new Point(x1, y1) : new Point(x2, y2)
    return p.transform(
      util.multiplyTransformMatrices(
        line.getViewportTransform(),
        line.calcTransformMatrix(),
      ),
    )
  }
}

function lineEndpointAction(which: 1 | 2): TransformActionHandler {
  const inner: TransformActionHandler = (_e, transform, x, y) => {
    const line = transform.target as Line
    const pt = util.sendPointToPlane(
      new Point(x, y),
      undefined,
      line.calcOwnMatrix(),
    )
    if (which === 1) {
      line.set({ x1: pt.x, y1: pt.y })
    } else {
      line.set({ x2: pt.x, y2: pt.y })
    }
    line.setCoords()
    return true
  }
  return controlsUtils.wrapWithFireEvent(MODIFY_POLY, inner)
}

function scenePointFromCanvas(canvas: Canvas, x: number, y: number) {
  return util.transformPoint(
    new Point(x, y),
    util.invertTransform(canvas.viewportTransform),
  )
}

export function ensureAvnacArrowEndpoints(g: Group) {
  const meta = getAvnacShapeMeta(g)
  if (!meta || meta.kind !== 'arrow') return
  if (meta.arrowEndpoints) return
  const c = g.getCenterPoint()
  const rad = ((g.angle ?? 0) * Math.PI) / 180
  const pair = arrowTailTipLocal(g)
  let approxL = 200
  if (pair) {
    const m = g.calcTransformMatrix()
    const t = pair.tip.transform(m)
    const tl = pair.tail.transform(m)
    approxL = Math.hypot(t.x - tl.x, t.y - tl.y)
  } else {
    approxL = Math.max(
      g.width * Math.abs(g.scaleX ?? 1),
      g.getBoundingRect().width * 0.85,
      80,
    )
  }
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const ep = {
    x1: c.x - (ux * approxL) / 2,
    y1: c.y - (uy * approxL) / 2,
    x2: c.x + (ux * approxL) / 2,
    y2: c.y + (uy * approxL) / 2,
  }
  setAvnacShapeMeta(g, { ...meta, arrowEndpoints: ep })
}

export function syncAvnacArrowEndpointsFromGeometry(g: Group) {
  const meta = getAvnacShapeMeta(g)
  if (!meta || meta.kind !== 'arrow') return
  const pair = arrowTailTipLocal(g)
  if (!pair) return
  const m = g.calcTransformMatrix()
  const tailS = pair.tail.transform(m)
  const tipS = pair.tip.transform(m)
  setAvnacShapeMeta(g, {
    ...meta,
    arrowEndpoints: {
      x1: tailS.x,
      y1: tailS.y,
      x2: tipS.x,
      y2: tipS.y,
    },
  })
}

function arrowEndpointPosition(which: 'tail' | 'tip') {
  return (
    _dim: Point,
    _finalMatrix: number[],
    fabricObject: InteractiveFabricObject,
  ) => {
    const g = fabricObject as Group
    const pair = arrowTailTipLocal(g)
    if (!pair) return new Point(0, 0)
    const local = which === 'tail' ? pair.tail : pair.tip
    return local.transform(
      util.multiplyTransformMatrices(
        g.getViewportTransform(),
        g.calcTransformMatrix(),
      ),
    )
  }
}

function arrowEndpointAction(which: 'tail' | 'tip'): TransformActionHandler {
  const inner: TransformActionHandler = (_e, transform, x, y) => {
    const g = transform.target as Group
    const canvas = g.canvas
    if (!canvas) return false
    ensureAvnacArrowEndpoints(g)
    const meta = getAvnacShapeMeta(g)
    if (!meta || meta.kind !== 'arrow' || !meta.arrowEndpoints) return false
    const scene = scenePointFromCanvas(canvas, x, y)
    const ep = { ...meta.arrowEndpoints }
    if (which === 'tail') {
      ep.x1 = scene.x
      ep.y1 = scene.y
    } else {
      ep.x2 = scene.x
      ep.y2 = scene.y
    }
    const strokeW = meta.arrowStrokeWidth ?? 10
    const color = arrowDisplayColor(g)
    layoutArrowGroup(g, ep.x1, ep.y1, ep.x2, ep.y2, {
      strokeWidth: strokeW,
      headFrac: meta.arrowHead ?? 1,
      color,
      lineStyle: meta.arrowLineStyle,
      roundedEnds: meta.arrowRoundedEnds,
    })
    setAvnacShapeMeta(g, { ...meta, arrowEndpoints: ep })
    return true
  }
  return controlsUtils.wrapWithFireEvent(MODIFY_POLY, inner)
}

export function installCanvaLineControls(line: Line) {
  canvaEndpointChrome(line)
  line.controls = {
    p1: new Control({
      positionHandler: lineEndpointPosition(1),
      actionHandler: lineEndpointAction(1),
      cursorStyle: 'pointer',
    }),
    p2: new Control({
      positionHandler: lineEndpointPosition(2),
      actionHandler: lineEndpointAction(2),
      cursorStyle: 'pointer',
    }),
    mtr: new Control({
      x: 0,
      y: 0.5,
      offsetY: 88,
      withConnection: true,
      actionHandler: controlsUtils.rotationWithSnapping,
      cursorStyleHandler: controlsUtils.rotationStyleHandler,
      sizeX: 56,
      sizeY: 56,
    }),
  }
}

export function installCanvaArrowControls(g: Group) {
  canvaEndpointChrome(g)
  g.controls = {
    tail: new Control({
      positionHandler: arrowEndpointPosition('tail'),
      actionHandler: arrowEndpointAction('tail'),
      cursorStyle: 'pointer',
    }),
    tip: new Control({
      positionHandler: arrowEndpointPosition('tip'),
      actionHandler: arrowEndpointAction('tip'),
      cursorStyle: 'pointer',
    }),
    mtr: new Control({
      x: 0,
      y: 0.5,
      offsetY: 88,
      withConnection: true,
      actionHandler: controlsUtils.rotationWithSnapping,
      cursorStyleHandler: controlsUtils.rotationStyleHandler,
      sizeX: 56,
      sizeY: 56,
    }),
  }
}
