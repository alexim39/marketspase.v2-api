import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { brandEmail, paragraphs, BRAND_LOGO_URL } from './emailBrand.js';

describe('brandEmail', () => {
  it('wraps title, body, logo and footer', () => {
    const html = brandEmail({ title: 'Hello', body: '<p>World</p>' });
    assert.match(html, /Hello/);
    assert.match(html, /<p>World<\/p>/);
    assert.ok(html.includes(BRAND_LOGO_URL));
    assert.match(html, /contacts@marketspase\.com/);
  });

  it('escapes the title but trusts the body HTML', () => {
    const html = brandEmail({ title: '<script>x</script>', body: '<b>ok</b>' });
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /<b>ok<\/b>/);
  });

  it('renders the action button only when a URL is given', () => {
    assert.match(
      brandEmail({ title: 'T', body: 'B', actionUrl: 'https://c21fg.online/x' }).toString(),
      /https:\/\/c21fg\.online\/x/,
    );
    assert.doesNotMatch(brandEmail({ title: 'T', body: 'B' }), /Open MarketSpase<\/a>/);
  });
});

describe('paragraphs', () => {
  it('splits blank lines into paragraphs, single breaks into <br>', () => {
    assert.equal(
      paragraphs('Line one\nLine two\n\nLine three'),
      '<p style="margin:0 0 1em;">Line one<br>Line two</p><p style="margin:0 0 1em;">Line three</p>',
    );
  });

  it('escapes HTML and handles empty input', () => {
    assert.match(paragraphs('<script>x</script>'), /&lt;script&gt;/);
    assert.doesNotMatch(paragraphs('<script>x</script>'), /<script>/);
    assert.equal(paragraphs('   '), '');
  });
});

describe('sendEmail transport', () => {
  const keep = { ...process.env };

  beforeEach(async () => {
    const { __resetEmailTransporter } = await import('./emailService.js');
    __resetEmailTransporter();
  });

  it('resolves { sent: false } without throwing when unconfigured', async () => {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    process.env = { ...process.env };
    const { sendEmail, __resetEmailTransporter } = await import('./emailService.js');
    __resetEmailTransporter();
    const res = await sendEmail('a@x.test', 'Hi', '<p>body</p>');
    assert.deepEqual(res.sent, false);
    Object.assign(process.env, keep);
  });

  it('resolves { sent: false } when disabled explicitly', async () => {
    process.env.MAIL_DISABLED = 'true';
    const { sendEmail } = await import('./emailService.js');
    const res = await sendEmail('a@x.test', 'Hi', '<p>body</p>');
    assert.equal(res.sent, false);
    assert.match(res.error ?? '', /disabled/i);
    delete process.env.MAIL_DISABLED;
    Object.assign(process.env, keep);
  });

  it('defaults to port 465 implicit TLS and honors explicit overrides', async () => {
    const { env } = await import('../shared/config/env.js');
    delete process.env.EMAIL_PORT;
    delete process.env.EMAIL_SECURE;
    assert.equal(env.mail.port, 465);
    assert.equal(env.mail.secure, true);
    process.env.EMAIL_PORT = '587';
    process.env.EMAIL_SECURE = 'false';
    assert.equal(env.mail.port, 587);
    assert.equal(env.mail.secure, false);
    process.env.EMAIL_PORT = '465';
    process.env.EMAIL_SECURE = 'true';
    assert.equal(env.mail.port, 465);
    assert.equal(env.mail.secure, true);
    Object.assign(process.env, keep);
  });
});
