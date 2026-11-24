// The student's dictated maths on the page: typeset (KaTeX) from its canonical text — not ink, not a tutor answer.
// Tap selects it (Hint / Next step / Explain / Full solution in the menu). When selected: Move (drag the handle, or
// arrow keys), Edit, Delete. A drag commits ONE undoable move on release; Escape cancels it. No ink, no panning.

import katex from 'katex'
import { useMemo, useRef, useState } from 'react'
import { canonToTex, prettyMath } from '../voice/spokenMath'
import type { Page, TypedBlock } from './types'

export const TYPED_FONT = 30

const texHtml = (text: string) => katex.renderToString(canonToTex(text), { throwOnError: false, trust: false, strict: 'ignore', output: 'html' })

/** Rendered size of a dictated block on the page (page units): fractions, bounds and limits are taller than a line. */
export function measureTyped(text: string, fontSize = TYPED_FONT): { w: number; h: number } {
  try {
    const el = document.createElement('div')
    el.className = 'typed-block measuring'
    el.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;font-size:${fontSize}px;width:auto;height:auto`
    el.innerHTML = texHtml(text)
    document.body.appendChild(el)
    const r = { w: Math.ceil(el.offsetWidth) + 16, h: Math.max(Math.ceil(fontSize * 1.5), Math.ceil(el.offsetHeight) + 8) }
    el.remove()
    if (r.w > 20) return r
  } catch { /* no DOM (tests) */ }
  return { w: Math.ceil(prettyMath(text).length * fontSize * 0.55) + 16, h: Math.ceil(fontSize * 1.5) }
}
/** kept for callers that only need the width */
export const typedWidth = (text: string, fontSize = TYPED_FONT) => measureTyped(text, fontSize).w

function Tex({ text }: { text: string }) {
  const html = useMemo(() => texHtml(text), [text])
  return <span className="typed-tex" dangerouslySetInnerHTML={{ __html: html }} />
}

interface Props {
  page: Page
  scale: number
  selectedRegionId: string | null
  editingId: string | null
  onSelect: (regionId: string) => void
  onEdit: (id: string, text: string, size: { w: number; h: number }) => void
  onEditDone: () => void
  onStartEdit: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  onDelete: (id: string) => void
}

export function TypedLayer({ page, scale, selectedRegionId, editingId, onSelect, onEdit, onEditDone, onStartEdit, onMove, onDelete }: Props) {
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const start = useRef<{ id: string; x: number; y: number; pointer: number } | null>(null)

  const beginDrag = (e: React.PointerEvent, b: TypedBlock) => {
    e.stopPropagation() // never ink, never a pan
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    start.current = { id: b.id, x: e.clientX, y: e.clientY, pointer: e.pointerId }
    setDrag({ id: b.id, dx: 0, dy: 0 })
  }
  const moveDrag = (e: React.PointerEvent) => {
    const s = start.current
    if (!s || s.pointer !== e.pointerId) return
    e.stopPropagation()
    setDrag({ id: s.id, dx: (e.clientX - s.x) / scale, dy: (e.clientY - s.y) / scale }) // screen px → page units at any zoom
  }
  const endDrag = (e: React.PointerEvent, b: TypedBlock, cancel = false) => {
    const s = start.current
    if (!s || s.pointer !== e.pointerId) return
    e.stopPropagation()
    start.current = null
    const d = drag
    setDrag(null)
    if (!cancel && d && (Math.abs(d.dx) > 1 || Math.abs(d.dy) > 1)) onMove(b.id, b.x + d.dx, b.y + d.dy) // one commit per drag
  }

  return (
    <>
      {(page.typed ?? []).map((b) => {
        const region = page.regions.find((r) => r.typedId === b.id)
        const selected = !!region && region.id === selectedRegionId
        const editing = editingId === b.id
        const off = drag?.id === b.id ? drag : null
        const value = draft?.id === b.id ? draft.text : b.text
        return (
          <div
            key={b.id}
            className={`typed-block ${selected ? 'selected' : ''} ${off ? 'dragging' : ''}`}
            data-testid="typed-block"
            data-typed-id={b.id}
            data-text={b.text}
            data-pass-ink
            role="button"
            tabIndex={0}
            aria-label={`Your question: ${prettyMath(b.text)}. Tap to select it.`}
            style={{ left: b.x + (off?.dx ?? 0), top: b.y + (off?.dy ?? 0), minWidth: b.w, minHeight: b.h, fontSize: b.fontSize }}
            onClick={() => region && onSelect(region.id)}
            onDoubleClick={() => onStartEdit(b.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' && region) onSelect(region.id) }}
          >
            {editing ? (
              <input
                autoFocus
                value={value}
                aria-label="Edit the maths"
                data-testid="typed-edit"
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setDraft({ id: b.id, text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') { setDraft(null); onEditDone() }
                  if (e.key === 'Enter') {
                    const t = value.trim()
                    if (t && t !== b.text) onEdit(b.id, t, measureTyped(t, b.fontSize))
                    setDraft(null)
                    onEditDone()
                  }
                }}
                onBlur={() => { setDraft(null); onEditDone() }}
              />
            ) : (
              <Tex text={b.text} />
            )}
            {selected && !editing && (
              <span className="tb-tools" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  className="tb-move"
                  data-testid="typed-move"
                  aria-label="Move: drag, or use the arrow keys"
                  title="Drag to move (arrow keys also work; Esc cancels)"
                  onPointerDown={(e) => beginDrag(e, b)}
                  onPointerMove={moveDrag}
                  onPointerUp={(e) => endDrag(e, b)}
                  onPointerCancel={(e) => endDrag(e, b, true)}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 40 : 10
                    const k: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
                    if (k[e.key]) { e.preventDefault(); e.stopPropagation(); onMove(b.id, b.x + k[e.key][0], b.y + k[e.key][1]) }
                    if (e.key === 'Escape' && start.current) { start.current = null; setDrag(null) }
                  }}
                  onClick={(e) => e.stopPropagation()}
                >✥ Move</button>
                <button data-testid="typed-edit-btn" onClick={(e) => { e.stopPropagation(); onStartEdit(b.id) }}>Edit</button>
                <button data-testid="typed-delete" onClick={(e) => { e.stopPropagation(); onDelete(b.id) }}>Delete</button>
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
