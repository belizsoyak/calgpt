// calgpt_pedal_webtest.ino — WiFi + CSV fetch test for Adafruit ESP32 Feather
//
// Verifies the full web → pedal parameter pipeline:
//   1. Connect to WiFi
//   2. HTTP GET a CSV from the CalGPT backend (GET /setlist/{sid}/export.csv)
//   3. Parse the 13 FxParams columns from the first song row
//   4. Apply them to the DSP and run the ADC→DSP→DAC audio loop
//
// CSV column order (must match backend main.py FLAT_COLUMNS):
//   song, od_drive, od_tone, od_mix,
//   vib_rate, vib_depth, vib_mix,
//   trem_rate, trem_depth, trem_mix,
//   dl_time_ms, dl_feedback, dl_mix,
//   rv_mix
//
// Serial output at 115200 baud shows every step — check it first before
// listening for audio. LED blinks once on successful CSV fetch.
//
// Dependencies (Arduino Library Manager): ESP32 board support only.

#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Config — fill these in before flashing
// ---------------------------------------------------------------------------
static const char *WIFI_SSID = "Berkey-IoT";
static const char *WIFI_PASS = "@OweyFowley06";

// Full URL to the exported CSV, e.g.:
//   "http://192.168.1.42:8000/setlist/abc12345/export.csv"
// Run the backend, create a setlist, grab the ID, paste it here.
static const char *CSV_URL   = "http://YOUR_BACKEND_IP:8000/setlist/YOUR_SETLIST_ID/export.csv";

// Which song row to load (0 = first song after header)
#define SONG_ROW 0

// ---------------------------------------------------------------------------
// Pins (Adafruit HUZZAH32)
// ---------------------------------------------------------------------------
#define PIN_ADC  34   // A2 — guitar input
#define PIN_DAC  25   // A1 — audio output
#define PIN_LED  13   // built-in red LED

// ---------------------------------------------------------------------------
// Audio config
// ---------------------------------------------------------------------------
#define SAMPLE_RATE    8000
#define BUFFER_FRAMES  256
#define DELAY_MAX_MS   600
#define US_PER_SAMPLE  (1000000 / SAMPLE_RATE)

// ---------------------------------------------------------------------------
// FxParams — identical layout to firmware and backend FLAT_COLUMNS
// ---------------------------------------------------------------------------
struct FxParams {
  float od_drive, od_tone, od_mix;
  float vib_rate, vib_depth, vib_mix;
  float trem_rate, trem_depth, trem_mix;
  float dl_time_ms, dl_feedback, dl_mix;
  float rv_mix;
};

// Bypass-safe defaults — matches FLAT_DEFAULTS in esp32_bridge.py
static FxParams g_params = {
  0.0f, 0.5f, 0.0f,
  0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f,
  0.0f
};

static bool g_params_loaded = false;

// ---------------------------------------------------------------------------
// DSP state
// ---------------------------------------------------------------------------
static const int DELAY_LINE_LEN = (SAMPLE_RATE * DELAY_MAX_MS) / 1000 + 1;

static int32_t delay_line[DELAY_LINE_LEN];
static int     delay_write  = 0;
static int32_t vib_line[DELAY_LINE_LEN];
static int     vib_write    = 0;
static int32_t reverb_buf[DELAY_LINE_LEN];
static int     reverb_write = 0;
static float   od_lp_state  = 0.0f;
static float   vib_phase    = 0.0f;
static float   trem_phase   = 0.0f;
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
      x = x * (1.0f - p.trem_mix) + (x * gain) * p.trem_mix;
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
// CSV parser
// Expects header row: song,od_drive,od_tone,...,rv_mix
// Parses SONG_ROW (0-indexed after header) into FxParams.
// Returns true on success.
// ---------------------------------------------------------------------------
bool parse_csv(const String &body, int target_row, FxParams &out) {
  int line_start = 0;
  int row = -1;  // -1 = header

  while (line_start < (int)body.length()) {
    int line_end = body.indexOf('\n', line_start);
    if (line_end < 0) line_end = body.length();

    String line = body.substring(line_start, line_end);
    line.trim();

    if (row == target_row && line.length() > 0) {
      // Parse 14 comma-separated fields: song + 13 params
      float vals[13];
      int   field = 0;
      int   pos   = 0;

      // Skip song name (first field)
      int comma = line.indexOf(',', pos);
      if (comma < 0) { Serial.println("[CSV] malformed row"); return false; }
      String song_name = line.substring(pos, comma);
      pos = comma + 1;

      while (field < 13 && pos < (int)line.length()) {
        int next = line.indexOf(',', pos);
        if (next < 0) next = line.length();
        vals[field++] = line.substring(pos, next).toFloat();
        pos = next + 1;
      }

      if (field < 13) {
        Serial.printf("[CSV] only got %d fields (need 13)\n", field);
        return false;
      }

      out.od_drive    = vals[0];
      out.od_tone     = vals[1];
      out.od_mix      = vals[2];
      out.vib_rate    = vals[3];
      out.vib_depth   = vals[4];
      out.vib_mix     = vals[5];
      out.trem_rate   = vals[6];
      out.trem_depth  = vals[7];
      out.trem_mix    = vals[8];
      out.dl_time_ms  = vals[9];
      out.dl_feedback = vals[10];
      out.dl_mix      = vals[11];
      out.rv_mix      = vals[12];

      Serial.printf("[CSV] Loaded song: \"%s\"\n", song_name.c_str());
      Serial.printf("  overdrive  drive=%.2f tone=%.2f mix=%.2f\n",
                    out.od_drive, out.od_tone, out.od_mix);
      Serial.printf("  vibrato    rate=%.2f depth=%.2f mix=%.2f\n",
                    out.vib_rate, out.vib_depth, out.vib_mix);
      Serial.printf("  tremolo    rate=%.2f depth=%.2f mix=%.2f\n",
                    out.trem_rate, out.trem_depth, out.trem_mix);
      Serial.printf("  delay      time=%.0fms fb=%.2f mix=%.2f\n",
                    out.dl_time_ms, out.dl_feedback, out.dl_mix);
      Serial.printf("  reverb     mix=%.2f\n", out.rv_mix);
      return true;
    }

    row++;
    line_start = line_end + 1;
  }

  Serial.printf("[CSV] row %d not found\n", target_row);
  return false;
}

