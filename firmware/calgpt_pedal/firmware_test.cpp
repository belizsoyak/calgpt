// firmware_test.cpp — desktop test harness for CalGPT DSP core
//
// Replaces WiFi/ADC/DAC with file I/O:
//   reads  testin.wav  (16-bit PCM, any sample rate — resampled to 5 kHz)
//   writes testout.wav (16-bit PCM, 5 kHz)
//
// The DSP logic (process_buffer, FxParams, all state) is identical to
// calgpt_pedal.ino. Only the I/O and networking layers are replaced.
//
// Build:
//   g++ -O2 -std=c++17 -lm -o firmware_test firmware_test.cpp
// Run:
//   ./firmware_test
//
// To test specific effect settings, edit DEFAULT_PARAMS below.

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstdlib>
#include <vector>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
#define SAMPLE_RATE   5000          // Hz — fixed for this test harness
#define BUFFER_FRAMES 256
#define DELAY_MAX_MS  2000

static const char *INPUT_FILE  = "testin.wav";
static const char *OUTPUT_FILE = "testout.wav";

// ---------------------------------------------------------------------------
// Parameter block — identical to firmware
// ---------------------------------------------------------------------------
struct FxParams {
  float od_drive, od_tone, od_mix;
  float vib_rate, vib_depth, vib_mix;
  float trem_rate, trem_depth, trem_mix;
  float dl_time_ms, dl_feedback, dl_mix;
  float rv_mix;
};

