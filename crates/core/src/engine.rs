use crate::sequencer::{Event, Groove, Pattern};
use crate::slicing::slices;

pub const PADS: usize = 16;
const VOICES: usize = 32;
const MAX_EVENTS: usize = 4096;

#[derive(Debug, Clone, Default)]
struct Pad {
    pitch: f64,
    gain: f32,
    reverse: bool,
    stretched: Vec<(i64, [Vec<f32>; 2])>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Source {
    Sample,
    Stretched(usize, usize),
}

#[derive(Debug, Clone, Copy)]
struct Voice {
    sounding: bool,
    pad: Option<usize>,
    source: Source,
    pos: f64,
    start: f64,
    end: f64,
    rate: f64,
    gain: f32,
    age: usize,
    release: Option<usize>,
}

impl Voice {
    const SILENT: Voice = Voice {
        sounding: false,
        pad: None,
        source: Source::Sample,
        pos: 0.0,
        start: 0.0,
        end: 0.0,
        rate: 1.0,
        gain: 0.0,
        age: 0,
        release: None,
    };
}

pub struct Engine {
    sample_rate: f64,
    sample: [Vec<f32>; 2],
    markers: Vec<usize>,
    pad_slices: [usize; PADS],
    pads: Vec<Pad>,
    voices: [Voice; VOICES],
    pattern: Pattern,
    bpm: f64,
    playing: bool,
    beat: f64,
    block_time: f64,
    block_beat: f64,
    audition: Option<f64>,
    source_rate: f64,
    play_limit: Option<f64>,
    played: f64,
    metronome: bool,
    click_age: Option<usize>,
    out: [Vec<f32>; 2],
    pending: Vec<(usize, Event)>,
    fade_in: usize,
    fade_out: usize,
}

impl Engine {
    pub fn new(sample_rate: f64, max_block: usize) -> Self {
        let mut pattern = Pattern::new(4.0);
        pattern.reserve(MAX_EVENTS);
        Self {
            sample_rate,
            sample: [Vec::new(), Vec::new()],
            markers: Vec::new(),
            pad_slices: std::array::from_fn(|i| i),
            pads: vec![Pad { gain: 1.0, ..Pad::default() }; PADS],
            voices: [Voice::SILENT; VOICES],
            pattern,
            bpm: 90.0,
            playing: false,
            beat: 0.0,
            block_time: 0.0,
            block_beat: 0.0,
            audition: None,
            source_rate: 1.0,
            play_limit: None,
            played: 0.0,
            metronome: false,
            click_age: None,
            out: [vec![0.0; max_block], vec![0.0; max_block]],
            pending: Vec::with_capacity(MAX_EVENTS),
            fade_in: ((sample_rate * 0.002) as usize).max(1),
            fade_out: ((sample_rate * 0.004) as usize).max(1),
        }
    }

    pub fn load_sample(&mut self, left: Vec<f32>, right: Vec<f32>) {
        self.voices = [Voice::SILENT; VOICES];
        self.audition = None;
        self.sample = [left, right];
        self.markers.clear();
        self.pad_slices = std::array::from_fn(|i| i);
    }

    pub fn set_markers(&mut self, markers: Vec<usize>) {
        self.markers = markers;
    }

