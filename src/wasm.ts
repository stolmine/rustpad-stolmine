// WASM initialization wrapper
// This module ensures the WASM is initialized before exporting OpSeq
import init, { OpSeq } from "rustpad-wasm";

// Initialize WASM - this is idempotent (safe to call multiple times)
console.log("[WASM] Initializing...");
await init();
console.log("[WASM] Initialization complete");

// Re-export OpSeq after initialization
export { OpSeq };
