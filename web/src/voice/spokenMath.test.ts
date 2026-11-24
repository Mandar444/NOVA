import { describe, expect, it } from 'vitest'
import { interpretSpokenMath as I, prettyMath } from './spokenMath'

describe('spoken maths', () => {
  it('bounded integral', () => {
    const r = I('integral of x squared from zero to two')
    expect(r.text).toBe('∫_0^2 x^2 dx')
    expect(r.display).toBe('∫₀² x² dx')
    expect(r.complete).toBe(true)
  })
  it('quadratic equation keeps signs', () => {
    const r = I('x squared plus three x minus four equals zero')
    expect(r.text).toBe('x^2 + 3x - 4 = 0')
    expect(r.display).toBe('x² + 3x − 4 = 0')
  })
  it('differentiate sine x', () => {
    const r = I('differentiate sine x')
    expect(r.text).toBe('d/dx(sin x)')
    expect(r.display).toBe('d/dx(sin x)')
  })
  it('whisper-style digits and symbols', () => {
    expect(I('x squared + 3x - 4 = 0').text).toBe('x^2 + 3x - 4 = 0')
    expect(I('Integral of x squared from 0 to 2.').text).toBe('∫_0^2 x^2 dx')
  })
  it('never invents a missing bound', () => {
    const r = I('integral of x squared from zero')
    expect(r.text).toBe('')
    expect(r.clarify?.id).toBe('bound')
  })
  it('asks for the variable of integration when unclear', () => {
    const r = I('integral of x times y')
    expect(r.clarify?.id).toBe('var')
    expect(I('integral of x times y', { var: 'y' }).text).toBe('∫ x * y dy')
    expect(I('integral of x y with respect to y').text).toBe('∫ xy dy')
  })
  it('asks about an ambiguous "over"', () => {
    const r = I('x plus one over two')
    expect(r.clarify?.options.map((o) => o.label)).toEqual(['(x + 1)/2', 'x + 1/2'])
    expect(I('x plus one over two', { over0: 'whole' }).text).toBe('(x + 1)/2')
    expect(I('x plus one over two', { over0: 'part' }).text).toBe('x + 1/2')
    expect(I('x plus one all over two').text).toBe('(x + 1)/2')
  })
  it('keeps variable names, numbers and commands', () => {
    expect(I('solve two t plus five equals eleven').text).toBe('Solve 2t + 5 = 11')
    expect(I('twenty five point five minus theta').text).toBe('25.5 - θ')
    expect(I('derivative of t cubed').text).toBe('d/dt(t^3)')
    expect(I('integral of t squared from one to three with respect to t').text).toBe('∫_1^3 t^2 dt')
  })
  it('flags words it does not understand', () => {
    const r = I('x squared banana')
    expect(r.unknown).toContain('banana')
    expect(r.complete).toBe(false)
  })
  it('pretty prints canonical text', () => {
    expect(prettyMath('∫_0^2 x^2 dx')).toBe('∫₀² x² dx')
    expect(prettyMath('x^2 + 3x - 4 = 0')).toBe('x² + 3x − 4 = 0')
  })
})

import katex from 'katex'
import { canonToTex } from './spokenMath'
describe('typesetting dictated maths', () => {
  it('turns canonical text into valid TeX', () => {
    expect(canonToTex('∫_0^2 x^2 dx')).toBe('\int_{0}^{2} x^{2} \,dx')
    for (const t of ['∫_0^2 x^2 dx', 'x^2 + 3x - 4 = 0', 'd/dx(sin x)', '∫_0^1 x^2/100 dx', 'lim x->10 (3x + 4x - 6x sin θ)', 'dy/dx = sin(x^2)', 'Solve 2(x + 3) = 14'])
      expect(() => katex.renderToString(canonToTex(t), { throwOnError: true })).not.toThrow()
  })
})
