use sily_core::classify::{classify, Category, Model};
use sily_core::engine::Engine;
use sily_core::features::extract;
use sily_core::sequencer::{Event, Groove};
use sily_core::slicing::onset_markers;
use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};
use std::slice;

static mut ENGINE: Option<Engine> = None;
static mut RESULT_FRAMES: Vec<u32> = Vec::new();
static mut RESULT_AUDIO: [Vec<f32>; 2] = [Vec::new(), Vec::new()];
static mut MODEL: Option<Model> = None;
static mut RESULT_FEATURES: Vec<f32> = Vec::new();
static mut RESULT_CONFIDENCE: f32 = 0.0;

#[allow(static_mut_refs)]
fn engine() -> &'static mut Engine {
    unsafe { ENGINE.as_mut().expect("engine_init first") }
}

unsafe fn floats(ptr: *const f32, len: u32) -> &'static [f32] {
    slice::from_raw_parts(ptr, len as usize)
}

#[no_mangle]
pub extern "C" fn alloc(bytes: u32) -> *mut u8 {
    unsafe { raw_alloc(Layout::from_size_align_unchecked(bytes.max(1) as usize, 8)) }
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, bytes: u32) {
    raw_dealloc(ptr, Layout::from_size_align_unchecked(bytes.max(1) as usize, 8));
}

#[no_mangle]
pub extern "C" fn engine_init(sample_rate: f64, max_block: u32) {
    unsafe { ENGINE = Some(Engine::new(sample_rate, max_block as usize)) }
}

