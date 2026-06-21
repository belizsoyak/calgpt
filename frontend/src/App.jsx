import { useState, useEffect, useRef } from 'react'
import * as audioEngine from './audioEngine'

const WS_URL = 'ws://localhost:8000/ws'
const API = 'http://localhost:8000'

function generateSessionId() {
  return Math.random().toString(36).slice(2)
}

export default function App() {
  const [user, setUser] = useState(() => localStorage.getItem('calgpt_user') || '')
  const [sessionId] = useState(generateSessionId)
  const [messages, setMessages] = useState([])
  const [contract, setContract] = useState(null)
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState('studio')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)
  const [source, setSource] = useState('file')   // 'file' | 'guitar'
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [audioError, setAudioError] = useState(null)
  const wsRef = useRef(null)
  const bottomRef = useRef(null)

  function signOut() {
    if (audioEngine.isPlaying()) { audioEngine.stop(); setLive(false) }
    localStorage.removeItem('calgpt_user')
    setUser('')
  }

  async function changeSource(mode) {
    setSource(mode)
    setAudioError(null)
    try {
      await audioEngine.setSource(mode)   // seamless swap if already live
      if (mode === 'guitar') setDevices(await audioEngine.listInputDevices())
    } catch (err) {
      console.error('source switch failed:', err)
      setAudioError('Could not access input device')
    }
  }

  function changeDevice(id) {
    setDeviceId(id)
    audioEngine.setInputDevice(id).catch(err => {
      console.error('device switch failed:', err)
      setAudioError('Could not switch input device')
    })
  }

  // toggle real-time audio; Tone.start() must run inside this click handler
  async function toggleLive() {
    if (audioEngine.isPlaying()) {
      audioEngine.stop()
      setLive(false)
    } else {
      setAudioError(null)
      try {
        await audioEngine.start()
        setLive(true)
        if (contract) audioEngine.applyChain(contract)
        // device labels are available now that permission was granted
        if (source === 'guitar') setDevices(await audioEngine.listInputDevices())
      } catch (err) {
        console.error('live audio failed:', err)
        setAudioError(source === 'guitar' ? 'Microphone/input permission denied' : 'Could not start audio')
      }
    }
  }

  async function onPickLoop(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await audioEngine.loadSource(file)
    } catch (err) {
      console.error('loop load failed:', err)
    }
  }

  // populate the device list when entering guitar mode
  useEffect(() => {
    if (source === 'guitar') audioEngine.listInputDevices().then(setDevices).catch(() => {})
  }, [source])

  // while live, morph the loop whenever the Studio chain changes
  useEffect(() => {
    if (live && contract) audioEngine.applyChain(contract)
  }, [contract, live])

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

  if (!user) {
    return <SignIn onSignIn={name => { localStorage.setItem('calgpt_user', name); setUser(name) }} />
  }

  return (
    <div className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🎸</span>
          <div className="leading-none">
            <h1 className="text-lg font-bold tracking-tight">CalGPT</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">AI guitar tone studio</p>
          </div>
          <span className={`ml-2 w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-zinc-600'}`}
            title={connected ? 'agent connected' : 'connecting...'} />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            {['studio', 'performance'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition ${
                  view === v ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-zinc-800">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-xs font-bold uppercase">
              {user[0] || '?'}
            </div>
            <span className="text-sm text-zinc-300 hidden sm:block">{user}</span>
            <button onClick={signOut} className="text-xs text-zinc-500 hover:text-white transition">Sign out</button>
          </div>
        </div>
      </header>

      {/* Live-audio control strip */}
      <div className="border-b border-zinc-800 bg-zinc-900/40 px-6 py-2.5 flex items-center gap-3 flex-wrap text-sm">
        <button onClick={toggleLive}
          className={`px-4 py-1.5 rounded-lg font-semibold transition ${
            live ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          }`}>
          {live ? '■ Stop' : '▶ Live'}
        </button>
        {live && (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />live · {source}
          </span>
        )}

        <span className="text-zinc-700">|</span>
        <span className="text-xs text-zinc-500">Source</span>
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
          {[['file', 'File'], ['guitar', 'Guitar']].map(([mode, label]) => (
            <button key={mode} onClick={() => changeSource(mode)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                source === mode ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {source === 'file' ? (
          <label className="text-xs text-zinc-400 hover:text-white cursor-pointer underline decoration-dotted underline-offset-2" title="Load your own guitar loop">
            load loop
            <input type="file" accept="audio/*" onChange={onPickLoop} className="hidden" />
          </label>
        ) : (
          <>
            <select value={deviceId} onChange={e => changeDevice(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500 max-w-[220px]">
              <option value="">Default input</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <span className="text-xs text-amber-500/80" title="Speakers + mic will feed back">🎧 use headphones</span>
          </>
        )}
        {audioError && <span className="text-xs text-red-400">{audioError}</span>}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
      {view === 'performance' ? (
        <Performance live={live} />
      ) : (
      <div className="flex flex-1 overflow-hidden">

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

function Performance({ live }) {
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
  const [autoPlay, setAutoPlay] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef(null)   // single shared Audio element
  const urlRef = useRef(null)     // last object URL, for cleanup

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  // play a chain through /preview; stops any currently-playing preview first
  async function playChain(chain) {
    if (!chain) return
    stopAudio()
    setPreviewing(true)
    try {
      const res = await fetch(`${API}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chain),
      })
      if (!res.ok) throw new Error(`preview ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      if (!audioRef.current) audioRef.current = new Audio()
      audioRef.current.src = url
      await audioRef.current.play()
    } catch (err) {
      console.error('preview failed:', err)
      setStatus('Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // stop audio + free the blob URL when leaving the view
  useEffect(() => stopAudio, [])

  // while live, morph the loop whenever the active song changes (Start/Next/Prev)
  useEffect(() => {
    if (live && active) audioEngine.applyChain(active)
  }, [active, live])

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
      // auto-play the newly-active song's tone right after pushing it
      if (autoPlay) playChain(setlist.songs[data.current].chain)
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
    <div className="flex flex-1 overflow-hidden">
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
          <label className="ml-auto flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)}
              className="accent-violet-500 w-4 h-4" />
            Auto-play on change
          </label>
        </div>

        {status && <p className="mb-4 text-sm text-amber-400">{status}</p>}

        {active ? (
          <>
            <h3 className="text-lg font-semibold text-violet-400 mb-4 flex items-center gap-3">
              {active.song_name}
              <span className={`text-xs ${active.pushed ? 'text-green-400' : 'text-zinc-500'}`}>
                {active.pushed ? '● pushed to pedal' : '○ not pushed'}
              </span>
              <button onClick={() => playChain(setlist.songs[current].chain)} disabled={previewing}
                className="ml-auto bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-semibold transition">
                {previewing ? 'Loading...' : '▶ Hear it'}
              </button>
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

function SignIn({ onSignIn }) {
  const [name, setName] = useState('')

  function submit(e) {
    e.preventDefault()
    const n = name.trim()
    if (n) onSignIn(n)
  }

  return (
    <div className="h-screen bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🎸</div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">CalGPT</h1>
        <p className="text-zinc-500 mb-8">Describe a tone in plain words — hear it live, build a setlist, send it to your pedal.</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-center text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-semibold transition"
          >
            Enter the studio
          </button>
        </form>
        <p className="text-[11px] text-zinc-600 mt-4">Saved locally on this device. No password needed.</p>
      </div>
    </div>
  )
}
