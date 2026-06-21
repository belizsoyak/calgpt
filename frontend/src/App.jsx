import { useState, useEffect, useRef } from 'react'

const WS_URL = 'ws://localhost:8000/ws'

function generateSessionId() {
  return Math.random().toString(36).slice(2)
}

export default function App() {
  const [sessionId] = useState(generateSessionId)
  const [messages, setMessages] = useState([])
  const [contract, setContract] = useState(null)
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
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

  function sendMessage(e) {
    e.preventDefault()
    if (!input.trim() || !connected) return
    setMessages(prev => [...prev, { role: 'user', text: input }])
    wsRef.current.send(JSON.stringify({ message: input }))
    setInput('')
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">CalGPT</h1>
        <span className={`w-2 h-2 rounded-full transition-colors ${connected ? 'bg-green-400' : 'bg-zinc-600'}`} />
        <span className="text-xs text-zinc-500">{connected ? 'connected' : 'connecting...'}</span>
      </header>

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
              disabled={!connected}
            />
            <button
              type="submit"
              disabled={!connected || !input.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-semibold text-sm transition"
            >
              Send
            </button>
          </form>
        </div>

        {/* Knobs panel */}
        <div className="w-1/2 p-6 overflow-y-auto">
          {contract ? (
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
