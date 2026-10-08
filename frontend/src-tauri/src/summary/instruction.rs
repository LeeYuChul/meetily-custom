//! Global summary instruction ("요약 지침") applied to every summary generation
//! when enabled in Settings > 요약 모델.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const ENABLED_KEY: &str = "summary_instruction_enabled";
const TEXT_KEY: &str = "summary_instruction_text";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SummaryInstruction {
    pub enabled: bool,
    pub text: String,
}

async fn get_pref(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT value FROM app_preferences WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
}

async fn load(pool: &SqlitePool) -> Result<SummaryInstruction, sqlx::Error> {
    Ok(SummaryInstruction {
        enabled: get_pref(pool, ENABLED_KEY).await?.as_deref() == Some("true"),
        text: get_pref(pool, TEXT_KEY).await?.unwrap_or_default(),
    })
}

/// The instruction to apply right now: empty when disabled, blank, or unreadable.
pub async fn load_active_instruction(pool: &SqlitePool) -> String {
    match load(pool).await {
        Ok(i) if i.enabled => i.text.trim().to_string(),
        Ok(_) => String::new(),
        Err(e) => {
            log::warn!("Failed to load summary instruction, generating without it: {}", e);
            String::new()
        }
    }
}

#[tauri::command]
pub async fn summary_instruction_get(state: tauri::State<'_, AppState>) -> Result<SummaryInstruction, String> {
    load(state.db_manager.pool()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn summary_instruction_set(
    state: tauri::State<'_, AppState>,
    enabled: bool,
    text: String,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (key, value) in [(ENABLED_KEY, enabled.to_string()), (TEXT_KEY, text)] {
        sqlx::query(
            "INSERT INTO app_preferences (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}
