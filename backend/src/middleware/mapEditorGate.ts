import type { FastifyReply } from 'fastify';
import { featureFlags } from '../config/featureFlags';

export function isMapEditorEnabled(): boolean {
  return featureFlags.mapEditorEnabled;
}

export function mapEditorDisabledReply(reply: FastifyReply) {
  return reply.status(403).send({ error: 'Map Editor is not available' });
}
