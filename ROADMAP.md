# Scribblr Roadmap

Fork of [Rustpad](https://github.com/ekzhang/rustpad) customized as a private collaborative notes app.

## Overview

| Feature | Priority | Effort | Status |
|---------|----------|--------|--------|
| Cloudflare Tunnel | 1 | Easy | Done |
| Persistence (Default) | 2 | Easy | Done |
| Cloudflare Access Auth | 3 | Easy | Done |
| File Browser + CRUD | 4 | High | Done |
| Shortcuts | 5 | Moderate | Done |
| Note Title Modal | 6 | Easy | Done |
| Browser Tab Title | 7 | Easy | Done |
| Remove Language Selection | 8 | Easy | Done |
| Remove About/GitHub Link | 9 | Easy | Done |
| Test Cloudflare Setup | 10 | Moderate | Done |
| Fix Duplicate @ Shortcuts | 11 | Easy | Done |
| Timestamp Format (YYYY/MM/DD 24h) | 12 | Easy | Done |
| Show Note Title in Editor UI | 13 | Easy | Done |
| Cloudflare Access User Identity | 14 | Moderate | Done |
| Adjustable User Text Color | 15 | Easy | Done |
| Custom Syntax Highlighting | 16 | Moderate | Done |
| Remove Rustpad from Link Unfurl | 17 | Easy | Done |
| Delete All Notes (Kablammo) | 18 | Moderate | Done |
| Editor Line Coloring by User | 19 | High | Done |
| Persistent Color Preferences | 20 | Moderate | Done |
| Fixed Colors Toggle | 21 | Easy | Done |

---

## 1. Cloudflare Tunnel

**Goal**: Expose the app securely to the internet without port forwarding.

### Implementation

Create `docker-compose.yml` at project root:

```yaml
services:
  scribblr:
    build: .
    environment:
      - SQLITE_URI=sqlite:///data/scribblr.db
      - PORT=3030
      - EXPIRY_DAYS=365
    volumes:
      - ./data:/data
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
    depends_on:
      - scribblr
    restart: unless-stopped
```

Create `.env` (gitignored):

```
TUNNEL_TOKEN=<token-from-cloudflare-dashboard>
```

### Setup Steps

1. Log into [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to Networks > Tunnels > Create a tunnel
3. Name the tunnel (e.g., "scribblr")
4. Copy the tunnel token to `.env`
5. Add public hostname pointing to `scribblr:3030`
6. Run `docker-compose up -d`

### Acceptance Criteria

- [ ] App accessible via custom domain over HTTPS
- [ ] WebSocket connections work through tunnel
- [ ] Container restarts automatically on failure

---

## 2. Persistence (Default)

**Goal**: Make SQLite persistence mandatory rather than optional.

### Backend Changes

**File**: `rustpad-server/src/main.rs`

- Remove `Option` wrapper from `sqlite_uri` in `ServerConfig`
- Fail startup if `SQLITE_URI` environment variable is not set
- Log database path on startup

**File**: `rustpad-server/src/lib.rs`

- Remove `Option` handling for database in `ServerState`
- Simplify persistence logic (always persist)

### Schema Enhancement

**File**: `rustpad-server/migrations/1_document.sql`

Update schema to support document metadata:

```sql
CREATE TABLE document(
    id TEXT PRIMARY KEY,
    name TEXT,
    text TEXT NOT NULL,
    language TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_document_updated_at ON document(updated_at DESC);
```

### Docker Changes

- Ensure `/data` volume is always mounted
- Set default `SQLITE_URI` in Dockerfile or compose

### Acceptance Criteria

- [ ] App fails to start without `SQLITE_URI`
- [ ] Documents persist across container restarts
- [ ] Database file created automatically on first run
- [ ] `created_at` and `updated_at` tracked for all documents

---

## 3. Cloudflare Access Auth

**Goal**: Restrict app access to authorized users only (2 users).

### Implementation

This requires zero code changes. Configure entirely in Cloudflare dashboard.

### Setup Steps

1. In Zero Trust dashboard, go to Access > Applications
2. Create new application:
   - Type: Self-hosted
   - Application domain: your scribblr domain
   - Session duration: 24 hours (or preferred)
3. Create access policy:
   - Policy name: "Allowed Users"
   - Action: Allow
   - Include: Emails matching `you@email.com` OR `partner@email.com`
4. Save and deploy

### Optional: Display User Identity

If we want to show which user is editing (from Cloudflare headers):

**Backend**: Read `Cf-Access-Authenticated-User-Email` header in WebSocket handler

**Frontend**: Display authenticated user email in sidebar

### Acceptance Criteria

- [ ] Unauthenticated requests redirected to Cloudflare login
- [ ] Only specified email addresses can access app
- [ ] Session persists across page refreshes
- [ ] (Optional) User email displayed in UI

---

## 4. File Browser + CRUD

**Goal**: Allow users to create, list, rename, and delete documents.

### Backend Changes

**File**: `rustpad-server/src/lib.rs`

Add new API endpoints:

```
GET    /api/documents          - List all documents
POST   /api/documents          - Create new document
GET    /api/documents/{id}     - Get document metadata
PATCH  /api/documents/{id}     - Rename document
DELETE /api/documents/{id}     - Delete document (soft delete)
```

**File**: `rustpad-server/src/database.rs`

Add database methods:

```rust
pub async fn list_documents(&self) -> Result<Vec<DocumentMeta>>
pub async fn create_document(&self, name: &str) -> Result<String>
pub async fn get_document_meta(&self, id: &str) -> Result<DocumentMeta>
pub async fn rename_document(&self, id: &str, name: &str) -> Result<()>
pub async fn delete_document(&self, id: &str) -> Result<()>
```

**New struct**:

```rust
pub struct DocumentMeta {
    pub id: String,
    pub name: Option<String>,
    pub language: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

### Schema Update

Add soft delete support:

```sql
ALTER TABLE document ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_document_deleted ON document(deleted_at);
```

### Frontend Changes

**New file**: `src/DocumentList.tsx`

Document browser component following Rustpad conventions:

- Use Chakra UI components (`Box`, `VStack`, `HStack`, `Button`, `Input`, `IconButton`)
- Use Chakra icons or `react-icons`
- Follow existing color mode patterns (`useColorModeValue`)
- Responsive design matching Sidebar breakpoints

Features:
- List documents sorted by `updated_at` DESC
- Search/filter documents by name
- Create new document button
- Click document to open
- Rename document (inline edit or modal)
- Delete document with confirmation

**File**: `src/App.tsx`

- Add state for document list view vs editor view
- Add navigation between views
- Update URL routing (keep hash-based for documents)

**File**: `src/Sidebar.tsx`

- Add "All Documents" / back button when in editor view
- Show current document name

### UI Layout

```
┌─────────────────────────────────────────────┐
│  Scribblr              [+ New] [Dark Mode]  │
├─────────────────────────────────────────────┤
│  Search documents...                        │
├─────────────────────────────────────────────┤
│  📄 Shopping List              2 min ago    │
│  📄 Project Ideas              1 hour ago   │
│  📄 Travel Plans               Yesterday    │
│  📄 Meeting Notes              3 days ago   │
└─────────────────────────────────────────────┘
```

### Acceptance Criteria

- [ ] Document list displays all non-deleted documents
- [ ] New documents can be created with optional name
- [ ] Documents can be renamed
- [ ] Documents can be deleted (soft delete)
- [ ] Deleted documents recoverable (admin/API)
- [ ] UI follows Rustpad/Chakra conventions
- [ ] Responsive on mobile

---

## 5. Shortcuts

**Goal**: Support text expansion shortcuts like `@today` → current date.

### Implementation

**New file**: `src/shortcuts.ts`

```typescript
export interface Shortcut {
  trigger: string;
  label: string;
  expand: () => string;
}

export const shortcuts: Shortcut[] = [
  {
    trigger: '@today',
    label: 'Today\'s date',
    expand: () => new Date().toLocaleDateString()
  },
  {
    trigger: '@now',
    label: 'Current date and time',
    expand: () => new Date().toLocaleString()
  },
  {
    trigger: '@tomorrow',
    label: 'Tomorrow\'s date',
    expand: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toLocaleDateString();
    }
  },
  {
    trigger: '@yesterday',
    label: 'Yesterday\'s date',
    expand: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString();
    }
  },
  {
    trigger: '@week',
    label: 'Current week number',
    expand: () => `Week ${getWeekNumber(new Date())}`
  },
];
```

### Monaco Integration

**File**: `src/App.tsx` or new `src/useShortcuts.ts`

Register Monaco completion provider:

```typescript
monaco.languages.registerCompletionItemProvider('*', {
  triggerCharacters: ['@'],
  provideCompletionItems: (model, position) => {
    // Return matching shortcuts as suggestions
  }
});
```

On completion accept:
1. Delete the trigger text (e.g., `@today`)
2. Insert expanded value (e.g., `12/27/2024`)

### Alternative: Inline Expansion

Instead of autocomplete, expand on Space or Enter after trigger:

```typescript
editor.onDidChangeModelContent((e) => {
  // Check if change matches a shortcut trigger
  // If followed by space/enter, replace with expansion
});
```

### UI Feedback

- Show subtle tooltip when `@` is typed
- Autocomplete dropdown with available shortcuts
- Follow Monaco's existing autocomplete styling

### Acceptance Criteria

- [ ] `@today` expands to current date
- [ ] `@now` expands to current datetime
- [ ] `@tomorrow` and `@yesterday` work correctly
- [ ] Autocomplete shows available shortcuts
- [ ] Shortcuts work in collaborative context (OT-safe)
- [ ] User can dismiss autocomplete with Escape

---

## 6. Note Title Modal

**Goal**: Prompt user to enter a title when creating a new note.

### Implementation

**New component**: `src/components/CreateNoteModal.tsx`

Modal with:
- Text input for note title
- "Create" button (disabled if title empty)
- "Cancel" button
- Keyboard support: Enter to create, Escape to cancel

**File**: `src/views/DocumentList.tsx`

- Replace direct navigation on "+ New" click with modal open
- On modal submit: call `createDocument(title)`, then navigate to new note

### UI Flow

```
1. User clicks "+ New Note"
2. Modal appears with title input focused
3. User types title, presses Enter or clicks "Create"
4. Note created with title, user navigated to editor
```

### Acceptance Criteria

- [ ] Modal appears when creating new note
- [ ] Title input is auto-focused
- [ ] Enter key submits, Escape cancels
- [ ] Empty title prevented (button disabled)
- [ ] Modal follows Chakra UI patterns

---

## 7. Browser Tab Title

**Goal**: Change the browser tab title from "Rustpad" to "Scribblr".

### Implementation

**File**: `index.html`
- Update `<title>` tag to "Scribblr"

### Acceptance Criteria

- [ ] Browser tab shows "Scribblr" instead of "Rustpad"

---

## 8. Remove Language Selection

**Goal**: Remove the language/syntax highlighting dropdown from the editor sidebar.

### Implementation

**File**: `src/Sidebar.tsx`
- Remove language selector component
- Remove related props and state

### Acceptance Criteria

- [ ] No language dropdown visible in sidebar
- [ ] Editor defaults to plaintext

---

## 9. Remove About/GitHub Link

**Goal**: Remove the "About" text and GitHub link from the editor footer/sidebar.

### Implementation

**File**: `src/Footer.tsx` and/or `src/Sidebar.tsx`
- Remove GitHub link
- Remove "About" section or explanatory text

### Acceptance Criteria

- [ ] No GitHub links visible
- [ ] No "About Rustpad" text visible

---

## 10. Test Cloudflare Setup

**Goal**: Verify the app works correctly when deployed behind Cloudflare Tunnel with Cloudflare Access.

### Testing Checklist

- [ ] App accessible via custom domain over HTTPS
- [ ] WebSocket connections work through tunnel
- [ ] Authentication via Cloudflare Access works
- [ ] Document persistence works in deployed environment
- [ ] Real-time collaboration works between two users

---

## 11. Fix Duplicate @ Shortcuts

**Goal**: Prevent duplicate items from appearing in the `@` shortcut autocomplete dropdown.

### Implementation

**File**: `src/shortcutProvider.ts`
- Ensure completion provider is registered only once
- Deduplicate suggestions if necessary

### Acceptance Criteria

- [ ] Each shortcut appears only once in dropdown
- [ ] No duplicates after navigation or editor remount

---

## 12. Timestamp Format (YYYY/MM/DD 24h)

**Goal**: Format all timestamp shortcuts using YYYY/MM/DD date format and 24-hour time.

### Implementation

**File**: `src/shortcuts.ts`
- Update `@today` → `2024/12/27`
- Update `@now` → `2024/12/27 14:30`
- Update `@tomorrow`, `@yesterday` accordingly

### Acceptance Criteria

- [ ] `@today` expands to `YYYY/MM/DD` format
- [ ] `@now` expands to `YYYY/MM/DD HH:MM` (24-hour)
- [ ] All date shortcuts use consistent format

---

## 13. Show Note Title in Editor UI

**Goal**: Display the note's title instead of its ID in the editor interface, while keeping IDs in URLs.

### Implementation

**File**: `src/App.tsx`
- Fetch note metadata (title) when loading a note
- Display title in the breadcrumb/header area

**File**: `src/Sidebar.tsx`
- Show note title instead of ID where applicable

### Acceptance Criteria

- [ ] Editor header shows note title (e.g., "Shopping List") not ID
- [ ] URLs still use note ID (e.g., `#abc123`)
- [ ] Untitled notes show fallback (e.g., "Untitled" or the ID)

