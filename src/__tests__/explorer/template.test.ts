import { describe, it, expect } from 'vitest';
import { renderExplorerPage, type RenderExplorerPageOptions } from '../../explorer/template.js';

const defaults: RenderExplorerPageOptions = {
  title: 'Test API',
  theme: 'auto',
  defaultPageSize: 25,
  prefix: '/api',
  authEnabled: false,
};

describe('renderExplorerPage', () => {
  it('returns a string', () => {
    expect(typeof renderExplorerPage(defaults)).toBe('string');
  });

  it('contains the injected title', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('Test API');
  });

  it('contains the injected prefix in JS state', () => {
    const html = renderExplorerPage({ ...defaults, prefix: '/my-api' });
    expect(html).toContain('/my-api');
  });

  it('contains valid HTML structure (html, head, body)', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('contains the sidebar element', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="collections-list"');
  });

  it('contains the detail panel element', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('id="detail-panel"');
    expect(html).toContain('id="detail-content"');
  });

  it('contains the curl bar element', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('id="curl-bar"');
  });

  it('includes prefers-color-scheme media query when theme is "auto"', () => {
    const html = renderExplorerPage({ ...defaults, theme: 'auto' });
    expect(html).toContain('prefers-color-scheme');
  });

  it('does NOT include media query when theme is "light"', () => {
    const html = renderExplorerPage({ ...defaults, theme: 'light' });
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('applies theme-dark class when theme is "dark"', () => {
    const html = renderExplorerPage({ ...defaults, theme: 'dark' });
    expect(html).toContain('theme-dark');
  });

  it('does NOT include theme-dark class when theme is "light"', () => {
    const html = renderExplorerPage({ ...defaults, theme: 'light' });
    expect(html).not.toContain('theme-dark');
  });

  it('includes defaultPageSize in JS', () => {
    const html = renderExplorerPage({ ...defaults, defaultPageSize: 50 });
    expect(html).toContain('pageSize: 50');
  });

  it('includes api-key-input when authEnabled is true', () => {
    const html = renderExplorerPage({ ...defaults, authEnabled: true });
    expect(html).toContain('type="password"');
    expect(html).toContain('id="api-key-input"');
  });

  it('does NOT include api-key-input input element when authEnabled is false', () => {
    const html = renderExplorerPage({ ...defaults, authEnabled: false });
    expect(html).not.toContain('type="password"');
    // The string "api-key-input" may appear in JS event listener code; check no HTML input exists
    expect(html).not.toContain('id="api-key-input"');
  });

  it('links to /docs', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('href="/docs"');
  });

  it('links to GitHub', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('github.com/matthew-gerstman/mongo-autorest');
  });

  it('is under 40KB', () => {
    const html = renderExplorerPage(defaults);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(40 * 1024);
  });

  it('contains the filter bar element', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('id="filter-bar"');
  });

  it('contains pagination bar', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('id="pagination-bar"');
  });

  it('contains filter controls in JS (filter state)', () => {
    const html = renderExplorerPage(defaults);
    expect(html).toContain('filters:');
    expect(html).toContain('add-filter-btn');
  });

  it('escapes title for XSS safety', () => {
    const html = renderExplorerPage({ ...defaults, title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
