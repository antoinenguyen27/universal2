import { saveSkill } from './skill-store.js';

export async function writeSkillFromDemo({ domain, skillName, finalSkill }) {
  if (!finalSkill || !skillName || !domain) {
    throw new Error('Cannot write skill without domain, skillName, and finalSkill.');
  }

  return saveSkill({
    name: skillName,
    content: finalSkill,
    domain
  });
}
