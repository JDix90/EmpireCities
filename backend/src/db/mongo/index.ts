import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { config } from '../../config';

export async function connectMongo(): Promise<void> {
  await mongoose.connect(config.mongo.uri);
  console.log('[MongoDB] Connected successfully');
}

export function getDb(): Db {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  return db;
}

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err);
});
