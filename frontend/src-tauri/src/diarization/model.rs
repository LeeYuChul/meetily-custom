//! Speaker embedding model management (download + cached session).

use super::embedder::SpeakerEmbedder;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

/// A stalled connection fails instead of hanging the import forever
const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

const MODEL_FILE: &str = "3dspeaker_campplus_sv_zh_en_16k_advanced.onnx";
const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
pub const MODEL_SIZE_BYTES: u64 = 28_281_164;

/// Loaded once and reused across diarization runs
pub static EMBEDDER: Mutex<Option<SpeakerEmbedder>> = Mutex::new(None);

pub fn model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Failed to resolve app data dir: {}", e))?
        .join("models")
        .join("diarization");
    Ok(dir.join(MODEL_FILE))
}

pub fn is_model_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    model_path(app)
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map_or(false, |m| m.len() == MODEL_SIZE_BYTES)
}

/// Download the model if missing. `progress` receives 0..=100; `is_cancelled` aborts the download.
pub async fn ensure_model<R: Runtime>(
    app: &AppHandle<R>,
    progress: impl Fn(u32) + Send,
    is_cancelled: impl Fn() -> bool + Send,
) -> Result<PathBuf> {
    let path = model_path(app)?;
    if is_model_available(app) {
        return Ok(path);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    log::info!("Downloading speaker embedding model to {}", path.display());
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()?
        .get(MODEL_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| anyhow!("Failed to download speaker model: {}", e))?;

    let part_path = path.with_extension("onnx.part");
    let mut file = std::fs::File::create(&part_path)?;
    let mut downloaded: u64 = 0;
    let mut last_reported = u32::MAX;
    let mut stream = response.bytes_stream();
    loop {
        if is_cancelled() {
            drop(file);
            let _ = std::fs::remove_file(&part_path);
            return Err(anyhow!("Speaker model download cancelled"));
        }
        let next = tokio::time::timeout(CHUNK_TIMEOUT, stream.next())
            .await
            .map_err(|_| anyhow!("Speaker model download stalled"))?;
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| anyhow!("Speaker model download interrupted: {}", e))?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let pct = ((downloaded * 100) / MODEL_SIZE_BYTES).min(100) as u32;
        if pct != last_reported {
            last_reported = pct;
            progress(pct);
        }
    }
    file.flush()?;
    drop(file);

    if downloaded != MODEL_SIZE_BYTES {
        let _ = std::fs::remove_file(&part_path);
        return Err(anyhow!(
            "Speaker model download incomplete ({} of {} bytes)",
            downloaded,
            MODEL_SIZE_BYTES
        ));
    }
    std::fs::rename(&part_path, &path)?;
    Ok(path)
}

/// Run `f` with the cached embedder, loading it on first use.
pub fn with_embedder<T>(
    model_path: &std::path::Path,
    f: impl FnOnce(&mut SpeakerEmbedder) -> Result<T>,
) -> Result<T> {
    let mut guard = EMBEDDER.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(SpeakerEmbedder::load(model_path)?);
    }
    f(guard.as_mut().unwrap())
}
