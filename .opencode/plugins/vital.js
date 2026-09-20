/**
 * Vital plugin for OpenCode.ai
 *
 * Registers the repository's skills/ directory via the config hook so
 * OpenCode discovers the vital skill without symlinks or manual config edits.
 * Zero dependencies.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const vitalSkillsDir = path.resolve(__dirname, '../../skills');

export const VitalPlugin = async () => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(vitalSkillsDir)) {
        config.skills.paths.push(vitalSkillsDir);
      }
    },
  };
};