---

## 14. Cloudflare Access User Identity

**Goal**: Display the authenticated user's email (from Cloudflare Access) instead of "Anonymous X" in the editor.

### Implementation

**Backend** (`rustpad-server/src/lib.rs`):
- Read `Cf-Access-Authenticated-User-Email` header from WebSocket upgrade request
- Pass email to Rustpad user info instead of random animal name

**Frontend** (`src/App.tsx`):
- Remove random name generation when behind Cloudflare Access
- Display email from server or use as default name

### Acceptance Criteria

- [ ] User's email appears in collaborator list
- [ ] No "Anonymous Elephant" style names when authenticated
- [ ] Fallback to anonymous names if header not present (local dev)

---

## Technical Notes

### UI Conventions (from Rustpad)

- **Component Library**: Chakra UI v2
- **Icons**: Chakra icons, react-icons
- **Color Mode**: `useColorModeValue` for light/dark
- **Spacing**: Chakra spacing scale (1-10)
- **Responsive**: Chakra breakpoints (`base`, `sm`, `md`, `lg`)
- **State**: React hooks, localStorage for preferences
- **Animations**: Framer Motion (used sparingly)

### File Structure

```
src/
├── App.tsx              # Main app, routing
├── Sidebar.tsx          # Navigation sidebar
├── DocumentList.tsx     # NEW: Document browser
├── DocumentItem.tsx     # NEW: Single document row
├── Editor.tsx           # NEW: Extract editor logic
├── shortcuts.ts         # NEW: Shortcut definitions
├── useShortcuts.ts      # NEW: Monaco integration
├── rustpad.ts           # OT client (unchanged)
├── useHash.ts           # URL hash handling
└── ...
```

