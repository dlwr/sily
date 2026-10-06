use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DelaySettings {
    pub feedback: f32,
    pub tone_hz: f32,
    pub ping_pong: bool,
}

impl Default for DelaySettings {
    fn default() -> Self {
        Self { feedback: 0.35, tone_hz: 4000.0, ping_pong: true }
    }
}

pub struct Delay {
    sample_rate: f32,
    lines: [Vec<f32>; 2],
    pos: usize,
    settings: DelaySettings,
    smooth: [f32; 2],
    coef: f32,
}

impl Delay {
    pub fn new(sample_rate: f32, max_seconds: f32) -> Self {
        let len = (sample_rate * max_seconds) as usize + 1;
        let mut delay = Self { sample_rate, lines: [vec![0.0; len], vec![0.0; len]], pos: 0, settings: DelaySettings::default(), smooth: [0.0; 2], coef: 1.0 };
        delay.set(DelaySettings::default());
        delay
    }

    pub fn set(&mut self, settings: DelaySettings) {
        self.coef = if settings.tone_hz > 0.0 {
            1.0 - (-2.0 * std::f32::consts::PI * settings.tone_hz.min(self.sample_rate * 0.45) / self.sample_rate).exp()
        } else {
            1.0
        };
        self.settings = settings;
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], seconds: f32) {
        let len = self.lines[0].len();
        let distance = ((seconds * self.sample_rate).round() as usize).clamp(1, len - 1);
        let feedback = self.settings.feedback.clamp(0.0, 0.95);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let read = (self.pos + len - distance) % len;
            let echo = [self.lines[0][read], self.lines[1][read]];
            for (ch, e) in echo.iter().enumerate() {
                self.smooth[ch] += self.coef * (e - self.smooth[ch]);
            }
            let back = self.smooth;
            if self.settings.ping_pong {
                self.lines[0][self.pos] = (*l + *r) * 0.5 + back[1] * feedback;
                self.lines[1][self.pos] = back[0] * feedback;
            } else {
                self.lines[0][self.pos] = *l + back[0] * feedback;
                self.lines[1][self.pos] = *r + back[1] * feedback;
            }
            *l = echo[0];
            *r = echo[1];
            self.pos = (self.pos + 1) % len;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ReverbSettings {
    pub size: f32,
    pub damping: f32,
}

impl Default for ReverbSettings {
    fn default() -> Self {
        Self { size: 0.5, damping: 0.5 }
    }
}

const COMBS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES: [usize; 4] = [556, 441, 341, 225];
const SPREAD: usize = 23;
const INPUT_GAIN: f32 = 0.015;
const WET_GAIN: f32 = 3.0;

struct Comb {
    buf: Vec<f32>,
    pos: usize,
    store: f32,
}

impl Comb {
    fn run(&mut self, x: f32, feedback: f32, damp: f32) -> f32 {
        let out = self.buf[self.pos];
        self.store = out * (1.0 - damp) + self.store * damp;
        self.buf[self.pos] = x + self.store * feedback;
        self.pos = (self.pos + 1) % self.buf.len();
        out
    }
}

struct Allpass {
    buf: Vec<f32>,
    pos: usize,
}

impl Allpass {
    fn run(&mut self, x: f32) -> f32 {
        let delayed = self.buf[self.pos];
        self.buf[self.pos] = x + delayed * 0.5;
        self.pos = (self.pos + 1) % self.buf.len();
        delayed - x
    }
}

pub struct Reverb {
    combs: [Vec<Comb>; 2],
    allpasses: [Vec<Allpass>; 2],
    feedback: f32,
    damp: f32,
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let scale = sample_rate / 44_100.0;
        let len = |n: usize, ch: usize| (((n + ch * SPREAD) as f32 * scale) as usize).max(1);
        let mut reverb = Self {
            combs: std::array::from_fn(|ch| COMBS.iter().map(|&n| Comb { buf: vec![0.0; len(n, ch)], pos: 0, store: 0.0 }).collect()),
            allpasses: std::array::from_fn(|ch| ALLPASSES.iter().map(|&n| Allpass { buf: vec![0.0; len(n, ch)], pos: 0 }).collect()),
            feedback: 0.0,
            damp: 0.0,
        };
        reverb.set(ReverbSettings::default());
        reverb
    }

    pub fn set(&mut self, settings: ReverbSettings) {
        self.feedback = settings.size.clamp(0.0, 1.0) * 0.28 + 0.7;
        self.damp = settings.damping.clamp(0.0, 1.0) * 0.4;
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let input = (*l + *r) * INPUT_GAIN;
            let mut out = [0.0f32; 2];
            for (ch, o) in out.iter_mut().enumerate() {
                let mut sum = 0.0;
                for comb in &mut self.combs[ch] {
                    sum += comb.run(input, self.feedback, self.damp);
                }
                for allpass in &mut self.allpasses[ch] {
                    sum = allpass.run(sum);
                }
                *o = sum * WET_GAIN;
            }
            *l = out[0];
            *r = out[1];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 1000.0;

    fn impulse(frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut l = vec![0.0; frames];
        l[0] = 1.0;
        (l.clone(), l)
    }

    fn run_delay(d: &mut Delay, l: &mut [f32], r: &mut [f32], seconds: f32) {
        for (lc, rc) in l.chunks_mut(64).zip(r.chunks_mut(64)) {
            d.process(lc, rc, seconds);
        }
    }

    fn loudest(x: &[f32]) -> usize {
        x.iter().enumerate().fold((0, 0.0f32), |best, (i, v)| if v.abs() > best.1 { (i, v.abs()) } else { best }).0
    }

    #[test]
    fn delay_echoes_after_the_delay_time() {
        let mut d = Delay::new(SR, 4.0);
        d.set(DelaySettings { feedback: 0.0, tone_hz: 0.0, ping_pong: false });
        let (mut l, mut r) = impulse(2000);
        run_delay(&mut d, &mut l, &mut r, 0.5);
        assert_eq!(loudest(&l), 500);
    }

    #[test]
    fn delay_without_feedback_echoes_once() {
        let mut d = Delay::new(SR, 4.0);
        d.set(DelaySettings { feedback: 0.0, tone_hz: 0.0, ping_pong: false });
        let (mut l, mut r) = impulse(2000);
        run_delay(&mut d, &mut l, &mut r, 0.5);
        assert!(l[600..].iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn delay_feedback_echoes_again_quieter() {
        let mut d = Delay::new(SR, 4.0);
        d.set(DelaySettings { feedback: 0.5, tone_hz: 0.0, ping_pong: false });
        let (mut l, mut r) = impulse(2000);
        run_delay(&mut d, &mut l, &mut r, 0.5);
        assert!((l[1000] - 0.5 * l[500]).abs() < 1e-4, "{} {}", l[500], l[1000]);
    }

    #[test]
    fn ping_pong_answers_on_the_other_side() {
        let mut d = Delay::new(SR, 4.0);
        d.set(DelaySettings { feedback: 0.5, tone_hz: 0.0, ping_pong: true });
        let (mut l, mut r) = impulse(2000);
        r[0] = 0.0;
        run_delay(&mut d, &mut l, &mut r, 0.5);
        assert!(l[500].abs() > 0.1 && r[500].abs() < 1e-6, "{} {}", l[500], r[500]);
        assert!(r[1000].abs() > 0.05 && l[1000].abs() < 1e-6, "{} {}", l[1000], r[1000]);
    }

    #[test]
    fn reverb_keeps_ringing_after_the_input_stops() {
        let mut v = Reverb::new(44_100.0);
        v.set(ReverbSettings { size: 0.7, damping: 0.3 });
        let (mut l, mut r) = (vec![0.0; 44_100], vec![0.0; 44_100]);
        l[0] = 1.0;
        r[0] = 1.0;
        for (lc, rc) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
            v.process(lc, rc);
        }
        let tail = l[22_050..22_500].iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(tail > 1e-4, "{}", tail);
    }

    #[test]
    fn a_bigger_room_rings_longer() {
        let energy = |size: f32| {
            let mut v = Reverb::new(44_100.0);
            v.set(ReverbSettings { size, damping: 0.3 });
            let (mut l, mut r) = (vec![0.0; 88_200], vec![0.0; 88_200]);
            l[0] = 1.0;
            r[0] = 1.0;
            for (lc, rc) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
                v.process(lc, rc);
            }
            l[44_100..].iter().map(|x| x * x).sum::<f32>()
        };
        assert!(energy(0.9) > energy(0.3) * 2.0);
    }
}
