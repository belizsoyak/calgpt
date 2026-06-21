// CalGPT hardware bridge — ESP32 guitar pedal firmware
//
// Receives a flat effect-parameter payload over WiFi (POST /params) and runs a
// single DSP function over a 32-bit audio buffer. Params are double-buffered and
// swapped in only at a buffer boundary so the audio path never sees a torn update.
//
// Effect order (matches the CalGPT signal chain, with tremolo inserted):
//   overdrive -> vibrato (chorus) -> tremolo -> delay -> reverb
//
// Dependencies (Arduino Library Manager):
//   - ESP32 board support (WiFi.h, WebServer.h)
//   - ArduinoJson (>=6)

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
#ifndef SAMPLE_RATE
#define SAMPLE_RATE 8000          // Hz — configurable; default 8 kHz
#endif

#define BUFFER_FRAMES 256         // audio frames processed per DSP call
#define DELAY_MAX_MS  2000        // sized for the largest delay/vibrato line

static const char *WIFI_SSID = "your-ssid";
static const char *WIFI_PASS = "your-password";

// ---------------------------------------------------------------------------
// Parameter block — ONE struct holds every effect parameter.
// All "0..1" fields are normalized; rates are in Hz; times in ms.
// ---------------------------------------------------------------------------
struct FxParams {
  // overdrive
  float od_drive;     // 0..1 amount of gain/saturation
  float od_tone;      // 0..1 brightness (one-pole tilt)
  float od_mix;       // 0..1 dry/wet

  // vibrato (CalGPT maps "chorus" -> vibrato here)
  float vib_rate;     // Hz LFO rate
  float vib_depth;    // 0..1 modulation depth
  float vib_mix;      // 0..1 dry/wet

  // tremolo
  float trem_rate;    // Hz LFO rate
  float trem_depth;   // 0..1 modulation depth
  float trem_mix;     // 0..1 dry/wet

  // delay
  float dl_time_ms;   // ms delay time
  float dl_feedback;  // 0..1 feedback
  float dl_mix;       // 0..1 dry/wet

  // reverb
  float rv_mix;       // 0..1 dry/wet
};

// Bypass-safe defaults: every effect contributes nothing until set.
static FxParams g_active = {
  0.0f, 0.5f, 0.0f,     // overdrive
  0.0f, 0.0f, 0.0f,     // vibrato
  0.0f, 0.0f, 0.0f,     // tremolo
  0.0f, 0.0f, 0.0f,     // delay
  0.0f                  // reverb
};

// Pending block written by the HTTP handler; swapped in at a buffer boundary.
static volatile FxParams g_pending;
static volatile bool g_pending_dirty = false;

// ---------------------------------------------------------------------------
// DSP state (persists across buffers)
// ---------------------------------------------------------------------------
static const int   DELAY_LINE_LEN = (SAMPLE_RATE * DELAY_MAX_MS) / 1000 + 1;
static int32_t     delay_line[DELAY_LINE_LEN];
static int        delay_write = 0;

static int32_t     vib_line[DELAY_LINE_LEN];
static int        vib_write = 0;

static int32_t     reverb_buf[DELAY_LINE_LEN];
static int        reverb_write = 0;

static float       od_lp_state = 0.0f;   // overdrive tone filter memory
static float       vib_phase   = 0.0f;   // vibrato LFO phase
static float       trem_phase  = 0.0f;   // tremolo LFO phase

static const int   REVERB_DELAY = SAMPLE_RATE / 20;  // ~50 ms fixed pre-delay

static WebServer   server(80);

