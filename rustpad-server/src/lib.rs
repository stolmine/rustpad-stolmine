//! Server backend for the Rustpad collaborative text editor.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use dashmap::DashMap;
use log::{error, info};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::time::{self, Instant};
use warp::{filters::BoxedFilter, http::StatusCode, ws::Ws, Filter, Rejection, Reply};

use crate::{database::Database, rustpad::Rustpad};

pub mod database;
mod ot;
mod rustpad;

/// An entry stored in the global server map.
///
/// Each entry corresponds to a single document. This is garbage collected by a
/// background task after one day of inactivity, to avoid server memory usage
/// growing without bound.
struct Document {
    last_accessed: Instant,
    rustpad: Arc<Rustpad>,
}

impl Document {
    fn new(rustpad: Arc<Rustpad>) -> Self {
        Self {
            last_accessed: Instant::now(),
            rustpad,
        }
    }
}

impl Drop for Document {
    fn drop(&mut self) {
        self.rustpad.kill();
    }
}

#[allow(dead_code)]
#[derive(Debug)]
struct CustomReject(anyhow::Error);

impl warp::reject::Reject for CustomReject {}

/// The shared state of the server, accessible from within request handlers.
#[derive(Clone)]
struct ServerState {
    /// Concurrent map storing in-memory documents.
    documents: Arc<DashMap<String, Document>>,
    /// Connection to the database pool.
    database: Database,
}

/// Statistics about the server, returned from an API endpoint.
#[derive(Serialize)]
struct Stats {
    /// System time when the server started, in seconds since Unix epoch.
    start_time: u64,
    /// Number of documents currently tracked by the server.
    num_documents: usize,
    /// Number of documents persisted in the database.
    database_size: usize,
}

/// Request body for creating a new document.
#[derive(Deserialize)]
struct CreateDocumentRequest {
    name: Option<String>,
}

/// Request body for renaming a document.
#[derive(Deserialize)]
struct RenameDocumentRequest {
    name: String,
}

/// Server configuration.
#[derive(Clone, Debug)]
pub struct ServerConfig {
    /// Number of days to clean up documents after inactivity.
    pub expiry_days: u32,
    /// Database object for persistence.
    pub database: Database,
}


/// A combined filter handling all server routes.
pub fn server(config: ServerConfig) -> BoxedFilter<(impl Reply,)> {
    warp::path("api")
        .and(backend(config))
        .or(frontend())
        .boxed()
}

/// Construct routes for static files from React.
fn frontend() -> BoxedFilter<(impl Reply,)> {
    warp::fs::dir("dist").boxed()
}

/// Construct backend routes, including WebSocket handlers.
fn backend(config: ServerConfig) -> BoxedFilter<(impl Reply,)> {
    let state = ServerState {
        documents: Default::default(),
        database: config.database,
    };
    tokio::spawn(cleaner(state.clone(), config.expiry_days));

    let state_filter = warp::any().map(move || state.clone());

    let socket = warp::path!("socket" / String)
        .and(warp::ws())
        .and(state_filter.clone())
        .and_then(socket_handler);

    let text = warp::path!("text" / String)
        .and(state_filter.clone())
        .and_then(text_handler);

    let start_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("SystemTime returned before UNIX_EPOCH")
        .as_secs();
    let stats = warp::path!("stats")
        .and(warp::any().map(move || start_time))
        .and(state_filter.clone())
        .and_then(stats_handler);

    let list_docs = warp::path!("documents")
        .and(warp::get())
        .and(state_filter.clone())
        .and_then(list_documents_handler);

    let create_doc = warp::path!("documents")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(create_document_handler);

    let get_doc = warp::path!("documents" / String)
        .and(warp::get())
        .and(state_filter.clone())
        .and_then(get_document_handler);

    let rename_doc = warp::path!("documents" / String)
        .and(warp::patch())
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(rename_document_handler);

    let delete_doc = warp::path!("documents" / String)
        .and(warp::delete())
        .and(state_filter.clone())
        .and_then(delete_document_handler);

    socket.or(text).or(stats).or(list_docs).or(create_doc).or(get_doc).or(rename_doc).or(delete_doc).boxed()
}

/// Handler for the `/api/socket/{id}` endpoint.
async fn socket_handler(id: String, ws: Ws, state: ServerState) -> Result<impl Reply, Rejection> {
    use dashmap::mapref::entry::Entry;

    let mut entry = match state.documents.entry(id.clone()) {
        Entry::Occupied(e) => e.into_ref(),
        Entry::Vacant(e) => {
            let rustpad = Arc::new(
                state.database.load(&id).await.map(Rustpad::from).unwrap_or_default()
            );
            tokio::spawn(persister(id.clone(), Arc::clone(&rustpad), state.database.clone()));
            e.insert(Document::new(rustpad))
        }
    };

    let value = entry.value_mut();
    value.last_accessed = Instant::now();
    let rustpad = Arc::clone(&value.rustpad);
    Ok(ws.on_upgrade(|socket| async move { rustpad.on_connection(socket).await }))
}

