//! Tauri commands for speaker diarization, speaker renaming, audio playback
//! and transcript export.

use super::{dominant_speaker, model, relabel_by_appearance, run_diarization, speaker_label};
use crate::audio::decoder::decode_audio_file;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

static DIARIZATION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
/// Serializes playback transcodes so two requests never write the same temp file
static TRANSCODE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Formats the webview's <audio> element can play directly
const PLAYABLE_EXTENSIONS: &[&str] = &["mp3", "m4a", "mp4", "aac", "wav", "ogg", "oga", "opus", "webm", "flac"];

#[derive(Debug, Serialize)]
pub struct DiarizationModelStatus {
    pub available: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct DiarizeMeetingResult {
    pub speakers: usize,
    pub updated: usize,
}

async fn meeting_folder(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<Option<PathBuf>, String> {
    let folder: Option<Option<String>> =
        sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to load meeting: {}", e))?;
    Ok(folder.flatten().filter(|f| !f.is_empty()).map(PathBuf::from))
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, meeting_id: &str, progress: u32, message: &str) {
    let _ = app.emit(
        "diarization-progress",
        serde_json::json!({ "meeting_id": meeting_id, "progress": progress, "message": message }),
    );
}

#[tauri::command]
pub async fn diarization_model_status<R: Runtime>(app: AppHandle<R>) -> DiarizationModelStatus {
    DiarizationModelStatus {
        available: model::is_model_available(&app),
        size_bytes: model::MODEL_SIZE_BYTES,
    }
}

/// Re-run speaker detection on an existing meeting without re-transcribing.
/// Each transcript segment gets the speaker that dominates its time span.
#[tauri::command]
pub async fn diarize_meeting<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    num_speakers: Option<usize>,
) -> Result<DiarizeMeetingResult, String> {
    if DIARIZATION_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("Speaker detection is already running".to_string());
    }
    let result = diarize_meeting_inner(&app, state.db_manager.pool(), &meeting_id, num_speakers).await;
    DIARIZATION_IN_PROGRESS.store(false, Ordering::SeqCst);
    result
}

