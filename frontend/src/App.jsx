import { useState, useEffect, useRef } from 'react'

const WS_URL = 'ws://localhost:8000/ws'
const API = 'http://localhost:8000'

function generateSessionId() {
  return Math.random().toString(36).slice(2)
}

export default function App() {
  const [sessionId] = useState(generateSessionId)
  const [messages, setMessages] = useState([])
  const [contract, setContract] = useState(null)
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState('studio')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/${sessionId}`)
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'chain_update') {
        setContract(data.contract)
        setMessages(prev => [...prev, { role: 'vibe', text: data.message }])
      } else if (data.type === 'critic_message') {
        setMessages(prev => [...prev, { role: 'critic', text: data.message }])
      }
    }
    wsRef.current = ws
    return () => ws.close()
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/vibe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe: text }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      // /vibe returns the chain at the TOP LEVEL: { preset_name, effects }
      const chain = await res.json()
      setContract(chain)
      setMessages(prev => [...prev, { role: 'vibe', text: `Dialed in "${chain.preset_name}".` }])
    } catch (err) {
      console.error('vibe request failed:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">CalGPT</h1>
        <span className={`w-2 h-2 rounded-full transition-colors ${connected ? 'bg-green-400' : 'bg-zinc-600'}`} />
        <span className="text-xs text-zinc-500">{connected ? 'connected' : 'connecting...'}</span>
        <div className="ml-auto flex gap-1 text-sm">
          {['studio', 'performance'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg font-medium capitalize transition ${
                view === v ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      {view === 'performance' ? (
        <Performance />
      ) : (
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

        {/* Chat panel */}
        <div className="flex flex-col w-1/2 border-r border-zinc-800">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.length === 0 && (
              <p className="text-zinc-600 text-sm text-center mt-12">
                Describe your tone to get started...
              </p>
            )}
            {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t border-zinc-800 p-4 flex gap-2">
            <input
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition text-sm"
              placeholder="warm 70s blues with slapback delay..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-semibold text-sm transition"
            >
              {loading ? '...' : 'Send'}
            </button>
          </form>
        </div>

        {/* Knobs panel */}
        <div className="w-1/2 p-6 overflow-y-auto">
          {loading ? (
            <p className="text-zinc-500 text-sm text-center mt-12">Dialing in your tone...</p>
          ) : error ? (
            <p className="text-red-400 text-sm text-center mt-12">{error}</p>
          ) : contract ? (
            <>
              <h2 className="text-lg font-semibold text-violet-400 mb-4">{contract.preset_name}</h2>
              <div className="flex flex-col gap-3">
                {contract.effects.map((fx, i) => <EffectCard key={i} fx={fx} />)}
              </div>
            </>
          ) : (
            <p className="text-zinc-600 text-sm text-center mt-12">
              Effect chain will appear here...
            </p>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

function ChatMessage({ msg }) {
  const styles = {
    user:   'self-end bg-violet-600 text-white',
    vibe:   'self-start bg-zinc-800 text-zinc-200',
    critic: 'self-start bg-amber-950/60 border border-amber-700/50 text-amber-300',
  }
  const labels = { vibe: 'Vibe Agent', critic: 'Critic' }

  return (
    <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${styles[msg.role]}`}>
      {msg.role !== 'user' && (
        <p className="text-xs opacity-50 mb-1">{labels[msg.role]}</p>
      )}
      {msg.text}
    </div>
  )
}

