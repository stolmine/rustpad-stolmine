//! Eventually consistent server-side logic for Rustpad.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use anyhow::{bail, Context, Result};
use futures::prelude::*;
use log::{info, warn};
use operational_transform::OperationSeq;
use parking_lot::{RwLock, RwLockUpgradableReadGuard};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Notify};
use warp::ws::{Message, WebSocket};

use crate::{database::{Database, PersistedDocument}, ot::transform_index};

/// The main object representing a collaborative session.
pub struct Rustpad {
    /// State modified by critical sections of the code.
    state: RwLock<State>,
    /// Incremented to obtain unique user IDs.
    count: AtomicU64,
    /// Used to notify clients of new text operations.
    notify: Notify,
    /// Used to inform all clients of metadata updates.
    update: broadcast::Sender<ServerMsg>,
    /// Set to true when the document is destroyed.
    killed: AtomicBool,
    /// Database for persisting user colors.
    database: Option<Database>,
}

/// Shared state involving multiple users, protected by a lock.
#[derive(Default)]
struct State {
    operations: Vec<UserOperation>,
    text: String,
    language: Option<String>,
    users: HashMap<u64, UserInfo>,
    cursors: HashMap<u64, CursorData>,
    /// Color preferences by email (for authenticated users).
    user_colors: HashMap<String, u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UserOperation {
    id: u64,
    operation: OperationSeq,
    /// The authenticated email of the user who made this edit (for persistent ownership).
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UserInfo {
    name: String,
    hue: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CursorData {
    cursors: Vec<u32>,
    selections: Vec<(u32, u32)>,
}

/// A message received from the client over WebSocket.
#[derive(Clone, Debug, Serialize, Deserialize)]
enum ClientMsg {
    /// Represents a sequence of local edits from the user.
    Edit {
        revision: usize,
        operation: OperationSeq,
    },
    /// Sets the language of the editor.
    SetLanguage(String),
    /// Sets the user's current information.
    ClientInfo(UserInfo),
    /// Sets the user's cursor and selection positions.
    CursorData(CursorData),
    /// Sets the authenticated user's color preference.
    SetColor(u32),
}

/// A message sent to the client over WebSocket.
#[derive(Clone, Debug, Serialize, Deserialize)]
enum ServerMsg {
    /// Informs the client of their unique socket ID.
    Identity(u64),
    /// Informs the client of their authenticated email (from Cloudflare Access).
    AuthenticatedEmail(Option<String>),
    /// Broadcasts text operations to all clients.
    History {
        start: usize,
        operations: Vec<UserOperation>,
    },
    /// Broadcasts the current language, last writer wins.
    Language(String),
    /// Broadcasts a user's information, or `None` on disconnect.
    UserInfo { id: u64, info: Option<UserInfo> },
    /// Broadcasts a user's cursor position.
    UserCursor { id: u64, data: CursorData },
    /// Broadcasts an authenticated user's color preference.
    UserColor { email: String, hue: u32 },
}

impl From<ServerMsg> for Message {
    fn from(msg: ServerMsg) -> Self {
        let serialized = serde_json::to_string(&msg).expect("failed serialize");
        Message::text(serialized)
    }
}

impl Default for Rustpad {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(16);
        Self {
            state: Default::default(),
            count: Default::default(),
            notify: Default::default(),
            update: tx,
            killed: AtomicBool::new(false),
            database: None,
        }
    }
}

impl Rustpad {
    /// Create a new Rustpad with database support for color persistence.
    pub fn new(database: Database) -> Self {
        let (tx, _) = broadcast::channel(16);
        Self {
            state: Default::default(),
            count: Default::default(),
            notify: Default::default(),
            update: tx,
            killed: AtomicBool::new(false),
            database: Some(database),
        }
    }

    /// Create a Rustpad from a persisted document with database support.
    pub fn from_document(document: PersistedDocument, database: Database) -> Self {
        let mut operation = OperationSeq::default();
        operation.insert(&document.text);

        let rustpad = Self::new(database);
        {
            let mut state = rustpad.state.write();
            state.text = document.text;
            state.language = document.language;
            state.operations.push(UserOperation {
                id: u64::MAX,
                operation,
                email: None,
            })
        }
        rustpad
    }

    /// Initialize user colors from database.
    pub async fn load_colors(&self) {
        if let Some(ref db) = self.database {
            match db.load_user_colors().await {
                Ok(colors) => {
                    let mut state = self.state.write();
                    for (email, hue) in colors {
                        state.user_colors.insert(email, hue);
                    }
                }
                Err(e) => {
                    warn!("Failed to load user colors: {}", e);
                }
            }
        }
    }
}

impl Rustpad {
    /// Handle a connection from a WebSocket.
    pub async fn on_connection(&self, socket: WebSocket, cf_email: Option<String>) {
        let id = self.count.fetch_add(1, Ordering::Relaxed);
        info!("connection! id = {}, cf_email = {:?}", id, cf_email);
        if let Err(e) = self.handle_connection(id, socket, cf_email).await {
            warn!("connection terminated early: {}", e);
        }
        info!("disconnection, id = {}", id);
        self.state.write().users.remove(&id);
        self.state.write().cursors.remove(&id);
        self.update
            .send(ServerMsg::UserInfo { id, info: None })
            .ok();
    }

    /// Returns a snapshot of the latest text.
    pub fn text(&self) -> String {
        let state = self.state.read();
        state.text.clone()
    }

    /// Returns a snapshot of the current document for persistence.
    pub fn snapshot(&self) -> PersistedDocument {
        let state = self.state.read();
        PersistedDocument {
            text: state.text.clone(),
            language: state.language.clone(),
        }
    }

    /// Returns the current revision.
    pub fn revision(&self) -> usize {
        let state = self.state.read();
        state.operations.len()
    }

    /// Kill this object immediately, dropping all current connections.
    pub fn kill(&self) {
        self.killed.store(true, Ordering::Relaxed);
        self.notify.notify_waiters();
    }

    /// Returns if this Rustpad object has been killed.
    pub fn killed(&self) -> bool {
        self.killed.load(Ordering::Relaxed)
    }

    async fn handle_connection(&self, id: u64, mut socket: WebSocket, cf_email: Option<String>) -> Result<()> {
        let mut update_rx = self.update.subscribe();

        let mut revision: usize = self.send_initial(id, &mut socket, cf_email.clone()).await?;

        loop {
            // In order to avoid the "lost wakeup" problem, we first request a
            // notification, **then** check the current state for new revisions.
            // This is the same approach that `tokio::sync::watch` takes.
            let notified = self.notify.notified();
            if self.killed() {
                break;
            }
            if self.revision() > revision {
                revision = self.send_history(revision, &mut socket).await?
            }

            tokio::select! {
                _ = notified => {}
                update = update_rx.recv() => {
                    socket.send(update?.into()).await?;
                }
                result = socket.next() => {
                    match result {
                        None => break,
                        Some(message) => {
                            self.handle_message(id, message?, cf_email.clone()).await?;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn send_initial(&self, id: u64, socket: &mut WebSocket, cf_email: Option<String>) -> Result<usize> {
        socket.send(ServerMsg::Identity(id).into()).await?;
        socket.send(ServerMsg::AuthenticatedEmail(cf_email).into()).await?;
        let mut messages = Vec::new();
        let revision = {
            let state = self.state.read();
            if !state.operations.is_empty() {
                messages.push(ServerMsg::History {
                    start: 0,
                    operations: state.operations.clone(),
                });
            }
            if let Some(language) = &state.language {
                messages.push(ServerMsg::Language(language.clone()));
            }
            for (&id, info) in &state.users {
                messages.push(ServerMsg::UserInfo {
                    id,
                    info: Some(info.clone()),
                });
            }
            for (&id, data) in &state.cursors {
                messages.push(ServerMsg::UserCursor {
                    id,
                    data: data.clone(),
                });
            }
            // Send known user color preferences
            for (email, &hue) in &state.user_colors {
                messages.push(ServerMsg::UserColor {
                    email: email.clone(),
                    hue,
                });
            }
            state.operations.len()
        };
        for msg in messages {
            socket.send(msg.into()).await?;
        }
        Ok(revision)
    }

    async fn send_history(&self, start: usize, socket: &mut WebSocket) -> Result<usize> {
        let operations = {
            let state = self.state.read();
            let len = state.operations.len();
            if start < len {
                state.operations[start..].to_owned()
            } else {
                Vec::new()
            }
        };
        let num_ops = operations.len();
        if num_ops > 0 {
            let msg = ServerMsg::History { start, operations };
            socket.send(msg.into()).await?;
        }
        Ok(start + num_ops)
    }

    async fn handle_message(&self, id: u64, message: Message, cf_email: Option<String>) -> Result<()> {
        let msg: ClientMsg = match message.to_str() {
            Ok(text) => serde_json::from_str(text).context("failed to deserialize message")?,
            Err(()) => return Ok(()), // Ignore non-text messages
        };
        match msg {
            ClientMsg::Edit {
                revision,
                operation,
            } => {
                self.apply_edit(id, revision, operation, cf_email)
                    .context("invalid edit operation")?;
                self.notify.notify_waiters();
            }
            ClientMsg::SetLanguage(language) => {
                self.state.write().language = Some(language.clone());
                self.update.send(ServerMsg::Language(language)).ok();
            }
            ClientMsg::ClientInfo(info) => {
                self.state.write().users.insert(id, info.clone());
                let msg = ServerMsg::UserInfo {
                    id,
                    info: Some(info),
                };
                self.update.send(msg).ok();
            }
            ClientMsg::CursorData(data) => {
                self.state.write().cursors.insert(id, data.clone());
                let msg = ServerMsg::UserCursor { id, data };
                self.update.send(msg).ok();
            }
            ClientMsg::SetColor(hue) => {
                // Only authenticated users can set persistent colors
                if let Some(ref email) = cf_email {
                    self.state.write().user_colors.insert(email.clone(), hue);
                    let msg = ServerMsg::UserColor {
                        email: email.clone(),
                        hue,
                    };
                    self.update.send(msg).ok();
                    // Persist to database
                    if let Some(ref db) = self.database {
                        let db = db.clone();
                        let email = email.clone();
                        tokio::spawn(async move {
                            if let Err(e) = db.save_user_color(&email, hue).await {
                                warn!("Failed to save user color: {}", e);
                            }
                        });
                    }
                }
            }
        }
        Ok(())
    }

    fn apply_edit(&self, id: u64, revision: usize, mut operation: OperationSeq, email: Option<String>) -> Result<()> {
        info!(
            "edit: id = {}, revision = {}, base_len = {}, target_len = {}, email = {:?}",
            id,
            revision,
            operation.base_len(),
            operation.target_len(),
            email
        );
        let state = self.state.upgradable_read();
        let len = state.operations.len();
        if revision > len {
            bail!("got revision {}, but current is {}", revision, len);
        }
        for history_op in &state.operations[revision..] {
            operation = operation.transform(&history_op.operation)?.0;
        }
        if operation.target_len() > 256 * 1024 {
            bail!(
                "target length {} is greater than 256 KiB maximum",
                operation.target_len()
            );
        }
        let new_text = operation.apply(&state.text)?;
        let mut state = RwLockUpgradableReadGuard::upgrade(state);
        for (_, data) in state.cursors.iter_mut() {
            for cursor in data.cursors.iter_mut() {
                *cursor = transform_index(&operation, *cursor);
            }
            for (start, end) in data.selections.iter_mut() {
                *start = transform_index(&operation, *start);
                *end = transform_index(&operation, *end);
            }
        }
        state.operations.push(UserOperation { id, operation, email });
        state.text = new_text;
        Ok(())
    }
}
