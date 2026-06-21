import { useState, useEffect, useRef } from 'react'
import * as audioEngine from './audioEngine'

// Backend location is configurable via env (VITE_API_URL / VITE_WS_URL),
// defaulting to the standard local backend on port 8000.
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'

function generateSessionId() {
  return Math.random().toString(36).slice(2)
}

function stripJson(content) {
  return content.replace(/```json[\s\S]*?```/g, '').replace(/@\w+/g, m => m).trim().slice(0, 120)
}

function parseContract(content) {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/)
  if (match) {
    try {
      const data = JSON.parse(match[1])
      if (data.effects) return data
      if (data.contract?.effects) return data.contract
    } catch {}
  }
  try {
    const data = JSON.parse(content)
    if (data.effects) return data
    if (data.contract?.effects) return data.contract
  } catch {}
  return null
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('calgpt_dark') !== 'false')
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
  const [feedbackState, setFeedbackState] = useState(null) // null | 'saved' | 'quick_fixes'
  const [quickFixes, setQuickFixes] = useState([])
  const [agentLog, setAgentLog] = useState([])
  const wsRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('calgpt_dark', darkMode)
  }, [darkMode])

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
        setLoading(false)
        setFeedbackState(null)
        setQuickFixes([])
      } else if (data.type === 'critic_message') {
        setMessages(prev => [...prev, { role: 'critic', text: data.message }])
      } else if (data.type === 'agent_message') {
        setMessages(prev => [...prev, { role: data.agent, text: data.content }])
        setAgentLog(prev => [...prev.slice(-19), {
          agent: data.agent,
          text: stripJson(data.content),
          ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        }])
        setLoading(false)
        // If VibeAgent included a JSON contract, parse and apply it
        if (data.agent === 'VibeAgent') {
          const contract = parseContract(data.content)
          if (contract) {
            setContract(contract)
            setFeedbackState(null)
            setQuickFixes([])
          }
        }
      } else if (data.type === 'quick_fixes') {
        setQuickFixes(data.fixes)
        setFeedbackState('quick_fixes')
      } else if (data.type === 'feedback_saved') {
        setFeedbackState('saved')
        setTimeout(() => setFeedbackState(null), 2000)
      }
    }
    wsRef.current = ws
    return () => ws.close()
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading || !connected) return
    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setLoading(true)
    setError(null)
    wsRef.current.send(JSON.stringify({ message: text }))
  }

  function sendFeedback(rating) {
    if (!contract || !connected) return
    wsRef.current.send(JSON.stringify({ type: 'feedback', rating, contract }))
  }

  function sendQuickFix(fix) {
    if (!contract || !connected) return
    setMessages(prev => [...prev, { role: 'user', text: fix }])
    setLoading(true)
    setFeedbackState(null)
    wsRef.current.send(JSON.stringify({ type: 'quick_fix', fix, contract }))
  }

  if (!user) {
    return <SignIn onSignIn={name => { localStorage.setItem('calgpt_user', name); setUser(name) }} />
  }

  return (
    <div className="h-screen dark:bg-zinc-950 bg-gray-50 dark:text-white text-zinc-900 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="border-b dark:border-red-950 border-red-200 dark:bg-zinc-950 bg-white px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🎸</span>
          <div className="leading-none">
            <h1 style={{ fontFamily: "'Metal Mania', cursive" }} className="text-xl dark:text-white text-red-600 tracking-wide">
              CalGPT <span className="text-sm font-sans tracking-normal" style={{ fontFamily: "'Oswald', sans-serif" }}>(Guitar Pedal Technology)</span>
            </h1>
            <p className="text-[11px] text-zinc-500 mt-0.5 uppercase tracking-widest" style={{ fontFamily: "'Oswald', sans-serif" }}>AI Tone Studio</p>
          </div>
          <span className={`ml-2 w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-zinc-600'}`}
            title={connected ? 'agent connected' : 'connecting...'} />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            {['studio', 'performance'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition ${
                  view === v ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-zinc-800">
            <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold uppercase">
              {user[0] || '?'}
            </div>
            <span className="text-sm text-zinc-300 hidden sm:block">{user}</span>
            <button onClick={signOut} className="text-xs text-zinc-500 hover:text-white transition">Sign out</button>
          </div>
        </div>
      </header>

      {/* Live-audio control strip */}
      <div className="border-b dark:border-zinc-800 border-gray-200 dark:bg-zinc-900/40 bg-gray-100/60 px-6 py-2.5 flex items-center gap-3 flex-wrap text-sm">
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
                source === mode ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
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
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-red-500 max-w-[220px]">
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
        <div className="flex flex-col w-1/2 border-r dark:border-zinc-800 border-gray-200">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.length === 0 && (
              <p className="text-zinc-600 text-sm text-center mt-12">
                Describe your tone to get started...
              </p>
            )}
            {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t dark:border-zinc-800 border-gray-200 p-4 flex gap-2">
            <input
              className="flex-1 dark:bg-zinc-800 bg-white dark:border-zinc-700 border-gray-300 border rounded-lg px-4 py-2 dark:text-white text-zinc-900 dark:placeholder-zinc-500 placeholder-gray-400 focus:outline-none focus:border-red-500 transition text-sm"
              placeholder="SRV, Hendrix, or describe your tone..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-semibold text-sm transition"
            >
              {loading ? '...' : 'Send'}
            </button>
          </form>
        </div>

        {/* Right panel: pedals + agent activity */}
        <div className="w-1/2 flex flex-col overflow-hidden">
        <div className="flex-1 p-6 overflow-y-auto">
          {loading ? (
            <p className="text-zinc-500 text-sm text-center mt-12">Dialing in your tone...</p>
          ) : error ? (
            <p className="text-red-400 text-sm text-center mt-12">{error}</p>
          ) : contract ? (
            <>
              <h2 className="text-lg font-semibold text-red-400 mb-4">{contract.preset_name}</h2>
              <div className="flex flex-col gap-2">
                {contract.effects.map((fx, i) => (
                  <Pedal key={i} fx={fx} isLast={i === contract.effects.length - 1} />
                ))}
              </div>

              {/* Feedback row */}
              <div className="mt-4 flex flex-col gap-2">
                {feedbackState === 'saved' ? (
                  <p className="text-green-400 text-xs text-center">✓ Saved to session</p>
                ) : feedbackState === 'quick_fixes' ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-zinc-500 text-xs">Pick a fix:</p>
                    <div className="flex flex-wrap gap-2">
                      {quickFixes.map(fix => (
                        <button key={fix} onClick={() => sendQuickFix(fix)}
                          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition">
                          {fix}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => sendFeedback('positive')}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg text-sm transition">
                      👍 Sounds right
                    </button>
                    <button onClick={() => sendFeedback('negative')}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg text-sm transition">
                      👎 Not quite
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-zinc-600 text-sm text-center mt-12">
              Effect chain will appear here...
            </p>
          )}
        </div>

        {/* Agent Activity feed */}
        <div className="border-t dark:border-zinc-800 border-gray-200 dark:bg-zinc-900/60 bg-gray-100/60 px-4 py-3 h-44 overflow-y-auto flex flex-col gap-1.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">⚡ Agent Activity</p>
          {agentLog.length === 0 ? (
            <p className="text-zinc-700 text-xs">Waiting for agent activity...</p>
          ) : (
            agentLog.map((entry, i) => <AgentLogEntry key={i} entry={entry} />)
          )}
        </div>
        </div>
      </div>
      )}
      </div>

      {/* Dark/Light mode toggle */}
      <button
        onClick={() => setDarkMode(d => !d)}
        className="fixed bottom-5 right-5 w-10 h-10 rounded-full dark:bg-zinc-800 bg-white border dark:border-zinc-700 border-gray-300 shadow-lg flex items-center justify-center text-lg transition hover:scale-110 z-50"
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {darkMode ? '☀️' : '🌙'}
      </button>
    </div>
  )
}

function ChatMessage({ msg }) {
  const styles = {
    user:          'self-end bg-red-600 text-white',
    vibe:          'self-start bg-zinc-800 text-zinc-200',
    critic:        'self-start bg-amber-950/60 border border-amber-700/50 text-amber-300',
    VibeAgent:     'self-start bg-red-950/60 border border-red-700/50 text-red-300',
    CriticAgent:   'self-start bg-amber-950/60 border border-amber-700/50 text-amber-300',
    ResearchAgent: 'self-start bg-blue-950/60 border border-blue-700/50 text-blue-300',
    MemoryAgent:   'self-start bg-yellow-950/60 border border-yellow-700/50 text-yellow-300',
    FeedbackAgent: 'self-start bg-green-950/60 border border-green-700/50 text-green-300',
  }
  const labels = {
    vibe: 'Vibe Agent', critic: 'Critic',
    VibeAgent: 'Vibe Agent ⚡ Band', CriticAgent: 'Critic ⚡ Band',
    ResearchAgent: 'Research ⚡ Band', MemoryAgent: 'Memory ⚡ Band',
    FeedbackAgent: 'Feedback ⚡ Band',
  }

  return (
    <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${styles[msg.role] || 'self-start bg-zinc-800 text-zinc-200'}`}>
      {msg.role !== 'user' && (
        <p className="text-xs opacity-50 mb-1">{labels[msg.role] || msg.role}</p>
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
        <h2 className="text-lg font-semibold text-red-400 mb-4">Build a setlist</h2>
        <form onSubmit={buildSetlist} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
              placeholder="Setlist name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              className="w-48 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-red-500"
              placeholder="esp_ip (host:port)"
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
            />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="w-1/3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                placeholder={`Song ${i + 1} name`}
                value={r.song_name}
                onChange={e => updateRow(i, 'song_name', e.target.value)}
              />
              <input
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
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
              className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold text-sm transition">
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
        <a
          href={`${API}/setlist/${setlist.id}/export.csv`}
          download
          className="block mb-3 text-center text-xs font-medium text-red-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-700 rounded-lg py-2 transition"
          title="Download this setlist as CSV for the ESP32 pedal"
        >
          ⬇ Export CSV
        </a>
        <ul className="flex flex-col gap-1">
          {setlist.songs.map((s, i) => (
            <li key={i}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                i === current ? 'bg-red-600 text-white font-semibold' : 'bg-zinc-800/50 text-zinc-300'
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
              className="accent-red-500 w-4 h-4" />
            Auto-play on change
          </label>
        </div>

        {status && <p className="mb-4 text-sm text-amber-400">{status}</p>}

        {active ? (
          <>
            <h3 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-3">
              {active.song_name}
              <span className={`text-xs ${active.pushed ? 'text-green-400' : 'text-zinc-500'}`}>
                {active.pushed ? '● pushed to pedal' : '○ not pushed'}
              </span>
              <button onClick={() => playChain(setlist.songs[current].chain)} disabled={previewing}
                className="ml-auto bg-red-600 hover:bg-red-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-semibold transition">
                {previewing ? 'Loading...' : '▶ Hear it'}
              </button>
            </h3>
            <div className="flex flex-col gap-2 max-w-xl">
              {active.effects.map((fx, i) => (
                <Pedal key={i} fx={fx} isLast={i === active.effects.length - 1} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-zinc-600 text-sm mt-12 text-center">Press Start to load the first song's tone.</p>
        )}
      </div>
    </div>
  )
}

const AGENT_COLOR = {
  VibeAgent:     { dot: 'bg-red-500',    text: 'text-red-400'    },
  CriticAgent:   { dot: 'bg-amber-500',  text: 'text-amber-400'  },
  ResearchAgent: { dot: 'bg-blue-500',   text: 'text-blue-400'   },
  MemoryAgent:   { dot: 'bg-yellow-500', text: 'text-yellow-400' },
  FeedbackAgent: { dot: 'bg-green-500',  text: 'text-green-400'  },
}

function AgentLogEntry({ entry }) {
  const c = AGENT_COLOR[entry.agent] || { dot: 'bg-zinc-500', text: 'text-zinc-400' }
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-zinc-600 font-mono mt-0.5 shrink-0">{entry.ts}</span>
      <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${c.dot}`} />
      <span className={`font-semibold shrink-0 ${c.text}`}>{entry.agent}</span>
      <span className="text-zinc-400 truncate">{entry.text}</span>
    </div>
  )
}

const PEDAL_THEME = {
  overdrive: { bg: 'bg-amber-950',   border: 'border-amber-600',   led: 'bg-amber-400',   glow: '#f59e0b', label: 'text-amber-400',   knob: '#f59e0b' },
  chorus:    { bg: 'bg-blue-950',    border: 'border-blue-500',    led: 'bg-blue-400',    glow: '#60a5fa', label: 'text-blue-400',    knob: '#60a5fa' },
  delay:     { bg: 'bg-emerald-950', border: 'border-emerald-600', led: 'bg-emerald-400', glow: '#34d399', label: 'text-emerald-400', knob: '#34d399' },
  reverb:    { bg: 'bg-red-950',  border: 'border-red-700',  led: 'bg-red-400',  glow: '#ef4444', label: 'text-red-400',  knob: '#ef4444' },
}

function Pedal({ fx, isLast }) {
  const { type, ...params } = fx
  const t = PEDAL_THEME[type] || PEDAL_THEME.reverb
  return (
    <div className="flex items-stretch gap-0">
      <div className={`flex-1 ${t.bg} border ${t.border} rounded-xl p-4 relative`}>
        {/* LED */}
        <div
          className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${t.led}`}
          style={{ boxShadow: `0 0 7px 2px ${t.glow}` }}
        />
        <p className={`text-xs font-bold uppercase tracking-widest mb-4 ${t.label}`}>{type}</p>
        <div className="flex flex-wrap gap-5">
          {Object.entries(params).map(([k, v]) => <Knob key={k} label={k} value={v} color={t.knob} />)}
        </div>
        {/* footswitch */}
        <div className="mt-4 flex justify-center">
          <div className="w-8 h-4 rounded-full bg-zinc-700 border border-zinc-600" />
        </div>
      </div>
      {!isLast && (
        <div className="flex items-center px-1 text-zinc-600 text-xs select-none">→</div>
      )}
    </div>
  )
}

function Knob({ label, value, color }) {
  const pct = label === 'rate_hz' ? (value / 5) * 100
            : label === 'time_ms' ? (value / 2000) * 100
            : value * 100
  return (
    <div className="flex flex-col items-center gap-1 min-w-[52px]">
      <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center relative">
        <div
          className="w-1 h-4 rounded absolute bottom-1/2 origin-bottom"
          style={{ transform: `rotate(${-140 + pct * 2.8}deg)`, backgroundColor: color }}
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
    <div className="h-screen dark:bg-zinc-950 bg-gray-50 dark:text-white text-zinc-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🎸</div>
        <h1 style={{ fontFamily: "'Metal Mania', cursive" }} className="text-5xl dark:text-white text-red-600 mb-1">
          CalGPT
          <span className="block text-2xl font-sans tracking-normal mt-1" style={{ fontFamily: "'Oswald', sans-serif" }}>(Guitar Pedal Technology)</span>
        </h1>
        <p className="text-zinc-500 mb-8 uppercase tracking-widest text-xs mt-3" style={{ fontFamily: "'Oswald', sans-serif" }}>Describe your tone. Hear it live.</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            className="dark:bg-zinc-900 bg-white dark:border-zinc-700 border-gray-300 border rounded-lg px-4 py-3 text-center dark:text-white text-zinc-900 dark:placeholder-zinc-500 placeholder-gray-400 focus:outline-none focus:border-red-500 transition"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-semibold transition text-white"
          >
            Enter the studio
          </button>
        </form>
        <p className="text-[11px] text-zinc-500 mt-4">Saved locally on this device. No password needed.</p>
      </div>
    </div>
  )
}
