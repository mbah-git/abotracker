require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example).`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  // Pfad, unter dem die App laeuft, z. B. "/abotracker" (leer = Domain-Root)
  basePath: (process.env.BASE_PATH || '').replace(/\/+$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
};
