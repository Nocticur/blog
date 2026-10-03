import matter from 'gray-matter';

// Content is data: gray-matter's built-in JavaScript aliases must never run.
export default function safeMatter(source) {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  const header = /^\uFEFF?---([^\r\n]*)/.exec(text);
  const language = header?.[1].trim().toLowerCase() || 'yaml';
  if (!['yaml', 'yml', 'json'].includes(language)) throw new Error('Frontmatter 仅支持 YAML 或 JSON');
  return matter(text, { language: language === 'yml' ? 'yaml' : language, engines: {
    js: () => { throw new Error('JavaScript Frontmatter is disabled'); },
    javascript: () => { throw new Error('JavaScript Frontmatter is disabled'); },
  } });
}

safeMatter.stringify = (content, data) => matter.stringify(content, data, { language: 'yaml' });
