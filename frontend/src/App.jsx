import { useState } from 'react'

const BACKEND = 'http://localhost:8000'

export default function App() {
  const [vibe, setVibe] = useState('')
  const [preset, setPreset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!vibe.trim()) return
    setLoading(true)
    setError(null)
    setPreset(null)
    try {
      const res = await fetch(`${BACKEND}/vibe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setPreset(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center px-4">
      <h1 className="text-5xl font-bold mb-2 tracking-tight">CalGPT</h1>
      <p className="text-zinc-400 mb-10 text-lg">Describe your tone. Get your rig.</p>

      <form onSubmit={handleSubmit} className="w-full max-w-xl flex gap-2">
        <input
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition"
          placeholder="e.g. warm 70s blues with slapback delay"
          value={vibe}
          onChange={e => setVibe(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !vibe.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-semibold transition"
        >
          {loading ? '...' : 'Dial In'}
        </button>
      </form>

      {error && (
        <p className="mt-6 text-red-400 text-sm">{error}</p>
      )}

      {preset && (
        <div className="mt-10 w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-violet-400">{preset.preset_name}</h2>
          <div className="flex flex-col gap-3">
            {preset.effects.map((fx, i) => (
              <EffectCard key={i} fx={fx} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EffectCard({ fx }) {
  const { type, ...params } = fx
  return (
    <div className="bg-zinc-800 rounded-lg px-4 py-3">
      <p className="text-sm font-semibold text-zinc-300 uppercase tracking-widest mb-2">{type}</p>
      <div className="flex flex-wrap gap-4">
        {Object.entries(params).map(([k, v]) => (
          <Knob key={k} label={k} value={v} />
        ))}
      </div>
    </div>
  )
}

function Knob({ label, value }) {
  const pct = Math.round(
    label === 'rate_hz' ? (value / 5) * 100 :
    label === 'time_ms' ? (value / 2000) * 100 :
    value * 100
  )
  return (
    <div className="flex flex-col items-center gap-1 min-w-[56px]">
      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center relative">
        <div
          className="w-1 h-4 bg-violet-400 rounded absolute bottom-1/2 origin-bottom"
          style={{ transform: `rotate(${-140 + pct * 2.8}deg)` }}
        />
      </div>
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-300 font-mono">{typeof value === 'number' ? value.toFixed(2) : value}</span>
    </div>
  )
}
