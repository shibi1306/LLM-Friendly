const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: {
      background: './src/background/background.js',
      content: './src/content/content.js',
      popup: './src/popup/popup.js',
      options: './src/options/options.js',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
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
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'icons', to: 'icons' },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'src/options/options.html', to: 'options.html' },
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
