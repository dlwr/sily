pub const MFCC_BANDS: usize = 13;
pub const BANDS: usize = 10;
pub const SEGMENT_LEN: usize = BANDS + 4 + MFCC_BANDS;
const SEGMENTS: [(f32, f32); 3] = [(0.0, 0.05), (0.05, 0.25), (0.25, 1.0)];
pub const LEN: usize = 12 + MFCC_BANDS + SEGMENTS.len() * SEGMENT_LEN + 3;

#[derive(Debug, Clone, PartialEq)]
pub struct Features {
    pub duration: f32,
    pub attack: f32,
    pub decay: f32,
    pub rms: f32,
    pub centroid: f32,
    pub rolloff: f32,
    pub flatness: f32,
    pub zcr: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub pitchedness: f32,
    pub mfcc: [f32; MFCC_BANDS],
    pub segments: Vec<f32>,
    pub temporal_centroid: f32,
    pub crest: f32,
    pub pitch_hz: f32,
}

impl Features {
    pub fn to_vec(&self) -> Vec<f32> {
        let mut v = vec![
            self.duration,
            self.attack,
            self.decay,
            self.rms,
            self.centroid,
            self.rolloff,
            self.flatness,
            self.zcr,
            self.low,
            self.mid,
            self.high,
            self.pitchedness,
        ];
        v.extend_from_slice(&self.mfcc);
        v.extend_from_slice(&self.segments);
        v.extend_from_slice(&[self.temporal_centroid, self.crest, self.pitch_hz]);
        v
    }
}

const WINDOW: usize = 2048;
const HOP: usize = 512;
const ANALYSIS_SECONDS: f32 = 0.05;
const ENVELOPE_BLOCK: usize = 512;
const MEL_BANDS: usize = 26;
const EPS: f32 = 1e-10;

pub fn extract(mono: &[f32], sample_rate: u32) -> Features {
    let sr = sample_rate as f32;
    let power = mean_power_spectrum(mono, sample_rate);
    let total: f32 = power.iter().sum::<f32>() + EPS;
    let hz = |k: usize| k as f32 * sr / WINDOW as f32;
    let nyquist = sr / 2.0;
    let centroid = power.iter().enumerate().map(|(k, p)| hz(k) * p).sum::<f32>() / total / nyquist;
    let mut acc = 0.0;
    let rolloff_bin = power.iter().position(|p| {
        acc += p;
        acc >= total * 0.85
    });
    let rolloff = hz(rolloff_bin.unwrap_or(0)) / nyquist;
    let log_mean = power.iter().map(|p| (p + EPS).ln()).sum::<f32>() / power.len() as f32;
    let flatness = log_mean.exp() / (total / power.len() as f32);
    let band = |lo: f32, hi: f32| {
        power.iter().enumerate().filter(|(k, _)| hz(*k) >= lo && hz(*k) < hi).map(|(_, p)| p).sum::<f32>() / total
    };
    let (attack, decay) = envelope_times(mono, sr);
    Features {
        duration: mono.len() as f32 / sr,
        attack,
        decay,
        rms: (mono.iter().map(|x| x * x).sum::<f32>() / mono.len().max(1) as f32).sqrt(),
        centroid,
        rolloff,
        flatness,
        zcr: mono.windows(2).filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0)).count() as f32 / mono.len().max(1) as f32,
        low: band(0.0, 150.0),
        mid: band(150.0, 2_000.0),
        high: band(2_000.0, f32::INFINITY),
        pitchedness: pitchedness(mono, sample_rate),
        segments: segment_features(mono, sample_rate),
        temporal_centroid: temporal_centroid(mono, sr),
        crest: crest(mono),
        pitch_hz: pitch_hz(mono, sample_rate),
        mfcc: mfcc(&power, sample_rate),
    }
}

const SEGMENT_FFT: usize = 1024;
const SEGMENT_HOP: usize = 256;
const ALIGN_BLOCK: usize = 128;
const PRE_ROLL: usize = 64;
const PEAK_SHARE: f32 = 0.9;

fn aligned_start(mono: &[f32]) -> isize {
    let peak = mono.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let first = mono.iter().position(|x| x.abs() >= peak * 0.1).unwrap_or(0);
    first as isize - PRE_ROLL as isize
}

