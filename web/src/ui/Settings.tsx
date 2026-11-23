import { useEffect, useState } from 'react'
import { api, type Capabilities } from '../tutor/api'
import { Icon } from './icons'
import { getThemePref, setThemePref, type ThemePref } from './theme'
import { getVoiceLang, setVoiceLang, type VoiceLang } from '../voice/browserSpeech'
import { getLibrary } from '../handwriting/library'
import { HANDWRITING_TOTAL } from './HandwritingSetup'

export interface AppSettings {
  settingsV?: number
  autoAnswer: boolean
  assist: boolean
  assistConsent: boolean
  speechOutput: boolean
  stylusOnly: boolean
  showReadback?: boolean // the small chip under each line with what NOVA read (on unless turned off)
}

// Assist (read after you pause writing) is on from the start: that is the whole experience
export const DEFAULT_SETTINGS: AppSettings = { autoAnswer: true, assist: true, assistConsent: true, settingsV: 2, speechOutput: false, stylusOnly: false }

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onClose: () => void
  onRequestAssist: () => void
  onExport: () => void
  onTeachHandwriting: () => void
}

export function SettingsDialog({ settings, onChange, onClose, onRequestAssist, onExport, onTeachHandwriting }: Props) {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [voice, setVoice] = useState<VoiceLang>(getVoiceLang)
  const taught = Object.keys(getLibrary()).length
  const total = HANDWRITING_TOTAL()

  const load = () => api.capabilities().then((c) => { setCaps(c); setErr(null) }).catch((e) => setErr((e as Error).message))
  useEffect(() => void load(), [])

  const test = async (vision: boolean) => {
    setTesting(vision ? 'vision' : 'models')
    setResult(null)
    try {
      const r = await api.testConnection(vision)
      const v = r.vision as { passed?: boolean; reading?: string; latencyMs?: number; error?: { message: string } } | undefined
      if (vision && v) setResult(v.error ? `Vision test failed: ${v.error.message}` : `Vision ${v.passed ? 'passed' : 'did not match'}: read “${v.reading}” in ${v.latencyMs} ms (synthetic typed image, not handwriting evidence).`)
      else setResult(r.ok ? 'Models reachable.' : `Failed: ${(r.error as { message?: string })?.message ?? 'unknown error'}`)
    } catch (e) {
      setResult((e as Error).message)
    } finally {
      setTesting(null)
      load()
    }
  }

  return (
    <div className="dialog-backdrop st-back" onClick={onClose}>
      <div className="st" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="st-head">
          <button className="st-backbtn" aria-label="Back" onClick={onClose}><Icon.back /></button>
          <h2>Settings</h2>
        </div>

        <section className="st-card">
          <h3>Theme</h3>
          <div className="st-themes" role="radiogroup" aria-label="Theme">
            {(['light', 'dark', 'system'] as ThemePref[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className={`st-theme ${theme === t ? 'on' : ''}`} onClick={() => { setTheme(t); setThemePref(t) }}>
                <span className={`st-theme-pv ${t}`} aria-hidden="true" />
                <span>{t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="st-card st-rows">
          <label className="st-row">
            <span><b>Assist</b><span>NOVA checks each line as you write and marks ✓ or ✗</span></span>
            <input type="checkbox" className="st-check" checked={settings.assist} onChange={(e) => (e.target.checked && !settings.assistConsent ? onRequestAssist() : onChange({ ...settings, assist: e.target.checked }))} />
          </label>
          <label className="st-row">
            <span><b>Show what NOVA read</b><span>A small chip under each line. Tap it to open Hint, Explain or Solve.</span></span>
            <input type="checkbox" className="st-check" checked={settings.showReadback !== false} onChange={(e) => onChange({ ...settings, showReadback: e.target.checked })} />
          </label>
          <div className="st-row">
            <span><b>Voice language</b><span>For spoken questions. Shown in the text box before sending.</span></span>
            <div className="st-seg" role="radiogroup" aria-label="Voice language">
              {([['en', 'English'], ['hi', 'हिन्दी'], ['hinglish', 'Hinglish']] as [VoiceLang, string][]).map(([v, label]) => (
                <button key={v} role="radio" aria-checked={voice === v} className={voice === v ? 'on' : ''} onClick={() => { setVoice(v); setVoiceLang(v) }}>{label}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="st-hw">
          <span className="st-hw-pv" aria-hidden="true">7 x ÷</span>
          <span className="st-hw-body">
            <b>Teach NOVA my handwriting</b>
            <span>Write a few digits and symbols so NOVA writes its answers in your hand. About 3 minutes.</span>
            <span className="st-hw-bar"><i style={{ '--w': `${Math.round((taught / Math.max(1, total)) * 100)}%` } as React.CSSProperties} /><em>{taught} / {total}</em></span>
          </span>
          <button className="st-hw-btn" onClick={onTeachHandwriting}>{taught ? 'Continue' : 'Start'}</button>
        </section>

        <details className="st-card st-more">
          <summary>More settings</summary>
          <label className="st-row">
            <span><b>Auto-answer</b><span>NOVA finishes plain arithmetic after “=”. Off: NOVA only marks ✓ / ✗.</span></span>
            <input type="checkbox" className="st-check" checked={settings.autoAnswer} onChange={(e) => onChange({ ...settings, autoAnswer: e.target.checked })} />
          </label>
          <label className="st-row">
            <span><b>Always speak NOVA's replies</b><span>Spoken questions are always answered aloud.</span></span>
            <input type="checkbox" className="st-check" checked={settings.speechOutput} onChange={(e) => onChange({ ...settings, speechOutput: e.target.checked })} />
          </label>
          <label className="st-row">
            <span><b>Stylus-only drawing</b><span>Fingers pan and zoom.</span></span>
            <input type="checkbox" className="st-check" checked={settings.stylusOnly} onChange={(e) => onChange({ ...settings, stylusOnly: e.target.checked })} />
          </label>
          <div className="st-row st-col">
            <span><b>Connection</b><span>{err ? `Server not reachable: ${err}` : caps ? `${caps.provider.model} · key ${caps.provider.keyConfigured ? 'set' : 'missing'} · models ${caps.provider.modelsReachable === null ? 'not tested' : caps.provider.modelsReachable ? 'reachable' : 'unreachable'}` : 'Checking…'}</span></span>
            <span className="row gap">
              <button className="btn" disabled={!!testing} onClick={() => test(false)}>{testing === 'models' ? 'Testing…' : 'Test connection'}</button>
              <button className="btn" disabled={!!testing} onClick={() => test(true)}>{testing === 'vision' ? 'Testing…' : 'Test vision'}</button>
            </span>
            {result && <span className="muted">{result}</span>}
          </div>
          <div className="st-row st-col">
            <span><b>Backup</b><span>Notebooks live on this device only. Export a copy to keep it safe.</span></span>
            <button className="btn" onClick={onExport}>Export notebook backup</button>
          </div>
        </details>
        <p className="st-foot">Your notebooks are saved on this device. Nothing changes when you switch themes.</p>
      </div>
    </div>
  )
}

export function AssistConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog narrow" role="dialog" aria-label="Turn on Assist" onClick={(e) => e.stopPropagation()}>
        <h2>Turn on Assist?</h2>
        <p>With Assist on, about a second after you stop writing NOVA sends a picture of <strong>just that line of ink</strong> to the BharatCode model so it can read it. Only the line is sent, not the whole page, grid or NOVA's notes.</p>
        <p className="muted">Requests use store:false, but that does not guarantee zero retention by the provider. With Assist off, writing stays on this device and NOVA only reads when you tap Read or Ask.</p>
        <div className="row gap end">
          <button className="btn" onClick={onCancel}>Not now</button>
          <button className="btn primary" onClick={onAccept}>Turn on Assist</button>
        </div>
      </div>
    </div>
  )
}
