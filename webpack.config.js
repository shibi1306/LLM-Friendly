const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: {
      background: './src/background/background.js',
      content: './src/content/content.js',
      popup: './src/popup/popup.js',
      options: './src/options/options.js',
      offscreen: './src/offscreen/offscreen.js',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: 'string-replace-loader',
          options: {
            search: /new Function\(['"]return this['"]\)\(\)/g,
            replace: 'globalThis'
          }
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
      ],
    },
    plugins: [
      new webpack.ProvidePlugin({
        global: [path.resolve(__dirname, 'src/global.js')],
      }),
      // MV3 compliance: replace tesseract.js modules that contain remotely-hosted code.
      // The patched versions remove:
      //   - Blob + importScripts() dynamic worker creation
      //   - CDN URL defaults for workerPath
      //   - workerBlobURL: true default
      new webpack.NormalModuleReplacementPlugin(
        /tesseract\.js[\\/]src[\\/]worker[\\/]browser[\\/]spawnWorker/,
        path.resolve(__dirname, 'src/patched-tesseract/spawnWorker.js')
      ),
      new webpack.NormalModuleReplacementPlugin(
        /tesseract\.js[\\/]src[\\/]worker[\\/]browser[\\/]defaultOptions/,
        path.resolve(__dirname, 'src/patched-tesseract/defaultOptions.js')
      ),
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new CopyPlugin({
        patterns: [
          { 
            from: 'manifest.json', 
            to: 'manifest.json',
            transform: (content) => {
              const manifest = JSON.parse(content);
              
              // Remove Firefox-specific fields
              delete manifest.browser_specific_settings;
              
              // Chrome MV3 strictly forbids remote script-src, but we need wasm-unsafe-eval
              if (manifest.content_security_policy && manifest.content_security_policy.extension_pages) {
                manifest.content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
              }
              
              return JSON.stringify(manifest, null, 2);
            }
          },
          { from: 'icons', to: 'icons' },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'src/options/options.html', to: 'options.html' },
          { from: 'src/offscreen/offscreen.html', to: 'offscreen.html' },
          { from: 'src/polyfill.js', to: 'polyfill.js' },
          {
            from: 'node_modules/pdfjs-dist/build/pdf.worker.min.js',
            to: 'pdf.worker.js',
          },
          {
            from: 'node_modules/tesseract.js/dist/worker.min.js',
            to: 'tesseract-worker.min.js',
            transform: (content) => {
              let src = content.toString();
              // Fix CSP-unsafe Function constructor pattern
              src = src.replace(/new Function\(['"]return this['"]\)\(\)/g, 'globalThis');
              // Strip CDN URLs — MV3 extensions must not reference remotely hosted code
              src = src.replace(/https?:\/\/cdn\.jsdelivr\.net[^\s"']*/g, '');
              return src;
            }
          },
          {
            from: 'node_modules/tesseract.js-core/tesseract-core.wasm.js',
            to: 'tesseract-core.wasm.js',
          },
          {
            from: 'eng.traineddata',
            to: 'traineddata/eng.traineddata',
          },
        ],
      }),
    ],
    optimization: {
      // No chunk splitting — content scripts can't load dynamic chunks
      splitChunks: false,
    },
    resolve: {
      alias: {
        // Patched constants — used by our patched defaultOptions.js via a
        // module-level require('tesseract.js/src/constants/defaultOptions')
        'tesseract.js/src/constants/defaultOptions': path.resolve(__dirname, 'src/patched-tesseract/constantsDefaultOptions.js'),
      },
      fallback: {
        url: false,
        path: false,
        fs: false,
        stream: false,
        buffer: false,
        crypto: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        util: false,
      },
    },
    devtool: isDev ? 'inline-source-map' : false,
    performance: {
      // Large bundles expected due to pdf.js + mammoth
      maxAssetSize: 5 * 1024 * 1024,
      maxEntrypointSize: 5 * 1024 * 1024,
    },
  };
};
