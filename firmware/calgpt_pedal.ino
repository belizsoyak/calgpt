// CalGPT hardware bridge — ESP32 guitar pedal firmware
//
// Two ways to change the active tone, both supported at once:
//   1. WiFi: POST /params with flat JSON (the mock pedal / backend pushes this).
//   2. Setlist: a setlist.csv on LittleFS is loaded into ToneParams[]; a
//      footswitch (GPIO) steps through songs, applying each tone.
//
// Params are double-buffered: writers stage into `stagingParams` + set
// `paramsDirty`; the audio loop swaps them into `activeParams` at a buffer
// boundary so the DSP never sees a torn update.
//
// Effect order (matches the CalGPT signal chain, with tremolo inserted):
//   overdrive -> vibrato (chorus) -> tremolo -> delay -> reverb
//
// Getting setlist.csv onto flash (two options):
//   A. Arduino "ESP32 LittleFS Data Upload" plugin — put the file in a /data
//      folder next to this sketch and upload it to the LittleFS partition.
//   B. Fetch it once over WiFi from the backend export endpoint
//      (GET /setlist/<id>/export.csv) and write the body to "/setlist.csv".
//
// Dependencies (Arduino Library Manager / ESP32 core):
//   - ESP32 board support (WiFi.h, WebServer.h, LittleFS.h)
//   - ArduinoJson (>=6)

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
#ifndef SAMPLE_RATE
#define SAMPLE_RATE 8000          // Hz — configurable; default 8 kHz
#endif

#define BUFFER_FRAMES 256         // audio frames processed per DSP call
#define DELAY_MAX_MS  2000        // sized for the largest delay/vibrato line
#define MAX_SONGS     32          // setlist capacity
#define NEXT_PIN      15          // footswitch: button to GND, uses INPUT_PULLUP

static const char *WIFI_SSID = "your-ssid";
static const char *WIFI_PASS = "your-password";

// ---------------------------------------------------------------------------
// ToneParams — ONE struct holds every effect parameter. Field names + order
// match the 13-column CSV contract exactly (parsed by position):
//   od_drive, od_tone, od_mix, vib_rate, vib_depth, vib_mix,
//   trem_rate, trem_depth, trem_mix, dl_time_ms, dl_feedback, dl_mix, rv_mix
// All "0..1" fields are normalized; rates are in Hz; times in ms.
// ---------------------------------------------------------------------------
struct ToneParams {
  float od_drive;     // 0..1 amount of gain/saturation
  float od_tone;      // 0..1 brightness (one-pole tilt)
  float od_mix;       // 0..1 dry/wet

  float vib_rate;     // Hz LFO rate (CalGPT maps "chorus" -> vibrato)
  float vib_depth;    // 0..1 modulation depth
  float vib_mix;      // 0..1 dry/wet

  float trem_rate;    // Hz LFO rate
  float trem_depth;   // 0..1 modulation depth
  float trem_mix;     // 0..1 dry/wet

  float dl_time_ms;   // ms delay time
  float dl_feedback;  // 0..1 feedback
  float dl_mix;       // 0..1 dry/wet

  float rv_mix;       // 0..1 dry/wet
};

// Bypass-safe defaults: every effect contributes nothing until set.
static ToneParams activeParams = {
  0.0f, 0.5f, 0.0f,     // overdrive
  0.0f, 0.0f, 0.0f,     // vibrato
  0.0f, 0.0f, 0.0f,     // tremolo
  0.0f, 0.0f, 0.0f,     // delay
  0.0f                  // reverb
};

// Staged by any writer (WiFi or setlist); swapped in at a buffer boundary.
// Everything currently runs in loop() (no ISR/second task), so a plain struct
// is safe; only the flag is volatile. When the DSP moves to its own audio task,
// guard the swap with a critical section / mutex instead.
static ToneParams stagingParams;
static volatile bool paramsDirty = false;

// ---------------------------------------------------------------------------
// Setlist (loaded from LittleFS)
// ---------------------------------------------------------------------------
static ToneParams setlist[MAX_SONGS];
static int songCount = 0;
static int currentSong = -1;

