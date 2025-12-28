# Scribblr Debug Log

## Issue
Notes do not persist - text entered in editor is not saved to database.

## Symptoms
1. Document list UI works correctly
2. Creating notes works
3. Navigating to notes works (after React hooks fix)
4. Typing in editor appears to work locally
5. But text is empty when reopening note
6. Database shows `text` column is empty

## Root Cause Identified
**React 18 StrictMode** causes effects to mount → unmount → remount in development mode. This was breaking the WebSocket connection:

1. Component mounts, Rustpad connects to WebSocket
2. StrictMode unmounts component for verification
3. `dispose()` runs, WebSocket closes (sends "Away" close code 1001)
4. Component remounts, new Rustpad connects
5. But the rapid connect/disconnect cycle means edits are lost

## Fixes Applied

### 1. React Hooks Order (App.tsx)
**Problem**: `useState` and `useEffect` were called after conditional return, violating React hooks rules.

**Fix**: Moved all hooks before the `if (!id) return <DocumentList />` check:
```tsx
// Before (broken):
const id = useHash();
if (!id) return <DocumentList />;
const [readCodeConfirmOpen, setReadCodeConfirmOpen] = useState(false);
useEffect(() => { ... }, [deps]);

// After (fixed):
const [readCodeConfirmOpen, setReadCodeConfirmOpen] = useState(false);
const id = useHash();
useEffect(() => {
  if (!id || !editor?.getModel()) return;
  // ... rest of effect
}, [id, editor]);
if (!id) return <DocumentList />;
```

### 2. useEffect Dependencies (App.tsx)
**Problem**: `toast` and `setUsers` in dependency array caused effect to re-run on every render.

**Fix**: Simplified dependencies to just `[id, editor]`:
```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [id, editor]);
```

### 3. StrictMode Removal (index.tsx)
**Problem**: React StrictMode double-mounts components in dev, breaking WebSocket.

**Fix**: Removed StrictMode wrapper:
```tsx
// Before:
<StrictMode>
  <ChakraProvider>
    <App />
  </ChakraProvider>
</StrictMode>

// After:
<ChakraProvider>
  <App />
</ChakraProvider>
```

## Backend Verification
The backend is working correctly:
- WebSocket connections are logged: `connection! id = X`
- Persister runs every 3 seconds: `persisting revision X for id = Y`
- Database queries succeed: `rows affected: 1`

The issue was frontend - edits never reached the server (no "edit:" log messages).

## How to Verify Fix Works
1. Run `RUST_LOG=debug cargo run`
2. Run `npm run dev`
3. Open http://localhost:5173
4. Create or open a note
5. Type some text
6. Check cargo terminal for:
   - `connection! id = X` (only ONE connection)
   - `edit: id = X, revision = Y` (when typing)
   - `persisting revision X for id = Y` (after ~3-5 seconds)
7. Navigate away and back - text should persist

## Files Modified
- `/src/App.tsx` - Hooks order fix, useEffect dependencies
- `/src/index.tsx` - StrictMode removal

## Test Database
```bash
sqlite3 data/scribblr.db "SELECT id, length(text), substr(text, 1, 50) FROM document;"
```

## Other Fixes Made (During Implementation)

### Docker/Persistence
- `Dockerfile`: Changed from `scratch` to `alpine:latest` base, added `/data` directory
- `docker-compose.yml`: Added `ports: "3030:3030"` for local testing
- Test files: Updated to use in-memory SQLite instead of `ServerConfig::default()`

### Database Schema
- Added migration `2_document_metadata.sql` with `name`, `created_at`, `updated_at`, `deleted_at`
- Made `SQLITE_URI` required (not optional)
- Added CRUD methods to `database.rs`

### REST API
- Added endpoints: GET/POST `/api/documents`, GET/PATCH/DELETE `/api/documents/{id}`
- Added route handlers in `lib.rs`

### Frontend
- Created `src/api/documents.ts` - API client
- Created `src/hooks/useDocuments.ts` - State hook
- Created `src/views/DocumentList.tsx` - Document browser
- Created `src/components/DocumentItem.tsx` - List item
- Created `src/components/DeleteConfirmModal.tsx` - Delete confirmation
- Modified `src/useHash.ts` - Return empty string when no hash
- Modified `src/Sidebar.tsx` - Added "All Notes" link
- Branding: Rustpad → Scribblr

### Shortcuts
- Created `src/shortcuts.ts` - @today, @now, etc.
- Created `src/shortcutProvider.ts` - Monaco completion provider
