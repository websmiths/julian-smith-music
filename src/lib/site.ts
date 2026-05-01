export const site = {
  name: 'Julian Smith',
  tagline: 'Bass and flute, Northern Rivers',
  region: 'Northern Rivers, NSW',
  bio: 'Plays mainly basses and flute, with regular work across funk, folk, blues, jazz, latin and various world influences. Anything with harmony and groove.',
  email: 'julian@websmiths.com.au',
  social: {
    facebook: 'https://www.facebook.com/JulianSmithPlays',
  },
  nav: [
    { label: 'Bands', href: '/bands' },
    { label: 'Recordings', href: '/recordings' },
    { label: 'Live', href: '/live' },
    { label: 'For hire', href: '/for-hire' },
    { label: 'About', href: '/about' },
  ],
  roleLabels: {
    core: 'Core member',
    sub: 'Sub / stand-in',
    session: 'Studio session',
    video: 'Video / rehearsal',
  } as const,
  genreLabels: {
    jazz: 'Jazz',
    blues: 'Blues',
    folk: 'Folk',
    funk: 'Funk',
    'trad-jazz': 'Trad jazz',
    bluegrass: 'Bluegrass',
    'old-time': 'Old-time',
    skiffle: 'Skiffle',
    swing: 'Gypsy swing',
    country: 'Country',
    'cosmic-country': 'Cosmic country',
    americana: 'Americana',
    world: 'World',
    afrobeat: 'Afrobeat',
    hawaiian: 'Hawaiian',
    cajun: 'Cajun / zydeco',
    latin: 'Latin',
    rock: 'Rock',
    pop: 'Pop',
  } as const,
};

export type RoleKey = keyof typeof site.roleLabels;
export type GenreKey = keyof typeof site.genreLabels;
