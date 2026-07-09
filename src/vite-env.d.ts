/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIRMS_KEY?: string;
  readonly VITE_OWM_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