// Edit these to test different effect settings.
static FxParams DEFAULT_PARAMS = {
  // overdrive: drive, tone, mix  (SRV-style: high drive, bright tone)
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
// DSP state — identical to firmware
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

static const int REVERB_DELAY = SAMPLE_RATE / 20;  // ~50 ms

// ---------------------------------------------------------------------------
// process_buffer — copied verbatim from firmware, no changes
// ---------------------------------------------------------------------------
void process_buffer(int32_t *buf, int frames, const FxParams &p) {
  const float TWO_PI_F = 6.28318530718f;
  const float vib_inc  = TWO_PI_F * p.vib_rate  / (float)SAMPLE_RATE;
  const float trem_inc = TWO_PI_F * p.trem_rate / (float)SAMPLE_RATE;

  const int dl_samples = (int)(p.dl_time_ms * SAMPLE_RATE / 1000.0f);
  const int vib_max    = (int)(0.005f * SAMPLE_RATE);

  for (int i = 0; i < frames; ++i) {
    float x = (float)buf[i];

    // --- overdrive ---
    if (p.od_mix > 0.0f) {
      float g = 1.0f + p.od_drive * 30.0f;
      float wet = tanhf(x * g / 2147483648.0f) * 2147483648.0f;
      od_lp_state += (wet - od_lp_state) * (0.05f + 0.9f * p.od_tone);
      wet = od_lp_state;
      x = x * (1.0f - p.od_mix) + wet * p.od_mix;
    }

    // --- vibrato ---
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

    // --- tremolo ---
    if (p.trem_mix > 0.0f) {
      float lfo  = (sinf(trem_phase) * 0.5f + 0.5f);
      float gain = 1.0f - p.trem_depth * lfo;
      float wet  = x * gain;
      x = x * (1.0f - p.trem_mix) + wet * p.trem_mix;
    }
    trem_phase += trem_inc;
    if (trem_phase > TWO_PI_F) trem_phase -= TWO_PI_F;

    // --- delay ---
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

    // --- reverb ---
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
// Minimal WAV I/O (16-bit PCM, mono or stereo — mixed to mono on read)
// ---------------------------------------------------------------------------
#pragma pack(push, 1)
struct WavHeader {
  char     riff[4];        // "RIFF"
  uint32_t chunk_size;
  char     wave[4];        // "WAVE"
  char     fmt[4];         // "fmt "
  uint32_t fmt_size;       // 16 for PCM
  uint16_t audio_format;   // 1 = PCM
  uint16_t num_channels;
  uint32_t sample_rate;
  uint32_t byte_rate;
  uint16_t block_align;
  uint16_t bits_per_sample;
  char     data[4];        // "data"
  uint32_t data_size;
};
#pragma pack(pop)

// Read WAV into a float vector (normalised -1..1), return source sample rate.
// Mixes multichannel down to mono. Only handles 16-bit PCM.
// Scans for fmt/data chunks so extra metadata chunks (LIST, etc.) are skipped.
static int read_wav(const char *path, std::vector<float> &out_samples, uint32_t &out_rate) {
  FILE *f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "Cannot open %s\n", path); return -1; }

  // Read RIFF/WAVE header (12 bytes)
  char riff[4]; uint32_t riff_size; char wave[4];
  if (fread(riff, 4, 1, f) != 1 || fread(&riff_size, 4, 1, f) != 1 || fread(wave, 4, 1, f) != 1) {
    fprintf(stderr, "Bad WAV header in %s\n", path); fclose(f); return -1;
  }
  if (strncmp(riff, "RIFF", 4) || strncmp(wave, "WAVE", 4)) {
    fprintf(stderr, "%s is not a WAV file\n", path); fclose(f); return -1;
  }

  // Scan chunks until we find fmt and data
  uint16_t audio_format = 0, num_channels = 0, bits_per_sample = 0;
  uint32_t sample_rate = 0, byte_rate = 0, data_size = 0;
  uint16_t block_align = 0;
  bool got_fmt = false, got_data = false;

  while (!got_data) {
    char id[4]; uint32_t size;
    if (fread(id, 4, 1, f) != 1 || fread(&size, 4, 1, f) != 1) break;
    if (strncmp(id, "fmt ", 4) == 0) {
      fread(&audio_format,   2, 1, f);
      fread(&num_channels,   2, 1, f);
      fread(&sample_rate,    4, 1, f);
      fread(&byte_rate,      4, 1, f);
      fread(&block_align,    2, 1, f);
      fread(&bits_per_sample,2, 1, f);
      if (size > 16) fseek(f, size - 16, SEEK_CUR); // skip extension
      got_fmt = true;
    } else if (strncmp(id, "data", 4) == 0) {
      data_size = size;
      got_data = true;
    } else {
      fseek(f, size, SEEK_CUR); // skip unknown chunk
    }
  }

  if (!got_fmt || !got_data) {
    fprintf(stderr, "Could not find fmt/data chunks in %s\n", path); fclose(f); return -1;
  }
  if (audio_format != 1 || bits_per_sample != 16) {
    fprintf(stderr, "Only 16-bit PCM WAV supported\n"); fclose(f); return -1;
  }

  out_rate = sample_rate;
  int n_frames = data_size / block_align;
  int ch = num_channels;

  out_samples.reserve(n_frames);
  for (int i = 0; i < n_frames; ++i) {
    float mix = 0.0f;
    for (int c = 0; c < ch; ++c) {
      int16_t s; fread(&s, 2, 1, f);
      mix += (float)s / 32768.0f;
    }
    out_samples.push_back(mix / ch);
  }
  fclose(f);
  return 0;
}

// Simple linear resample from src_rate to dst_rate.
static std::vector<float> resample(const std::vector<float> &in,
                                   uint32_t src_rate, uint32_t dst_rate) {
  if (src_rate == dst_rate) return in;
  double ratio = (double)src_rate / dst_rate;
  size_t out_len = (size_t)(in.size() / ratio);
  std::vector<float> out(out_len);
  for (size_t i = 0; i < out_len; ++i) {
    double pos = i * ratio;
    size_t a = (size_t)pos;
    size_t b = a + 1 < in.size() ? a + 1 : a;
    float t = (float)(pos - a);
    out[i] = in[a] * (1.0f - t) + in[b] * t;
  }
  return out;
}

static int write_wav(const char *path, const std::vector<int16_t> &samples, uint32_t rate) {
  FILE *f = fopen(path, "wb");
  if (!f) { fprintf(stderr, "Cannot write %s\n", path); return -1; }

  WavHeader hdr;
  memcpy(hdr.riff, "RIFF", 4);
  memcpy(hdr.wave, "WAVE", 4);
  memcpy(hdr.fmt,  "fmt ", 4);
  memcpy(hdr.data, "data", 4);
  hdr.fmt_size       = 16;
  hdr.audio_format   = 1;
  hdr.num_channels   = 1;
  hdr.sample_rate    = rate;
  hdr.bits_per_sample= 16;
  hdr.block_align    = 2;
  hdr.byte_rate      = rate * 2;
  hdr.data_size      = (uint32_t)(samples.size() * 2);
  hdr.chunk_size     = 36 + hdr.data_size;

  fwrite(&hdr, sizeof(hdr), 1, f);
  fwrite(samples.data(), 2, samples.size(), f);
  fclose(f);
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main() {
  // Zero DSP state
  memset(delay_line, 0, sizeof(delay_line));
  memset(vib_line,   0, sizeof(vib_line));
  memset(reverb_buf, 0, sizeof(reverb_buf));

  // Load input
  std::vector<float> raw;
  uint32_t src_rate;
  if (read_wav(INPUT_FILE, raw, src_rate) < 0) return 1;
  printf("Read %zu frames @ %u Hz from %s\n", raw.size(), src_rate, INPUT_FILE);

  // Resample to test SAMPLE_RATE if needed
  std::vector<float> pcm = resample(raw, src_rate, SAMPLE_RATE);
  printf("Resampled to %zu frames @ %d Hz\n", pcm.size(), SAMPLE_RATE);

  // Convert float → int32 (firmware scale: full range = ±2^31)
  std::vector<int32_t> work(pcm.size());
  for (size_t i = 0; i < pcm.size(); ++i)
    work[i] = (int32_t)(pcm[i] * 2147483648.0f);

  // Process in BUFFER_FRAMES chunks, same as firmware loop
  FxParams p = DEFAULT_PARAMS;
  size_t total = work.size();
  for (size_t off = 0; off < total; off += BUFFER_FRAMES) {
    int frames = (int)((off + BUFFER_FRAMES <= total) ? BUFFER_FRAMES : total - off);
    process_buffer(work.data() + off, frames, p);
  }

  // Convert int32 → int16 with soft clip to prevent overflow
  std::vector<int16_t> out(total);
  for (size_t i = 0; i < total; ++i) {
    float s = (float)work[i] / 2147483648.0f;
    // soft clip output
    s = tanhf(s);
    int32_t q = (int32_t)(s * 32767.0f);
    if (q >  32767) q =  32767;
    if (q < -32768) q = -32768;
    out[i] = (int16_t)q;
  }

  if (write_wav(OUTPUT_FILE, out, SAMPLE_RATE) < 0) return 1;
  printf("Wrote %zu frames to %s\n", out.size(), OUTPUT_FILE);
  return 0;
}
