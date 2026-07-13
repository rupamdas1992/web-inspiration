const path = require('path');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Add any custom webpack configuration here if needed
      return webpackConfig;
    },
  },
  style: {
    postcss: {
      mode: "file",
    },
  },
};