### API Structure

```
/api/
├── socket/{id}          # WebSocket (existing)
├── text/{id}            # Get text (existing)
├── stats                # Server stats (existing)
├── documents            # NEW: List/create
└── documents/{id}       # NEW: Get/update/delete
```

---

## 15. Adjustable User Text Color

**Goal**: Allow users to customize their text/cursor color in the editor.

### Implementation

**File**: `src/Sidebar.tsx` or `src/App.tsx`
- Add color picker or preset color options
- Store selected color in localStorage
- Pass color to Rustpad user info (hue value)

**File**: `src/rustpad.ts`
- Already supports `hue` in `UserInfo`
- May need to expand to support full RGB or more hues

### UI Options

1. **Color picker**: Full color selection
2. **Preset palette**: 8-12 predefined colors
3. **Hue slider**: Simple slider for hue adjustment

### Acceptance Criteria

- [ ] User can change their text/cursor color
- [ ] Color persists across sessions (localStorage)
- [ ] Color visible to collaborators
- [ ] Follows existing UI patterns

---

## 16. Custom Syntax Highlighting

**Goal**: Disable default code syntax highlighting and optionally add note-relevant highlighting (dates, times, etc.).

### Options

1. **Disable completely**: Set Monaco to plaintext with no tokenization
2. **Custom highlighting**: Create a custom Monaco language/theme that highlights:
   - Dates (e.g., `2024/12/27`)
   - Times (e.g., `14:30`)
   - URLs
   - Headings (lines starting with `#`)
   - Lists (lines starting with `-` or `*`)
   - Checkboxes (`[ ]` and `[x]`)