fn segment_features(mono: &[f32], sample_rate: u32) -> Vec<f32> {
    use rustfft::{num_complex::Complex, FftPlanner};
    let sr = sample_rate as f32;
    let peak = mono.iter().fold(0.0f32, |m, x| m.max(x.abs())).max(EPS);
    let start = aligned_start(mono);
    let fft = FftPlanner::<f32>::new().plan_fft_forward(SEGMENT_FFT);
    let hann: Vec<f32> = (0..SEGMENT_FFT)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / SEGMENT_FFT as f32).cos())
        .collect();
    let bins = SEGMENT_FFT / 2;
    let hz = |k: usize| k as f32 * sr / SEGMENT_FFT as f32;
    let edges: Vec<f32> = (0..=BANDS).map(|i| 30.0 * (20_000.0f32 / 30.0).powf(i as f32 / BANDS as f32)).collect();
    let mut out = Vec::with_capacity(SEGMENTS.len() * SEGMENT_LEN);
    let mut buf = vec![Complex::new(0.0f32, 0.0); SEGMENT_FFT];
    for &(a, b) in &SEGMENTS {
        let from = start + (a * sr) as isize;
        let to = (start + (b * sr) as isize).min(mono.len() as isize).max(from);
        let seg: Vec<f32> = (from..to)
            .map(|i| if i < 0 { 0.0 } else { mono.get(i as usize).copied().unwrap_or(0.0) / peak })
            .collect();
        let mut power = vec![0.0f32; bins];
        let mut frames = 0;
        let mut pos = 0;
        loop {
            for (i, c) in buf.iter_mut().enumerate() {
                *c = Complex::new(seg.get(pos + i).copied().unwrap_or(0.0) * hann[i], 0.0);
            }
            fft.process(&mut buf);
            for (p, c) in power.iter_mut().zip(&buf) {
                *p += c.norm_sqr();
            }
            frames += 1;
            pos += SEGMENT_HOP;
            if pos + SEGMENT_FFT > seg.len() {
                break;
            }
        }
        power.iter_mut().for_each(|p| *p /= frames as f32);
        let total: f32 = power.iter().sum::<f32>() + EPS;
        for w in edges.windows(2) {
            let e: f32 = power.iter().enumerate().filter(|(k, _)| hz(*k) >= w[0] && hz(*k) < w[1]).map(|(_, p)| p).sum();
            out.push(10.0 * (e / total + 1e-9).log10());
        }
        let energy = seg.iter().map(|x| x * x).sum::<f32>() / seg.len().max(1) as f32;
        out.push(10.0 * (energy + 1e-12).log10());
        let nyquist = sr / 2.0;
        out.push(power.iter().enumerate().map(|(k, p)| hz(k) * p).sum::<f32>() / total / nyquist);
        let log_mean = power.iter().map(|p| (p + EPS).ln()).sum::<f32>() / bins as f32;
        out.push(log_mean.exp() / (total / bins as f32));
        let mut acc = 0.0;
        let roll = power.iter().position(|p| {
            acc += p;
            acc >= total * 0.85
        });
        out.push(hz(roll.unwrap_or(0)) / nyquist);
        out.extend_from_slice(&mfcc(&power, sample_rate));
    }
    out
}

fn temporal_centroid(mono: &[f32], sr: f32) -> f32 {
    let start = aligned_start(mono).max(0) as usize;
    let (weighted, total) = mono[start..]
        .chunks(ALIGN_BLOCK)
        .enumerate()
        .fold((0.0f32, 0.0f32), |(w, t), (i, c)| {
            let e = c.iter().map(|x| x * x).sum::<f32>();
            (w + e * i as f32, t + e)
        });
    weighted / (total + EPS) * ALIGN_BLOCK as f32 / sr
}

fn crest(mono: &[f32]) -> f32 {
    let peak = mono.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let rms = (mono.iter().map(|x| x * x).sum::<f32>() / mono.len().max(1) as f32).sqrt();
    peak / (rms + EPS)
}

fn pitch_hz(mono: &[f32], sample_rate: u32) -> f32 {
    best_lag(mono, sample_rate).map(|(lag, _)| sample_rate as f32 / lag as f32).unwrap_or(0.0)
}

fn mean_power_spectrum(mono: &[f32], sample_rate: u32) -> Vec<f32> {
    use rustfft::{num_complex::Complex, FftPlanner};
    let fft = FftPlanner::<f32>::new().plan_fft_forward(WINDOW);
    let hann: Vec<f32> = (0..WINDOW)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / WINDOW as f32).cos())
        .collect();
    let limit = mono.len().min((sample_rate as f32 * ANALYSIS_SECONDS) as usize);
    let mut power = vec![0.0f32; WINDOW / 2];
    let mut buf = vec![Complex::new(0.0f32, 0.0); WINDOW];
    let mut frames = 0;
    let mut start = 0;
    loop {
        for (i, c) in buf.iter_mut().enumerate() {
            let x = if start + i < limit { mono[start + i] } else { 0.0 };
            *c = Complex::new(x * hann[i], 0.0);
        }
        fft.process(&mut buf);
        for (p, c) in power.iter_mut().zip(&buf) {
            *p += c.norm_sqr();
        }
        frames += 1;
        start += HOP;
        if start + WINDOW > limit {
            break;
        }
    }
    power.iter_mut().for_each(|p| *p /= frames as f32);
    power
}

