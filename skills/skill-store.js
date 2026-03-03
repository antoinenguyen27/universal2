import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, 'data');

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function saveSkill({ name, content, domain }) {
  const safeDomain = domain.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
  const domainDir = path.join(SKILLS_DIR, safeDomain);
  await fs.mkdir(domainDir, { recursive: true });

  const filename = `${slugify(name) || 'skill'}.md`;
  await fs.writeFile(path.join(domainDir, filename), content, 'utf8');

  return { domain: safeDomain, filename };
}

export async function loadSkillsForSite(domain) {
  try {
    const domainDir = path.join(SKILLS_DIR, domain);
    const files = (await fs.readdir(domainDir)).filter((file) => file.endsWith('.md'));
    const loaded = await Promise.all(
      files.map(async (file) => ({
        domain,
        name: file.replace(/\.md$/, ''),
        filename: file,
        content: await fs.readFile(path.join(domainDir, file), 'utf8')
      }))
    );
    return loaded;
  } catch {
    return [];
  }
}

export async function loadAllSkills() {
  try {
    const domains = await fs.readdir(SKILLS_DIR);
    const loaded = await Promise.all(domains.map((domain) => loadSkillsForSite(domain)));
    return loaded.flat().sort((a, b) => a.domain.localeCompare(b.domain));
  } catch {
    return [];
  }
}