### Implementation

**Option 1 - Disable:**

**File**: `src/App.tsx`
- Set `language="plaintext"` on Monaco Editor (may already be default)
- Ensure no automatic language detection

**Option 2 - Custom Language:**

**New file**: `src/noteLanguage.ts`
- Register custom Monaco language `note`
- Define tokenizer rules for dates, times, URLs, etc.

**File**: `src/App.tsx`
- Import and register custom language on mount
- Set `language="note"` on Monaco Editor

### Acceptance Criteria

- [ ] No code syntax highlighting (unless custom)
- [ ] (Optional) Dates/times highlighted subtly
- [ ] (Optional) URLs clickable or highlighted
- [ ] Follows existing color mode (dark/light)

---

## 17. Remove Rustpad from Link Unfurl

**Goal**: Update link preview metadata to show "Scribblr" instead of "Rustpad" when sharing links.

### Implementation

**File**: `index.html`
- Update `<meta property="og:title">` to "Scribblr"
- Update `<meta property="og:description">` to remove Rustpad references
- Update `<meta name="description">` similarly
- Update any `<meta property="og:site_name">` if present

### Acceptance Criteria

- [ ] Link previews show "Scribblr" branding
- [ ] No "Rustpad" text in unfurled links
- [ ] Description reflects private notes app purpose

