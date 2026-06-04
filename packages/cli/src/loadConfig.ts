/**
 * Config file loading (Node IO). The pure defaults logic lives in @stp/core;
 * this wrapper only reads the JSON file from disk.
 */

import * as fs from 'node:fs';
import { applyDefaults, type Config, type RawConfig } from '@stp/core';

/**
 * Read a config JSON file from disk and return a fully populated Config.
 * Throws if the file is unreadable, unparseable, or missing mandatory fields.
 */
export function loadConfig(filePath = 'config.json'): Config {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawConfig;
  return applyDefaults(raw);
}
