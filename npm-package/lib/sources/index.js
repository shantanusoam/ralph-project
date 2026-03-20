const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const userAgent = 'vibepup/1.0';

const decodeHtml = (value) => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const stripHtml = (value) => decodeHtml(
  value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
)
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const sanitizeName = (value) => value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'source';

const isUrl = (value) => /^https?:\/\//i.test(value);

const isGitHubIssueUrl = (value) => /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/i.test(value);

const isGitHubRepoUrl = (value) => /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(value);

const fetchText = async (url, extraHeaders = {}) => {
  const response = await fetch(url, {
    headers: {
      'user-agent': userAgent,
      accept: 'application/json, text/plain, text/html;q=0.9, */*;q=0.8',
      ...extraHeaders,
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  return { body, contentType };
};

const loadPdfText = (sourcePath) => {
  const pdftotext = spawnSync('pdftotext', [sourcePath, '-'], { encoding: 'utf8' });
  if (pdftotext.status === 0 && (pdftotext.stdout || '').trim()) {
    return pdftotext.stdout;
  }

  const strings = spawnSync('strings', [sourcePath], { encoding: 'utf8' });
  if (strings.status === 0 && (strings.stdout || '').trim()) {
    return strings.stdout;
  }

  throw new Error(`Could not extract text from PDF: ${sourcePath}`);
};

const loadLocalSource = async (input) => {
  const resolved = path.resolve(input);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Source path must be a file, not a directory: ${resolved}`);
  }

  const extension = path.extname(resolved).toLowerCase();
  const contents = extension === '.pdf'
    ? loadPdfText(resolved)
    : fs.readFileSync(resolved, 'utf8');

  return {
    kind: extension === '.pdf' ? 'pdf' : 'file',
    title: path.basename(resolved),
    content: [
      `# Local Source: ${path.basename(resolved)}`,
      '',
      `Original path: ${resolved}`,
      '',
      contents.trim(),
      '',
    ].join('\n'),
    suggestedName: sanitizeName(path.basename(resolved, extension || undefined)),
  };
};

const loadGitHubIssue = async (url) => {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  const [, owner, repo, number] = match;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const { body } = await fetchText(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, headers);
  const issue = JSON.parse(body);
  const commentsResponse = await fetchText(issue.comments_url, headers);
  const comments = JSON.parse(commentsResponse.body);

  return {
    kind: 'github-issue',
    title: `${owner}/${repo}#${number} ${issue.title}`,
    suggestedName: sanitizeName(`${owner}-${repo}-issue-${number}`),
    content: [
      `# GitHub Issue: ${owner}/${repo}#${number}`,
      '',
      `Title: ${issue.title}`,
      `State: ${issue.state}`,
      `URL: ${url}`,
      '',
      '## Body',
      '',
      (issue.body || '_No body provided._').trim(),
      '',
      '## Comments',
      '',
      comments.length === 0
        ? '_No comments._'
        : comments.map((comment) => [
          `### ${comment.user?.login || 'unknown'}`,
          '',
          (comment.body || '').trim(),
        ].join('\n')).join('\n\n'),
      '',
    ].join('\n'),
  };
};

const loadGitHubRepo = async (url) => {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  const [, owner, repo] = match;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const { body } = await fetchText(`https://api.github.com/repos/${owner}/${repo}`, headers);
  const repository = JSON.parse(body);
  const readmeResponse = await fetchText(`https://api.github.com/repos/${owner}/${repo}/readme`, headers);
  const readme = JSON.parse(readmeResponse.body);
  const decodedReadme = Buffer.from(readme.content || '', 'base64').toString('utf8');

  return {
    kind: 'github-repo',
    title: `${owner}/${repo}`,
    suggestedName: sanitizeName(`${owner}-${repo}`),
    content: [
      `# GitHub Repository: ${owner}/${repo}`,
      '',
      `Description: ${repository.description || 'n/a'}`,
      `Default branch: ${repository.default_branch || 'n/a'}`,
      `URL: ${url}`,
      '',
      '## README',
      '',
      decodedReadme.trim(),
      '',
    ].join('\n'),
  };
};

const loadRemoteUrl = async (url) => {
  if (isGitHubIssueUrl(url)) return loadGitHubIssue(url);
  if (isGitHubRepoUrl(url)) return loadGitHubRepo(url);

  const { body, contentType } = await fetchText(url);
  const text = /html/i.test(contentType) ? stripHtml(body) : body.trim();
  return {
    kind: 'url',
    title: url,
    suggestedName: sanitizeName(new URL(url).hostname),
    content: [
      `# Remote Source`,
      '',
      `URL: ${url}`,
      '',
      text,
      '',
    ].join('\n'),
  };
};

const resolveSource = async (input) => {
  if (!input) {
    throw new Error('A source is required.');
  }
  if (isUrl(input)) return loadRemoteUrl(input);
  return loadLocalSource(input);
};

const writeSourceToSpecs = async (projectDir, input) => {
  const source = await resolveSource(input);
  const specsDir = path.join(projectDir, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const fileName = `${Date.now()}-${source.suggestedName}.md`;
  const targetPath = path.join(specsDir, fileName);
  const latestPath = path.join(specsDir, 'latest-source.md');
  fs.writeFileSync(targetPath, source.content, 'utf8');
  fs.writeFileSync(latestPath, source.content, 'utf8');
  return {
    ...source,
    path: targetPath,
    latestPath,
  };
};

module.exports = {
  resolveSource,
  writeSourceToSpecs,
};
