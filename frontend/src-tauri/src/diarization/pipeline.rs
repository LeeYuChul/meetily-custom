//! Speaker diarization over speech regions.
//!
//! Speech regions (from VAD or existing transcript segments) are covered with
//! fixed 1.5s windows, each window is embedded and clustered, and window labels
//! are turned into speaker turns by overlap voting at 50ms resolution.

use super::cluster::{cluster_embeddings, DEFAULT_THRESHOLD};
use super::embedder::SpeakerEmbedder;
use super::fbank::{FbankExtractor, SAMPLE_RATE};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::BTreeMap;

const WINDOW_SECS: f64 = 1.5;
const MIN_WINDOW_SECS: f64 = 0.5;
const MIN_HOP_SECS: f64 = 0.75;
const MAX_WINDOWS: usize = 3000;
const BATCH_SIZE: usize = 32;
const VOTE_STEP_SECS: f64 = 0.05;
/// Turns shorter than this are absorbed by a neighbouring turn
pub const MIN_TURN_SECS: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: usize,
}

#[derive(Debug, Clone)]
pub struct DiarizeOptions {
    pub num_speakers: Option<usize>,
    pub threshold: f32,
}

impl Default for DiarizeOptions {
    fn default() -> Self {
        Self { num_speakers: None, threshold: DEFAULT_THRESHOLD }
    }
}

fn plan_windows(regions: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let total: f64 = regions.iter().map(|(s, e)| (e - s).max(0.0)).sum();
    let hop = MIN_HOP_SECS.max(total / MAX_WINDOWS as f64);
    let mut windows = Vec::new();
    for &(s, e) in regions {
        let len = e - s;
        if len < MIN_WINDOW_SECS {
            continue;
        }
        if len <= WINDOW_SECS {
            windows.push((s, e));
            continue;
        }
        let mut t = s;
        while t + WINDOW_SECS <= e + 1e-6 {
            windows.push((t, t + WINDOW_SECS));
            t += hop;
        }
        if windows.last().map_or(true, |w| w.1 < e - 0.2) {
            windows.push((e - WINDOW_SECS, e));
        }
    }
    // Short regions each add a window regardless of hop; subsample evenly so the
    // O(n²) clustering stays bounded. Regions without a window get the nearest label.
    if windows.len() > MAX_WINDOWS {
        let step = windows.len() as f64 / MAX_WINDOWS as f64;
        windows = (0..MAX_WINDOWS).map(|i| windows[(i as f64 * step) as usize]).collect();
    }
    windows
}

/// Run diarization. `progress` receives 0.0..=1.0 and returns false to cancel.
pub fn diarize(
    audio: &[f32],
    regions: &[(f64, f64)],
    embedder: &mut SpeakerEmbedder,
    opts: &DiarizeOptions,
    mut progress: impl FnMut(f32) -> bool,
) -> Result<Vec<SpeakerTurn>> {
    let audio_secs = audio.len() as f64 / SAMPLE_RATE as f64;
    let regions: Vec<(f64, f64)> = regions
        .iter()
        .map(|&(s, e)| (s.max(0.0), e.min(audio_secs)))
        .filter(|(s, e)| e > s)
        .collect();
    let windows = plan_windows(&regions);
    if windows.is_empty() {
        return Ok(Vec::new());
    }

    // Group windows by frame count so each batch has a uniform shape
    let mut by_frames: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new(); // frames -> (window idx, start sample)
    for (i, &(s, e)) in windows.iter().enumerate() {
        let start = (s * SAMPLE_RATE as f64).round() as usize;
        let end = ((e * SAMPLE_RATE as f64).round() as usize).min(audio.len());
        let frames = FbankExtractor::num_frames(end.saturating_sub(start));
        if frames > 0 {
            by_frames.entry(frames).or_default().push((i, start));
        }
    }

    let mut embeddings: Vec<Option<Vec<f32>>> = vec![None; windows.len()];
    let mut done = 0usize;
    for (frames, items) in &by_frames {
        let len = 400 + 160 * (frames - 1);
        for batch in items.chunks(BATCH_SIZE) {
            let chunks: Vec<&[f32]> = batch.iter().map(|&(_, s)| &audio[s..s + len]).collect();
            let embs = embedder.embed_batch(&chunks)?;
            for (&(i, _), e) in batch.iter().zip(embs) {
                embeddings[i] = Some(e);
            }
            done += batch.len();
            if !progress(done as f32 / windows.len() as f32) {
                return Err(anyhow!("Diarization cancelled"));
            }
        }
    }

    let (windows, embeddings): (Vec<(f64, f64)>, Vec<Vec<f32>>) = windows
        .into_iter()
        .zip(embeddings)
        .filter_map(|(w, e)| e.map(|e| (w, e)))
        .unzip();
    let labels = cluster_embeddings(&embeddings, opts.threshold, opts.num_speakers);
    let num_labels = labels.iter().max().map_or(0, |m| m + 1);
    log::info!(
        "Diarization: {} windows over {} regions -> {} speakers",
        windows.len(),
        regions.len(),
        num_labels
    );

    Ok(windows_to_turns(&regions, &windows, &labels, num_labels))
}

