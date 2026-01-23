import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

import { babel } from '@rollup/plugin-babel';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
    }),
  ],
  esbuild: {
    target: 'es2015',
  },
  build: {
    target: 'es2015',
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
      plugins: [
        babel({
          babelHelpers: 'bundled',
          presets: ['@babel/preset-env'],
          extensions: ['.js', '.ts'],
        }),
      ],
    },
    // Target smaller bundle size (terser is better for ES5)
    minify: 'terser',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
