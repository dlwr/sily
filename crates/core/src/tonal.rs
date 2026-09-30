use rustfft::{num_complex::Complex, FftPlanner};

const FFT: usize = 8192;
const HOP: usize = 4096;
const MAX_SECONDS: f32 = 60.0;
const LOWEST_HZ: f32 = 50.0;
const HIGHEST_HZ: f32 = 4_000.0;

pub fn chroma(mono: &[f32], sample_rate: u32) -> [f32; 12] {
    let sr = sample_rate as f32;
    let limit = mono.len().min((sr * MAX_SECONDS) as usize);
    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT);
    let hann: Vec<f32> = (0..FFT).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT as f32).cos()).collect();
    let classes: Vec<Option<usize>> = (0..FFT / 2)
        .map(|k| {
            let hz = k as f32 * sr / FFT as f32;
            (LOWEST_HZ..HIGHEST_HZ).contains(&hz).then(|| {
                let midi = 69.0 + 12.0 * (hz / 440.0).log2();
                (midi.round() as i64).rem_euclid(12) as usize
            })
        })
        .collect();
    let mut sums = [0.0f32; 12];
    let mut buf = vec![Complex::new(0.0f32, 0.0); FFT];
    let mut start = 0;
    loop {
        for (i, c) in buf.iter_mut().enumerate() {
            *c = Complex::new(mono.get(start + i).filter(|_| start + i < limit).copied().unwrap_or(0.0) * hann[i], 0.0);
        }
        fft.process(&mut buf);
        for (k, class) in classes.iter().enumerate() {
            if let Some(c) = class {
                sums[*c] += buf[k].norm();
            }
        }
        start += HOP;
        if start + FFT > limit {
            break;
        }
    }
    let total: f32 = sums.iter().sum();
    if total <= 1e-9 {
        return [1.0 / 12.0; 12];
    }
    sums.map(|v| v / total)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44_100;

    fn tones(freqs: &[f32], seconds: f32) -> Vec<f32> {
        (0..(SR as f32 * seconds) as usize)
            .map(|i| freqs.iter().map(|f| (2.0 * std::f32::consts::PI * f * i as f32 / SR as f32).sin()).sum::<f32>() * 0.2)
            .collect()
    }

    fn loudest(c: [f32; 12]) -> usize {
        c.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0
    }

    #[test]
    fn a440_lands_on_a() {
        assert_eq!(loudest(chroma(&tones(&[440.0], 1.0), SR)), 9);
    }

    #[test]
    fn octaves_fold_into_the_same_class() {
        assert_eq!(loudest(chroma(&tones(&[65.41], 1.0), SR)), 0);
    }

    #[test]
    fn a_chord_lights_up_its_notes() {
        let c = chroma(&tones(&[261.63, 329.63, 392.0], 1.0), SR);
        let mut top: Vec<usize> = (0..12).collect();
        top.sort_by(|a, b| c[*b].total_cmp(&c[*a]));
        let mut three = top[..3].to_vec();
        three.sort();
        assert_eq!(three, vec![0, 4, 7]);
    }

    #[test]
    fn chroma_sums_to_one() {
        let c = chroma(&tones(&[440.0, 523.25], 1.0), SR);
        assert!((c.iter().sum::<f32>() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn silence_is_flat_and_finite() {
        assert!(chroma(&vec![0.0; 44_100], SR).iter().all(|v| v.is_finite()));
    }
}
