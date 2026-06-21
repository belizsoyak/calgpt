// calgpt_pedal_hwtest.ino — Adafruit ESP32 Feather (HUZZAH32) test firmware
//
// No WiFi, no HTTP, no ArduinoJson, no I2S.
// Uses ESP32 built-in ADC + DAC directly.
// Params hardcoded: SRV-style heavy overdrive + reverb.
//
// Wiring:
//   A1  (GPIO 25) — DAC output → amp/speaker
//   A2  (GPIO 34) — ADC input  ← guitar signal (bias to ~1.65V / Vcc/2)
//   GND (next to A0) — signal ground
//   LED — wire to GPIO 13 (built-in LED on Feather) with 470Ω to GND
//
// ⚠ A3 = GPIO 39 on HUZZAH32, which is INPUT ONLY — cannot drive an LED.
//   Use GPIO 13 instead (it's the red LED already on the board).
//   If you have a different Feather revision, change PIN_LED below.
//
// Effect order: overdrive → vibrato → tremolo → delay → reverb

#include <math.h>

// ---------------------------------------------------------------------------
// Pin config
// ---------------------------------------------------------------------------
#define PIN_ADC   34    // A2 — guitar input (bias to 1.65V)
#define PIN_DAC   25    // A1 — audio output
#define PIN_LED   13    // built-in red LED on HUZZAH32 (change if needed)

// ---------------------------------------------------------------------------
// Audio config
// ---------------------------------------------------------------------------
#define SAMPLE_RATE   8000    // Hz
#define BUFFER_FRAMES 256
#define DELAY_MAX_MS  100     // only reverb pre-delay (~50ms) needed; delay+vibrato are off

// Microseconds per sample
#define US_PER_SAMPLE (1000000 / SAMPLE_RATE)

// ---------------------------------------------------------------------------
// Hardcoded params — SRV: heavy overdrive + reverb
// ---------------------------------------------------------------------------
struct FxParams {
  float od_drive, od_tone, od_mix;
  float vib_rate, vib_depth, vib_mix;
  float trem_rate, trem_depth, trem_mix;
  float dl_time_ms, dl_feedback, dl_mix;
  float rv_mix;
};

static const FxParams g_params = {
  // overdrive: drive, tone, mix
  0.9f, 0.8f, 1.0f,
  // vibrato:   rate(Hz), depth, mix
  0.0f, 0.0f, 0.0f,
  // tremolo:   rate(Hz), depth, mix
  0.0f, 0.0f, 0.0f,
  // delay:     time_ms, feedback, mix
  0.0f, 0.0f, 0.0f,
  // reverb:    mix
  0.6f
};

// ---------------------------------------------------------------------------
// DSP state — identical to main firmware
// ---------------------------------------------------------------------------
static const int DELAY_LINE_LEN = (SAMPLE_RATE * DELAY_MAX_MS) / 1000 + 1;

static int32_t delay_line[DELAY_LINE_LEN];
static int     delay_write = 0;
static int32_t vib_line[DELAY_LINE_LEN];
static int     vib_write = 0;
static int32_t reverb_buf[DELAY_LINE_LEN];
static int     reverb_write = 0;
static float   od_lp_state = 0.0f;
static float   vib_phase   = 0.0f;
static float   trem_phase  = 0.0f;

static const int REVERB_DELAY = SAMPLE_RATE / 20;