fn envelope_times(mono: &[f32], sr: f32) -> (f32, f32) {
    let env: Vec<f32> = mono.chunks(ENVELOPE_BLOCK).map(|c| c.iter().fold(0.0f32, |m, x| m.max(x.abs()))).collect();
    let Some((peak_at, &peak)) = env.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)) else {
        return (0.0, 0.0);
    };
    if peak <= EPS {
        return (0.0, 0.0);
    }
    let block_seconds = ENVELOPE_BLOCK as f32 / sr;
    let last_loud = env.iter().rposition(|&e| e >= peak * 0.1).unwrap_or(peak_at);
    ((peak_at as f32 + 1.0) * block_seconds, (last_loud - peak_at + 1) as f32 * block_seconds)
}

fn pitchedness(mono: &[f32], sample_rate: u32) -> f32 {
    best_lag(mono, sample_rate).map(|(_, r)| r).unwrap_or(0.0)
}

fn best_lag(mono: &[f32], sample_rate: u32) -> Option<(usize, f32)> {
    let len = WINDOW.min(mono.len());
    if len < 64 {
        return None;
    }
    let start = ((mono.len() - len) / 4).min(mono.len() - len);
    let seg = &mono[start..start + len];
    let energy: f32 = seg.iter().map(|x| x * x).sum();
    if energy <= EPS {
        return None;
    }
    let min_lag = (sample_rate / 2_000).max(1) as usize;
    let max_lag = ((sample_rate / 40) as usize).min(len / 2);
    let curve: Vec<(usize, f32)> = (min_lag..max_lag)
        .map(|lag| {
            let (a, b) = (&seg[..len - lag], &seg[lag..]);
            let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
            let norm = (a.iter().map(|x| x * x).sum::<f32>() * b.iter().map(|y| y * y).sum::<f32>()).sqrt();
            (lag, dot / (norm + EPS))
        })
        .collect();
    let after_dip = curve.iter().position(|(_, r)| *r < 0.0)?;
    let peak = curve[after_dip..].iter().map(|(_, r)| *r).fold(f32::MIN, f32::max);
    if peak <= 0.0 {
        return None;
    }
    curve[after_dip..].windows(3).find_map(|w| {
        let (lag, r) = w[1];
        (r >= peak * PEAK_SHARE && r >= w[0].1 && r >= w[2].1).then_some((lag, r))
    })
}

