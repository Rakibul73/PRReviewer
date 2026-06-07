export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  newLineNumber?: number;
  oldLineNumber?: number;
}

export interface DiffHunkSection {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffHunk {
  filename: string;
  extension: string;
  language: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldFilename?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunkSection[];
  patch: string;
  truncated?: boolean;
}

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rb: 'Ruby',
  java: 'Java',
  cs: 'C#',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  c: 'C',
  h: 'C/C++ Header',
  hpp: 'C++ Header',
  rs: 'Rust',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  r: 'R',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  ps1: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  md: 'Markdown',
  mdx: 'MDX',
  tf: 'Terraform',
  hcl: 'HCL',
  dart: 'Dart',
  lua: 'Lua',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  hrl: 'Erlang',
  clj: 'Clojure',
  cljs: 'ClojureScript',
  hs: 'Haskell',
  fs: 'F#',
  fsx: 'F#',
  vue: 'Vue',
  svelte: 'Svelte',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  proto: 'Protobuf',
};

function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

function getLanguage(extension: string): string {
  return EXTENSION_TO_LANGUAGE[extension] ?? (extension.toUpperCase() || 'Unknown');
}

const HUNK_HEADER_REGEX = /^@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/;

function parseHunkSection(lines: string[]): DiffHunkSection[] {
  const hunks: DiffHunkSection[] = [];
  let currentHunk: DiffHunkSection | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkMatch = HUNK_HEADER_REGEX.exec(line);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[3], 10);
      currentHunk = {
        header: line.split('\n')[0],
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        content: line.slice(1),
        newLineNumber: newLine,
      });
      newLine++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNumber: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : '',
        newLineNumber: newLine,
        oldLineNumber: oldLine,
      });
      oldLine++;
      newLine++;
    }
    // lines starting with \ (e.g. "\ No newline at end of file") are skipped
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

export function parseDiff(rawDiff: string): DiffHunk[] {
  if (!rawDiff || rawDiff.trim() === '') {
    return [];
  }

  // Split on "diff --git" to get per-file sections
  const fileSections = rawDiff.split(/^diff --git /m).filter((s) => s.trim() !== '');

  const result: DiffHunk[] = [];

  for (const section of fileSections) {
    const lines = section.split('\n');
    if (lines.length === 0) continue;

    // Skip binary files
    if (section.includes('Binary files')) continue;

    // Parse the file paths from "a/path b/path" on the first line
    const firstLine = lines[0];
    const filePathMatch = /^a\/(.+?) b\/(.+)$/.exec(firstLine);
    if (!filePathMatch) continue;

    const aPath = filePathMatch[1];
    const bPath = filePathMatch[2];

    // Determine status
    let status: DiffHunk['status'] = 'modified';
    let filename = bPath;
    let oldFilename: string | undefined;

    const newFileMatch = lines.find((l) => l.startsWith('new file mode'));
    const deletedFileMatch = lines.find((l) => l.startsWith('deleted file mode'));
    const renameFromMatch = lines.find((l) => l.startsWith('rename from '));
    const renameToMatch = lines.find((l) => l.startsWith('rename to '));

    if (newFileMatch) {
      status = 'added';
    } else if (deletedFileMatch) {
      status = 'deleted';
      filename = aPath;
    } else if (renameFromMatch && renameToMatch) {
      status = 'renamed';
      oldFilename = renameFromMatch.replace('rename from ', '').trim();
      filename = renameToMatch.replace('rename to ', '').trim();
    }

    const extension = getExtension(filename);
    const language = getLanguage(extension);

    // Extract the patch (everything from the first @@ onward)
    const patchStartIdx = lines.findIndex((l) => l.startsWith('@@'));
    const patchLines = patchStartIdx >= 0 ? lines.slice(patchStartIdx) : [];
    const patch = patchLines.join('\n');

    // Parse hunk sections
    const hunks = parseHunkSection(patchLines);

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') additions++;
        else if (line.type === 'removed') deletions++;
      }
    }

    const diffHunk: DiffHunk = {
      filename,
      extension,
      language,
      status,
      additions,
      deletions,
      hunks,
      patch,
    };

    if (oldFilename) {
      diffHunk.oldFilename = oldFilename;
    }

    if (additions > 500) {
      diffHunk.truncated = true;
    }

    result.push(diffHunk);
  }

  return result;
}
