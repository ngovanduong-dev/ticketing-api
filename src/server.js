const { validateEnvironment } = require('./config/environment');

let config;
try {
  if (process.env.NODE_ENV === 'test') {
    require('./config/test-environment').configureTestEnvironment();
  } else {
    require('dotenv').config({ quiet: true });
  }
  config = validateEnvironment();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const app = require('./app');

app.listen(config.port, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${config.port}`);
});
