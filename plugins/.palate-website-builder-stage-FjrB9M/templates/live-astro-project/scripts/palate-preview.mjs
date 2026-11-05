#!/usr/bin/env node
import { runPreview } from '../palate-preview/server.mjs';
await runPreview(process.argv.slice(2));
