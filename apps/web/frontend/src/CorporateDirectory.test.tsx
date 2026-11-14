import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CorporateDirectory } from './CorporateDirectory';
import { corporateLinks } from './corporate-links';

it('opens every corporate service in a separate tab', () => {
  const html = renderToStaticMarkup(<CorporateDirectory />);
  const links = html.match(/<a\b[^>]*>/g) ?? [];
  expect(links).toHaveLength(corporateLinks.length);
  corporateLinks.forEach((service, index) => {
    expect(links[index]).toContain(`href="${service.url}"`);
    expect(links[index]).toContain('target="_blank"');
    expect(links[index]).toContain('rel="noopener noreferrer"');
  });
});