fn mfcc(power: &[f32], sample_rate: u32) -> [f32; MFCC_BANDS] {
    let mel = |hz: f32| 2595.0 * (1.0 + hz / 700.0).log10();
    let inv = |m: f32| 700.0 * (10f32.powf(m / 2595.0) - 1.0);
    let nyquist = sample_rate as f32 / 2.0;
    let edges: Vec<f32> = (0..MEL_BANDS + 2)
        .map(|i| inv(mel(nyquist) * i as f32 / (MEL_BANDS + 1) as f32) / nyquist * power.len() as f32)
        .collect();
    let energies: Vec<f32> = (0..MEL_BANDS)
        .map(|b| {
            let (lo, center, hi) = (edges[b], edges[b + 1], edges[b + 2]);
            let sum: f32 = power
                .iter()
                .enumerate()
                .map(|(k, p)| {
                    let k = k as f32;
                    let w = if k < lo || k > hi {
                        0.0
                    } else if k <= center {
                        (k - lo) / (center - lo).max(EPS)
                    } else {
                        (hi - k) / (hi - center).max(EPS)
                    };
                    w * p
                })
                .sum();
            (sum + EPS).ln()
        })
        .collect();
    let mut out = [0.0; MFCC_BANDS];
    for (n, o) in out.iter_mut().enumerate() {
        *o = energies
            .iter()
            .enumerate()
            .map(|(m, e)| e * (std::f32::consts::PI * n as f32 * (m as f32 + 0.5) / MEL_BANDS as f32).cos())
            .sum::<f32>()
            / MEL_BANDS as f32;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44_100;

    fn sine(freq: f32, seconds: f32) -> Vec<f32> {
        (0..(SR as f32 * seconds) as usize).map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / SR as f32).sin() * 0.8).collect()
    }

    fn noise(seconds: f32) -> Vec<f32> {
        let mut seed: u32 = 7;
        (0..(SR as f32 * seconds) as usize)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0) * 0.8
            })
            .collect()
    }

    fn decaying(mut s: Vec<f32>, rate: f32) -> Vec<f32> {
        for (i, x) in s.iter_mut().enumerate() {
            *x *= (-(i as f32) / SR as f32 * rate).exp();
        }
        s
    }

    #[test]
    fn vector_has_a_fixed_length() {
        assert_eq!(extract(&sine(440.0, 0.2), SR).to_vec().len(), LEN);
    }

    #[test]
    fn silence_yields_finite_features() {
        assert!(extract(&vec![0.0; 4410], SR).to_vec().iter().all(|v| v.is_finite()));
    }

    #[test]
    fn empty_input_yields_finite_features() {
        assert!(extract(&[], SR).to_vec().iter().all(|v| v.is_finite()));
    }

    #[test]
    fn duration_is_in_seconds() {
        assert!((extract(&sine(440.0, 0.5), SR).duration - 0.5).abs() < 1e-3);
    }

    #[test]
    fn low_sine_has_a_lower_centroid_than_high_sine() {
        assert!(extract(&sine(100.0, 0.3), SR).centroid < extract(&sine(4000.0, 0.3), SR).centroid);
    }

    #[test]
    fn noise_is_flatter_than_a_sine() {
        assert!(extract(&noise(0.3), SR).flatness > extract(&sine(440.0, 0.3), SR).flatness * 5.0);
    }

    #[test]
    fn noise_crosses_zero_more_than_a_low_sine() {
        assert!(extract(&noise(0.3), SR).zcr > extract(&sine(100.0, 0.3), SR).zcr * 5.0);
    }

    #[test]
    fn sub_sine_puts_its_energy_in_the_low_band() {
        assert!(extract(&sine(60.0, 0.3), SR).low > 0.9);
    }

    #[test]
    fn bright_sine_puts_its_energy_in_the_high_band() {
        assert!(extract(&sine(6000.0, 0.3), SR).high > 0.9);
    }

    #[test]
    fn sine_is_more_pitched_than_noise() {
        assert!(extract(&sine(220.0, 0.3), SR).pitchedness > extract(&noise(0.3), SR).pitchedness + 0.5);
    }

    #[test]
    fn fast_decay_is_shorter_than_slow_decay() {
        let fast = extract(&decaying(noise(1.0), 40.0), SR).decay;
        let slow = extract(&decaying(noise(1.0), 4.0), SR).decay;
        assert!(fast < slow, "fast {fast} slow {slow}");
    }

    #[test]
    fn attack_measures_the_time_to_peak() {
        let ramp: Vec<f32> = (0..4410).map(|i| i as f32 / 4410.0).chain(std::iter::repeat(0.0).take(4410)).collect();
        assert!((extract(&ramp, SR).attack - 0.1).abs() < 0.01);
    }

    #[test]
    fn low_notes_do_not_fake_a_short_decay() {
        let bass = decaying(sine(55.0, 1.5), 1.5);
        assert!(extract(&bass, SR).decay > 1.0, "{}", extract(&bass, SR).decay);
    }

    #[test]
    fn beating_chords_do_not_fake_a_short_decay() {
        let chord: Vec<f32> = (0..(SR as f32 * 1.5) as usize)
            .map(|i| {
                let t = i as f32 / SR as f32;
                [261.6f32, 329.6, 392.0, 523.2].iter().map(|f| (2.0 * std::f32::consts::PI * f * t).sin()).sum::<f32>() * 0.15 * (-t * 2.0).exp()
            })
            .collect();
        assert!(extract(&chord, SR).decay > 0.8, "{}", extract(&chord, SR).decay);
    }

    #[test]
    fn leading_silence_does_not_change_the_segments() {
        let hit = decaying(noise(0.5), 20.0);
        let mut late = vec![0.0; 4410];
        late.extend_from_slice(&hit);
        let (a, b) = (extract(&hit, SR).segments, extract(&late, SR).segments);
        let diff = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max);
        let worst = a.iter().zip(&b).enumerate().max_by(|x, y| (x.1 .0 - x.1 .1).abs().total_cmp(&(y.1 .0 - y.1 .1).abs())).unwrap();
        assert!(diff < 0.5, "max diff {diff} at {worst:?}");
    }

    #[test]
    fn segment_bands_find_a_sub_bass_in_the_body() {
        let segments = extract(&sine(50.0, 0.5), SR).segments;
        let body_bands = &segments[SEGMENT_LEN..SEGMENT_LEN + BANDS];
        let loudest = body_bands.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert_eq!(loudest, 0);
    }

    #[test]
    fn segments_of_silence_are_finite() {
        assert!(extract(&vec![0.0; 4410], SR).segments.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn estimates_the_pitch_of_a_low_note() {
        let hz = extract(&sine(55.0, 0.5), SR).pitch_hz;
        assert!((hz - 55.0).abs() < 1.5, "{hz}");
    }

    #[test]
    fn estimates_the_pitch_of_a_mid_note() {
        let hz = extract(&sine(220.0, 0.5), SR).pitch_hz;
        assert!((hz - 220.0).abs() < 3.0, "{hz}");
    }
}