    pub fn set_pad(&mut self, pad: usize, pitch: f64, gain: f32, reverse: bool) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.pitch = pitch;
            p.gain = gain;
            p.reverse = reverse;
        }
    }

    pub fn set_pad_stretched(&mut self, pad: usize, pitch: f64, buffer: Option<[Vec<f32>; 2]>) {
        let Some(p) = self.pads.get_mut(pad) else { return };
        let key = cents(pitch);
        p.stretched.retain(|(k, _)| *k != key);
        if let Some(buffer) = buffer {
            p.stretched.push((key, buffer));
        }
        self.voices.iter_mut().filter(|v| matches!(v.source, Source::Stretched(vp, _) if vp == pad)).for_each(|v| v.sounding = false);
    }

    pub fn clear_pad_stretched(&mut self, pad: usize) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.stretched.clear();
        }
        self.voices.iter_mut().filter(|v| matches!(v.source, Source::Stretched(vp, _) if vp == pad)).for_each(|v| v.sounding = false);
    }

    pub fn set_pad_slice(&mut self, pad: usize, slice: usize) {
        if let Some(s) = self.pad_slices.get_mut(pad) {
            *s = slice;
        }
    }

    pub fn set_source_rate(&mut self, rate: f64) {
        self.source_rate = rate.clamp(0.1, 4.0);
    }

    pub fn trigger(&mut self, pad: usize, velocity: f32, pitch: f64) {
        self.start_pad(pad, velocity, pitch);
    }

    pub fn trigger_note(&mut self, slice: usize, semitones: f64, velocity: f32) {
        if let Some(mut voice) = self.voice_for(slice, velocity, semitones) {
            voice.pad = None;
            self.start_voice(voice);
        }
    }

    pub fn audition(&mut self, from_frame: Option<usize>) {
        self.audition = from_frame.map(|f| f as f64);
    }

    pub fn audition_frame(&self) -> Option<usize> {
        self.audition.map(|p| p as usize)
    }

    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm = bpm.clamp(20.0, 400.0);
    }

    pub fn set_playing(&mut self, playing: bool) {
        if playing && !self.playing {
            self.beat = 0.0;
            self.played = 0.0;
        }
        self.playing = playing;
    }

    pub fn set_play_limit(&mut self, beats: Option<f64>) {
        self.play_limit = beats;
    }

    pub fn set_metronome(&mut self, on: bool) {
        self.metronome = on;
    }

    pub fn set_pattern_length(&mut self, beats: f64) {
        self.pattern.set_length_beats(beats);
        self.beat = self.beat.rem_euclid(beats);
    }

    pub fn set_groove(&mut self, groove: Groove) {
        self.pattern.set_groove(groove);
    }

    pub fn clear_events(&mut self) {
        self.pattern.clear();
    }

    pub fn add_event(&mut self, event: Event) {
        if self.pattern.events().len() < MAX_EVENTS {
            self.pattern.push(event);
        }
    }

    pub fn beat(&self) -> f64 {
        self.beat
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    pub fn beat_at_time(&self, time: f64) -> f64 {
        (self.block_beat + (time - self.block_time) * self.beats_per_second())
            .rem_euclid(self.pattern.length_beats())
    }

    pub fn process(&mut self, frames: usize, time: f64) {
        let frames = frames.min(self.out[0].len());
        self.block_time = time;
        self.block_beat = self.beat;
        for ch in &mut self.out {
            ch[..frames].fill(0.0);
        }
        self.pending.clear();
        let mut clicks = [usize::MAX; 8];
        if self.playing {
            let beats_per_frame = self.beats_per_second() / self.sample_rate;
            let span = frames as f64 * beats_per_frame;
            let audible_span = match self.play_limit {
                Some(limit) => span.min((limit - self.played).max(0.0)),
                None => span,
            };
            let pending = &mut self.pending;
            self.pattern.for_each_in_span(self.beat, audible_span, |offset, e| {
                if pending.len() < pending.capacity() {
                    pending.push((frame_offset(offset, beats_per_frame, frames), *e));
                }
            });
            if self.metronome {
                let mut k = self.beat.ceil();
                let mut n = 0;
                while k < self.beat + audible_span && n < clicks.len() {
                    clicks[n] = frame_offset(k - self.beat, beats_per_frame, frames);
                    k += 1.0;
                    n += 1;
                }
            }
            self.beat = (self.beat + span).rem_euclid(self.pattern.length_beats());
            self.played += span;
            if self.play_limit.is_some_and(|limit| self.played >= limit) {
                self.playing = false;
            }
        }
        let mut cursor = 0;
        let mut next_event = 0;
        loop {
            let event_at = self.pending.get(next_event).map(|(o, _)| *o).unwrap_or(usize::MAX);
            let click_at = clicks.iter().copied().min().unwrap_or(usize::MAX);
            let at = event_at.min(click_at).min(frames);
            self.render(cursor, at);
            cursor = at;
            if at == frames {
                break;
            }
            if event_at == at {
                let (_, e) = self.pending[next_event];
                self.start_pad(e.pad as usize, e.velocity, e.pitch);
                next_event += 1;
            } else {
                if let Some(c) = clicks.iter_mut().find(|c| **c == at) {
                    *c = usize::MAX;
                }
                self.click_age = Some(0);
            }
        }
        self.limit(frames);
    }

    fn limit(&mut self, frames: usize) {
        for ch in &mut self.out {
            for s in &mut ch[..frames] {
                *s = soft_clip(*s);
            }
        }
    }

    fn beats_per_second(&self) -> f64 {
        self.bpm / 60.0
    }

    fn slice(&self, index: usize) -> Option<std::ops::Range<usize>> {
        if self.sample[0].is_empty() {
            return None;
        }
        slices(&self.markers, self.sample[0].len()).into_iter().nth(index)
    }

    fn start_pad(&mut self, pad: usize, velocity: f32, pitch: f64) {
        let Some(voice) = self.voice_for(pad, velocity, pitch) else { return };
        for v in self.voices.iter_mut().filter(|v| v.sounding && v.pad == Some(pad)) {
            v.release.get_or_insert(0);
        }
        self.start_voice(voice);
    }

    fn voice_for(&self, pad: usize, velocity: f32, pitch: f64) -> Option<Voice> {
        let p = self.pads.get(pad)?;
        let total = p.pitch + pitch;
        let base = Voice { sounding: true, pad: Some(pad), gain: p.gain * velocity, ..Voice::SILENT };
        if let Some(i) = p.stretched.iter().position(|(k, _)| *k == cents(total)) {
            let len = p.stretched[i].1[0].len() as f64;
            return Some(Voice { source: Source::Stretched(pad, i), pos: 0.0, start: 0.0, end: len, rate: 1.0, ..base });
        }
        let range = self.slice(*self.pad_slices.get(pad)?)?;
        let rate = semitone_rate(total) * self.source_rate;
        let (start, end) = (range.start as f64, range.end as f64);
        Some(if p.reverse {
            Voice { source: Source::Sample, pos: end - 1.0, start, end, rate: -rate, ..base }
        } else {
            Voice { source: Source::Sample, pos: start, start, end, rate, ..base }
        })
    }

    fn start_voice(&mut self, voice: Voice) {
        let slot = match self.voices.iter().position(|v| !v.sounding) {
            Some(i) => i,
            None => (0..VOICES).max_by_key(|&i| self.voices[i].age).unwrap_or(0),
        };
        self.voices[slot] = voice;
    }

    fn render(&mut self, from: usize, to: usize) {
        if from >= to {
            return;
        }
        let fade_in = self.fade_in;
        let fade_out = self.fade_out;
        for v in self.voices.iter_mut().filter(|v| v.sounding) {
            let buf = match v.source {
                Source::Sample => &self.sample,
                Source::Stretched(p, i) => match self.pads[p].stretched.get(i) {
                    Some((_, b)) => b,
                    None => {
                        v.sounding = false;
                        continue;
                    }
                },
            };
            for i in from..to {
                if v.pos >= v.end || v.pos < v.start || v.release.is_some_and(|r| r >= fade_out) {
                    v.sounding = false;
                    break;
                }
                let mut g = v.gain;
                if v.age < fade_in {
                    g *= (v.age + 1) as f32 / (fade_in + 1) as f32;
                }
                let remaining = if v.rate > 0.0 { (v.end - v.pos) / v.rate } else { (v.pos - v.start) / -v.rate };
                if remaining < fade_out as f64 {
                    g *= (remaining / fade_out as f64) as f32;
                }
                if let Some(r) = v.release.as_mut() {
                    g *= 1.0 - *r as f32 / fade_out as f32;
                    *r += 1;
                }
                self.out[0][i] += read(&buf[0], v.pos) * g;
                self.out[1][i] += read(&buf[1], v.pos) * g;
                v.pos += v.rate;
                v.age += 1;
            }
        }
        if let Some(pos) = self.audition.as_mut() {
            let len = self.sample[0].len() as f64;
            for i in from..to {
                if *pos >= len {
                    self.audition = None;
                    break;
                }
                self.out[0][i] += read(&self.sample[0], *pos);
                self.out[1][i] += read(&self.sample[1], *pos);
                *pos += self.source_rate;
            }
        }
        if let Some(age) = self.click_age.as_mut() {
            let length = (self.sample_rate * 0.03) as usize;
            let accent = self.block_beat < 0.5;
            let freq = if accent { 1500.0 } else { 1000.0 };
            for i in from..to {
                if *age >= length {
                    self.click_age = None;
                    break;
                }
                let t = *age as f64 / self.sample_rate;
                let s = ((2.0 * std::f64::consts::PI * freq * t).cos() * (-t * 150.0).exp() * 0.3) as f32;
                self.out[0][i] += s;
                self.out[1][i] += s;
                *age += 1;
            }
        }
    }

    pub fn output(&self, channel: usize) -> &[f32] {
        &self.out[channel]
    }
}

fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.8;
    if x.abs() <= KNEE {
        x
    } else {
        x.signum() * (KNEE + (1.0 - KNEE) * ((x.abs() - KNEE) / (1.0 - KNEE)).tanh())
    }
}

fn cents(semitones: f64) -> i64 {
    (semitones * 100.0).round() as i64
}

fn semitone_rate(semitones: f64) -> f64 {
    2f64.powf(semitones / 12.0)
}

fn frame_offset(beats: f64, beats_per_frame: f64, frames: usize) -> usize {
    ((beats / beats_per_frame + 1e-6).floor() as usize).min(frames - 1)
}

fn read(buf: &[f32], pos: f64) -> f32 {
    let i = pos as usize;
    let frac = (pos - i as f64) as f32;
    let a = buf.get(i).copied().unwrap_or(0.0);
    let b = buf.get(i + 1).copied().unwrap_or(0.0);
    a + (b - a) * frac
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 1000.0;

    fn ramp(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| i as f32 / frames as f32).collect()
    }

    fn engine_with(sample: Vec<f32>) -> Engine {
        let mut e = Engine::new(SR, 4096);
        e.load_sample(sample.clone(), sample);
        e
    }

    fn render(e: &mut Engine, frames: usize) -> Vec<f32> {
        let mut out = Vec::new();
        let mut time = 0.0;
        let mut left = frames;
        while left > 0 {
            let n = left.min(128);
            e.process(n, time);
            out.extend_from_slice(&e.output(0)[..n]);
            time += n as f64 / SR;
            left -= n;
        }
        out
    }

    fn first_sound(out: &[f32]) -> Option<usize> {
        out.iter().position(|s| s.abs() > 1e-6)
    }

    #[test]
    fn pad_plays_its_slice_at_original_speed() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 300, 600]);
        e.trigger(1, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[320]).abs() < 1e-4, "{} vs {}", out[20], src[320]);
    }

    #[test]
    fn slice_stops_at_the_next_marker() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 300, 600]);
        e.trigger(1, 1.0, 0.0);
        let out = render(&mut e, 400);
        assert!(out[300].abs() < 1e-6);
    }

    #[test]
    fn octave_up_plays_twice_as_fast() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 12.0, 1.0, false);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn octave_up_ends_the_slice_in_half_the_time() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 12.0, 1.0, false);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 400);
        assert!(out[305].abs() < 1e-6);
    }

    #[test]
    fn velocity_scales_the_output() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.trigger(0, 0.5, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.25).abs() < 1e-4);
    }

    #[test]
    fn pad_without_a_slice_is_silent() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 500]);
        e.trigger(5, 1.0, 0.0);
        assert_eq!(first_sound(&render(&mut e, 50)), None);
    }

    #[test]
    fn retriggering_a_pad_chokes_its_previous_voice() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.trigger(0, 1.0, 0.0);
        render(&mut e, 10);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[30] - 0.5).abs() < 1e-4, "{}", out[30]);
    }

    #[test]
    fn keyboard_note_transposes_the_slice() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.trigger_note(0, 12.0, 1.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn stretched_pad_plays_its_own_buffer() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_pad_stretched(0, 0.0, Some([vec![0.1; 800], vec![0.1; 800]]));
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.1).abs() < 1e-4);
    }

    #[test]
    fn pattern_event_sounds_at_its_beat() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.5, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_playing(true);
        assert_eq!(first_sound(&render(&mut e, 1000)), Some(500));
    }

    #[test]
    fn pattern_loops_and_fires_again_mid_block() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.03, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_playing(true);
        let out = render(&mut e, 1100);
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1030));
    }

    #[test]
    fn event_at_loop_start_fires_each_cycle() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_playing(true);
        let out = render(&mut e, 2100);
        assert_eq!(first_sound(&out), Some(0));
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1000));
        assert_eq!(first_sound(&out[1500..]).map(|i| i + 1500), Some(2000));
    }

    #[test]
    fn stopped_transport_ignores_the_pattern() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        assert_eq!(first_sound(&render(&mut e, 500)), None);
    }

    #[test]
    fn beat_advances_while_playing() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(120.0);
        e.set_pattern_length(4.0);
        e.set_playing(true);
        render(&mut e, 1000);
        assert!((e.beat() - 2.0).abs() < 1e-9);
    }

    #[test]
    fn beat_at_time_maps_a_moment_inside_the_current_block() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(4.0);
        e.set_playing(true);
        e.process(128, 10.0);
        assert!((e.beat_at_time(10.05) - 0.05).abs() < 1e-9);
    }

    #[test]
    fn beat_at_time_wraps_into_the_pattern() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_playing(true);
        e.process(128, 10.0);
        assert!((e.beat_at_time(9.9) - 0.9).abs() < 1e-9);
    }

    #[test]
    fn audition_plays_the_whole_sample_and_reports_position() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 100]);
        e.audition(Some(200));
        let out = render(&mut e, 128);
        assert!((out[50] - src[250]).abs() < 1e-4);
        assert_eq!(e.audition_frame(), Some(328));
    }

    #[test]
    fn audition_ends_at_the_sample_end() {
        let mut e = engine_with(vec![0.5; 100]);
        e.audition(Some(0));
        render(&mut e, 256);
        assert_eq!(e.audition_frame(), None);
    }

    #[test]
    fn metronome_clicks_on_the_beat() {
        let mut e = engine_with(vec![0.0; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(4.0);
        e.set_metronome(true);
        e.set_playing(true);
        let out = render(&mut e, 1200);
        assert_eq!(first_sound(&out), Some(0));
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1000));
    }

    #[test]
    fn stacked_voices_never_exceed_full_scale() {
        let mut e = engine_with(vec![1.0; 1000]);
        e.set_markers((0..16).map(|i| i * 10).collect());
        for pad in 0..16 {
            e.trigger(pad, 1.0, 0.0);
        }
        let out = render(&mut e, 20);
        assert!(out.iter().all(|s| s.abs() <= 1.0), "{:?}", out);
    }

    #[test]
    fn quiet_signals_pass_unchanged() {
        let mut e = engine_with(vec![0.6; 1000]);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.6).abs() < 1e-6);
    }

    #[test]
    fn note_pitch_adds_to_the_pad_pitch() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 5.0, 1.0, false);
        e.trigger(0, 1.0, 7.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn pattern_event_carries_its_pitch() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 12.0 });
        e.set_playing(true);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn fractional_semitones_detune_the_rate() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 900]);
        e.set_pad(0, 0.5, 1.0, false);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 200);
        let expected = 100.0 * 2f64.powf(0.5 / 12.0);
        assert!((out[100] as f64 - expected / 1000.0).abs() < 1e-4);
    }

    #[test]
    fn reversed_pad_plays_its_slice_backwards() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 0.0, 1.0, true);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[579]).abs() < 1e-4, "{} vs {}", out[20], src[579]);
    }

    #[test]
    fn reversed_pad_stops_at_the_slice_start() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![300, 600]);
        e.set_pad(0, 0.0, 1.0, true);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 400);
        assert!(out[300].abs() < 1e-6);
    }

    #[test]
    fn source_rate_speeds_up_pads() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_source_rate(2.0);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn source_rate_speeds_up_audition() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_source_rate(0.5);
        e.audition(Some(0));
        let out = render(&mut e, 100);
        assert!((out[80] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn stretched_buffer_is_chosen_by_total_pitch() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_pad(0, 5.0, 1.0, false);
        e.set_pad_stretched(0, 5.0, Some([vec![0.1; 800], vec![0.1; 800]]));
        e.set_pad_stretched(0, 12.0, Some([vec![0.2; 800], vec![0.2; 800]]));
        e.trigger(0, 1.0, 7.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.2).abs() < 1e-4);
    }

    #[test]
    fn missing_stretched_pitch_falls_back_to_varispeed() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad_stretched(0, 0.0, Some([vec![0.1; 800], vec![0.1; 800]]));
        e.trigger(0, 1.0, 12.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn clearing_stretched_buffers_returns_to_varispeed() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad_stretched(0, 0.0, Some([vec![0.1; 800], vec![0.1; 800]]));
        e.clear_pad_stretched(0);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[20]).abs() < 1e-4);
    }

    #[test]
    fn play_limit_stops_events_at_the_limit() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_play_limit(Some(2.0));
        e.set_playing(true);
        let out = render(&mut e, 3000);
        assert_eq!(first_sound(&out[1500..]).map(|i| i + 1500), None);
    }

    #[test]
    fn play_limit_keeps_events_before_the_limit() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_play_limit(Some(2.0));
        e.set_playing(true);
        let out = render(&mut e, 3000);
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1000));
    }

    #[test]
    fn play_limit_lets_sounding_voices_ring_out() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.5, pad: 0, velocity: 1.0, nudge: 0.0, pitch: 0.0 });
        e.set_play_limit(Some(1.0));
        e.set_playing(true);
        let out = render(&mut e, 1400);
        assert!(out[1200].abs() > 0.1);
    }

    #[test]
    fn pad_can_point_at_another_slice() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 300, 600]);
        e.set_pad_slice(0, 2);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[620]).abs() < 1e-4);
    }

    #[test]
    fn loading_a_sample_resets_pad_slices() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_pad_slice(0, 2);
        e.load_sample(src.clone(), src.clone());
        e.set_markers(vec![0, 300, 600]);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[20]).abs() < 1e-4);
    }
}
