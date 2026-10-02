use crate::fx::{FxChain, FxSettings};
use crate::sequencer::{Event, Groove, Pattern};
use crate::slicing::slices;

pub const PADS: usize = 16;
const VOICES: usize = 32;
const MAX_EVENTS: usize = 16384;

#[derive(Debug, Clone, Default)]
struct Pad {
    pitch: f64,
    gain: f32,
    reverse: bool,
    choke: Option<u8>,
    own: Option<[Vec<f32>; 2]>,
    stretched: Vec<(i64, [Vec<f32>; 2])>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Source {
    Sample,
    Own(usize),
    Stretched(usize, usize),
}

#[derive(Debug, Clone, Copy)]
struct Voice {
    sounding: bool,
    pad: Option<usize>,
    bus: usize,
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
        bus: 0,
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
    pad_spans: [Option<std::ops::Range<usize>>; PADS],
    pads: Vec<Pad>,
    voices: [Voice; VOICES],
    pattern: Pattern,
    queued: Option<(Vec<Event>, Option<f64>)>,
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
    click_accent: bool,
    out: [Vec<f32>; 2],
    buses: Vec<[Vec<f32>; 2]>,
    pad_fx: Vec<FxChain>,
    master_fx: FxChain,
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
            pad_spans: std::array::from_fn(|_| None),
            pads: vec![Pad { gain: 1.0, ..Pad::default() }; PADS],
            voices: [Voice::SILENT; VOICES],
            pattern,
            queued: None,
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
            click_accent: false,
            out: [vec![0.0; max_block], vec![0.0; max_block]],
            buses: (0..PADS).map(|_| [vec![0.0; max_block], vec![0.0; max_block]]).collect(),
            pad_fx: (0..PADS).map(|_| FxChain::new(sample_rate as f32)).collect(),
            master_fx: FxChain::new(sample_rate as f32),
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
        self.pads.iter_mut().for_each(|p| p.stretched.clear());
        self.pad_slices = std::array::from_fn(|i| i);
        self.pad_spans = std::array::from_fn(|_| None);
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

    pub fn set_pad_sample(&mut self, pad: usize, buffer: Option<[Vec<f32>; 2]>) {
        let Some(p) = self.pads.get_mut(pad) else { return };
        p.own = buffer;
        self.voices
            .iter_mut()
            .filter(|v| matches!(v.source, Source::Own(vp) if vp == pad))
            .for_each(|v| v.sounding = false);
    }

