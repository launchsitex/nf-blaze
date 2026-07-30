import type { ToolDefinition } from './types'

/** Shared JSON Schema fragment for a relative file/dir path */
const pathProp = {
  type: 'string',
  description: 'Relative path from the project root (no .. or absolute paths)'
} as const

/**
 * All agent tools in plain JSON Schema.
 * `/providers` adapters translate these to vendor-specific tool formats.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a text file in the project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: pathProp,
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Optional 0-based line offset to start reading from'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Optional max number of lines to return'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_dir',
    description: 'List files and directories under a relative path.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          ...pathProp,
          description: 'Directory relative to project root (use "." for root)'
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list nested entries (default false)'
        },
        maxEntries: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
          description: 'Cap on number of returned entries (default 500)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'grep',
    description: 'Search file contents for a regex or literal pattern.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (JavaScript RegExp source, or literal if literal=true)'
        },
        path: {
          type: 'string',
          description: 'Relative file or directory to search (default ".")'
        },
        literal: {
          type: 'boolean',
          description: 'Treat pattern as literal string instead of regex (default false)'
        },
        caseInsensitive: {
          type: 'boolean',
          description: 'Case-insensitive match (default false)'
        },
        maxMatches: {
          type: 'integer',
          minimum: 1,
          maximum: 2000,
          description: 'Maximum matches to return (default 100)'
        },
        glob: {
          type: 'string',
          description: 'Optional simple extension filter, e.g. "*.ts" or "*.tsx"'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'declare_scope',
    description:
      'Declare the list of files you intend to edit/write in this request. MUST be called before the first edit_file or write_file. To touch additional files later, call again with those files and a non-empty reason (scope expansion).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Relative paths you intend to create or modify'
        },
        reason: {
          type: 'string',
          description:
            'Required when expanding scope after the first declaration — shown to the user'
        }
      },
      required: ['files']
    }
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact unique substring in a file. File must be in declared scope and must have been read_file in this session. Fails if old_string is missing or appears more than once.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: pathProp,
        old_string: {
          type: 'string',
          description: 'Exact text to find — must appear exactly once in the file'
        },
        new_string: {
          type: 'string',
          description: 'Replacement text'
        }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file with the given content. Creates parent directories. File must be in the declared scope (declare_scope first).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: pathProp,
        content: {
          type: 'string',
          description: 'Full file contents to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description:
      'Run an allowlisted project command: npm install (optionally with package names, e.g. "npm install dayjs @radix-ui/react-accordion"), npm ci, or npm run <script>. Cwd is the project root.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: {
          type: 'string',
          description: 'Allowlisted command string, e.g. "npm install" or "npm run build"'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'update_plan',
    description:
      'Create or update the persistent multi-stage build plan (survives between chat turns). Call when starting a large task (break it into stages) and after finishing each stage (mark done / in_progress). Always send the FULL stage list.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: {
          type: 'string',
          description: 'One-line description of what is being built overall'
        },
        stages: {
          type: 'array',
          description: 'Full ordered stage list (replaces the previous plan)',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', description: 'Short stage title' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done'],
                description: 'Stage status (default pending)'
              },
              notes: {
                type: 'string',
                description: 'Optional: key decisions or leftovers for this stage'
              }
            },
            required: ['title']
          }
        }
      },
      required: ['goal', 'stages']
    }
  },
  {
    name: 'web_search',
    description:
      'Search the web (DuckDuckGo). Use when the user asks to research online — design trends, content examples, library docs, best practices. Returns titles, URLs and snippets; follow up with web_fetch to read a full page. English queries usually return better results.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (English recommended for better coverage)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a web page by URL and return its readable text content. Use after web_search to read promising results, or directly when the user gives a URL.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'Full http/https URL to fetch'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'save_memory',
    description:
      'Save the persistent project memory (architecture decisions, data schemas, conventions, connected services). Replaces the whole memory — send the full updated text. Keep it short and factual; it is injected into every future request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: {
          type: 'string',
          description: 'Full updated memory in Markdown (max 6000 chars)'
        }
      },
      required: ['content']
    }
  }
]

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name)
}