// ---------------------------------------------------------------------------
// DSP state (persists across buffers)
// ---------------------------------------------------------------------------
static const int   DELAY_LINE_LEN = (SAMPLE_RATE * DELAY_MAX_MS) / 1000 + 1;
static int32_t     delay_line[DELAY_LINE_LEN];
static int         delay_write = 0;

static int32_t     vib_line[DELAY_LINE_LEN];
static int         vib_write = 0;

static int32_t     reverb_buf[DELAY_LINE_LEN];
static int         reverb_write = 0;

static float       od_lp_state = 0.0f;   // overdrive tone filter memory
static float       vib_phase   = 0.0f;   // vibrato LFO phase
static float       trem_phase  = 0.0f;   // tremolo LFO phase

static const int   REVERB_DELAY = SAMPLE_RATE / 20;  // ~50 ms fixed pre-delay

static WebServer   server(80);

// ---------------------------------------------------------------------------
// Param staging — writers call stageParams(); audio loop applies at a boundary.
// ---------------------------------------------------------------------------
void stageParams(const ToneParams &p) {
  stagingParams = p;
  paramsDirty = true;
}

void dspInit() {
  for (int i = 0; i < DELAY_LINE_LEN; ++i) {
    delay_line[i] = 0;
    vib_line[i]   = 0;
    reverb_buf[i] = 0;
  }
  delay_write = vib_write = reverb_write = 0;
  od_lp_state = vib_phase = trem_phase = 0.0f;
}

// ---------------------------------------------------------------------------
// processSample — the DSP. Process one 32-bit sample using activeParams.
// Called once per audio frame by the buffer loop.
// ---------------------------------------------------------------------------
int32_t processSample(int32_t in) {
  const ToneParams &p = activeParams;
  const float TWO_PI_F = 6.28318530718f;
  float x = (float)in;

  // --- overdrive: soft clip + tone tilt + dry/wet ---
  if (p.od_mix > 0.0f) {
    float g = 1.0f + p.od_drive * 30.0f;
    float wet = tanhf(x * g / 2147483648.0f) * 2147483648.0f;
    od_lp_state += (wet - od_lp_state) * (0.05f + 0.9f * p.od_tone);
    wet = od_lp_state;
    x = x * (1.0f - p.od_mix) + wet * p.od_mix;
  }

  // --- vibrato: modulated read from its own delay line ---
  vib_line[vib_write] = (int32_t)x;
  if (p.vib_mix > 0.0f) {
    const int vib_max = (int)(0.005f * SAMPLE_RATE);   // up to 5 ms swing
    float lfo = (sinf(vib_phase) * 0.5f + 0.5f) * p.vib_depth * vib_max;
    int rd = vib_write - (int)lfo;
    while (rd < 0) rd += DELAY_LINE_LEN;
    float wet = (float)vib_line[rd % DELAY_LINE_LEN];
    x = x * (1.0f - p.vib_mix) + wet * p.vib_mix;
  }
  vib_phase += TWO_PI_F * p.vib_rate / (float)SAMPLE_RATE;
  if (vib_phase > TWO_PI_F) vib_phase -= TWO_PI_F;
  if (++vib_write >= DELAY_LINE_LEN) vib_write = 0;

  // --- tremolo: amplitude LFO ---
  if (p.trem_mix > 0.0f) {
    float lfo = (sinf(trem_phase) * 0.5f + 0.5f);     // 0..1
    float gain = 1.0f - p.trem_depth * lfo;
    float wet = x * gain;
    x = x * (1.0f - p.trem_mix) + wet * p.trem_mix;
  }
  trem_phase += TWO_PI_F * p.trem_rate / (float)SAMPLE_RATE;
  if (trem_phase > TWO_PI_F) trem_phase -= TWO_PI_F;

  // --- delay: feedback delay line ---
  const int dl_samples = (int)(p.dl_time_ms * SAMPLE_RATE / 1000.0f);
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

  return (int32_t)x;
}

