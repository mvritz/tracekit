import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        // These dependencies also target React Server Components; this app is entirely client-rendered.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        defaultHandler(warning);
      },
    },
  },
});
