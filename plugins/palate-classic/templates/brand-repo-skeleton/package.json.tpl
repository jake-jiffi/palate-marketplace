{
  "name": "@palate-projects/{{SLUG}}-brand",
  "version": "1.0.0",
  "description": "Brand-as-code for {{CLIENT_NAME}}",
  "private": true,
  "type": "module",
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "repository": { "type": "git", "url": "https://github.com/palate-projects/{{SLUG}}-brand.git" },
  "exports": {
    "./tokens.css": "./tokens/tokens.css",
    "./fonts.css": "./fonts/fonts.css",
    "./tailwind.preset": "./tokens/tailwind.preset.ts",
    "./tokens.json": "./tokens/tokens.json",
    "./tokens": "./tokens/tokens.ts",
    "./styles/globals.css": "./styles/globals.css",
    "./components/*": "./components/*"
  },
  "files": ["tokens", "fonts", "components", "styles", "logo", "characters", "illustrations", "brand"]
}
