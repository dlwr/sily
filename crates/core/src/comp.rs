#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Style {
    Punch,
    Glue,
}

struct Shape {
    attack_seconds: f32,
    release_seconds: f32,
    threshold_db: f32,
    ratio: f32,
}

impl Style {
    fn shape(self) -> Shape {
        match self {
            Style::Punch => Shape { attack_seconds: 0.005, release_seconds: 0.12, threshold_db: -30.0, ratio: 5.0 },
            Style::Glue => Shape { attack_seconds: 0.03, release_seconds: 0.3, threshold_db: -20.0, ratio: 1.5 },
        }
    }
}

pub struct Compressor {
    amount: f32,
    attack: f32,
    release: f32,
    threshold_db: f32,
    slope: f32,
    makeup_db: f32,
    envelope: f32,
    style: Style,
}

impl Compressor {
    pub fn new(sample_rate: f32, style: Style) -> Self {
        let shape = style.shape();
        let coef = |seconds: f32| (-1.0 / (seconds * sample_rate)).exp();
        Self {
            amount: 0.0,
            attack: coef(shape.attack_seconds),
            release: coef(shape.release_seconds),
            threshold_db: 0.0,
            slope: 0.0,
            makeup_db: 0.0,
            envelope: 0.0,
            style,
        }
    }

    pub fn set(&mut self, amount: f32) {
        let amount = amount.clamp(0.0, 1.0);
        let shape = self.style.shape();
        let ratio = 1.0 + shape.ratio * amount;
        self.amount = amount;
        self.threshold_db = shape.threshold_db * amount;
        self.slope = 1.0 - 1.0 / ratio;
        self.makeup_db = -self.threshold_db * self.slope * 0.5;
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.amount == 0.0 {
            return;
        }
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let level = l.abs().max(r.abs());
            let coef = if level > self.envelope { self.attack } else { self.release };
            self.envelope = level + coef * (self.envelope - level);
            let over = 20.0 * (self.envelope + 1e-9).log10() - self.threshold_db;
            let reduction = if over > 0.0 { over * self.slope } else { 0.0 };
            let gain = 10f32.powf((self.makeup_db - reduction) / 20.0);
            *l *= gain;
            *r *= gain;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44_100.0;

    fn sine(amp: f32) -> Vec<f32> {
        (0..44_100).map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / SR).sin() * amp).collect()
    }

    fn settled_peak(mut c: Compressor, input: &[f32]) -> f32 {
        let mut l = input.to_vec();
        let mut r = input.to_vec();
        for (lc, rc) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
            c.process(lc, rc);
        }
        l[22_050..].iter().fold(0.0f32, |m, v| m.max(v.abs()))
    }

    fn with(style: Style, amount: f32) -> Compressor {
        let mut c = Compressor::new(SR, style);
        c.set(amount);
        c
    }

    #[test]
    fn no_amount_leaves_the_signal_alone() {
        let input = sine(0.9);
        assert!((settled_peak(with(Style::Punch, 0.0), &input) - 0.9).abs() < 1e-4);
    }

    #[test]
    fn it_narrows_the_gap_between_loud_and_quiet() {
        let loud = settled_peak(with(Style::Punch, 0.8), &sine(0.9));
        let quiet = settled_peak(with(Style::Punch, 0.8), &sine(0.05));
        assert!(loud / quiet < 0.9 / 0.05 * 0.5, "{} / {}", loud, quiet);
    }

    #[test]
    fn glue_squeezes_more_gently_than_punch() {
        let punch = settled_peak(with(Style::Punch, 0.8), &sine(0.9)) / settled_peak(with(Style::Punch, 0.8), &sine(0.05));
        let glue = settled_peak(with(Style::Glue, 0.8), &sine(0.9)) / settled_peak(with(Style::Glue, 0.8), &sine(0.05));
        assert!(glue > punch, "{} {}", glue, punch);
    }

    #[test]
    fn makeup_keeps_a_compressed_loud_sound_near_its_level() {
        let out = settled_peak(with(Style::Punch, 0.5), &sine(0.5));
        assert!(out > 0.3 && out < 1.0, "{}", out);
    }
}
