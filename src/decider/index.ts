import { config } from '../config.js';
import { FakeDecider } from './fake.js';
import { JevDecider } from './jev.js';
import type { Decider } from './types.js';

export function makeDecider(): Decider {
  return config.decider === 'fake' ? new FakeDecider() : new JevDecider();
}
export type { Decider };
