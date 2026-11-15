import { describe, it, expect } from 'vitest';
import { publicSiteOrigin, resolvePublicSiteOrigin } from './publicOrigin';

const APP = 'capacitor://localhost';

describe('resolvePublicSiteOrigin', () => {
  it('is where the page is, on the website, whatever the build was given', () => {
    expect(resolvePublicSiteOrigin({ native: false, pageOrigin: 'https://borderfall.gg' })).toBe('https://borderfall.gg');
    expect(resolvePublicSiteOrigin({
      native: false,
      pageOrigin: 'https://staging.example.com',
      publicSiteUrl: 'https://borderfall.gg',
      apiUrl: 'https://api.example.com',
    })).toBe('https://staging.example.com');
  });

  it('is the site the app was built against, in the native app', () => {
    expect(resolvePublicSiteOrigin({ native: true, pageOrigin: APP, apiUrl: 'https://borderfall.gg' })).toBe('https://borderfall.gg');
    // A trailing slash or a path on the build variable is not part of the origin.
    expect(resolvePublicSiteOrigin({ native: true, pageOrigin: APP, apiUrl: ' https://borderfall.gg/ ' })).toBe('https://borderfall.gg');
  });

  it('prefers VITE_PUBLIC_SITE_URL when the API is deployed apart from the site', () => {
    expect(resolvePublicSiteOrigin({
      native: true,
      pageOrigin: APP,
      publicSiteUrl: 'https://borderfall.gg',
      apiUrl: 'https://api.borderfall.gg',
    })).toBe('https://borderfall.gg');
  });

  it('skips a value that is not an absolute web address', () => {
    expect(resolvePublicSiteOrigin({ native: true, pageOrigin: APP, publicSiteUrl: '/site', apiUrl: 'https://borderfall.gg' })).toBe('https://borderfall.gg');
    expect(resolvePublicSiteOrigin({ native: true, pageOrigin: APP, publicSiteUrl: 'javascript:alert(1)', apiUrl: '' })).toBe(APP);
    expect(resolvePublicSiteOrigin({ native: true, pageOrigin: APP })).toBe(APP);
  });
});

describe('publicSiteOrigin', () => {
  it('is the page origin in a browser', () => {
    expect(publicSiteOrigin()).toBe(window.location.origin);
  });
});
