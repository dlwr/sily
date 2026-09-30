use crate::sequencer::{Event, Groove, Pattern};
use crate::slicing::slices;

pub const PADS: usize = 16;
const VOICES: usize = 32;
const MAX_EVENTS: usize = 4096;

#[derive(Debug, Clone, Default)]
struct Pad {
    pitch: f64,
    gain: f32,
    stretched: Option<[Vec<f32>; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Source {
    Sample,
    Pad(usize),
}

#[derive(Debug, Clone, Copy)]
struct Voice {
    sounding: bool,
    pad: Option<usize>,
    source: Source,
    pos: f64,
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
    pads: Vec<Pad>,
    voices: [Voice; VOICES],
    pattern: Pattern,
    bpm: f64,
    playing: bool,
    beat: f64,
    block_time: f64,
    block_beat: f64,
    audition: Option<f64>,
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
            pads: vec![Pad { gain: 1.0, ..Pad::default() }; PADS],
            voices: [Voice::SILENT; VOICES],
            pattern,
            bpm: 90.0,
            playing: false,
            beat: 0.0,
            block_time: 0.0,
            block_beat: 0.0,
            audition: None,
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
    }

    pub fn set_markers(&mut self, markers: Vec<usize>) {
        self.markers = markers;
    }

    pub fn set_pad(&mut self, pad: usize, pitch: f64, gain: f32) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.pitch = pitch;
            p.gain = gain;
        }
    }

    pub fn set_pad_stretched(&mut self, pad: usize, buffer: Option<[Vec<f32>; 2]>) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.stretched = buffer;
        }
    }

    pub fn trigger(&mut self, pad: usize, velocity: f32) {
        self.start_pad(pad, velocity);
    }

    pub fn trigger_note(&mut self, slice: usize, semitones: f64, velocity: f32) {
        let Some(range) = self.slice(slice) else { return };
        let pitch = self.pads[slice].pitch + semitones;
        let gain = self.pads[slice].gain * velocity;
        self.start_voice(Voice {
            sounding: true,
            pad: None,
            source: Source::Sample,
            pos: range.start as f64,
            end: range.end as f64,
            rate: semitone_rate(pitch),
            gain,
            age: 0,
            release: None,
        });
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
        }
        self.playing = playing;
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
            let pending = &mut self.pending;
            self.pattern.for_each_in_span(self.beat, span, |offset, e| {
                if pending.len() < pending.capacity() {
                    pending.push((frame_offset(offset, beats_per_frame, frames), *e));
                }
            });
            if self.metronome {
                let mut k = self.beat.ceil();
                let mut n = 0;
                while k < self.beat + span && n < clicks.len() {
                    clicks[n] = frame_offset(k - self.beat, beats_per_frame, frames);
                    k += 1.0;
                    n += 1;
                }
            }
            self.beat = (self.beat + span).rem_euclid(self.pattern.length_beats());
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
                self.start_pad(e.pad as usize, e.velocity);
                next_event += 1;
            } else {
                if let Some(c) = clicks.iter_mut().find(|c| **c == at) {
                    *c = usize::MAX;
                }
                self.click_age = Some(0);
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

    fn start_pad(&mut self, pad: usize, velocity: f32) {
        let Some(p) = self.pads.get(pad) else { return };
        let gain = p.gain * velocity;
        let voice = match &p.stretched {
            Some(buf) => Voice {
                sounding: true,
                pad: Some(pad),
                source: Source::Pad(pad),
                pos: 0.0,
                end: buf[0].len() as f64,
                rate: 1.0,
                gain,
                age: 0,
                release: None,
            },
            None => {
                let pitch = p.pitch;
                let Some(range) = self.slice(pad) else { return };
                Voice {
                    sounding: true,
                    pad: Some(pad),
                    source: Source::Sample,
                    pos: range.start as f64,
                    end: range.end as f64,
                    rate: semitone_rate(pitch),
                    gain,
                    age: 0,
                    release: None,
                }
            }
        };
        for v in self.voices.iter_mut().filter(|v| v.sounding && v.pad == Some(pad)) {
            v.release.get_or_insert(0);
        }
        self.start_voice(voice);
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
                Source::Pad(p) => match &self.pads[p].stretched {
                    Some(b) => b,
                    None => {
                        v.sounding = false;
                        continue;
                    }
                },
            };
            for i in from..to {
                if v.pos >= v.end || v.release.is_some_and(|r| r >= fade_out) {
                    v.sounding = false;
                    break;
                }
                let mut g = v.gain;
                if v.age < fade_in {
                    g *= (v.age + 1) as f32 / (fade_in + 1) as f32;
                }
                let remaining = (v.end - v.pos) / v.rate;
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
                *pos += 1.0;
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
        e.trigger(1, 1.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[320]).abs() < 1e-4, "{} vs {}", out[20], src[320]);
    }

    #[test]
    fn slice_stops_at_the_next_marker() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 300, 600]);
        e.trigger(1, 1.0);
        let out = render(&mut e, 400);
        assert!(out[300].abs() < 1e-6);
    }

    #[test]
    fn octave_up_plays_twice_as_fast() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 12.0, 1.0);
        e.trigger(0, 1.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[40]).abs() < 1e-4);
    }

    #[test]
    fn octave_up_ends_the_slice_in_half_the_time() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 600]);
        e.set_pad(0, 12.0, 1.0);
        e.trigger(0, 1.0);
        let out = render(&mut e, 400);
        assert!(out[305].abs() < 1e-6);
    }

    #[test]
    fn velocity_scales_the_output() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.trigger(0, 0.5);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.25).abs() < 1e-4);
    }

    #[test]
    fn pad_without_a_slice_is_silent() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 500]);
        e.trigger(5, 1.0);
        assert_eq!(first_sound(&render(&mut e, 50)), None);
    }

    #[test]
    fn retriggering_a_pad_chokes_its_previous_voice() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.trigger(0, 1.0);
        render(&mut e, 10);
        e.trigger(0, 1.0);
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
        e.set_pad_stretched(0, Some([vec![0.1; 800], vec![0.1; 800]]));
        e.trigger(0, 1.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.1).abs() < 1e-4);
    }

    #[test]
    fn pattern_event_sounds_at_its_beat() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.5, pad: 0, velocity: 1.0, nudge: 0.0 });
        e.set_playing(true);
        assert_eq!(first_sound(&render(&mut e, 1000)), Some(500));
    }

    #[test]
    fn pattern_loops_and_fires_again_mid_block() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.03, pad: 0, velocity: 1.0, nudge: 0.0 });
        e.set_playing(true);
        let out = render(&mut e, 1100);
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1030));
    }

    #[test]
    fn event_at_loop_start_fires_each_cycle() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0 });
        e.set_playing(true);
        let out = render(&mut e, 2100);
        assert_eq!(first_sound(&out), Some(0));
        assert_eq!(first_sound(&out[500..]).map(|i| i + 500), Some(1000));
        assert_eq!(first_sound(&out[1500..]).map(|i| i + 1500), Some(2000));
    }

    #[test]
    fn stopped_transport_ignores_the_pattern() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.add_event(Event { beat: 0.0, pad: 0, velocity: 1.0, nudge: 0.0 });
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
}