    pub fn set_choke_group(&mut self, pad: usize, group: Option<u8>) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.choke = group;
        }
    }

    pub fn set_pad_slice(&mut self, pad: usize, slice: usize) {
        if let Some(s) = self.pad_slices.get_mut(pad) {
            *s = slice;
        }
    }

    pub fn set_pad_span(&mut self, pad: usize, span: Option<std::ops::Range<usize>>) {
        if let Some(s) = self.pad_spans.get_mut(pad) {
            *s = span;
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
        if !playing {
            if let Some(queued) = self.queued.take() {
                self.apply_queued(queued);
            }
        }
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
        self.queued = None;
        self.pattern.clear();
    }

    pub fn add_event(&mut self, event: Event) {
        if self.pattern.events().len() < MAX_EVENTS {
            self.pattern.push(event);
        }
    }

    pub fn queue_events(&mut self, events: Vec<Event>) {
        self.queue(events, None);
    }

    pub fn queue_pattern(&mut self, events: Vec<Event>, length_beats: f64) {
        self.queue(events, Some(length_beats));
    }

    fn queue(&mut self, events: Vec<Event>, length_beats: Option<f64>) {
        if self.playing {
            self.queued = Some((events, length_beats));
        } else {
            self.apply_queued((events, length_beats));
        }
    }

    fn apply_queued(&mut self, (events, length_beats): (Vec<Event>, Option<f64>)) {
        if let Some(length) = length_beats {
            self.set_pattern_length(length);
        }
        self.replace_events(events);
    }

    pub fn set_events(&mut self, events: Vec<Event>) {
        self.queued = None;
        self.replace_events(events);
    }

    fn replace_events(&mut self, mut events: Vec<Event>) {
        events.truncate(MAX_EVENTS);
        self.pattern.set_events(events);
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
        for bus in &mut self.buses {
            bus[0][..frames].fill(0.0);
            bus[1][..frames].fill(0.0);
        }
        self.pending.clear();
        let mut clicks = [usize::MAX; 8];
        let mut accents = [false; 8];
        if self.playing {
            let beats_per_frame = self.beats_per_second() / self.sample_rate;
            let span = frames as f64 * beats_per_frame;
            let audible_span = match self.play_limit {
                Some(limit) => span.min((limit - self.played).max(0.0)),
                None => span,
            };
            let length = self.pattern.length_beats();
            let head = length - self.beat;
            let wraps = audible_span > head;
            let first_span = if wraps && self.queued.is_some() { head } else { audible_span };
            let pending = &mut self.pending;
            self.pattern.for_each_in_span(self.beat, first_span, |offset, e| {
                if pending.len() < pending.capacity() {
                    pending.push((frame_offset(offset, beats_per_frame, frames), *e));
                }
            });
            let mut carried = None;
            if wraps {
                if let Some(queued) = self.queued.take() {
                    self.apply_queued(queued);
                    carried = Some(span - head);
                    let pending = &mut self.pending;
                    self.pattern.for_each_in_span(0.0, audible_span - head, |offset, e| {
                        if pending.len() < pending.capacity() {
                            pending.push((frame_offset(head + offset, beats_per_frame, frames), *e));
                        }
                    });
                }
            }
            if self.metronome {
                let mut k = self.beat.ceil();
                let mut n = 0;
                while k < self.beat + audible_span && n < clicks.len() {
                    clicks[n] = frame_offset(k - self.beat, beats_per_frame, frames);
                    accents[n] = k.rem_euclid(self.pattern.length_beats()) < 1e-9;
                    k += 1.0;
                    n += 1;
                }
            }
            self.beat = carried.unwrap_or(self.beat + span).rem_euclid(self.pattern.length_beats());
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
                if let Some(n) = clicks.iter().position(|c| *c == at) {
                    clicks[n] = usize::MAX;
                    self.click_accent = accents[n];
                }
                self.click_age = Some(0);
            }
        }
        self.mix_buses(frames);
        self.limit(frames);
    }

    pub fn set_pad_fx(&mut self, pad: usize, settings: FxSettings) {
        if let Some(fx) = self.pad_fx.get_mut(pad) {
            fx.set(settings);
        }
    }

    pub fn set_master_fx(&mut self, settings: FxSettings) {
        self.master_fx.set(settings);
    }

    fn mix_buses(&mut self, frames: usize) {
        for (bus, fx) in self.buses.iter_mut().zip(&mut self.pad_fx) {
            let [l, r] = bus;
            fx.process(&mut l[..frames], &mut r[..frames]);
            for i in 0..frames {
                self.out[0][i] += l[i];
                self.out[1][i] += r[i];
            }
        }
        let [l, r] = &mut self.out;
        self.master_fx.process(&mut l[..frames], &mut r[..frames]);
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
        let group = self.pads[pad].choke;
        let pads = &self.pads;
        let choked = |q: usize| q == pad || (group.is_some() && pads.get(q).is_some_and(|p| p.choke == group));
        for v in self.voices.iter_mut().filter(|v| v.sounding && v.pad.is_some_and(choked)) {
            v.release.get_or_insert(0);
        }
        self.start_voice(voice);
    }

    fn voice_for(&self, pad: usize, velocity: f32, pitch: f64) -> Option<Voice> {
        let p = self.pads.get(pad)?;
        let total = p.pitch + pitch;
        let base = Voice { sounding: true, pad: Some(pad), bus: pad, gain: p.gain * velocity, ..Voice::SILENT };
        if let Some(i) = p.stretched.iter().position(|(k, _)| *k == cents(total)) {
            let len = p.stretched[i].1[0].len() as f64;
            return Some(Voice { source: Source::Stretched(pad, i), pos: 0.0, start: 0.0, end: len, rate: 1.0, ..base });
        }
        let (source, start, end, rate) = match &p.own {
            Some(own) => (Source::Own(pad), 0.0, own[0].len() as f64, semitone_rate(total)),
            None => {
                let range = match self.pad_spans.get(pad)?.clone() {
                    Some(span) => span.start.min(self.sample[0].len())..span.end.min(self.sample[0].len()),
                    None => self.slice(*self.pad_slices.get(pad)?)?,
                };
                (Source::Sample, range.start as f64, range.end as f64, semitone_rate(total) * self.source_rate)
            }
        };
        Some(if p.reverse {
            Voice { source, pos: end - 1.0, start, end, rate: -rate, ..base }
        } else {
            Voice { source, pos: start, start, end, rate, ..base }
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
                Source::Own(p) => match &self.pads[p].own {
                    Some(b) => b,
                    None => {
                        v.sounding = false;
                        continue;
                    }
                },
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
                let bus = &mut self.buses[v.bus];
                bus[0][i] += read(&buf[0], v.pos) * g;
                bus[1][i] += read(&buf[1], v.pos) * g;
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
            let freq = if self.click_accent { 1500.0 } else { 1000.0 };
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

    #[test]
    fn pad_with_a_span_plays_that_range_across_markers() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 300, 600]);
        e.set_pad_span(0, Some(200..700));
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 600);
        assert!((out[150] - src[350]).abs() < 1e-4, "{} vs {}", out[150], src[350]);
        assert!(out[520].abs() < 1e-6);
    }

    #[test]
    fn clearing_a_span_brings_back_the_slice() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_markers(vec![0, 300, 600]);
        e.set_pad_span(1, Some(700..900));
        e.set_pad_span(1, None);
        e.trigger(1, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[320]).abs() < 1e-4);
    }

    #[test]
    fn loading_a_sample_clears_spans() {
        let src = ramp(1000);
        let mut e = engine_with(src.clone());
        e.set_pad_span(0, Some(500..700));
        e.load_sample(src.clone(), src.clone());
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[20]).abs() < 1e-4);
    }

    fn at(beat: f64, pad: u8) -> Event {
        Event { beat, pad, velocity: 1.0, nudge: 0.0, pitch: 0.0 }
    }

    #[test]
    fn queued_events_wait_for_the_loop_to_wrap() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(at(0.0, 0));
        e.set_playing(true);
        render(&mut e, 200);
        e.queue_events(vec![at(0.5, 0)]);
        let out = render(&mut e, 1400);
        let heard: Vec<usize> = [300, 800, 1300].iter().filter_map(|&from| first_sound(&out[from..from + 100]).map(|i| i + from)).collect();
        assert_eq!(heard, vec![1300]);
    }

    #[test]
    fn a_queued_pattern_brings_its_own_length() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_playing(true);
        render(&mut e, 200);
        e.queue_pattern(vec![at(1.5, 0)], 2.0);
        let out = render(&mut e, 2400);
        assert_eq!(first_sound(&out), Some(2300));
    }

    #[test]
    fn the_beat_carries_on_into_a_longer_queued_pattern() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_playing(true);
        render(&mut e, 200);
        e.queue_pattern(vec![], 4.0);
        render(&mut e, 2000);
        assert!((e.beat() - 1.2).abs() < 0.01);
    }

    #[test]
    fn a_long_song_plays_its_last_event() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_pattern_length(10_000.0);
        let mut events: Vec<Event> = (0..9_999).map(|i| Event { velocity: 0.0, ..at(i as f64, 1) }).collect();
        events.push(at(9_999.5, 0));
        e.set_events(events);
        assert!(e.pattern.events().iter().any(|ev| ev.beat == 9_999.5));
    }

    #[test]
    fn queued_events_apply_at_once_when_stopped() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.queue_events(vec![at(0.5, 0)]);
        e.set_playing(true);
        assert_eq!(first_sound(&render(&mut e, 1000)), Some(500));
    }

    #[test]
    fn queued_events_replace_the_old_pattern() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.add_event(at(0.25, 0));
        e.set_playing(true);
        render(&mut e, 400);
        e.queue_events(vec![at(0.5, 0)]);
        let out = render(&mut e, 1000);
        assert_eq!(first_sound(&out[800..900]), None);
    }

    #[test]
    fn stopping_applies_queued_events() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_playing(true);
        render(&mut e, 200);
        e.queue_events(vec![at(0.5, 0)]);
        e.set_playing(false);
        e.set_playing(true);
        assert_eq!(first_sound(&render(&mut e, 1000)), Some(500));
    }

    #[test]
    fn a_pad_cuts_off_other_pads_in_its_choke_group() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 500]);
        e.set_choke_group(0, Some(1));
        e.set_choke_group(1, Some(1));
        e.trigger(1, 1.0, 0.0);
        render(&mut e, 20);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[30] - 0.5).abs() < 1e-4, "{}", out[30]);
    }

    #[test]
    fn pads_outside_the_group_keep_ringing() {
        let mut e = engine_with(vec![0.5; 1000]);
        e.set_markers(vec![0, 500]);
        e.set_choke_group(0, Some(1));
        e.trigger(1, 1.0, 0.0);
        render(&mut e, 20);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[30] - 1.0).abs() < 0.2, "{}", out[30]);
    }

    #[test]
    fn loading_a_sample_forgets_stretched_buffers() {
        let src = ramp(1000);
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_stretched(0, 0.0, Some([vec![0.9; 800], vec![0.9; 800]]));
        e.load_sample(src.clone(), src.clone());
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - src[20]).abs() < 1e-4, "{}", out[20]);
    }

    #[test]
    fn clearing_events_drops_a_queued_pattern() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_playing(true);
        render(&mut e, 200);
        e.queue_events(vec![at(0.5, 0)]);
        e.clear_events();
        e.add_event(at(0.25, 0));
        let out = render(&mut e, 1400);
        assert_eq!(first_sound(&out[1250..1350]), None);
    }

    #[test]
    fn the_downbeat_click_keeps_one_pitch_across_blocks() {
        let mut e = engine_with(vec![0.0; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(1.0);
        e.set_metronome(true);
        e.set_playing(true);
        render(&mut e, 995);
        let mut out = Vec::new();
        let mut time = 0.0;
        for _ in 0..3 {
            e.process(10, time);
            out.extend_from_slice(&e.output(0)[..10]);
            time += 0.01;
        }
        let first = out.iter().position(|s| s.abs() > 1e-6).unwrap();
        let expected: Vec<f32> = (0..15).map(|age| {
            let t = age as f64 / SR;
            ((2.0 * std::f64::consts::PI * 1500.0 * t).cos() * (-t * 150.0).exp() * 0.3) as f32
        }).collect();
        for (i, want) in expected.iter().enumerate() {
            assert!((out[first + i] - want).abs() < 1e-4, "sample {i}: {} vs {}", out[first + i], want);
        }
    }

    #[test]
    fn replacing_many_events_keeps_them_in_time_order() {
        let mut e = engine_with(vec![0.5; 10]);
        e.set_bpm(60.0);
        e.set_pattern_length(4.0);
        e.set_events((0..8).rev().map(|i| at(i as f64 * 0.5, 0)).collect());
        e.set_playing(true);
        let out = render(&mut e, 4000);
        let onsets: Vec<usize> = (0..8).filter_map(|i| first_sound(&out[i * 500..i * 500 + 50]).map(|o| o + i * 500)).collect();
        assert_eq!(onsets, (0..8).map(|i| i * 500).collect::<Vec<_>>());
    }

    fn engine_44k(sample: Vec<f32>) -> Engine {
        let mut e = Engine::new(44_100.0, 4096);
        e.load_sample(sample.clone(), sample);
        e
    }

    fn render_44k(e: &mut Engine, frames: usize) -> Vec<f32> {
        let mut out = Vec::new();
        let mut time = 0.0;
        let mut left = frames;
        while left > 0 {
            let n = left.min(128);
            e.process(n, time);
            out.extend_from_slice(&e.output(0)[..n]);
            time += n as f64 / 44_100.0;
            left -= n;
        }
        out
    }

    fn low_tone(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (2.0 * std::f32::consts::PI * 40.0 * i as f32 / 44_100.0).sin() * 0.3).collect()
    }

    #[test]
    fn pad_fx_shape_that_pad() {
        let mut e = engine_44k(low_tone(44_100));
        e.set_pad_fx(0, FxSettings { highpass_hz: 800.0, ..Default::default() });
        e.trigger(0, 1.0, 0.0);
        let out = render_44k(&mut e, 22_050);
        assert!(out[11_025..].iter().all(|v| v.abs() < 0.01));
    }

    #[test]
    fn pad_fx_leave_other_pads_alone() {
        let mut e = engine_44k(low_tone(44_100));
        e.set_markers(vec![0, 22_050]);
        e.set_pad_fx(1, FxSettings { highpass_hz: 800.0, ..Default::default() });
        e.trigger(0, 1.0, 0.0);
        let out = render_44k(&mut e, 11_025);
        assert!(out[5_000..].iter().fold(0.0f32, |m, v| m.max(v.abs())) > 0.25);
    }

    #[test]
    fn keyboard_notes_go_through_their_pad_fx() {
        let mut e = engine_44k(low_tone(44_100));
        e.set_pad_fx(0, FxSettings { highpass_hz: 800.0, ..Default::default() });
        e.trigger_note(0, 0.0, 1.0);
        let out = render_44k(&mut e, 22_050);
        assert!(out[11_025..].iter().all(|v| v.abs() < 0.01));
    }

    #[test]
    fn master_maximizer_raises_quiet_mixes_under_its_ceiling() {
        let mut e = engine_44k(low_tone(44_100));
        e.set_master_fx(FxSettings { drive_db: 12.0, ceiling_db: -1.0, ..Default::default() });
        e.trigger(0, 1.0, 0.0);
        let out = render_44k(&mut e, 22_050);
        let peak = out[11_025..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak > 0.5 && peak <= 10f32.powf(-1.0 / 20.0) + 1e-4, "{peak}");
    }

    #[test]
    fn a_pad_with_its_own_sample_plays_it_from_the_start() {
        let own: Vec<f32> = (0..400).map(|i| i as f32 / 1000.0).collect();
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_sample(0, Some([own.clone(), own.clone()]));
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - own[20]).abs() < 1e-4, "{}", out[20]);
    }

    #[test]
    fn a_pad_sample_follows_the_pad_pitch() {
        let own: Vec<f32> = (0..400).map(|i| i as f32 / 1000.0).collect();
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_sample(0, Some([own.clone(), own.clone()]));
        e.set_pad(0, 12.0, 1.0, false);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - own[40]).abs() < 1e-4);
    }

    #[test]
    fn a_pad_sample_ignores_the_source_speed() {
        let own: Vec<f32> = (0..400).map(|i| i as f32 / 1000.0).collect();
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_sample(0, Some([own.clone(), own.clone()]));
        e.set_source_rate(2.0);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - own[20]).abs() < 1e-4);
    }

    #[test]
    fn pad_samples_survive_loading_a_new_source() {
        let own = vec![0.2; 400];
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_sample(0, Some([own.clone(), own.clone()]));
        e.load_sample(vec![0.7; 1000], vec![0.7; 1000]);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.2).abs() < 1e-4);
    }

    #[test]
    fn clearing_a_pad_sample_returns_to_the_slice() {
        let mut e = engine_with(vec![0.9; 1000]);
        e.set_pad_sample(0, Some([vec![0.2; 400], vec![0.2; 400]]));
        e.set_pad_sample(0, None);
        e.trigger(0, 1.0, 0.0);
        let out = render(&mut e, 50);
        assert!((out[20] - 0.8).abs() < 0.11, "{}", out[20]);
    }
}