// ---------------------------------------------------------------------------
// process_buffer — copied verbatim from main firmware
// ---------------------------------------------------------------------------
void process_buffer(int32_t *buf, int frames, const FxParams &p) {
  const float TWO_PI_F = 6.28318530718f;
  const float vib_inc  = TWO_PI_F * p.vib_rate  / (float)SAMPLE_RATE;
  const float trem_inc = TWO_PI_F * p.trem_rate / (float)SAMPLE_RATE;
  const int dl_samples = (int)(p.dl_time_ms * SAMPLE_RATE / 1000.0f);
  const int vib_max    = (int)(0.005f * SAMPLE_RATE);

  for (int i = 0; i < frames; ++i) {
    float x = (float)buf[i];

    if (p.od_mix > 0.0f) {
      float g = 1.0f + p.od_drive * 30.0f;
      float wet = tanhf(x * g / 2147483648.0f) * 2147483648.0f;
      od_lp_state += (wet - od_lp_state) * (0.05f + 0.9f * p.od_tone);
      wet = od_lp_state;
      x = x * (1.0f - p.od_mix) + wet * p.od_mix;
    }

    vib_line[vib_write] = (int32_t)x;
    if (p.vib_mix > 0.0f && vib_max > 0) {
      float lfo = (sinf(vib_phase) * 0.5f + 0.5f) * p.vib_depth * vib_max;
      int rd = vib_write - (int)lfo;
      while (rd < 0) rd += DELAY_LINE_LEN;
      float wet = (float)vib_line[rd % DELAY_LINE_LEN];
      x = x * (1.0f - p.vib_mix) + wet * p.vib_mix;
    }
    vib_phase += vib_inc;
    if (vib_phase > TWO_PI_F) vib_phase -= TWO_PI_F;
    if (++vib_write >= DELAY_LINE_LEN) vib_write = 0;

    if (p.trem_mix > 0.0f) {
      float lfo  = (sinf(trem_phase) * 0.5f + 0.5f);
      float gain = 1.0f - p.trem_depth * lfo;
      float wet  = x * gain;
      x = x * (1.0f - p.trem_mix) + wet * p.trem_mix;
    }
    trem_phase += trem_inc;
    if (trem_phase > TWO_PI_F) trem_phase -= TWO_PI_F;

    if (p.dl_mix > 0.0f && dl_samples > 0 && dl_samples < DELAY_LINE_LEN) {
      int rd = delay_write - dl_samples;
      while (rd < 0) rd += DELAY_LINE_LEN;
      float echo = (float)delay_line[rd];
      float wet  = x + echo * p.dl_feedback;
      delay_line[delay_write] = (int32_t)wet;
      x = x * (1.0f - p.dl_mix) + echo * p.dl_mix;
    } else {
      delay_line[delay_write] = (int32_t)x;
    }
    if (++delay_write >= DELAY_LINE_LEN) delay_write = 0;

    if (p.rv_mix > 0.0f) {
      int rd = reverb_write - REVERB_DELAY;
      while (rd < 0) rd += DELAY_LINE_LEN;
      float tail = (float)reverb_buf[rd] * 0.6f;
      float wet  = x + tail;
      reverb_buf[reverb_write] = (int32_t)wet;
      x = x * (1.0f - p.rv_mix) + wet * p.rv_mix;
    } else {
      reverb_buf[reverb_write] = (int32_t)x;
    }
    if (++reverb_write >= DELAY_LINE_LEN) reverb_write = 0;

    buf[i] = (int32_t)x;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // ADC: 12-bit (0–4095), attenuate to full 0–3.3V range
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  memset(delay_line, 0, sizeof(delay_line));
  memset(vib_line,   0, sizeof(vib_line));
  memset(reverb_buf, 0, sizeof(reverb_buf));

  Serial.println("CalGPT HW test — ADC(A2) → DSP → DAC(A1)");
  Serial.printf("Sample rate: %d Hz | Drive: %.1f | Reverb: %.1f\n",
                SAMPLE_RATE, g_params.od_drive, g_params.rv_mix);
}

// ---------------------------------------------------------------------------
// Loop — micros()-paced sample collection, ping-pong buffer processing
//
// Input signal assumed biased to Vcc/2 (~1.65V = ADC 2048).
// DSP operates at ±2^31 scale. DAC output biased back to 128/255.
// One buffer of latency (~32 ms at 8kHz/256 frames).
// ---------------------------------------------------------------------------
void loop() {
  static int32_t in_buf[BUFFER_FRAMES];
  static int32_t out_buf[BUFFER_FRAMES];
  static int     in_idx     = 0;
  static int     out_idx    = 0;
  static bool    out_ready  = false;
  static uint32_t next_us   = 0;

  uint32_t now = micros();
  if (now < next_us) return;
  next_us += US_PER_SAMPLE;

  // --- ADC read: 12-bit (0–4095), center at 2048, scale to int32 range ---
  int raw = analogRead(PIN_ADC);
  in_buf[in_idx++] = (int32_t)(raw - 2048) << 20;

  // --- DAC output: drain previous processed buffer ---
  if (out_ready) {
    int32_t s = out_buf[out_idx++] >> 20;  // scale back to ±2047
    s += 2048;                             // re-bias to 0–4095
    s >>= 4;                               // scale to 0–255 for 8-bit DAC
    if (s < 0)   s = 0;
    if (s > 255) s = 255;
    dacWrite(PIN_DAC, (uint8_t)s);
    if (out_idx >= BUFFER_FRAMES) out_ready = false;
  }

  // --- When input buffer full: process it into output buffer ---
  if (in_idx >= BUFFER_FRAMES) {
    digitalWrite(PIN_LED, HIGH);

    memcpy(out_buf, in_buf, sizeof(in_buf));
    process_buffer(out_buf, BUFFER_FRAMES, g_params);

    in_idx    = 0;
    out_idx   = 0;
    out_ready = true;

    digitalWrite(PIN_LED, LOW);
  }
}
