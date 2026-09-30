use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FxSettings {
    pub highpass_hz: f32,
    pub lowpass_hz: f32,
    pub low_db: f32,
    pub mid_db: f32,
    pub mid_hz: f32,
    pub high_db: f32,
    pub drive_db: f32,
    pub ceiling_db: f32,
}

impl Default for FxSettings {
    fn default() -> Self {
        Self { highpass_hz: 0.0, lowpass_hz: 0.0, low_db: 0.0, mid_db: 0.0, mid_hz: 1000.0, high_db: 0.0, drive_db: 0.0, ceiling_db: -0.3 }
    }
}

const LOW_SHELF_HZ: f32 = 120.0;
const HIGH_SHELF_HZ: f32 = 8_000.0;
const BUTTERWORTH_Q: f32 = std::f32::consts::FRAC_1_SQRT_2;
const MID_Q: f32 = 1.0;
const RELEASE_SECONDS: f32 = 0.05;

#[derive(Debug, Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: [f32; 2],
    z2: [f32; 2],
}

enum Shape {
    Highpass,
    Lowpass,
    LowShelf(f32),
    Peak(f32),
    HighShelf(f32),
}

impl Biquad {
    fn design(shape: Shape, freq: f32, q: f32, sample_rate: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * (freq / sample_rate).min(0.49);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let (b0, b1, b2, a0, a1, a2) = match shape {
            Shape::Highpass => ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Shape::Lowpass => ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            Shape::Peak(db) => {
                let a = 10f32.powf(db / 40.0);
                (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a)
            }
            Shape::LowShelf(db) | Shape::HighShelf(db) => {
                let a = 10f32.powf(db / 40.0);
                let shelf_alpha = sin / 2.0 * std::f32::consts::SQRT_2;
                let k = 2.0 * a.sqrt() * shelf_alpha;
                let sign = if matches!(shape, Shape::LowShelf(_)) { 1.0 } else { -1.0 };
                let b0 = a * ((a + 1.0) - sign * (a - 1.0) * cos + k);
                let b1 = sign * 2.0 * a * ((a - 1.0) - sign * (a + 1.0) * cos);
                let b2 = a * ((a + 1.0) - sign * (a - 1.0) * cos - k);
                let a0 = (a + 1.0) + sign * (a - 1.0) * cos + k;
                let a1 = -sign * 2.0 * ((a - 1.0) + sign * (a + 1.0) * cos);
                let a2 = (a + 1.0) + sign * (a - 1.0) * cos - k;
                (b0, b1, b2, a0, a1, a2)
            }
        };
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: [0.0; 2], z2: [0.0; 2] }
    }

    fn run(&mut self, ch: usize, x: f32) -> f32 {
        let y = self.b0 * x + self.z1[ch];
        self.z1[ch] = self.b1 * x - self.a1 * y + self.z2[ch];
        self.z2[ch] = self.b2 * x - self.a2 * y;
        y
    }
}

pub struct FxChain {
    sample_rate: f32,
    settings: FxSettings,
    filters: Vec<Biquad>,
    drive: f32,
    ceiling: f32,
    envelope: f32,
    release: f32,
}

impl FxChain {
    pub fn new(sample_rate: f32) -> Self {
        let mut chain = Self {
            sample_rate,
            settings: FxSettings::default(),
            filters: Vec::with_capacity(5),
            drive: 1.0,
            ceiling: 1.0,
            envelope: 0.0,
            release: (-1.0 / (RELEASE_SECONDS * sample_rate)).exp(),
        };
        chain.set(FxSettings::default());
        chain
    }

    pub fn settings(&self) -> FxSettings {
        self.settings
    }

    pub fn set(&mut self, settings: FxSettings) {
        let sr = self.sample_rate;
        let mut filters = Vec::with_capacity(5);
        if settings.highpass_hz > 0.0 {
            filters.push(Biquad::design(Shape::Highpass, settings.highpass_hz, BUTTERWORTH_Q, sr));
        }
        if settings.lowpass_hz > 0.0 {
            filters.push(Biquad::design(Shape::Lowpass, settings.lowpass_hz, BUTTERWORTH_Q, sr));
        }
        if settings.low_db != 0.0 {
            filters.push(Biquad::design(Shape::LowShelf(settings.low_db), LOW_SHELF_HZ, 1.0, sr));
        }
        if settings.mid_db != 0.0 {
            filters.push(Biquad::design(Shape::Peak(settings.mid_db), settings.mid_hz, MID_Q, sr));
        }
        if settings.high_db != 0.0 {
            filters.push(Biquad::design(Shape::HighShelf(settings.high_db), HIGH_SHELF_HZ, 1.0, sr));
        }
        for (new, old) in filters.iter_mut().zip(&self.filters) {
            new.z1 = old.z1;
            new.z2 = old.z2;
        }
        self.filters = filters;
        self.drive = 10f32.powf(settings.drive_db / 20.0);
        self.ceiling = 10f32.powf(settings.ceiling_db / 20.0);
        self.settings = settings;
    }