function Performance() {
  const [name, setName] = useState('My Set')
  const [espIp, setEspIp] = useState('127.0.0.1:9000')
  const [rows, setRows] = useState([
    { song_name: '', vibe: '' },
    { song_name: '', vibe: '' },
    { song_name: '', vibe: '' },
  ])
  const [setlist, setSetlist] = useState(null)
  const [current, setCurrent] = useState(-1)
  const [active, setActive] = useState(null)   // { song_name, effects, pushed }
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  function updateRow(i, key, val) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  }
  function addRow() {
    setRows([...rows, { song_name: '', vibe: '' }])
  }

  async function buildSetlist(e) {
    e.preventDefault()
    const songs = rows.filter(r => r.song_name.trim() && r.vibe.trim())
    if (!songs.length) return
    setBusy(true)
    setStatus('Precomputing tones...')
    try {
      const res = await fetch(`${API}/setlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, esp_ip: espIp, songs }),
      })
      const data = await res.json()
      if (data.error) { setStatus(`Error: ${data.error}`); return }
      setSetlist(data)
      setCurrent(-1)
      setActive(null)
      setStatus(null)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function action(verb) {
    if (!setlist) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/setlist/${setlist.id}/${verb}`, { method: 'POST' })
      const data = await res.json()
      if (data.done) { setStatus('End of setlist'); return }
      if (data.error) { setStatus(`Error: ${data.error}`); return }
      setCurrent(data.current)
      setActive(data)
      setStatus(data.pushed ? null : 'Pedal unreachable (tone not pushed)')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  // --- builder form (before a setlist exists) ---
  if (!setlist) {
    return (
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
        <h2 className="text-lg font-semibold text-violet-400 mb-4">Build a setlist</h2>
        <form onSubmit={buildSetlist} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
              placeholder="Setlist name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              className="w-48 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
              placeholder="esp_ip (host:port)"
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
            />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="w-1/3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                placeholder={`Song ${i + 1} name`}
                value={r.song_name}
                onChange={e => updateRow(i, 'song_name', e.target.value)}
              />
              <input
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                placeholder="tone vibe, e.g. warm blues with slapback"
                value={r.vibe}
                onChange={e => updateRow(i, 'vibe', e.target.value)}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={addRow}
              className="text-sm text-zinc-400 hover:text-white px-3 py-2">+ Add song</button>
            <button type="submit" disabled={busy}
              className="ml-auto bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold text-sm transition">
              {busy ? 'Building...' : 'Build setlist'}
            </button>
          </div>
        </form>
        {status && <p className="mt-4 text-sm text-zinc-400">{status}</p>}
      </div>
    )
  }

  // --- performance view (setlist built) ---
  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>
      {/* Song list */}
      <div className="w-1/3 border-r border-zinc-800 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{setlist.name}</h2>
          <button onClick={() => { setSetlist(null); setActive(null); setCurrent(-1) }}
            className="text-xs text-zinc-500 hover:text-white">edit</button>
        </div>
        <ul className="flex flex-col gap-1">
          {setlist.songs.map((s, i) => (
            <li key={i}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                i === current ? 'bg-violet-600 text-white font-semibold' : 'bg-zinc-800/50 text-zinc-300'
              }`}>
              <span className="opacity-50 mr-2">{i + 1}</span>{s.song_name}
            </li>
          ))}
        </ul>
      </div>

      {/* Stage: transport + active tone */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex gap-3 mb-6">
          <button onClick={() => action('prev')} disabled={busy}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-6 py-3 rounded-xl font-semibold transition">‹ Prev</button>
          <button onClick={() => action('start')} disabled={busy}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-40 px-8 py-3 rounded-xl font-bold transition">▶ Start</button>
          <button onClick={() => action('next')} disabled={busy}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-6 py-3 rounded-xl font-semibold transition">Next ›</button>
        </div>

        {status && <p className="mb-4 text-sm text-amber-400">{status}</p>}

        {active ? (
          <>
            <h3 className="text-lg font-semibold text-violet-400 mb-4">
              {active.song_name}
              <span className={`ml-3 text-xs ${active.pushed ? 'text-green-400' : 'text-zinc-500'}`}>
                {active.pushed ? '● pushed to pedal' : '○ not pushed'}
              </span>
            </h3>
            <div className="flex flex-col gap-3 max-w-xl">
              {active.effects.map((fx, i) => <EffectCard key={i} fx={fx} />)}
            </div>
          </>
        ) : (
          <p className="text-zinc-600 text-sm mt-12 text-center">Press Start to load the first song's tone.</p>
        )}
      </div>
    </div>
  )
}

function EffectCard({ fx }) {
  const { type, ...params } = fx
  return (
    <div className="bg-zinc-800 rounded-lg px-4 py-3">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">{type}</p>
      <div className="flex flex-wrap gap-4">
        {Object.entries(params).map(([k, v]) => <Knob key={k} label={k} value={v} />)}
      </div>
    </div>
  )
}

function Knob({ label, value }) {
  const pct = label === 'rate_hz' ? (value / 5) * 100
            : label === 'time_ms' ? (value / 2000) * 100
            : value * 100
  return (
    <div className="flex flex-col items-center gap-1 min-w-[56px]">
      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center relative">
        <div
          className="w-1 h-4 bg-violet-400 rounded absolute bottom-1/2 origin-bottom"
          style={{ transform: `rotate(${-140 + pct * 2.8}deg)` }}
        />
      </div>
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-300 font-mono">
        {typeof value === 'number' ? value.toFixed(2) : value}
      </span>
    </div>
  )
}
