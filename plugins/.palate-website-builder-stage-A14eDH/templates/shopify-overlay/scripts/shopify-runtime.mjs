import vercel from '@astrojs/vercel';

export default function shopifyRuntime() {
  return vercel({ maxDuration: 30 });
}
