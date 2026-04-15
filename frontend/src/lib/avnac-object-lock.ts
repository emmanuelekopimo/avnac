import type { FabricObject } from 'fabric'

export function getAvnacLocked(obj: FabricObject | undefined | null): boolean {
  if (!obj) return false
  return !!(obj as FabricObject & { avnacLocked?: boolean }).avnacLocked
}

export function setAvnacLocked(
  obj: FabricObject,
  locked: boolean,
  fabricMod: typeof import('fabric'),
): void {
  obj.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
    hasControls: !locked,
    selectable: true,
    evented: true,
    avnacLocked: locked,
  } as Partial<FabricObject> & { avnacLocked?: boolean })
  if (fabricMod.IText && obj instanceof fabricMod.IText) {
    obj.set({ editable: !locked })
  }
  if (fabricMod.Textbox && obj instanceof fabricMod.Textbox) {
    obj.set({ editable: !locked })
  }
  obj.setCoords()
}
