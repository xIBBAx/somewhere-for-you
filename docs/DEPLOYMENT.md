# Putting your world online

`npm run build` produces `dist/`: plain static files. Any static host serves
them: GitHub Pages, Netlify, Cloudflare Pages, Vercel, an S3 bucket, or your
own server. There is no backend to run.

```bash
npm ci
npm run build          # dist/ — about 110 MB, most of it models and textures
npm run preview        # check it at http://localhost:4173 before uploading
```

## Before you publish a personalized world

- Everything you referenced in `customize/` is inside `dist/`. Anyone with the
  link can download the photos and words. Use a private or unlisted address,
  or your host's password protection, if that matters to you.
- Check the copy in a private window: that is what the person will see on
  first visit.
- The world works at the site root (`https://example.com/`). To serve it from
  a sub-path, set Vite's [`base`](https://vite.dev/config/shared-options.html#base)
  in `vite.config.ts` and test with `npm run preview`.

## Recommended headers

Send these with every response. They are the same ones `npm run preview`
uses (the policy is in `tools/vite/securityHeaders.ts`, the other headers in
`vite.config.ts`), so you can test exactly what you deploy:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: data: https://api.open-meteo.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=()
```

If live weather is off in your world, you can remove
`https://api.open-meteo.com` from `connect-src` and use `geolocation=()`.

Files in `assets/` have content hashes in their names and can be cached for a
long time (`Cache-Control: public, max-age=31536000, immutable`); keep
`index.html` uncached.

### Netlify

`public/_headers` is copied into `dist/` if you create it:

```
/*
  Content-Security-Policy: (the policy above)
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

Cloudflare Pages reads the same `_headers` format.

### GitHub Pages

GitHub Pages cannot send custom headers. The game works there; the policy
above simply isn't enforced. Build with the right `base` for
`https://<user>.github.io/<repo>/`.

## Hosting limits

`dist/` is about 110 MB, with the largest single file under 5 MB, so it fits
the free tiers of the hosts above. Hosts with a per-file limit around 25 MB
are fine.
