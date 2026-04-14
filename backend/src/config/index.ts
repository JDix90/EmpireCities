import dotenv from 'dotenv';
dotenv.config();

function parseCorsOrigins(): string[] {
  const extra = process.env.CORS_ORIGINS;
  const primary = process.env.FRONTEND_URL || 'http://localhost:5173';
  const list = [primary];
  if (extra) {
    for (const o of extra.split(',')) {
      const t = o.trim();
      if (t && !list.includes(t)) list.push(t);
    }
  }
  // Capacitor / Ionic WebView defaults (add your production app URL via CORS_ORIGINS)
  const devExtras = ['capacitor://localhost', 'ionic://localhost', 'http://localhost'];
  if ((process.env.NODE_ENV || 'development') === 'development') {
    for (const o of devExtras) {
      if (!list.includes(o)) list.push(o);
    }
  }
  return list;
}

function parseRefreshCookieSameSite(): 'strict' | 'lax' | 'none' {
  const v = (process.env.REFRESH_COOKIE_SAME_SITE || '').toLowerCase();
  if (v === 'strict' || v === 'lax' || v === 'none') return v;
  return process.env.NODE_ENV === 'production' ? 'lax' : 'strict';
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: parseCorsOrigins(),
  refreshCookieSameSite: parseRefreshCookieSameSite(),

  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'chronouser',
    password: process.env.POSTGRES_PASSWORD || 'chronopass',
    database: process.env.POSTGRES_DB || 'erasofempire',
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://chronouser:chronopass@localhost:27017/erasofempire_maps?authSource=admin',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'chronoredis',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_in_production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@erasofempire.com',
  },

  push: {
    fcmServiceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH || '',
  },
};
