/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIRMS_KEY?: string;
  readonly VITE_OWM_KEY?: string;
  /** PyroCast backend base URL (default http://localhost:8000). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