// ---------------------------------------------------------------------------
// Fetch CSV over HTTP and parse it
// ---------------------------------------------------------------------------
bool fetch_and_load_params() {
  Serial.printf("[HTTP] GET %s\n", CSV_URL);

  HTTPClient http;
  http.begin(CSV_URL);
  http.setTimeout(5000);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[HTTP] failed, code=%d\n", code);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  Serial.printf("[HTTP] got %d bytes\n", body.length());
  return parse_csv(body, SONG_ROW, g_params);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  memset(delay_line, 0, sizeof(delay_line));
  memset(vib_line,   0, sizeof(vib_line));
  memset(reverb_buf, 0, sizeof(reverb_buf));

  // --- WiFi ---
  Serial.printf("[WiFi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] FAILED — running with bypass-safe defaults");
  } else {
    Serial.printf("\n[WiFi] connected, IP=%s\n", WiFi.localIP().toString().c_str());

    // --- Fetch CSV ---
    if (fetch_and_load_params()) {
      g_params_loaded = true;
      // Blink LED once to signal successful load
      digitalWrite(PIN_LED, HIGH); delay(300); digitalWrite(PIN_LED, LOW);
      Serial.println("[TEST] PASS — params loaded, starting audio loop");
    } else {
      Serial.println("[TEST] FAIL — could not load params, using defaults");
    }
  }

  Serial.printf("Sample rate: %d Hz\n", SAMPLE_RATE);
}

// ---------------------------------------------------------------------------
// Loop — same ADC/DAC engine as hwtest, using fetched params
// ---------------------------------------------------------------------------
void loop() {
  static int32_t in_buf[BUFFER_FRAMES];
  static int32_t out_buf[BUFFER_FRAMES];
  static bool    out_ready = false;

  digitalWrite(PIN_LED, HIGH);

  for (int i = 0; i < BUFFER_FRAMES; i++) {
    // 2x oversample + DC removal + full-wave reconstruction (same as hwtest)
    int raw = (analogRead(PIN_ADC) + analogRead(PIN_ADC)) >> 1;
    static float dc_avg  = 0.0f;
    static bool  dc_init = false;
    if (!dc_init) { dc_avg = (float)raw; dc_init = true; }
    dc_avg += 0.0002f * ((float)raw - dc_avg);
    float signal = ((float)raw - dc_avg) * 2.0f;
    static float prev_pos = 0.0f;
    if (signal >= 0.0f) { prev_pos = signal; }
    else                { signal = -prev_pos * 0.98f; }
    in_buf[i] = (int32_t)signal << 20;

    if (out_ready) {
      static float smooth = 128.0f;
      float target = (float)(out_buf[i] >> 20) + 2048.0f;
      target /= 16.0f;
      if (target < 0.0f)   target = 0.0f;
      if (target > 255.0f) target = 255.0f;
      smooth += 0.5f * (target - smooth);
      dacWrite(PIN_DAC, (uint8_t)(int)smooth);
    }

    delayMicroseconds(US_PER_SAMPLE - 30);
  }

  memcpy(out_buf, in_buf, sizeof(in_buf));
  process_buffer(out_buf, BUFFER_FRAMES, g_params);
  out_ready = true;

  digitalWrite(PIN_LED, LOW);
}
