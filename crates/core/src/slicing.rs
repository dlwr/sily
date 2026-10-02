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
const LEAD: usize = WINDOW / 2;

pub fn onset_markers(mono: &[f32], sample_rate: u32, sensitivity: f32, min_gap_seconds: f32) -> Vec<usize> {
    let flux = band_flux(mono, sample_rate);
    if flux.is_empty() {
        return Vec::new();
    }
    let delta = 0.02 + (1.0 - sensitivity.clamp(0.0, 1.0)) * 0.5;
    let min_gap = ((min_gap_seconds * sample_rate as f32 / HOP as f32).round() as usize).max(1);
    let mut peaks: Vec<usize> = (0..flux.len())
        .filter(|&i| {
            let lo = i.saturating_sub(3);
            let hi = (i + 4).min(flux.len());
            !flux[lo..hi].iter().any(|&f| f > flux[i]) && flux[i] >= local_median(&flux, i, 16) + delta
        })
        .collect();
    peaks.sort_by(|&a, &b| flux[b].total_cmp(&flux[a]).then(a.cmp(&b)));
    let mut kept: Vec<usize> = Vec::new();
    for i in peaks {
        if kept.iter().all(|&k| k.abs_diff(i) >= min_gap) {
            kept.push(i);
        }
    }
    kept.sort_unstable();
    kept.into_iter().map(|i| refine(mono, (i * HOP).saturating_sub(LEAD))).collect()
}

const BAND_EDGES_HZ: [f32; 4] = [0.0, 200.0, 1_000.0, 4_000.0];
const QUIET_BAND: f32 = 0.05;

fn band_flux(mono: &[f32], sample_rate: u32) -> Vec<f32> {
    let bins = WINDOW / 2;
    let hz_per_bin = sample_rate as f32 / WINDOW as f32;
    let mut edges: Vec<usize> = BAND_EDGES_HZ.iter().map(|hz| ((hz / hz_per_bin) as usize).min(bins)).collect();
    edges.push(bins);
    let bands = edges.len() - 1;
    let per_band = spectral_flux(mono, &edges);
    let peaks: Vec<f32> = (0..bands).map(|b| per_band.iter().map(|f| f[b]).fold(0.0, f32::max)).collect();
    let loudest = peaks.iter().cloned().fold(0.0, f32::max);
    if loudest <= 1e-6 {
        return Vec::new();
    }
    per_band
        .iter()
        .map(|frame| {
            (0..bands)
                .filter(|&b| peaks[b] >= loudest * QUIET_BAND)
                .map(|b| frame[b] / peaks[b])
                .fold(0.0, f32::max)
        })
        .collect()
}

