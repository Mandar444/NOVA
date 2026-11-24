import { describe, expect, it } from 'vitest'
import nova from './useNova.ts?raw'
import spoken from '../voice/spokenMath.ts?raw'
import speech from '../voice/speech.ts?raw'
import session from '../voice/session.ts?raw'
import engines from '../voice/engines.ts?raw'
import ask from '../ui/AskPopover.tsx?raw'
import typed from '../notebook/TypedLayer.tsx?raw'
import { FOLLOW_UP } from './useNova'

describe('follow-up phrases stay on the last teaching question', () => {
  it('matches ordinary follow-ups (straight and curly apostrophes)', () => {
    for (const q of ["I still don't understand", 'I still don’t understand', 'Explain it again', 'Why?', "I'm confused", 'I’m confused', 'why does that work', 'Can you explain that differently?'])
      expect(FOLLOW_UP.test(q), q).toBe(true)
  })
  it('does not treat new questions as follow-ups', () => {
    for (const q of ['Solve 2x + 3 = 9', 'What is the integral of sin x', 'Give me a similar question', 'Show me the full solution', 'anywhy'])
      expect(FOLLOW_UP.test(q), q).toBe(false)
  })
  it('the source contains no control characters (escaping damage)', () => {
    for (const [f, s] of Object.entries({ nova, spoken, speech, session, engines, ask, typed })) {
      expect([...s].filter((c) => c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)).length, f).toBe(0)
    }
  })
})
