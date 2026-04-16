import type { FabricObject } from 'fabric'

type WithLayerId = FabricObject & { avnacLayerId?: string }

export function ensureAvnacLayerId(obj: FabricObject): string {
  const cur = (obj as WithLayerId).avnacLayerId
  if (typeof cur === 'string' && cur.length > 0) return cur
  const id = crypto.randomUUID()
  obj.set({
    avnacLayerId: id,
  } as Partial<FabricObject> & { avnacLayerId?: string })
  return id
}

export function renewAvnacLayerId(obj: FabricObject): string {
  const id = crypto.randomUUID()
  obj.set({
    avnacLayerId: id,
  } as Partial<FabricObject> & { avnacLayerId?: string })
  return id
}
