module.exports = ({config}) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.SMARTTRADE_WEB_BASE_PATH ? {baseUrl: process.env.SMARTTRADE_WEB_BASE_PATH} : {}),
  },
});
