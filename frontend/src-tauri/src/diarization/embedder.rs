//! Speaker embedding extraction with the 3D-Speaker CAM++ ONNX model.

use super::fbank::{FbankExtractor, NUM_MEL_BINS};
use anyhow::{anyhow, Result};
use ndarray::Array3;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;
use std::path::Path;

pub struct SpeakerEmbedder {
    session: Session,
    fbank: FbankExtractor,
}

impl SpeakerEmbedder {
    pub fn load(model_path: &Path) -> Result<Self> {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().min(8))
            .unwrap_or(4);
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(threads)?
            .commit_from_file(model_path)?;
        log::info!(
            "Loaded speaker embedding model from {} ({} threads)",
            model_path.display(),
            threads
        );
        Ok(Self {
            session,
            fbank: FbankExtractor::new(),
        })
    }

    /// Embed a batch of equal-length audio chunks (16kHz mono).
    /// Returns L2-normalized embeddings, one per chunk.
    pub fn embed_batch(&mut self, chunks: &[&[f32]]) -> Result<Vec<Vec<f32>>> {
        if chunks.is_empty() {
            return Ok(Vec::new());
        }
        let num_frames = FbankExtractor::num_frames(chunks[0].len());
        if num_frames == 0 || chunks.iter().any(|c| FbankExtractor::num_frames(c.len()) != num_frames) {
            return Err(anyhow!("embed_batch requires equal-length chunks of at least 25ms"));
        }

        let mut input = Array3::<f32>::zeros((chunks.len(), num_frames, NUM_MEL_BINS));
        for (b, chunk) in chunks.iter().enumerate() {
            let feats = self.fbank.compute(chunk);
            input
                .slice_mut(ndarray::s![b, .., ..])
                .as_slice_mut()
                .ok_or_else(|| anyhow!("non-contiguous feature buffer"))?
                .copy_from_slice(&feats);
        }

        let outputs = self
            .session
            .run(inputs!["x" => TensorRef::from_array_view(input.view().into_dyn())?])?;
        let embeddings = outputs
            .get("embedding")
            .ok_or_else(|| anyhow!("speaker model has no 'embedding' output"))?
            .try_extract_array::<f32>()?;

        let dim = embeddings.shape().last().copied().unwrap_or(0);
        let flat: Vec<f32> = embeddings.iter().copied().collect();
        Ok(flat
            .chunks(dim)
            .map(|e| {
                let norm = e.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
                e.iter().map(|v| v / norm).collect()
            })
            .collect())
    }
}
