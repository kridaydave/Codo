#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import App from './ui.js';
import { loadConfig } from './config/config.js';

const cli = meow(
  `
  Usage
    $ codo <task>

  Examples
    $ codo "add a login endpoint"
    $ codo --provider google "create a new component"

  Options
    --provider, -p  Provider to use (anthropic, google, openai)
    --help          Show help
    --version       Show version
`,
  {
    importMeta: import.meta,
    flags: {
      provider: {
        type: 'string',
        shortFlag: 'p',
      },
    },
  },
);

const task = cli.input.join(' ');

// Get default provider from config
const config = await loadConfig();
const provider = (cli.flags.provider || config.provider) as 'anthropic' | 'google' | 'openai';

render(<App task={task} provider={provider} />);