/// Handler for the `/api/text/{id}` endpoint.
async fn text_handler(id: String, state: ServerState) -> Result<impl Reply, Rejection> {
    Ok(match state.documents.get(&id) {
        Some(value) => value.rustpad.text(),
        None => {
            state.database.load(&id)
                .await
                .map(|document| document.text)
                .unwrap_or_default()
        }
    })
}

/// Handler for the `/api/stats` endpoint.
async fn stats_handler(start_time: u64, state: ServerState) -> Result<impl Reply, Rejection> {
    let num_documents = state.documents.len();
    let database_size = match state.database.count().await {
        Ok(size) => size,
        Err(e) => return Err(warp::reject::custom(CustomReject(e))),
    };
    Ok(warp::reply::json(&Stats {
        start_time,
        num_documents,
        database_size,
    }))
}

/// Generate a random document ID.
fn generate_document_id() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

/// Handler for the GET `/api/documents` endpoint.
async fn list_documents_handler(state: ServerState) -> Result<impl Reply, Rejection> {
    match state.database.list().await {
        Ok(documents) => Ok(warp::reply::json(&documents)),
        Err(e) => {
            error!("Failed to list documents: {}", e);
            Err(warp::reject::custom(CustomReject(e)))
        }
    }
}

/// Handler for the POST `/api/documents` endpoint.
async fn create_document_handler(
    body: CreateDocumentRequest,
    state: ServerState,
) -> Result<impl Reply, Rejection> {
    let id = generate_document_id();
    match state.database.create(&id, body.name.as_deref()).await {
        Ok(meta) => Ok(warp::reply::with_status(
            warp::reply::json(&meta),
            StatusCode::CREATED,
        )),
        Err(e) => {
            error!("Failed to create document: {}", e);
            Err(warp::reject::custom(CustomReject(e)))
        }
    }
}

/// Handler for the GET `/api/documents/{id}` endpoint.
async fn get_document_handler(id: String, state: ServerState) -> Result<impl Reply, Rejection> {
    match state.database.get_meta(&id).await {
        Ok(Some(meta)) => Ok(warp::reply::json(&meta)),
        Ok(None) => Err(warp::reject::not_found()),
        Err(e) => {
            error!("Failed to get document {}: {}", id, e);
            Err(warp::reject::custom(CustomReject(e)))
        }
    }
}

/// Handler for the PATCH `/api/documents/{id}` endpoint.
async fn rename_document_handler(
    id: String,
    body: RenameDocumentRequest,
    state: ServerState,
) -> Result<impl Reply, Rejection> {
    if let Err(e) = state.database.rename(&id, &body.name).await {
        error!("Failed to rename document {}: {}", id, e);
        return Err(warp::reject::custom(CustomReject(e)));
    }
    match state.database.get_meta(&id).await {
        Ok(Some(meta)) => Ok(warp::reply::json(&meta)),
        Ok(None) => Err(warp::reject::not_found()),
        Err(e) => Err(warp::reject::custom(CustomReject(e)))
    }
}

/// Handler for the DELETE `/api/documents/{id}` endpoint.
async fn delete_document_handler(id: String, state: ServerState) -> Result<impl Reply, Rejection> {
    state.documents.remove(&id);

    match state.database.soft_delete(&id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            error!("Failed to delete document {}: {}", id, e);
            Err(warp::reject::custom(CustomReject(e)))
        }
    }
}

const HOUR: Duration = Duration::from_secs(3600);

/// Reclaims memory for documents.
async fn cleaner(state: ServerState, expiry_days: u32) {
    loop {
        time::sleep(HOUR).await;
        let mut keys = Vec::new();
        for entry in &*state.documents {
            if entry.last_accessed.elapsed() > HOUR * 24 * expiry_days {
                keys.push(entry.key().clone());
            }
        }
        info!("cleaner removing keys: {:?}", keys);
        for key in keys {
            state.documents.remove(&key);
        }
    }
}

const PERSIST_INTERVAL: Duration = Duration::from_secs(3);
const PERSIST_INTERVAL_JITTER: Duration = Duration::from_secs(1);

/// Persists changed documents after a fixed time interval.
async fn persister(id: String, rustpad: Arc<Rustpad>, db: Database) {
    let mut last_revision = 0;
    while !rustpad.killed() {
        let interval = PERSIST_INTERVAL
            + rand::thread_rng().gen_range(Duration::ZERO..=PERSIST_INTERVAL_JITTER);
        time::sleep(interval).await;
        let revision = rustpad.revision();
        if revision > last_revision {
            info!("persisting revision {} for id = {}", revision, id);
            if let Err(e) = db.store(&id, &rustpad.snapshot()).await {
                error!("when persisting document {}: {}", id, e);
            } else {
                last_revision = revision;
            }
        }
    }
}
