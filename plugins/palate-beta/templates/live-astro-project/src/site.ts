/**
 * The facts every page and the answer-engine summary read from. Keep them true to the business:
 * the layout falls back to this description, the home page's Organization uses this name, and
 * /llms.txt is built from it, so a fact corrected here is corrected everywhere.
 */
export const site = {
  name: 'Website project',
  description: 'The project is ready for design.',
};