// ---------------------------------------------------------------------------
// The single DSP function: process one buffer of 32-bit samples in place.
// ---------------------------------------------------------------------------
void process_buffer(int32_t *buf, int frames, const FxParams &p) {
  const float TWO_PI_F = 6.28318530718f;
  const float vib_inc  = TWO_PI_F * p.vib_rate  / (float)SAMPLE_RATE;
  const float trem_inc = TWO_PI_F * p.trem_rate / (float)SAMPLE_RATE;

  const int dl_samples  = (int)(p.dl_time_ms * SAMPLE_RATE / 1000.0f);
  const int vib_max     = (int)(0.005f * SAMPLE_RATE);   // up to 5 ms swing

  for (int i = 0; i < frames; ++i) {
    float x = (float)buf[i];

    // --- overdrive: soft clip + tone tilt + dry/wet ---
    if (p.od_mix > 0.0f) {
      float g = 1.0f + p.od_drive * 30.0f;
      float wet = tanhf(x * g / 2147483648.0f) * 2147483648.0f;
      // one-pole: od_tone toward bright (high-pass-ish) or dark (low-pass)
      od_lp_state += (wet - od_lp_state) * (0.05f + 0.9f * p.od_tone);
      wet = od_lp_state;
      x = x * (1.0f - p.od_mix) + wet * p.od_mix;
    }

    // --- vibrato: modulated read from its own delay line ---
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

    // --- tremolo: amplitude LFO ---
    if (p.trem_mix > 0.0f) {
      float lfo = (sinf(trem_phase) * 0.5f + 0.5f);     // 0..1
      float gain = 1.0f - p.trem_depth * lfo;
      float wet = x * gain;
      x = x * (1.0f - p.trem_mix) + wet * p.trem_mix;
    }
    trem_phase += trem_inc;
    if (trem_phase > TWO_PI_F) trem_phase -= TWO_PI_F;

    // --- delay: feedback delay line ---
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

    // --- reverb: fixed pre-delay comb, scaled by rv_mix ---
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
// HTTP: POST /params — flat JSON of every FxParams field.
// Writes to the pending block; the audio loop swaps it in at a buffer boundary.
// ---------------------------------------------------------------------------
void handle_params() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"empty body\"}");
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"error\":\"bad json\"}");
    return;
  }

  // Start from current active so omitted fields keep their value.
  FxParams next = g_active;
  next.od_drive   = doc["od_drive"]   | next.od_drive;
  next.od_tone    = doc["od_tone"]    | next.od_tone;
  next.od_mix     = doc["od_mix"]     | next.od_mix;
  next.vib_rate   = doc["vib_rate"]   | next.vib_rate;
  next.vib_depth  = doc["vib_depth"]  | next.vib_depth;
  next.vib_mix    = doc["vib_mix"]    | next.vib_mix;
  next.trem_rate  = doc["trem_rate"]  | next.trem_rate;
  next.trem_depth = doc["trem_depth"] | next.trem_depth;
  next.trem_mix   = doc["trem_mix"]   | next.trem_mix;
  next.dl_time_ms = doc["dl_time_ms"] | next.dl_time_ms;
  next.dl_feedback= doc["dl_feedback"]| next.dl_feedback;
  next.dl_mix     = doc["dl_mix"]     | next.dl_mix;
  next.rv_mix     = doc["rv_mix"]     | next.rv_mix;

  g_pending = next;
  g_pending_dirty = true;

  server.send(200, "application/json", "{\"ok\":true}");
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < DELAY_LINE_LEN; ++i) {
    delay_line[i] = 0;
    vib_line[i]   = 0;
    reverb_buf[i] = 0;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("CalGPT pedal ready at http://");
  Serial.println(WiFi.localIP());

  server.on("/params", HTTP_POST, handle_params);
  server.begin();
}

void loop() {
  server.handleClient();

  // Audio buffer boundary: swap in pending params before processing.
  static int32_t buffer[BUFFER_FRAMES];

  if (g_pending_dirty) {
    noInterrupts();
    g_active = (FxParams)g_pending;
    g_pending_dirty = false;
    interrupts();
  }

  // In a real build this buffer comes from / goes to the I2S codec.
  // read_i2s(buffer, BUFFER_FRAMES);
  process_buffer(buffer, BUFFER_FRAMES, g_active);
  // write_i2s(buffer, BUFFER_FRAMES);
}
