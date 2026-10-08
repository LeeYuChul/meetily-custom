//! Folders for organising notes in the sidebar ("전체 노트").
//! A note belongs to at most one folder via `meetings.note_folder_id`.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub sort_order: i64,
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    Ok(name.chars().take(100).collect())
}

#[tauri::command]
pub async fn note_folders_list(state: tauri::State<'_, AppState>) -> Result<Vec<NoteFolder>, String> {
    sqlx::query_as::<_, NoteFolder>(
        "SELECT id, name, created_at, sort_order FROM note_folders ORDER BY sort_order, created_at",
    )
    .fetch_all(state.db_manager.pool())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn note_folder_create(state: tauri::State<'_, AppState>, name: String) -> Result<NoteFolder, String> {
    let pool = state.db_manager.pool();
    let next_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM note_folders")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let folder = NoteFolder {
        id: format!("folder-{}", Uuid::new_v4()),
        name: clean_name(&name)?,
        created_at: chrono::Utc::now().to_rfc3339(),
        sort_order: next_order,
    };
    sqlx::query("INSERT INTO note_folders (id, name, created_at, sort_order) VALUES (?, ?, ?, ?)")
        .bind(&folder.id)
        .bind(&folder.name)
        .bind(&folder.created_at)
        .bind(folder.sort_order)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(folder)
}

#[tauri::command]
pub async fn note_folder_rename(state: tauri::State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    let result = sqlx::query("UPDATE note_folders SET name = ? WHERE id = ?")
        .bind(clean_name(&name)?)
        .bind(&id)
        .execute(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Folder not found".to_string());
    }
    Ok(())
}

/// Delete a folder; its notes are kept and moved out of the folder.
#[tauri::command]
pub async fn note_folder_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE meetings SET note_folder_id = NULL WHERE note_folder_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM note_folders WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// Move a note into `folder_id`, or out of any folder when `folder_id` is None.
#[tauri::command]
pub async fn note_move_to_folder(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    if let Some(folder_id) = &folder_id {
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM note_folders WHERE id = ?")
            .bind(folder_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("Folder not found".to_string());
        }
    }
    sqlx::query("UPDATE meetings SET note_folder_id = ? WHERE id = ?")
        .bind(&folder_id)
        .bind(&meeting_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
