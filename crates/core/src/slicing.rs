use rustfft::{num_complex::Complex, FftPlanner};
use std::ops::Range;

pub fn slices(markers: &[usize], frames: usize) -> Vec<Range<usize>> {
    if markers.is_empty() {
        return vec![0..frames];
    }
    markers
        .iter()
        .enumerate()
        .map(|(i, &start)| start..markers.get(i + 1).copied().unwrap_or(frames))
        .collect()
}

pub fn insert_marker(markers: &mut Vec<usize>, frame: usize) {
    if let Err(i) = markers.binary_search(&frame) {
        markers.insert(i, frame);
    }
}

pub fn remove_nearest_marker(markers: &mut Vec<usize>, frame: usize, tolerance: usize) -> bool {
    let nearest = markers
        .iter()
        .enumerate()
        .min_by_key(|(_, m)| m.abs_diff(frame))
        .filter(|(_, m)| m.abs_diff(frame) <= tolerance)
        .map(|(i, _)| i);
    match nearest {
        Some(i) => {
            markers.remove(i);
            true
        }
        None => false,
    }
}

pub fn grid_markers(start: usize, end: usize, count: usize) -> Vec<usize> {
    let len = end.saturating_sub(start) as f64;
    (0..count).map(|i| start + (len * i as f64 / count as f64).round() as usize).collect()
}

const WINDOW: usize = 1024;
const HOP: usize = 256;

pub fn onset_markers(mono: &[f32], sample_rate: u32, sensitivity: f32) -> Vec<usize> {
    let flux = spectral_flux(mono);
    let peak = flux.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 1e-6 {
        return Vec::new();
    }
    let flux: Vec<f32> = flux.iter().map(|f| f / peak).collect();
    let delta = 0.02 + (1.0 - sensitivity.clamp(0.0, 1.0)) * 0.5;
    let min_gap = (sample_rate as usize / 20) / HOP;
    let mut found: Vec<usize> = Vec::new();
    let mut last: Option<usize> = None;
    for i in 0..flux.len() {
        let lo = i.saturating_sub(3);
        let hi = (i + 4).min(flux.len());
        if flux[lo..hi].iter().any(|&f| f > flux[i]) {
            continue;
        }
        if flux[i] < local_median(&flux, i, 16) + delta {
            continue;
        }
        if last.is_some_and(|l| i - l < min_gap.max(1)) {
            continue;
        }
        last = Some(i);
        found.push(refine(mono, i * HOP));
    }
    found
}

fn spectral_flux(mono: &[f32]) -> Vec<f32> {
    if mono.len() < WINDOW {
        return Vec::new();
    }
    let fft = FftPlanner::<f32>::new().plan_fft_forward(WINDOW);
    let hann: Vec<f32> = (0..WINDOW)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / WINDOW as f32).cos())
        .collect();
    let mut prev = vec![0.0f32; WINDOW / 2];
    let mut buf = vec![Complex::new(0.0f32, 0.0); WINDOW];
    let mut flux = Vec::with_capacity(mono.len() / HOP);
    let mut pos = 0;
    while pos + WINDOW <= mono.len() {
        for (i, c) in buf.iter_mut().enumerate() {
            *c = Complex::new(mono[pos + i] * hann[i], 0.0);
        }
        fft.process(&mut buf);
        let mut sum = 0.0;
        for (k, p) in prev.iter_mut().enumerate() {
            let mag = (1.0 + buf[k].norm()).ln();
            sum += (mag - *p).max(0.0);
            *p = mag;
        }
        flux.push(sum);
        pos += HOP;
    }
    flux
}

fn local_median(values: &[f32], center: usize, radius: usize) -> f32 {
    let lo = center.saturating_sub(radius);
    let hi = (center + radius + 1).min(values.len());
    let mut window: Vec<f32> = values[lo..hi].to_vec();
    window.sort_by(f32::total_cmp);
    window[window.len() / 2]
}

fn refine(mono: &[f32], window_start: usize) -> usize {
    const BLOCK: usize = 32;
    let end = (window_start + WINDOW).min(mono.len());
    let energies: Vec<f32> = (window_start..end)
        .step_by(BLOCK)
        .map(|b| mono[b..(b + BLOCK).min(end)].iter().map(|x| x * x).sum())
        .collect();
    let loudest = energies.iter().cloned().fold(0.0f32, f32::max);
    let first = energies.iter().position(|&e| e >= loudest * 0.25).unwrap_or(0);
    window_start + first * BLOCK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_markers_means_the_whole_sample_is_one_slice() {
        assert_eq!(slices(&[], 100), vec![0..100]);
    }

    #[test]
    fn each_marker_starts_a_slice_that_runs_to_the_next() {
        assert_eq!(slices(&[10, 40, 70], 100), vec![10..40, 40..70, 70..100]);
    }

    #[test]
    fn inserting_keeps_markers_sorted() {
        let mut m = vec![10, 70];
        insert_marker(&mut m, 40);
        assert_eq!(m, vec![10, 40, 70]);
    }

    #[test]
    fn inserting_a_duplicate_is_ignored() {
        let mut m = vec![10, 40];
        insert_marker(&mut m, 40);
        assert_eq!(m, vec![10, 40]);
    }

    #[test]
    fn removes_the_nearest_marker_within_tolerance() {
        let mut m = vec![10, 40, 70];
        assert!(remove_nearest_marker(&mut m, 43, 5));
        assert_eq!(m, vec![10, 70]);
    }

    #[test]
    fn keeps_markers_outside_tolerance() {
        let mut m = vec![10, 40, 70];
        assert!(!remove_nearest_marker(&mut m, 55, 5));
        assert_eq!(m, vec![10, 40, 70]);
    }

    #[test]
    fn grid_divides_the_range_evenly() {
        assert_eq!(grid_markers(100, 500, 4), vec![100, 200, 300, 400]);
    }

    fn clicks(sample_rate: u32, at: &[usize], frames: usize) -> Vec<f32> {
        let mut s = vec![0.0f32; frames];
        for &p in at {
            for i in 0..2000 {
                let decay = (-(i as f32) / 300.0).exp();
                s[p + i] += (i as f32 * 0.7).sin() * decay;
            }
        }
        let _ = sample_rate;
        s
    }

    #[test]
    fn detects_onsets_of_percussive_hits() {
        let sr = 44_100;
        let at = [4_410, 26_000, 50_000, 71_000];
        let found = onset_markers(&clicks(sr, &at, 88_200), sr, 0.5);
        assert_eq!(found.len(), at.len(), "found {found:?}");
        for (f, a) in found.iter().zip(at) {
            assert!(f.abs_diff(a) < 512, "onset {f} too far from {a}");
        }
    }

    #[test]
    fn silence_has_no_onsets() {
        assert!(onset_markers(&vec![0.0; 44_100], 44_100, 0.5).is_empty());
    }

    #[test]
    fn lower_sensitivity_finds_fewer_onsets() {
        let sr = 44_100;
        let mut s = clicks(sr, &[4_410, 50_000], 88_200);
        for i in 0..2000 {
            s[26_000 + i] += (i as f32 * 0.7).sin() * 0.05 * (-(i as f32) / 300.0).exp();
        }
        let loose = onset_markers(&s, sr, 0.9).len();
        let strict = onset_markers(&s, sr, 0.1).len();
        assert!(strict < loose, "strict {strict} loose {loose}");
    }
}
