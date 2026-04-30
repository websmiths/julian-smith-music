# julian-smith-music

A music portfolio site for Julian Smith — bassist, flautist, multi-instrumentalist of the Northern Rivers, NSW.

Built with [Astro](https://astro.build) + Tailwind CSS, deployed to GitHub Pages.

## Local development

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # produce static site in ./dist
npm run preview  # serve the built site locally
```

## Adding or editing a band

Each band is a markdown file in `src/content/bands/`. The schema is defined in `src/content.config.ts`. To add a band:

1. Create `src/content/bands/<slug>.md`
2. Fill in the frontmatter — `name`, `role`, `genres`, `era`, `julianRole`, `blurb` are required; `members`, `discography`, `festivals`, `venues`, `quote`, `links` and `embeds` are optional
3. Write any longer prose in the markdown body (it appears in the main column on the band page)
4. `npm run build` to verify the schema

Set `featured: true` to surface a band on the home page.
Set `confirmed: false` if you're still gathering information — the page renders a "details pending" note.

## Deployment

Push to `main` and the GitHub Action in `.github/workflows/deploy.yml` builds and deploys to GitHub Pages. The site is configured for the path `/julian-smith-music` (i.e. `https://websmiths.github.io/julian-smith-music`); change `site` and `base` in `astro.config.mjs` if you move it to a custom domain.

## Notes

The `notes/research-dossier.md` file is the original research compiled when building the site. It contains URL-by-URL findings, gaps and uncertainties — useful as a working document when filling in the bands that didn't have an online footprint at the time of build. It's `.gitignore`d by default; remove the entry if you want to publish it.
