import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const bands = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/bands' }),
  schema: z.object({
    name: z.string(),
    slug: z.string().optional(),
    role: z.enum(['core', 'sub', 'session', 'video']),
    julianRole: z.string(), // e.g. "Double bass, backing vocals"
    genres: z.array(z.string()), // e.g. ["jazz", "trad"]
    accent: z.enum(['jazz', 'blues', 'folk', 'funk', 'world', 'country', 'swing']).optional(),
    era: z.string(), // e.g. "2017–", "2014", "1992–94", "2008–11"
    yearStart: z.number().optional(),
    yearEnd: z.number().optional(),
    region: z.string().optional(),
    blurb: z.string(), // short one-liner
    members: z.array(z.string()).optional(),
    discography: z.array(z.object({
      title: z.string(),
      year: z.number().optional(),
      type: z.enum(['album', 'ep', 'single', 'live', 'compilation']).optional(),
      notes: z.string().optional(),
      bandcamp: z.string().url().optional(),
      spotify: z.string().url().optional(),
      julianOn: z.boolean().default(true), // false = band's record but Julian wasn't on it
    })).optional(),
    festivals: z.array(z.string()).optional(),
    venues: z.array(z.string()).optional(),
    quote: z.object({
      text: z.string(),
      attribution: z.string().optional(),
    }).optional(),
    links: z.object({
      official: z.string().url().optional(),
      bandcamp: z.string().url().optional(),
      spotify: z.string().url().optional(),
      facebook: z.string().url().optional(),
      instagram: z.string().url().optional(),
      youtube: z.string().url().optional(),
      reverbnation: z.string().url().optional(),
      soundcloud: z.string().url().optional(),
      other: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
    }).optional(),
    embeds: z.object({
      youtube: z.array(z.object({ id: z.string(), title: z.string().optional(), params: z.string().optional() })).optional(),
      bandcamp: z.array(z.object({ html: z.string(), title: z.string().optional() })).optional(),
    }).optional(),
    image: z.string().optional(),         // path or URL
    imagePosition: z.string().optional(), // CSS object-position, e.g. "center 35%"
    featured: z.boolean().default(false),
    active: z.boolean().default(true), // false = band has been inactive for a while
    confirmed: z.boolean().default(true), // false = needs Julian's input
  }),
});

export const collections = { bands };