async fn diarize_meeting_inner<R: Runtime>(
    app: &AppHandle<R>,
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    num_speakers: Option<usize>,
) -> Result<DiarizeMeetingResult, String> {
    let folder = meeting_folder(pool, meeting_id)
        .await?
        .ok_or("This meeting has no audio folder")?;
    let audio_path = crate::audio::retranscription::find_audio_file(&folder).map_err(|e| e.to_string())?;

    let rows: Vec<(String, Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT id, audio_start_time, audio_end_time FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))?;
    let timed: Vec<(String, f64, f64)> = rows
        .into_iter()
        .filter_map(|(id, s, e)| Some((id, s?, e?)))
        .filter(|(_, s, e)| e > s)
        .collect();
    if timed.is_empty() {
        return Err("No timed transcript segments to analyze".to_string());
    }

    emit_progress(app, meeting_id, 2, "Decoding audio...");
    let audio = tokio::task::spawn_blocking(move || decode_audio_file(&audio_path).map(|d| d.to_whisper_format()))
        .await
        .map_err(|e| format!("Decode task failed: {}", e))?
        .map_err(|e| format!("Failed to decode audio: {}", e))?;

    let regions: Vec<(f64, f64)> = timed.iter().map(|(_, s, e)| (*s, *e)).collect();
    let progress_app = app.clone();
    let progress_id = meeting_id.to_string();
    let turns = run_diarization(
        app,
        Arc::new(audio),
        regions,
        num_speakers,
        Arc::new(move |p, msg| emit_progress(&progress_app, &progress_id, 5 + p * 9 / 10, msg)),
        Arc::new(|| false),
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut labels: Vec<Option<String>> = timed
        .iter()
        .map(|(_, s, e)| dominant_speaker(*s, *e, &turns).map(speaker_label))
        .collect();
    relabel_by_appearance(&mut labels);
    let speakers: std::collections::BTreeSet<_> = labels.iter().flatten().cloned().collect();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for ((id, _, _), label) in timed.iter().zip(&labels) {
        let Some(label) = label else { continue };
        sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ?")
            .bind(label)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to save speaker: {}", e))?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    emit_progress(app, meeting_id, 100, "Done");
    Ok(DiarizeMeetingResult { speakers: speakers.len(), updated: timed.len() })
}

/// Rename a speaker. `scope` is one of:
/// - "this": only this segment
/// - "all": every segment of the same speaker
/// - "after": segments of the same speaker from this one onward
/// - "before": segments of the same speaker up to and including this one
#[tauri::command]
pub async fn rename_speaker(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    transcript_id: String,
    new_name: String,
    scope: String,
) -> Result<u64, String> {
    let name = new_name.trim();
    if name.is_empty() {
        return Err("Speaker name cannot be empty".to_string());
    }
    let pool = state.db_manager.pool();

    let row: Option<(Option<String>, Option<f64>)> = sqlx::query_as(
        "SELECT speaker, audio_start_time FROM transcripts WHERE id = ? AND meeting_id = ?",
    )
    .bind(&transcript_id)
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (old_speaker, start) = row.ok_or("Transcript segment not found")?;
    let start = start.unwrap_or(0.0);

    let query = match scope.as_str() {
        "this" => sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ?")
            .bind(name)
            .bind(&transcript_id),
        "all" => sqlx::query("UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker IS ?")
            .bind(name)
            .bind(&meeting_id)
            .bind(&old_speaker),
        "after" => sqlx::query(
            "UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker IS ? AND COALESCE(audio_start_time, 0) >= ?",
        )
        .bind(name)
        .bind(&meeting_id)
        .bind(&old_speaker)
        .bind(start),
        "before" => sqlx::query(
            "UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker IS ? AND COALESCE(audio_start_time, 0) <= ?",
        )
        .bind(name)
        .bind(&meeting_id)
        .bind(&old_speaker)
        .bind(start),
        other => return Err(format!("Unknown rename scope: {}", other)),
    };

    let result = query.execute(pool).await.map_err(|e| e.to_string())?;
    Ok(result.rows_affected())
}

/// Resolve the meeting's audio file for playback and allow it in the asset protocol.
/// Formats the webview cannot play are transcoded once to `playback.m4a`.
#[tauri::command]
pub async fn get_meeting_audio_path<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<String>, String> {
    let Some(folder) = meeting_folder(state.db_manager.pool(), &meeting_id).await? else {
        return Ok(None);
    };
    let Ok(mut path) = crate::audio::retranscription::find_audio_file(&folder) else {
        return Ok(None);
    };

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !PLAYABLE_EXTENSIONS.contains(&ext.as_str()) {
        path = transcode_for_playback(&path, &folder).await?;
    }

    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| format!("Failed to allow audio file: {}", e))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

async fn transcode_for_playback(source: &Path, folder: &Path) -> Result<PathBuf, String> {
    let _guard = TRANSCODE_LOCK.lock().await;
    let target = folder.join("playback.m4a");
    if target.exists() {
        return Ok(target);
    }
    let ffmpeg = crate::audio::ffmpeg::find_ffmpeg_path().ok_or("FFmpeg not found")?;
    let tmp = folder.join("playback.tmp.m4a");
    let mut cmd = tokio::process::Command::new(ffmpeg);
    cmd.arg("-y").arg("-i").arg(source).args(["-vn", "-c:a", "aac", "-b:a", "128k"]).arg(&tmp);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let status = cmd.status().await.map_err(|e| format!("Failed to run FFmpeg: {}", e))?;
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err("Failed to convert audio for playback".to_string());
    }
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Show a save dialog and write `data` to the chosen file.
/// Returns the saved path, or None if the user cancelled.
#[tauri::command]
pub async fn save_export_file<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let ext = Path::new(&default_name)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "txt".to_string());
    let dialog_app = app.clone();
    let picked = tokio::task::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter(ext.to_uppercase(), &[ext.as_str()])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Save dialog failed: {}", e))?;

    let Some(file_path) = picked else { return Ok(None) };
    let path = file_path
        .into_path()
        .map_err(|e| format!("Invalid save path: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
