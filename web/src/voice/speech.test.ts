import { describe, expect, it } from 'vitest'
import { mathToSpeech, pickVoice } from './speech'

describe('maths read aloud', () => {
  it('reads notation naturally', () => {
    expect(mathToSpeech('∫₀² x² dx = 8/3')).toBe('the integral from 0 to 2 of x squared d x equals 8 over 3')
    expect(mathToSpeech('x² + 3x − 4 = 0')).toBe('x squared plus 3 x minus 4 equals 0')
    expect(mathToSpeech('d/dx(sin x) = cos x')).toBe('d by d x of (sine x) equals cos x')
  })
  it('never reads LaTeX commands', () => {
    const s = mathToSpeech('Use \\frac{x^{3}}{3} + C and \\int_0^2 x^2\\,dx')
    expect(s).not.toMatch(/\\|frac|\{|\}/)
    expect(s).toContain('over 3')
    expect(s).toContain('the integral from 0 to 2 of')
  })
  it('keeps ordinary words and hyphens', () => {
    expect(mathToSpeech('A well-known rule: add 1 to the power.')).toBe('A well-known rule: add 1 to the power.')
  })
})

describe('voice choice', () => {
  const v = (lang: string, localService = true, d = false) => ({ lang, localService, default: d, name: lang, voiceURI: lang }) as SpeechSynthesisVoice
  it('falls back sensibly', () => {
    expect(pickVoice([v('en-US'), v('en-IN')], 'en-IN')?.lang).toBe('en-IN')
    expect(pickVoice([v('en-US'), v('en-GB')], 'en-IN')?.lang).toBe('en-US')
    expect(pickVoice([v('fr-FR', true, true), v('en-GB', false)], 'hi-IN')?.lang).toBe('en-GB')
    expect(pickVoice([], 'en-IN')).toBeUndefined()
  })
})