    pub fn is_flat(&self) -> bool {
        self.filters.is_empty() && self.settings.drive_db == 0.0
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.is_flat() {
            return;
        }
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let mut x = [*l, *r];
            for f in &mut self.filters {
                x[0] = f.run(0, x[0]);
                x[1] = f.run(1, x[1]);
            }
            if self.settings.drive_db != 0.0 {
                x[0] *= self.drive;
                x[1] *= self.drive;
                let level = x[0].abs().max(x[1].abs());
                self.envelope = level.max(self.envelope * self.release);
                if self.envelope > self.ceiling {
                    let gain = self.ceiling / self.envelope;
                    x[0] *= gain;
                    x[1] *= gain;
                }
            }
            *l = x[0];
            *r = x[1];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44_100.0;

    fn sine(freq: f32, amp: f32) -> Vec<f32> {
        (0..44_100).map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / SR).sin() * amp).collect()
    }

    fn run(settings: FxSettings, input: &[f32]) -> Vec<f32> {
        let mut fx = FxChain::new(SR);
        fx.set(settings);
        let mut l = input.to_vec();
        let mut r = input.to_vec();
        for (lc, rc) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
            fx.process(lc, rc);
        }
        l
    }

    fn peak_after_settle(x: &[f32]) -> f32 {
        x[22_050..].iter().fold(0.0f32, |m, v| m.max(v.abs()))
    }

    #[test]
    fn flat_settings_leave_the_signal_alone() {
        let input = sine(440.0, 0.5);
        let out = run(FxSettings::default(), &input);
        assert!(input.iter().zip(&out).all(|(a, b)| (a - b).abs() < 1e-6));
    }

    #[test]
    fn low_shelf_boosts_lows() {
        let out = run(FxSettings { low_db: 12.0, ..Default::default() }, &sine(50.0, 0.1));
        assert!((peak_after_settle(&out) / 0.1 - 3.98).abs() < 0.4, "{}", peak_after_settle(&out));
    }

    #[test]
    fn low_shelf_leaves_highs() {
        let out = run(FxSettings { low_db: 12.0, ..Default::default() }, &sine(5000.0, 0.1));
        assert!((peak_after_settle(&out) / 0.1 - 1.0).abs() < 0.1);
    }

    #[test]
    fn high_shelf_boosts_highs() {
        let out = run(FxSettings { high_db: 6.0, ..Default::default() }, &sine(15000.0, 0.1));
        assert!((peak_after_settle(&out) / 0.1 - 2.0).abs() < 0.25, "{}", peak_after_settle(&out));
    }

    #[test]
    fn mid_peak_cuts_around_its_frequency() {
        let out = run(FxSettings { mid_db: -12.0, mid_hz: 1000.0, ..Default::default() }, &sine(1000.0, 0.5));
        assert!((peak_after_settle(&out) / 0.5 - 0.25).abs() < 0.03, "{}", peak_after_settle(&out));
    }

    #[test]
    fn highpass_removes_sub_bass() {
        let out = run(FxSettings { highpass_hz: 500.0, ..Default::default() }, &sine(40.0, 0.5));
        assert!(peak_after_settle(&out) < 0.01);
    }

    #[test]
    fn lowpass_removes_air() {
        let out = run(FxSettings { lowpass_hz: 1000.0, ..Default::default() }, &sine(12000.0, 0.5));
        assert!(peak_after_settle(&out) < 0.01);
    }

    #[test]
    fn drive_makes_quiet_sounds_louder() {
        let out = run(FxSettings { drive_db: 12.0, ..Default::default() }, &sine(440.0, 0.1));
        assert!(peak_after_settle(&out) > 0.35);
    }

    #[test]
    fn the_maximizer_never_exceeds_its_ceiling() {
        let out = run(FxSettings { drive_db: 24.0, ceiling_db: -1.0, ..Default::default() }, &sine(100.0, 0.9));
        let ceiling = 10f32.powf(-1.0 / 20.0);
        assert!(out.iter().all(|v| v.abs() <= ceiling + 1e-4), "{}", out.iter().fold(0.0f32, |m, v| m.max(v.abs())));
    }
}