fn windows_to_turns(
    regions: &[(f64, f64)],
    windows: &[(f64, f64)],
    labels: &[usize],
    num_labels: usize,
) -> Vec<SpeakerTurn> {
    let to_frame = |t: f64| (t / VOTE_STEP_SECS).floor().max(0.0) as usize;
    let end_frame = regions.iter().map(|r| to_frame(r.1) + 1).max().unwrap_or(0);
    let mut votes = vec![0u16; end_frame * num_labels];
    for (&(s, e), &l) in windows.iter().zip(labels) {
        for f in to_frame(s)..to_frame(e).min(end_frame) {
            votes[f * num_labels + l] = votes[f * num_labels + l].saturating_add(1);
        }
    }

    let nearest_window_label = |t: f64| {
        windows
            .iter()
            .zip(labels)
            .min_by(|a, b| {
                let da = ((a.0 .0 + a.0 .1) / 2.0 - t).abs();
                let db = ((b.0 .0 + b.0 .1) / 2.0 - t).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(_, &l)| l)
            .unwrap_or(0)
    };

    let mut turns: Vec<SpeakerTurn> = Vec::new();
    for &(rs, re) in regions {
        let (f0, f1) = (to_frame(rs), to_frame(re).max(to_frame(rs) + 1).min(end_frame));
        let mut frame_labels: Vec<Option<usize>> = (f0..f1)
            .map(|f| {
                let v = &votes[f * num_labels..(f + 1) * num_labels];
                let (best, &count) = v.iter().enumerate().max_by_key(|(_, c)| **c)?;
                (count > 0).then_some(best)
            })
            .collect();

        if frame_labels.iter().all(Option::is_none) {
            let l = nearest_window_label((rs + re) / 2.0);
            frame_labels.iter_mut().for_each(|x| *x = Some(l));
        } else {
            // Fill unvoted frames from the nearest voted frame
            let known: Vec<(usize, usize)> = frame_labels
                .iter()
                .enumerate()
                .filter_map(|(i, l)| l.map(|l| (i, l)))
                .collect();
            for (i, slot) in frame_labels.iter_mut().enumerate() {
                if slot.is_none() {
                    *slot = known.iter().min_by_key(|(k, _)| k.abs_diff(i)).map(|&(_, l)| l);
                }
            }
        }

        let mut region_turns: Vec<SpeakerTurn> = Vec::new();
        for (i, l) in frame_labels.iter().enumerate() {
            let l = l.unwrap_or(0);
            let t = (f0 + i) as f64 * VOTE_STEP_SECS;
            match region_turns.last_mut() {
                Some(last) if last.speaker == l => last.end = t + VOTE_STEP_SECS,
                _ => region_turns.push(SpeakerTurn { start: t, end: t + VOTE_STEP_SECS, speaker: l }),
            }
        }
        if let Some(first) = region_turns.first_mut() {
            first.start = rs;
        }
        if let Some(last) = region_turns.last_mut() {
            last.end = re;
        }
        absorb_short_turns(&mut region_turns, MIN_TURN_SECS);
        turns.extend(region_turns);
    }

    // Renumber speakers by order of first appearance
    turns.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut order: Vec<usize> = Vec::new();
    for t in &turns {
        if !order.contains(&t.speaker) {
            order.push(t.speaker);
        }
    }
    for t in &mut turns {
        t.speaker = order.iter().position(|&s| s == t.speaker).unwrap();
    }
    turns
}

/// Merge turns shorter than `min_secs` into a neighbour, then coalesce equal neighbours.
fn absorb_short_turns(turns: &mut Vec<SpeakerTurn>, min_secs: f64) {
    loop {
        let shortest = turns
            .iter()
            .enumerate()
            .filter(|(_, t)| t.end - t.start < min_secs)
            .min_by(|a, b| {
                (a.1.end - a.1.start)
                    .partial_cmp(&(b.1.end - b.1.start))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i);
        let Some(i) = shortest else { break };
        if turns.len() < 2 {
            break;
        }
        let prev_len = if i > 0 { turns[i - 1].end - turns[i - 1].start } else { -1.0 };
        let next_len = if i + 1 < turns.len() { turns[i + 1].end - turns[i + 1].start } else { -1.0 };
        let removed = turns.remove(i);
        if prev_len >= next_len {
            turns[i - 1].end = removed.end;
        } else {
            turns[i].start = removed.start;
        }
        // Coalesce neighbours that now share a speaker
        let mut j = 0;
        while j + 1 < turns.len() {
            if turns[j].speaker == turns[j + 1].speaker {
                turns[j].end = turns[j + 1].end;
                turns.remove(j + 1);
            } else {
                j += 1;
            }
        }
    }
}

/// Speaker with the largest overlap in [start, end], or the nearest turn if none overlap.
pub fn dominant_speaker(start: f64, end: f64, turns: &[SpeakerTurn]) -> Option<usize> {
    let mut overlap: BTreeMap<usize, f64> = BTreeMap::new();
    for t in turns {
        let o = end.min(t.end) - start.max(t.start);
        if o > 0.0 {
            *overlap.entry(t.speaker).or_default() += o;
        }
    }
    if let Some((&s, _)) = overlap
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
    {
        return Some(s);
    }
    turns
        .iter()
        .min_by(|a, b| {
            let da = (a.start - end).max(start - a.end).max(0.0);
            let db = (b.start - end).max(start - b.end).max(0.0);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|t| t.speaker)
}

/// Split [start, end] into speaker-homogeneous pieces covering the whole span.
pub fn split_by_turns(start: f64, end: f64, turns: &[SpeakerTurn]) -> Vec<SpeakerTurn> {
    let mut pieces: Vec<SpeakerTurn> = turns
        .iter()
        .filter(|t| t.end > start && t.start < end)
        .map(|t| SpeakerTurn { start: t.start.max(start), end: t.end.min(end), speaker: t.speaker })
        .collect();
    if pieces.is_empty() {
        return dominant_speaker(start, end, turns)
            .map(|speaker| vec![SpeakerTurn { start, end, speaker }])
            .unwrap_or_default();
    }
    pieces[0].start = start;
    let last = pieces.len() - 1;
    pieces[last].end = end;
    for i in 1..pieces.len() {
        pieces[i - 1].end = pieces[i].start; // close gaps between turns
    }
    absorb_short_turns(&mut pieces, MIN_TURN_SECS);
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(start: f64, end: f64, speaker: usize) -> SpeakerTurn {
        SpeakerTurn { start, end, speaker }
    }

    #[test]
    fn window_count_is_capped_for_many_short_regions() {
        let regions: Vec<(f64, f64)> = (0..8000).map(|i| (i as f64 * 2.0, i as f64 * 2.0 + 1.0)).collect();
        assert_eq!(plan_windows(&regions).len(), MAX_WINDOWS);
    }

    #[test]
    fn short_turns_are_absorbed() {
        let mut t = vec![turn(0.0, 3.0, 0), turn(3.0, 3.4, 1), turn(3.4, 6.0, 0)];
        absorb_short_turns(&mut t, 1.0);
        assert_eq!(t, vec![turn(0.0, 6.0, 0)]);
    }

    #[test]
    fn split_covers_span_and_respects_speakers() {
        let turns = vec![turn(0.0, 4.0, 0), turn(4.0, 9.0, 1), turn(12.0, 15.0, 0)];
        let pieces = split_by_turns(1.0, 8.0, &turns);
        assert_eq!(pieces, vec![turn(1.0, 4.0, 0), turn(4.0, 8.0, 1)]);
    }

    #[test]
    fn dominant_speaker_uses_overlap_then_proximity() {
        let turns = vec![turn(0.0, 4.0, 0), turn(4.0, 9.0, 1)];
        assert_eq!(dominant_speaker(3.0, 6.0, &turns), Some(1));
        assert_eq!(dominant_speaker(20.0, 21.0, &turns), Some(1));
    }

    /// End-to-end check against a real model and audio file:
    /// DIAR_TEST_MODEL=<campplus.onnx> DIAR_TEST_WAV=<16k wav> ORT_DYLIB_PATH=<onnxruntime.dll>
    /// DIAR_TEST_REGIONS=<json [[start,end],...]> (optional; defaults to the whole file)
    #[test]
    #[ignore]
    fn diarize_real_audio() {
        let model = std::env::var("DIAR_TEST_MODEL").expect("DIAR_TEST_MODEL");
        let wav = std::env::var("DIAR_TEST_WAV").expect("DIAR_TEST_WAV");
        let audio = crate::audio::decoder::decode_audio_file(std::path::Path::new(&wav))
            .unwrap()
            .to_whisper_format();
        let regions: Vec<(f64, f64)> = match std::env::var("DIAR_TEST_REGIONS") {
            Ok(path) => serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap(),
            Err(_) => vec![(0.0, audio.len() as f64 / 16000.0)],
        };
        let mut embedder = SpeakerEmbedder::load(std::path::Path::new(&model)).unwrap();
        let started = std::time::Instant::now();
        let turns = diarize(&audio, &regions, &mut embedder, &DiarizeOptions::default(), |_| true).unwrap();
        let mut per_speaker: BTreeMap<usize, f64> = BTreeMap::new();
        for t in &turns {
            *per_speaker.entry(t.speaker).or_default() += t.end - t.start;
        }
        println!("{} turns in {:.1}s, speech per speaker: {:?}", turns.len(), started.elapsed().as_secs_f32(), per_speaker);
        for t in turns.iter().take(12) {
            println!("  {:7.2}-{:7.2} speaker {}", t.start, t.end, t.speaker);
        }
    }

    #[test]
    fn windows_to_turns_labels_regions() {
        let regions = vec![(0.0, 3.0), (4.0, 7.0)];
        let windows = vec![(0.0, 1.5), (1.5, 3.0), (4.0, 5.5), (5.5, 7.0)];
        let labels = vec![1, 1, 0, 0];
        let turns = windows_to_turns(&regions, &windows, &labels, 2);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].speaker, 0); // renumbered by first appearance
        assert_eq!(turns[1].speaker, 1);
    }
}
