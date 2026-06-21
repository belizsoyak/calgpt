// Client-side REAL-TIME audio engine (Tone.js).
//
// A persistent effect chain is built ONCE; applyChain() only ramps live params,
// so a looping guitar sample morphs in real time as the tone changes — no
// re-render, no restart. This is separate from the server /preview render.
//
//   player -> Distortion -> Chorus -> FeedbackDelay -> Reverb -> Destination

import * as Tone from 'tone'
import defaultLoop from './assets/loop.wav'

const RAMP = 0.05 // seconds — smooth param glide

let player, distortion, chorus, feedbackDelay, reverb
let initialized = false
let lastSize = null      // reverb.decay regenerates the IR (async), so only set on change
let objectUrl = null     // last URL.createObjectURL, for cleanup

function clamp01(v) {
  v = Number(v)
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}

// Build the persistent graph once. Nodes can be created while the context is
// still suspended; Tone.start() (from a user gesture) resumes it later.
function init() {
  if (initialized) return
  player = new Tone.Player({ url: defaultLoop, loop: true })
  distortion = new Tone.Distortion(0)
  chorus = new Tone.Chorus(1.5, 2.5, 0.5).start()
  feedbackDelay = new Tone.FeedbackDelay(0.25, 0.3)
  reverb = new Tone.Reverb(1.5)

  // everything bypassed (dry) until a chain is applied
  distortion.wet.value = 0
  chorus.wet.value = 0
  feedbackDelay.wet.value = 0
  reverb.wet.value = 0

  player.chain(distortion, chorus, feedbackDelay, reverb, Tone.Destination)
  initialized = true
}

// Start the looping playback. MUST be called from a click handler so the
// browser allows audio (Tone.start resumes the AudioContext).
export async function start() {
  await Tone.start()
  init()
  await Tone.loaded() // wait for the sample buffer(s)
  if (player.state !== 'started') player.start()
}

export function stop() {
  if (player && player.state === 'started') player.stop()
}

export function isPlaying() {
  return initialized && player.state === 'started'
}

// Map an effect-chain dict onto the live params and ramp them — no rebuild.
// Any effect missing from the chain has its wet ramped to 0 (bypass).
export function applyChain(chain) {
  if (!initialized || !chain) return
  const byType = {}
  for (const fx of chain.effects || []) byType[fx.type] = fx

  // overdrive -> distortion
  const od = byType.overdrive
  if (od) {
    distortion.distortion = clamp01(od.drive)
    distortion.wet.rampTo(clamp01(od.mix), RAMP)
  } else {
    distortion.wet.rampTo(0, RAMP)
  }

  // chorus
  const ch = byType.chorus
  if (ch) {
    chorus.frequency.rampTo(Number(ch.rate_hz) || 1.5, RAMP)
    chorus.depth = clamp01(ch.depth)
    chorus.wet.rampTo(clamp01(ch.mix), RAMP)
  } else {
    chorus.wet.rampTo(0, RAMP)
  }

  // delay
  const dl = byType.delay
  if (dl) {
    feedbackDelay.delayTime.rampTo((Number(dl.time_ms) || 0) / 1000, RAMP)
    feedbackDelay.feedback.rampTo(clamp01(dl.feedback), RAMP)
    feedbackDelay.wet.rampTo(clamp01(dl.mix), RAMP)
  } else {
    feedbackDelay.wet.rampTo(0, RAMP)
  }

  // reverb — vary wet live; only regenerate the IR (decay) when size changes
  const rv = byType.reverb
  if (rv) {
    const size = clamp01(rv.size)
    if (size !== lastSize) {
      reverb.decay = 0.5 + size * 4
      lastSize = size
    }
    reverb.wet.rampTo(clamp01(rv.mix), RAMP)
  } else {
    reverb.wet.rampTo(0, RAMP)
  }
}

// Swap the loop source (user-picked File or a URL string). Keeps playing if it was.
export async function loadSource(fileOrUrl) {
  init()
  const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl)
  const wasPlaying = player.state === 'started'
  if (wasPlaying) player.stop()
  await player.load(url)
  player.loop = true
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = typeof fileOrUrl === 'string' ? null : url
  if (wasPlaying) player.start()
}
