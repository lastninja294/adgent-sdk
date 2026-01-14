import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
    }),
  ],
  esbuild: {
    target: 'chrome68',
  },
  build: {
    target: 'chrome68',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AdgentSDK',
      formats: ['es', 'umd'],
      fileName: (format) => `adgent-sdk.${format}.js`,
    },
    rollupOptions: {
      // Externalize deps that shouldn't be bundled
      external: ['fast-xml-parser'],
      output: {
        globals: {
          'fast-xml-parser': 'FastXMLParser',
        },
      },
    },
    // Target smaller bundle size (esbuild is bundled with Vite)
    minify: 'esbuild',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
