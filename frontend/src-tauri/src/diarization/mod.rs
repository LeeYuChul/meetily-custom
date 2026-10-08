//! Speaker diarization ("who spoke when") for imported meetings.
//!
//! CAM++ speaker embeddings (3D-Speaker, ONNX) over short windows of speech,
//! agglomerative clustering, and conversion to speaker turns that can split or
//! label transcript segments.

pub mod cluster;
pub mod commands;
pub mod embedder;
pub mod fbank;
pub mod model;
pub mod pipeline;

pub use pipeline::{dominant_speaker, split_by_turns, DiarizeOptions, SpeakerTurn};

use anyhow::{anyhow, Result};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

/// Default display name for a detected speaker (0-based index)
pub fn speaker_label(index: usize) -> String {
    format!("참석자 {}", index + 1)
}

/// Renumber default labels by first appearance in transcript order, so the
/// numbering has no gaps after short turns were absorbed into neighbours.
pub fn relabel_by_appearance(labels: &mut [Option<String>]) {
    let mut order: Vec<String> = Vec::new();
    for label in labels.iter().flatten() {
        if !order.contains(label) {
            order.push(label.clone());
        }
    }
    for label in labels.iter_mut().flatten() {
        let index = order.iter().position(|o| o == label).unwrap_or(0);
        *label = speaker_label(index);
    }
}

pub type ProgressFn = Arc<dyn Fn(u32, &str) + Send + Sync>;
pub type CancelFn = Arc<dyn Fn() -> bool + Send + Sync>;

/// Download the model if needed and diarize `regions` of 16kHz mono `audio`.
/// `progress` receives 0..=100 for the whole diarization step.
pub async fn run_diarization<R: Runtime>(
    app: &AppHandle<R>,
    audio: Arc<Vec<f32>>,
    regions: Vec<(f64, f64)>,
    num_speakers: Option<usize>,
    progress: ProgressFn,
    is_cancelled: CancelFn,
) -> Result<Vec<SpeakerTurn>> {
    let download_progress = progress.clone();
    let download_cancelled = is_cancelled.clone();
    let model_path = model::ensure_model(
        app,
        move |pct| download_progress(pct / 5, &format!("Downloading speaker model... {}%", pct)),
        move || download_cancelled(),
    )
    .await?;

    let options = DiarizeOptions {
        num_speakers: num_speakers.filter(|&n| n > 0),
        ..Default::default()
    };
    tokio::task::spawn_blocking(move || {
        model::with_embedder(&model_path, |embedder| {
            pipeline::diarize(&audio, &regions, embedder, &options, |fraction| {
                progress(20 + (fraction * 80.0) as u32, "Identifying speakers...");
                !is_cancelled()
            })
        })
    })
    .await
    .map_err(|e| anyhow!("Diarization task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relabel_numbers_by_first_appearance() {
        let mut labels = vec![
            Some(speaker_label(0)),
            Some(speaker_label(2)),
            None,
            Some(speaker_label(4)),
            Some(speaker_label(2)),
        ];
        relabel_by_appearance(&mut labels);
        assert_eq!(
            labels,
            vec![Some(speaker_label(0)), Some(speaker_label(1)), None, Some(speaker_label(2)), Some(speaker_label(1))]
        );
    }
}
