const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';
  const browser = env.browser || 'chrome';
  const outputDir = browser === 'chrome' ? 'dist' : `dist-${browser}`;

  return {
    entry: {
      background: './src/background/background.js',
      content: './src/content/content.js',
      popup: './src/popup/popup.js',
      options: './src/options/options.js',
    },
    output: {
      path: path.resolve(__dirname, outputDir),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new CopyPlugin({
        patterns: [
          { 
            from: 'manifest.json', 
            to: 'manifest.json',
            transform: (content) => {
              const manifest = JSON.parse(content);
              
              if (browser === 'chrome') {
                // Remove Firefox-specific fields for Chrome
                delete manifest.browser_specific_settings;
              } else if (browser === 'firefox') {
                // Firefox needs background.scripts instead of service_worker
                manifest.background = {
                  scripts: ['background.js']
                };
              }
              
              return JSON.stringify(manifest, null, 2);
            }
          },
          { from: 'icons', to: 'icons' },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'src/options/options.html', to: 'options.html' },
          { from: 'src/polyfill.js', to: 'polyfill.js' },
          {
            from: 'node_modules/pdfjs-dist/build/pdf.worker.min.js',
            to: 'pdf.worker.js',
          },
        ],
      }),
    ],
    optimization: {
      // No chunk splitting — content scripts can't load dynamic chunks
      splitChunks: false,
    },
    resolve: {
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
