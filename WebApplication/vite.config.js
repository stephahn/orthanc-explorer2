import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import copy from 'rollup-plugin-copy'
import path from 'path'

const itkConfig = path.resolve(__dirname, 'src', 'itkConfig.js')
// https://vitejs.dev/config/
export default defineConfig({
  assetsInclude: './src/assets',
  base: '',
  plugins: [vue(),
    copy({
      targets: [
        { src: './node_modules/itk-wasm/dist/web-workers', dest: 'dist/itk', rename: 'web-workers'},
        {
          src: './node_modules/itk-image-io',
          dest: 'dist/assets/itk',
          rename: 'image-io'
        },
        {
          src: './node_modules/itk-mesh-io',
          dest: 'dist/assets/itk',
          rename: 'mesh-io'
        }
      ],
      hook: 'writeBundle'
    })],
  resolve: {
    // where itk-wasm code has 'import ../itkConfig.js` point to the path of itkConfig
    alias: {
      '../itkConfig.js': itkConfig,
      '../../itkConfig.js': itkConfig
    }
  },
  server: {
    host: true
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  css: {
    postcss: { // to avoid this warning: https://github.com/vitejs/vite/discussions/5079
      plugins: [
        {
          postcssPlugin: 'internal:charset-removal',
          AtRule: {
            charset: (atRule) => {
              if (atRule.name === 'charset') {
                atRule.remove();
              }
            }
          }
        }
      ]
    }
  }
})
