import { resolve } from 'node:path';

export function dataDirectory(configured?: string): string {
  return resolve(__dirname, '../../..', configured || 'data');
}
