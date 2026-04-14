import type { FabricObject } from 'fabric'
import type { BgValue } from '../components/background-popover'
import { linearGradientForBox } from './fabric-linear-gradient'

const AFILL = 'avnacFill' as const
const ASTROKE = 'avnacStroke' as const

type ObjPaint = FabricObject & {
  avnacFill?: BgValue
  avnacStroke?: BgValue
}

export function bgValueSolidFallback(v: BgValue): string {
  return v.type === 'solid' ? v.color : v.stops[0]?.color ?? '#262626'
}

export function getAvnacFill(obj: FabricObject): BgValue | undefined {
  return (obj as ObjPaint)[AFILL]
}

export function setAvnacFill(obj: FabricObject, v: BgValue | undefined) {
  const o = obj as ObjPaint
  if (v === undefined) delete o[AFILL]
  else o[AFILL] = v
}

export function getAvnacStroke(obj: FabricObject): BgValue | undefined {
  return (obj as ObjPaint)[ASTROKE]
}

export function setAvnacStroke(obj: FabricObject, v: BgValue | undefined) {
  const o = obj as ObjPaint
  if (v === undefined) delete o[ASTROKE]
  else o[ASTROKE] = v
}

function gradientBox(obj: FabricObject) {
  const w = Math.max(1, obj.getScaledWidth())
  const h = Math.max(1, obj.getScaledHeight())
  return { w, h }
}

export function applyBgValueToFill(
  mod: typeof import('fabric'),
  obj: FabricObject,
  v: BgValue,
) {
  const { w, h } = gradientBox(obj)
  if (v.type === 'solid') {
    obj.set('fill', v.color)
  } else {
    obj.set('fill', linearGradientForBox(mod, v.stops, v.angle, w, h))
  }
  setAvnacFill(obj, v)
}

export function applyBgValueToStroke(
  mod: typeof import('fabric'),
  obj: FabricObject,
  v: BgValue,
) {
  const { w, h } = gradientBox(obj)
  if (v.type === 'solid') {
    obj.set('stroke', v.color)
  } else {
    obj.set('stroke', linearGradientForBox(mod, v.stops, v.angle, w, h))
  }
  setAvnacStroke(obj, v)
}

export function bgValueFromFabricFill(obj: FabricObject): BgValue {
  const stored = getAvnacFill(obj)
  if (stored) return stored
  const f = obj.fill
  if (typeof f === 'string' && f) return { type: 'solid', color: f }
  return { type: 'solid', color: '#262626' }
}

export function bgValueFromFabricStroke(obj: FabricObject): BgValue {
  const stored = getAvnacStroke(obj)
  if (stored) return stored
  const s = obj.stroke
  if (typeof s === 'string' && s) return { type: 'solid', color: s }
  return { type: 'solid', color: '#262626' }
}