#[no_mangle]
pub unsafe extern "C" fn engine_load(left: *const f32, right: *const f32, frames: u32) {
    engine().load_sample(floats(left, frames).to_vec(), floats(right, frames).to_vec());
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_markers(ptr: *const u32, len: u32) {
    let markers = slice::from_raw_parts(ptr, len as usize).iter().map(|&m| m as usize).collect();
    engine().set_markers(markers);
}

#[no_mangle]
pub extern "C" fn engine_set_pad(pad: u32, pitch: f64, gain: f32, reverse: u32) {
    engine().set_pad(pad as usize, pitch, gain, reverse != 0);
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_pad_stretched(pad: u32, pitch: f64, left: *const f32, right: *const f32, frames: u32) {
    let buffer = (frames > 0).then(|| [floats(left, frames).to_vec(), floats(right, frames).to_vec()]);
    engine().set_pad_stretched(pad as usize, pitch, buffer);
}

#[no_mangle]
pub extern "C" fn engine_clear_pad_stretched(pad: u32) {
    engine().clear_pad_stretched(pad as usize);
}

#[no_mangle]
pub extern "C" fn engine_set_source_rate(rate: f64) {
    engine().set_source_rate(rate);
}

#[no_mangle]
pub extern "C" fn engine_trigger(pad: u32, velocity: f32, pitch: f64) {
    engine().trigger(pad as usize, velocity, pitch);
}

#[no_mangle]
pub extern "C" fn engine_trigger_note(slice: u32, semitones: f64, velocity: f32) {
    engine().trigger_note(slice as usize, semitones, velocity);
}

#[no_mangle]
pub extern "C" fn engine_audition(from_frame: i32) {
    engine().audition((from_frame >= 0).then_some(from_frame as usize));
}

#[no_mangle]
pub extern "C" fn engine_audition_frame() -> i32 {
    engine().audition_frame().map(|f| f as i32).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn engine_set_bpm(bpm: f64) {
    engine().set_bpm(bpm);
}

#[no_mangle]
pub extern "C" fn engine_set_playing(playing: u32) {
    engine().set_playing(playing != 0);
}

#[no_mangle]
pub extern "C" fn engine_set_metronome(on: u32) {
    engine().set_metronome(on != 0);
}

#[no_mangle]
pub extern "C" fn engine_set_pattern_length(beats: f64) {
    engine().set_pattern_length(beats);
}

#[no_mangle]
pub extern "C" fn engine_set_groove(grid: f64, strength: f64, swing: f64) {
    engine().set_groove(Groove { grid, strength, swing });
}

#[no_mangle]
pub extern "C" fn engine_clear_events() {
    engine().clear_events();
}

#[no_mangle]
pub extern "C" fn engine_add_event(beat: f64, pad: u32, velocity: f32, nudge: f64, pitch: f64) {
    engine().add_event(Event { beat, pad: pad as u8, velocity, nudge, pitch });
}

#[no_mangle]
pub extern "C" fn engine_beat() -> f64 {
    engine().beat()
}

#[no_mangle]
pub extern "C" fn engine_beat_at_time(time: f64) -> f64 {
    engine().beat_at_time(time)
}

#[no_mangle]
pub extern "C" fn engine_process(frames: u32, time: f64) {
    engine().process(frames as usize, time);
}

#[no_mangle]
pub extern "C" fn engine_output(channel: u32) -> *const f32 {
    engine().output(channel as usize).as_ptr()
}

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn analyze_onsets(mono: *const f32, frames: u32, sample_rate: u32, sensitivity: f32) -> u32 {
    RESULT_FRAMES = onset_markers(floats(mono, frames), sample_rate, sensitivity)
        .into_iter()
        .map(|f| f as u32)
        .collect();
    RESULT_FRAMES.len() as u32
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn result_frames() -> *const u32 {
    unsafe { RESULT_FRAMES.as_ptr() }
}

#[no_mangle]
pub unsafe extern "C" fn analyze_bpm(mono: *const f32, frames: u32, sample_rate: u32) -> f32 {
    stratum_dsp::analyze_audio(floats(mono, frames), sample_rate, Default::default())
        .map(|r| r.bpm)
        .unwrap_or(-1.0)
}

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn pitch_shift(
    left: *const f32,
    right: *const f32,
    frames: u32,
    sample_rate: u32,
    semitones: f64,
) -> u32 {
    let params = timestretch::StretchParams::new(1.0).with_sample_rate(sample_rate).with_channels(1);
    let factor = 2f64.powf(semitones / 12.0);
    for (ch, input) in [left, right].into_iter().enumerate() {
        RESULT_AUDIO[ch] = timestretch::pitch_shift(floats(input, frames), &params, factor).unwrap_or_default();
    }
    RESULT_AUDIO[0].len().min(RESULT_AUDIO[1].len()) as u32
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn result_audio(channel: u32) -> *const f32 {
    unsafe { RESULT_AUDIO[channel as usize].as_ptr() }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn stretch(left: *const f32, right: *const f32, frames: u32, sample_rate: u32, ratio: f64) -> u32 {
    let params = timestretch::StretchParams::new(ratio).with_sample_rate(sample_rate).with_channels(1);
    for (ch, input) in [left, right].into_iter().enumerate() {
        RESULT_AUDIO[ch] = timestretch::stretch(floats(input, frames), &params).unwrap_or_default();
    }
    RESULT_AUDIO[0].len().min(RESULT_AUDIO[1].len()) as u32
}

#[no_mangle]
pub extern "C" fn engine_set_play_limit(beats: f64) {
    engine().set_play_limit((beats >= 0.0).then_some(beats));
}

#[no_mangle]
pub extern "C" fn engine_set_pad_slice(pad: u32, slice: u32) {
    engine().set_pad_slice(pad as usize, slice as usize);
}

const CATEGORIES: [Category; 15] = [
    Category::Kick,
    Category::Snare,
    Category::Clap,
    Category::Rim,
    Category::ClosedHat,
    Category::OpenHat,
    Category::Tom,
    Category::Cymbal,
    Category::Perc,
    Category::Bass,
    Category::Keys,
    Category::Vocal,
    Category::Melody,
    Category::Fx,
    Category::Upper,
];

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn classifier_load(json: *const u8, len: u32) -> u32 {
    let text = std::str::from_utf8(slice::from_raw_parts(json, len as usize)).unwrap_or("null");
    MODEL = serde_json::from_str::<Option<Model>>(text).ok().flatten();
    MODEL.is_some() as u32
}

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn classify_slice(mono: *const f32, frames: u32, sample_rate: u32) -> u32 {
    let features = extract(floats(mono, frames), sample_rate);
    let prediction = classify(&features, MODEL.as_ref());
    RESULT_FEATURES = features.to_vec();
    RESULT_CONFIDENCE = prediction.confidence;
    CATEGORIES.iter().position(|c| *c == prediction.category).unwrap_or(8) as u32
}

#[no_mangle]
pub extern "C" fn result_confidence() -> f32 {
    unsafe { RESULT_CONFIDENCE }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn result_features() -> *const f32 {
    unsafe { RESULT_FEATURES.as_ptr() }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn result_features_len() -> u32 {
    unsafe { RESULT_FEATURES.len() as u32 }
}
