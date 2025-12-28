//! Backend SQLite database handlers for persisting documents.

use std::str::FromStr;

use anyhow::{bail, Result};
use serde::Serialize;
use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, SqlitePool};

/// Represents a document persisted in database storage.
#[derive(sqlx::FromRow, PartialEq, Eq, Clone, Debug)]
pub struct PersistedDocument {
    /// Text content of the document.
    pub text: String,
    /// Language of the document for editor syntax highlighting.
    pub language: Option<String>,
}

/// Lightweight document metadata for listing
#[derive(sqlx::FromRow, Serialize, Clone, Debug)]
pub struct DocumentMeta {
    /// Unique document identifier.
    pub id: String,
    /// Optional document name.
    pub name: Option<String>,
    /// Language of the document for editor syntax highlighting.
    pub language: Option<String>,
    /// Timestamp when the document was created.
    pub created_at: i64,
    /// Timestamp when the document was last updated.
    pub updated_at: i64,
}

/// A driver for database operations wrapping a pool connection.
#[derive(Clone, Debug)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Construct a new database from Postgres connection URI.
    pub async fn new(uri: &str) -> Result<Self> {
        {
            // Create database file if missing, and run migrations.
            let mut conn = SqliteConnectOptions::from_str(uri)?
                .create_if_missing(true)
                .connect()
                .await?;
            sqlx::migrate!().run(&mut conn).await?;
        }
        Ok(Database {
            pool: SqlitePool::connect(uri).await?,
        })
    }

    /// Load the text of a document from the database.
    pub async fn load(&self, document_id: &str) -> Result<PersistedDocument> {
        sqlx::query_as(r#"SELECT text, language FROM document WHERE id = $1"#)
            .bind(document_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.into())
    }

    /// Store the text of a document in the database.
    pub async fn store(&self, document_id: &str, document: &PersistedDocument) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query(
            r#"
INSERT INTO
    document (id, text, language, created_at, updated_at)
VALUES
    ($1, $2, $3, $4, $4)
ON CONFLICT(id) DO UPDATE SET
    text = excluded.text,
    language = excluded.language,
    updated_at = excluded.updated_at"#,
        )
        .bind(document_id)
        .bind(&document.text)
        .bind(&document.language)
        .bind(now)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            bail!(
                "expected store() to receive 1 row affected, but it affected {} rows instead",
                result.rows_affected(),
            );
        }
        Ok(())
    }

    /// Count the number of documents in the database.
    pub async fn count(&self) -> Result<usize> {
        let row: (i64,) = sqlx::query_as("SELECT count(*) FROM document")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0 as usize)
    }

    /// List all non-deleted documents
    pub async fn list(&self) -> Result<Vec<DocumentMeta>> {
        sqlx::query_as(
            r#"SELECT id, name, language, created_at, updated_at
               FROM document
               WHERE deleted_at IS NULL
               ORDER BY updated_at DESC"#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.into())
    }

    /// Create a new document
    pub async fn create(&self, id: &str, name: Option<&str>) -> Result<DocumentMeta> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        sqlx::query(
            r#"INSERT INTO document (id, text, name, created_at, updated_at)
               VALUES ($1, '', $2, $3, $3)"#
        )
        .bind(id)
        .bind(name)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(DocumentMeta {
            id: id.to_string(),
            name: name.map(String::from),
            language: None,
            created_at: now,
            updated_at: now,
        })
    }

    /// Get document metadata by ID
    pub async fn get_meta(&self, id: &str) -> Result<Option<DocumentMeta>> {
        sqlx::query_as(
            r#"SELECT id, name, language, created_at, updated_at
               FROM document WHERE id = $1 AND deleted_at IS NULL"#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.into())
    }

    /// Rename a document
    pub async fn rename(&self, id: &str, name: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query(
            r#"UPDATE document SET name = $2, updated_at = $3
               WHERE id = $1 AND deleted_at IS NULL"#
        )
        .bind(id)
        .bind(name)
        .bind(now)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            bail!("Document not found: {}", id);
        }
        Ok(())
    }

    /// Soft delete a document
    pub async fn soft_delete(&self, id: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query(
            r#"UPDATE document SET deleted_at = $2
               WHERE id = $1 AND deleted_at IS NULL"#
        )
        .bind(id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            bail!("Document not found or already deleted: {}", id);
        }
        Ok(())
    }

    /// Soft delete all non-deleted documents
    pub async fn delete_all_documents(&self) -> Result<u64> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query(
            r#"UPDATE document SET deleted_at = $1
               WHERE deleted_at IS NULL"#
        )
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Load all user color preferences
    pub async fn load_user_colors(&self) -> Result<Vec<(String, u32)>> {
        let rows: Vec<(String, i64)> = sqlx::query_as(
            r#"SELECT email, hue FROM user_color"#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|(email, hue)| (email, hue as u32)).collect())
    }

    /// Save a user's color preference
    pub async fn save_user_color(&self, email: &str, hue: u32) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        sqlx::query(
            r#"INSERT INTO user_color (email, hue, updated_at)
               VALUES ($1, $2, $3)
               ON CONFLICT(email) DO UPDATE SET
                   hue = excluded.hue,
                   updated_at = excluded.updated_at"#
        )
        .bind(email)
        .bind(hue as i64)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
