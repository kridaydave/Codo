import { readdir, readFile, stat } from 'fs/promises';
import { resolve, join, relative } from 'path';

const MAX_REGEX_LENGTH = 500;
const MAX_REGEX_GROUPS = 10;

const DANGEROUS_PATTERNS = [
  /\(\.\*\)\+/,
  /\(\.\+\)\+/,
  /\(\.\*\)\*/,
  /\(\.\+\)\*/,
  /\(\w\+\)\+/,
  /\(\d\+\)\+/,
  /\(\s\+\)\+/,
  /\[\^\]\+\+/,
  /\(\.\?\)\+/,
  /\(\?\:\?\w*\)\+/,
  /\(\?\=\.\*\)/,
  /\(\?\!\.\*\)/,
  /\(\?\<\=.*\)\+/,
  /\(\?\<\!.*\)\+/,
];

function isRegexSafe(pattern: string): { safe: boolean; error?: string } {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return {
      safe: false,
      error: `Regex pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
    };
  }

  const groupCount = (pattern.match(/\(/g) || []).length;
  if (groupCount > MAX_REGEX_GROUPS) {
    return {
      safe: false,
      error: `Regex pattern contains too many groups (max: ${MAX_REGEX_GROUPS})`,
    };
  }

  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    if (dangerousPattern.test(pattern)) {
      return {
        safe: false,
        error: 'Regex pattern contains potentially dangerous constructs (nested quantifiers)',
      };
    }
  }

  const nestedQuantifier = /\([^)]*[+*][^)]*\)[+*]/;
  if (nestedQuantifier.test(pattern)) {
    return {
      safe: false,
      error: 'Regex pattern contains nested quantifiers which can cause catastrophic backtracking',
    };
  }

  return { safe: true };
}

export const searchInFileTool = {
  name: 'search_in_file',
  description: 'Search for a text pattern in files within a directory',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The text or regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The directory path to search in (default: current directory)',
      },
      regex: {
        type: 'boolean',
        description: 'Whether to treat the pattern as a regex (default: false)',
      },
    },
    required: ['pattern'],
  },
};

async function searchInDir(
  dirPath: string,
  pattern: string,
  isRegex: boolean,
  results: string[],
  basePath: string,
): Promise<void> {
  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      // Skip ignored directories
      if (
        entry === 'node_modules' ||
        entry === '.git' ||
        entry === 'dist' ||
        entry.startsWith('.')
      ) {
        continue;
      }

      const fullPath = join(dirPath, entry);

      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          await searchInDir(fullPath, pattern, isRegex, results, basePath);
        } else if (stats.isFile()) {
          const content = await readFile(fullPath, 'utf-8');
          const relativePath = relative(basePath, fullPath);

          let match = false;
          if (isRegex) {
            const regex = new RegExp(pattern, 'gi');
            match = regex.test(content);
          } else {
            match = content.toLowerCase().includes(pattern.toLowerCase());
          }

          if (match) {
            results.push(relativePath);
          }
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

export async function searchInFileExecute(input: {
  pattern: string;
  path?: string;
  regex?: boolean;
}): Promise<string> {
  try {
    const isRegex = input.regex || false;

    if (isRegex) {
      const validation = isRegexSafe(input.pattern);
      if (!validation.safe) {
        return `Error: ${validation.error}`;
      }
    }

    const sandboxDir = process.env.AGENT_WORKTREE_PATH || process.cwd();
    const basePath = process.env.AGENT_OPERATING_DIR || sandboxDir;

    const searchPath = input.path ? resolve(basePath, input.path) : basePath;

    const results: string[] = [];
    await searchInDir(searchPath, input.pattern, isRegex, results, basePath);

    if (results.length === 0) {
      return 'No matches found';
    }

    return `Found matches in:\n${results.join('\n')}`;
  } catch (error) {
    return `Error searching files: ${error}`;
  }
}
