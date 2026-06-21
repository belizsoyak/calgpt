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

#include <WiFi.h>
#include <math.h>
#include <WiFi.h>

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
#define DELAY_MAX_MS  600     // enough for 500ms delay + reverb pre-delay

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
  1.0f, 0.8f, 1.0f,
  // vibrato:   rate(Hz), depth, mix
  0.0f, 0.0f, 0.0f,
  // tremolo:   rate(Hz), depth, mix
  0.0f, 0.0f, 0.0f,
  // delay:     time_ms, feedback, mix
  500.0f, 0.75f, 0.8f,
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
  WiFi.mode(WIFI_STA);
  Serial.println(WiFi.macAddress());
}

// ---------------------------------------------------------------------------
// Loop — delayMicroseconds-paced sample collection, ping-pong buffer.
// Collects one full buffer at SAMPLE_RATE, processes it, outputs the
// previous processed buffer simultaneously, then repeats.
// One buffer of latency (~32 ms at 8kHz/256 frames).
// ---------------------------------------------------------------------------
void loop() {
  static int32_t in_buf[BUFFER_FRAMES];
  static int32_t out_buf[BUFFER_FRAMES];
  static bool    out_ready = false;

  digitalWrite(PIN_LED, HIGH);

  // Collect input + drain output at SAMPLE_RATE
  for (int i = 0; i < BUFFER_FRAMES; i++) {
    // --- ADC: 2x oversample to reduce noise ---
    int raw = (analogRead(PIN_ADC) + analogRead(PIN_ADC)) >> 1;

    // --- DC removal: slow IIR tracks the half-wave average ---
    static float dc_avg = 0.0f;
    static bool  dc_ready = false;
    if (!dc_ready) { dc_avg = (float)raw; dc_ready = true; }
    dc_avg += 0.0002f * ((float)raw - dc_avg);  // ~0.6 s convergence at 8kHz
    float signal = ((float)raw - dc_avg) * 2.0f;

    // --- Full-wave reconstruction: mirror positive half into negative ---
    // After DC removal, the clipped negative half appears as signal < 0.
    // Replace it with the negated previous positive sample so the waveform
    // is symmetric — far better than a flat bottom.
    static float prev_pos = 0.0f;
    if (signal >= 0.0f) {
      prev_pos = signal;
    } else {
      signal = -prev_pos * 0.98f;  // slight decay keeps it natural
    }
    in_buf[i] = (int32_t)signal << 20;

    // --- DAC: output previous processed buffer with IIR smoothing ---
    // Smoothing reduces the audible stepping of the 8-bit DAC.
    if (out_ready) {
      static float smooth = 128.0f;
      float target = (float)(out_buf[i] >> 20) + 2048.0f;  // ±2047 → 0–4095
      target /= 16.0f;                                       // → 0–255
      if (target < 0.0f)   target = 0.0f;
      if (target > 255.0f) target = 255.0f;
      smooth += 0.5f * (target - smooth);  // ~2 kHz low-pass at 8kHz
      dacWrite(PIN_DAC, (uint8_t)(int)smooth);
    }

    delayMicroseconds(US_PER_SAMPLE - 30);  // -30 µs to account for two analogReads
  }

  // Process input into output buffer
  memcpy(out_buf, in_buf, sizeof(in_buf));
  process_buffer(out_buf, BUFFER_FRAMES, g_params);
  out_ready = true;

  digitalWrite(PIN_LED, LOW);
}
