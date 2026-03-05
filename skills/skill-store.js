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

function buildDomainCandidates(domain) {
  const normalized = String(domain || '').toLowerCase();
  const candidates = [normalized];
  if (normalized.startsWith('www.')) {
    candidates.push(normalized.slice(4));
  } else if (normalized) {
    candidates.push(`www.${normalized}`);
  }
  return [...new Set(candidates.filter(Boolean))];
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
  const allLoaded = [];

  for (const candidate of buildDomainCandidates(domain)) {
    try {
      const domainDir = path.join(SKILLS_DIR, candidate);
      const files = (await fs.readdir(domainDir)).filter((file) => file.endsWith('.md'));
      const loaded = await Promise.all(
        files.map(async (file) => ({
          domain: candidate,
          name: file.replace(/\.md$/, ''),
          filename: file,
          content: await fs.readFile(path.join(domainDir, file), 'utf8')
        }))
      );
      allLoaded.push(...loaded);
    } catch {}
  }

  return allLoaded;
}

export async function loadAllSkills() {
  try {
    const domains = await fs.readdir(SKILLS_DIR);
    const loaded = await Promise.all(
      domains.map(async (domain) => {
        try {
          const domainDir = path.join(SKILLS_DIR, domain);
          const files = (await fs.readdir(domainDir)).filter((file) => file.endsWith('.md'));
          return Promise.all(
            files.map(async (file) => ({
              domain,
              name: file.replace(/\.md$/, ''),
              filename: file,
              content: await fs.readFile(path.join(domainDir, file), 'utf8')
            }))
          );
        } catch {
          return [];
        }
      })
    );
    return loaded.flat().sort((a, b) => a.domain.localeCompare(b.domain));
  } catch {
    return [];
  }
}

export async function deleteSkill({ domain, filename }) {
  const safeDomain = String(domain || '').replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
  const safeFilename = path.basename(String(filename || ''));
  if (!safeDomain || !safeFilename.endsWith('.md')) {
    throw new Error('Invalid skill identifier.');
  }

  const domainDir = path.resolve(SKILLS_DIR, safeDomain);
  const target = path.resolve(domainDir, safeFilename);
  if (!target.startsWith(`${domainDir}${path.sep}`)) {
    throw new Error('Invalid skill path.');
  }

  await fs.unlink(target);

  // Domain folders can hold multiple skills; only remove when no markdown skills remain.
  try {
    const remaining = (await fs.readdir(domainDir)).filter((file) => file.endsWith('.md'));
    if (remaining.length === 0) {
      await fs.rmdir(domainDir);
    }
  } catch {
    // Ignore post-delete cleanup failures.
  }
}
