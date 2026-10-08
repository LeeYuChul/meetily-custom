//! Kaldi-compatible log-mel filterbank features (80 bins, 25ms/10ms, povey window).
//!
//! Matches `torchaudio.compliance.kaldi.fbank` defaults used to train the 3D-Speaker
//! CAM++ model (snip_edges=true, no dither, preemphasis 0.97, high_freq = Nyquist),
//! followed by per-utterance mean normalization ("global-mean" in the model metadata).

use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub const SAMPLE_RATE: usize = 16000;
pub const NUM_MEL_BINS: usize = 80;
const FRAME_LENGTH: usize = 400; // 25ms
const FRAME_SHIFT: usize = 160; // 10ms
const FFT_SIZE: usize = 512;
const PREEMPHASIS: f32 = 0.97;
const LOW_FREQ: f32 = 20.0;

pub struct FbankExtractor {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    /// Sparse triangular filters: (first fft bin, weights)
    mel_banks: Vec<(usize, Vec<f32>)>,
}

fn mel_scale(freq: f32) -> f32 {
    1127.0 * (1.0 + freq / 700.0).ln()
}

impl FbankExtractor {
    pub fn new() -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);

        let window = (0..FRAME_LENGTH)
            .map(|i| {
                let a = 2.0 * std::f32::consts::PI * i as f32 / (FRAME_LENGTH - 1) as f32;
                (0.5 - 0.5 * a.cos()).powf(0.85)
            })
            .collect();

        let num_fft_bins = FFT_SIZE / 2;
        let bin_width = SAMPLE_RATE as f32 / FFT_SIZE as f32;
        let mel_low = mel_scale(LOW_FREQ);
        let mel_high = mel_scale(SAMPLE_RATE as f32 / 2.0);
        let mel_delta = (mel_high - mel_low) / (NUM_MEL_BINS + 1) as f32;

        let mel_banks = (0..NUM_MEL_BINS)
            .map(|m| {
                let left = mel_low + m as f32 * mel_delta;
                let center = left + mel_delta;
                let right = center + mel_delta;
                let mut first = None;
                let mut weights = Vec::new();
                for bin in 0..num_fft_bins {
                    let mel = mel_scale(bin_width * bin as f32);
                    if mel > left && mel < right {
                        let w = if mel <= center {
                            (mel - left) / (center - left)
                        } else {
                            (right - mel) / (right - center)
                        };
                        first.get_or_insert(bin);
                        weights.push(w);
                    }
                }
                (first.unwrap_or(0), weights)
            })
            .collect();

        Self { fft, window, mel_banks }
    }

    pub fn num_frames(num_samples: usize) -> usize {
        if num_samples < FRAME_LENGTH {
            0
        } else {
            1 + (num_samples - FRAME_LENGTH) / FRAME_SHIFT
        }
    }

    /// Compute mean-normalized fbank features, row-major `[num_frames * NUM_MEL_BINS]`.
    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let num_frames = Self::num_frames(samples.len());
        let mut feats = vec![0.0f32; num_frames * NUM_MEL_BINS];
        let mut frame = vec![0.0f32; FFT_SIZE];
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut power = vec![0.0f32; FFT_SIZE / 2 + 1];

        for f in 0..num_frames {
            let start = f * FRAME_SHIFT;
            // Kaldi operates on int16-range samples
            for i in 0..FRAME_LENGTH {
                frame[i] = samples[start + i] * 32768.0;
            }
            let mean = frame[..FRAME_LENGTH].iter().sum::<f32>() / FRAME_LENGTH as f32;
            for v in &mut frame[..FRAME_LENGTH] {
                *v -= mean;
            }
            for i in (1..FRAME_LENGTH).rev() {
                frame[i] -= PREEMPHASIS * frame[i - 1];
            }
            frame[0] -= PREEMPHASIS * frame[0];
            for i in 0..FRAME_LENGTH {
                frame[i] *= self.window[i];
            }
            for v in &mut frame[FRAME_LENGTH..] {
                *v = 0.0;
            }

            // process_with_scratch clobbers the input buffer, which is refilled next frame
            if self
                .fft
                .process_with_scratch(&mut frame, &mut spectrum, &mut scratch)
                .is_err()
            {
                continue;
            }
            for (p, c) in power.iter_mut().zip(spectrum.iter()) {
                *p = c.re * c.re + c.im * c.im;
            }

            let row = &mut feats[f * NUM_MEL_BINS..(f + 1) * NUM_MEL_BINS];
            for (m, (first, weights)) in self.mel_banks.iter().enumerate() {
                let energy: f32 = weights
                    .iter()
                    .enumerate()
                    .map(|(k, w)| w * power[first + k])
                    .sum();
                row[m] = energy.max(f32::EPSILON).ln();
            }
        }

        // Per-utterance mean normalization
        if num_frames > 0 {
            for m in 0..NUM_MEL_BINS {
                let mean = (0..num_frames)
                    .map(|f| feats[f * NUM_MEL_BINS + m])
                    .sum::<f32>()
                    / num_frames as f32;
                for f in 0..num_frames {
                    feats[f * NUM_MEL_BINS + m] -= mean;
                }
            }
        }

        feats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_count_matches_kaldi_snip_edges() {
        assert_eq!(FbankExtractor::num_frames(399), 0);
        assert_eq!(FbankExtractor::num_frames(400), 1);
        assert_eq!(FbankExtractor::num_frames(16000), 98);
        assert_eq!(FbankExtractor::num_frames(24000), 148);
    }

    #[test]
    fn features_are_mean_normalized_and_finite() {
        let samples: Vec<f32> = (0..16000)
            .map(|i| (i as f32 * 0.05).sin() * 0.3 + ((i * 7919) % 97) as f32 / 970.0)
            .collect();
        let feats = FbankExtractor::new().compute(&samples);
        assert_eq!(feats.len(), 98 * NUM_MEL_BINS);
        assert!(feats.iter().all(|v| v.is_finite()));
        let col0_mean: f32 = (0..98).map(|f| feats[f * NUM_MEL_BINS]).sum::<f32>() / 98.0;
        assert!(col0_mean.abs() < 1e-3);
    }
}
