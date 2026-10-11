/**
 * The worker thread that holds a day's play-time solver (puzzleGrader.ts): it
 * builds the solver from the day's spec and the map the server loaded, then
 * answers the server's queries in order, one at a time, for as long as the
 * day is cached. A query's error goes back with its id; the solver and its
 * memo carry on.
 */
import { parentPort, workerData } from 'worker_threads';
import { contextFromSpec } from './puzzle/bridge';
import { LocalGrader, type GraderJob, type GraderQuery, type GraderReply } from './puzzleGrader';

const { spec, map } = workerData as GraderJob;
const grader = new LocalGrader(spec, contextFromSpec(spec, map));

parentPort?.on('message', (request: GraderQuery & { id: number }) => {
  let reply: GraderReply;
  try {
    reply = { id: request.id, result: grader.answer(request) };
  } catch (err) {
    reply = { id: request.id, error: err instanceof Error ? err.stack ?? err.message : String(err) };
  }
  parentPort?.postMessage(reply);
});
