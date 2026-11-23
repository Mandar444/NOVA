// The student's dictated maths on the page: text, not ink. Tap selects it (for Hint / Explain / Full solution),
// "Edit" changes its maths, "Delete" removes it (both undoable like any other change to their work).

import { useState } from 'react'
import { prettyMath } from '../voice/spokenMath'
import type { Page } from './types'

export const TYPED_FONT = 30
const FONT = `${TYPED_FONT}px "Cambria Math", "STIX Two Math", "Times New Roman", serif`
let measureCtx: CanvasRenderingContext2D | null = null
/** Width of a dictated line on the page (page units). */
export function typedWidth(display: string, fontSize = TYPED_FONT): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return display.length * fontSize * 0.55 + 16
  measureCtx.font = FONT.replace(`${TYPED_FONT}px`, `${fontSize}px`)
  return Math.ceil(measureCtx.measureText(display).width) + 16
}

interface Props {
  page: Page
  selectedRegionId: string | null
  onSelect: (regionId: string) => void
  onEdit: (id: string, text: string, display: string, w: number) => void
  onDelete: (id: string) => void
}

export function TypedLayer({ page, selectedRegionId, onSelect, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  return (
    <>
      {(page.typed ?? []).map((b) => {
        const region = page.regions.find((r) => r.typedId === b.id)
        const selected = !!region && region.id === selectedRegionId
        const isEditing = editing?.id === b.id
        return (
          <div
            key={b.id}
            className={`typed-block ${selected ? 'selected' : ''}`}
            data-testid="typed-block"
            data-typed-id={b.id}
            data-text={b.text}
            data-pass-ink
            role="button"
            tabIndex={0}
            aria-label={`Your question: ${b.display}. Tap to select it.`}
            style={{ left: b.x, top: b.y, width: isEditing ? undefined : b.w, height: b.h, fontSize: b.fontSize }}
            onClick={() => region && onSelect(region.id)}
            onDoubleClick={() => setEditing({ id: b.id, text: b.text })}
            onKeyDown={(e) => { if (e.key === 'Enter' && region) onSelect(region.id) }}
          >
            {isEditing ? (
              <input
                autoFocus
                value={editing.text}
                aria-label="Edit the maths"
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setEditing({ id: b.id, text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') setEditing(null)
                  if (e.key === 'Enter') {
                    const d = prettyMath(editing.text.trim())
                    if (editing.text.trim()) onEdit(b.id, editing.text.trim(), d, typedWidth(d, b.fontSize))
                    setEditing(null)
                  }
                }}
                onBlur={() => setEditing(null)}
              />
            ) : (
              b.display
            )}
            {selected && !isEditing && (
              <span className="tb-tools">
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditing({ id: b.id, text: b.text }) }}>Edit</button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(b.id) }}>Delete</button>
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