---

## 18. Delete All Notes (Kablammo)

**Goal**: Add a button to delete all notes with a confirmation safeguard.

### Implementation

**UI Location**: Document list page, bomb icon button next to "New Note"

**Modal Flow**:
1. User clicks bomb icon
2. Modal appears: "Are you sure you want to end it all?"
3. User must type `kablammo` in input field to enable confirm button
4. On confirm: delete all documents (soft delete)
5. Success toast: "All notes have been deleted"

### Backend

- `DELETE /api/documents/all` - Delete all documents (soft delete)
- `database.rs`: `delete_all_documents()` method

### Acceptance Criteria

- [ ] Bomb icon visible on document list page
- [ ] Modal appears on click with warning message
- [ ] Confirm button disabled until "kablammo" typed
- [ ] All documents soft-deleted on confirm
- [ ] Success feedback shown to user

---

## 19. Editor Line Coloring by User

**Goal**: Color editor lines based on which user last edited them.

### Implementation

Track line ownership in rustpad.ts:
- Maintain map of line number → user info (id, hue)
- Update ownership when local or remote edits occur
- Apply Monaco decorations to color line backgrounds
- Use subtle hsla colors based on user's hue

### Acceptance Criteria

- [ ] Lines show subtle background color based on last editor
- [ ] Color updates in real-time as edits are made
- [ ] Works correctly with collaborative editing
- [ ] Supports light and dark mode

---

## 20. Persistent Color Preferences

**Goal**: Store user color preferences on the server, tied to email, so they persist across sessions.

### Implementation

**Backend**:
- New database table `user_color` (email, hue, updated_at)
- `SetColor` WebSocket message to save color preference
- `UserColor` broadcast message to notify all clients
- Load colors from database on Rustpad creation

**Frontend**:
- `emailColors` map to cache server-stored colors
- `sendColor()` to persist color changes
- Use stored colors for line ownership coloring

### Acceptance Criteria

- [x] Color preferences stored in SQLite database
- [x] Colors persist across page reloads
- [x] Color changes broadcast to all connected clients
- [x] Line colors update when user changes their color

---

## 21. Fixed Colors Toggle

**Goal**: Allow switching between dynamic user-picked colors and fixed per-user color assignments.

### Implementation

**Fixed color assignments**:
- `brammyers@gmail.com` → Green (hue 120)
- `jamie.nanni@gmail.com` → Orange (hue 30)

**UI**: Toggle switch in sidebar "Fixed Colors"

**Frontend**:
- `useFixedColors` state in localStorage
- `setFixedColors()` method in Rustpad
- `getHueForEmail()` respects fixed colors mode
- Toggle refreshes all line colors immediately

### Acceptance Criteria

- [x] Toggle visible in sidebar
- [x] Fixed colors override dynamic colors when enabled
- [x] Both name and line text use fixed colors
- [x] Setting persists in localStorage

---

## Known Issues

### Second User Color Divergence

**Status**: Investigating

**Symptom**: Second user (jamie.nanni@gmail.com) sees their name in their picked color but their text lines appear in a different color (yellow/email-derived).

**Suspected cause**: Mismatch between owner keys used when storing line ownership vs when updating colors. Debug logging has been added to trace the issue.

**Workaround**: Use "Fixed Colors" toggle to force consistent colors.

---

## Future Considerations (Out of Scope)

These features are explicitly deferred:

- ~~Spellcheck~~ - Browser native may suffice
- ~~Markdown preview~~ - Keep simple text editing
- ~~Snapshots/versioning~~ - Soft delete provides basic recovery
- ~~Multiple users beyond 2~~ - Use Cloudflare Access if needed
- ~~Mobile app~~ - PWA/responsive web is sufficient