// ---------------------------------------------------------------------------
// Setlist: load CSV from LittleFS, switch songs.
// ---------------------------------------------------------------------------
void applySong(int i) {
  if (i < 0 || i >= songCount) return;
  currentSong = i;
  stageParams(setlist[i]);   // picked up at the next buffer boundary
  Serial.printf("Setlist: song %d/%d\n", i + 1, songCount);
}

void nextSong() {
  if (songCount > 0) applySong(min(currentSong + 1, songCount - 1));
}

void prevSong() {
  if (songCount > 0) applySong(max(currentSong - 1, 0));
}

// Parse "/setlist.csv": skip the header, then each line is
//   song_name,<13 floats in column order>.  Skip the name, read 13 floats.
bool loadSetlistCSV(const char *path) {
  File f = LittleFS.open(path, "r");
  if (!f) {
    Serial.printf("Setlist: %s not found on LittleFS\n", path);
    return false;
  }

  songCount = 0;
  if (f.available()) f.readStringUntil('\n');   // skip header row

  while (f.available() && songCount < MAX_SONGS) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    float vals[13];
    int vi = 0, field = 0, from = 0;
    for (int i = 0; i <= (int)line.length(); ++i) {
      if (i == (int)line.length() || line[i] == ',') {
        String tok = line.substring(from, i);
        if (field >= 1 && vi < 13) vals[vi++] = tok.toFloat();  // field 0 = name
        field++;
        from = i + 1;
      }
    }
    if (vi < 13) continue;   // malformed row — skip

    ToneParams p;
    p.od_drive  = vals[0];  p.od_tone    = vals[1];  p.od_mix    = vals[2];
    p.vib_rate  = vals[3];  p.vib_depth  = vals[4];  p.vib_mix   = vals[5];
    p.trem_rate = vals[6];  p.trem_depth = vals[7];  p.trem_mix  = vals[8];
    p.dl_time_ms= vals[9];  p.dl_feedback= vals[10]; p.dl_mix    = vals[11];
    p.rv_mix    = vals[12];
    setlist[songCount++] = p;
  }
  f.close();
  Serial.printf("Setlist: loaded %d song(s)\n", songCount);
  return songCount > 0;
}

// ---------------------------------------------------------------------------
// Footswitch: debounced GPIO button -> nextSong()
// ---------------------------------------------------------------------------
void pollFootswitch() {
  static int stable = HIGH, last = HIGH;
  static unsigned long changedAt = 0;
  int reading = digitalRead(NEXT_PIN);
  if (reading != last) {
    last = reading;
    changedAt = millis();
  }
  if ((millis() - changedAt) > 30 && reading != stable) {
    stable = reading;
    if (stable == LOW) nextSong();   // pressed (INPUT_PULLUP -> LOW on press)
  }
}

// ---------------------------------------------------------------------------
// HTTP: POST /params — flat JSON of every ToneParams field. Stages params so
// the audio loop swaps them in at a buffer boundary. Coexists with the setlist.
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
  ToneParams next = activeParams;
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

  stageParams(next);
  server.send(200, "application/json", "{\"ok\":true}");
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  pinMode(NEXT_PIN, INPUT_PULLUP);
  dspInit();

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

  // Load a setlist from flash if one is present; start on the first song.
  LittleFS.begin(true);
  if (loadSetlistCSV("/setlist.csv")) applySong(0);
}

void loop() {
  server.handleClient();
  pollFootswitch();

  // Audio buffer boundary: swap in staged params before processing.
  static int32_t buffer[BUFFER_FRAMES];

  if (paramsDirty) {
    activeParams = stagingParams;
    paramsDirty = false;
  }

  // === I2S audio I/O — the remaining hardware step ===
  // Wire an I2S codec (e.g. on an ESP32-A1S/LyraT) and replace these stubs:
  //   i2s_read(...)  -> fill `buffer` with guitar input frames    // INPUT STUB
  for (int i = 0; i < BUFFER_FRAMES; ++i) buffer[i] = processSample(buffer[i]);
  //   i2s_write(...) -> send `buffer` to the output                // OUTPUT STUB
}
