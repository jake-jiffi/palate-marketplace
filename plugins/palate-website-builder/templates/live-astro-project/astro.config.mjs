import { defineConfig } from 'astro/config';
import liveDesignPreview from './palate-preview/integration.mjs';

export default defineConfig({
  output: 'static',
  integrations: [liveDesignPreview()],
  devToolbar: { enabled: false },
});