fn spectral_flux(mono: &[f32], edges: &[usize]) -> Vec<Vec<f32>> {
    let fft = FftPlanner::<f32>::new().plan_fft_forward(WINDOW);
    let hann: Vec<f32> = (0..WINDOW)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / WINDOW as f32).cos())
        .collect();
    let bins = WINDOW / 2;
    let mut prev = vec![0.0f32; bins];
    let mut buf = vec![Complex::new(0.0f32, 0.0); WINDOW];
    let mut flux = Vec::with_capacity(mono.len() / HOP + 1);
    let mut start = -(LEAD as isize);
    while start < mono.len() as isize {
        for (i, c) in buf.iter_mut().enumerate() {
            let at = start + i as isize;
            let x = if at >= 0 { mono.get(at as usize).copied().unwrap_or(0.0) } else { 0.0 };
            *c = Complex::new(x * hann[i], 0.0);
        }
        fft.process(&mut buf);
        let mags: Vec<f32> = buf[..bins].iter().map(|c| (1.0 + c.norm()).ln()).collect();
        let frame: Vec<f32> = edges
            .windows(2)
            .map(|band| {
                (band[0]..band[1])
                    .map(|k| {
                        let reference = prev[k.saturating_sub(2)..(k + 3).min(bins)].iter().cloned().fold(0.0f32, f32::max);
                        (mags[k] - reference).max(0.0)
                    })
                    .sum()
            })
            .collect();
        prev = mags;
        flux.push(frame);
        start += HOP as isize;
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

    const GAP: f32 = 0.05;

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
        let found = onset_markers(&clicks(sr, &at, 88_200), sr, 0.5, GAP);
        assert_eq!(found.len(), at.len(), "found {found:?}");
        for (f, a) in found.iter().zip(at) {
            assert!(f.abs_diff(a) < 512, "onset {f} too far from {a}");
        }
    }

    #[test]
    fn silence_has_no_onsets() {
        assert!(onset_markers(&vec![0.0; 44_100], 44_100, 0.5, GAP).is_empty());
    }

    #[test]
    fn lower_sensitivity_finds_fewer_onsets() {
        let sr = 44_100;
        let mut s = clicks(sr, &[4_410, 50_000], 88_200);
        for i in 0..2000 {
            s[26_000 + i] += (i as f32 * 0.7).sin() * 0.05 * (-(i as f32) / 300.0).exp();
        }
        let loose = onset_markers(&s, sr, 0.9, GAP).len();
        let strict = onset_markers(&s, sr, 0.1, GAP).len();
        assert!(strict < loose, "strict {strict} loose {loose}");
    }

    #[test]
    fn keeps_the_stronger_of_two_onsets_closer_than_the_minimum_gap() {
        let sr = 44_100;
        let weak: Vec<f32> = clicks(sr, &[20_000], 66_150).iter().map(|x| x * 0.4).collect();
        let mut s = clicks(sr, &[22_646], 66_150);
        for (a, b) in s.iter_mut().zip(weak) {
            *a += b;
        }
        let found = onset_markers(&s, sr, 0.5, 0.1);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].abs_diff(22_646) < 512, "{found:?}");
    }

    #[test]
    fn a_longer_minimum_gap_thins_out_hits_that_come_too_fast() {
        let sr = 44_100;
        let at: Vec<usize> = (0..10).map(|i| 4_000 + i * 3_000).collect();
        let s = clicks(sr, &at, 44_100);
        let fine = onset_markers(&s, sr, 0.5, 0.05).len();
        let coarse = onset_markers(&s, sr, 0.5, 0.1).len();
        assert_eq!(fine, 10);
        assert!(coarse <= 5, "coarse {coarse}");
    }

    fn kicks(at: &[usize], frames: usize) -> Vec<f32> {
        let mut s = vec![0.0f32; frames];
        for &p in at {
            for i in 0..29_000.min(frames - p) {
                let t = i as f32 / 44_100.0;
                let f = 50.0 + 80.0 * (-t * 30.0).exp();
                s[p + i] += (2.0 * std::f32::consts::PI * f * t).sin() * (-t * 8.0).exp() * 0.9;
            }
        }
        s
    }

    #[test]
    fn detects_low_kicks_between_bright_hits() {
        let sr = 44_100;
        let mut s = kicks(&[0, 29_400], 58_800);
        let hats = clicks(sr, &[14_700, 44_100], 58_800);
        for (a, b) in s.iter_mut().zip(hats) {
            *a += b * 0.3;
        }
        let found = onset_markers(&s, sr, 0.5, GAP);
        for want in [0, 14_700, 29_400, 44_100] {
            assert!(found.iter().any(|f| f.abs_diff(want) < 1024), "missing {want} in {found:?}");
        }
    }

    #[test]
    fn falling_kick_pitch_is_not_a_new_onset() {
        let found = onset_markers(&kicks(&[0, 29_400], 58_800), 44_100, 0.5, GAP);
        assert_eq!(found.len(), 2, "{found:?}");
    }

    fn snares(at: &[usize], frames: usize) -> Vec<f32> {
        let mut s = vec![0.0f32; frames];
        let mut seed: u32 = 1;
        for &p in at {
            for i in 0..12_000.min(frames - p) {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
                s[p + i] += noise * (-(i as f32) / 44_100.0 * 18.0).exp() * 0.8;
            }
        }
        s
    }

    #[test]
    fn detects_kicks_next_to_loud_snares() {
        let mut s = kicks(&[0, 29_400], 58_800);
        for (a, b) in s.iter_mut().zip(snares(&[14_700, 44_100], 58_800)) {
            *a += b;
        }
        let found = onset_markers(&s, 44_100, 0.5, GAP);
        for want in [0, 14_700, 29_400, 44_100] {
            assert!(found.iter().any(|f| f.abs_diff(want) < 1024), "missing {want} in {found:?}");
        }
    }
}
