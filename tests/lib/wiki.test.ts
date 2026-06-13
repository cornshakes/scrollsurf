// Mock mediawiki module before importing wiki
jest.mock('../../scripts/lib/mediawiki', () => ({
  create_mediawiki_api: jest.fn(),
}));

import { is_namespaced_link } from '../../scripts/lib/wiki';

describe('is_namespaced_link', () => {
  describe('namespaced links (should return true)', () => {
    it('detects File: namespace', () => {
      expect(is_namespaced_link('File:Foo.jpg')).toBe(true);
    });

    it('detects Image: namespace (alias for File:)', () => {
      expect(is_namespaced_link('Image:X.png')).toBe(true);
    });

    it('detects Category: namespace', () => {
      expect(is_namespaced_link('Category:Bar')).toBe(true);
    });

    it('detects CAT: shorthand for Category:', () => {
      expect(is_namespaced_link('CAT:Articles')).toBe(true);
    });

    it('detects Wikipedia: namespace', () => {
      expect(is_namespaced_link('Wikipedia:Foo')).toBe(true);
    });

    it('detects Project: namespace (alias for Wikipedia:)', () => {
      expect(is_namespaced_link('Project:Guidelines')).toBe(true);
    });

    it('detects WP: shorthand for Wikipedia:', () => {
      expect(is_namespaced_link('WP:Foo')).toBe(true);
    });

    it('detects Talk: namespace', () => {
      expect(is_namespaced_link('Talk:Article')).toBe(true);
    });

    it('detects User: namespace', () => {
      expect(is_namespaced_link('User:Username')).toBe(true);
    });

    it('detects Template: namespace', () => {
      expect(is_namespaced_link('Template:Infobox')).toBe(true);
    });

    it('detects Help: namespace', () => {
      expect(is_namespaced_link('Help:Contents')).toBe(true);
    });

    it('detects Portal: namespace', () => {
      expect(is_namespaced_link('Portal:Science')).toBe(true);
    });

    it('detects Media: namespace', () => {
      expect(is_namespaced_link('Media:Example.wav')).toBe(true);
    });

    it('detects MediaWiki: namespace', () => {
      expect(is_namespaced_link('MediaWiki:Sidebar')).toBe(true);
    });

    it('detects Module: namespace', () => {
      expect(is_namespaced_link('Module:Foo')).toBe(true);
    });

    it('detects Special: namespace', () => {
      expect(is_namespaced_link('Special:Search')).toBe(true);
    });

    it('detects Draft: namespace', () => {
      expect(is_namespaced_link('Draft:Article')).toBe(true);
    });

    it('detects TimedText: namespace', () => {
      expect(is_namespaced_link('TimedText:Video.vtt')).toBe(true);
    });

    it('detects Wikipedia talk: compound namespace', () => {
      expect(is_namespaced_link('Wikipedia talk:X')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(is_namespaced_link('file:foo')).toBe(true);
      expect(is_namespaced_link('FILE:FOO')).toBe(true);
      expect(is_namespaced_link('category:bar')).toBe(true);
      expect(is_namespaced_link('CATEGORY:BAR')).toBe(true);
    });

    it('handles underscores in namespace names', () => {
      expect(is_namespaced_link('Wikipedia_talk:Article')).toBe(true);
    });

    it('allows extra whitespace before colon', () => {
      expect(is_namespaced_link('File  :Foo.jpg')).toBe(true);
      expect(is_namespaced_link('Category_:Bar')).toBe(true);
    });
  });

  describe('mainspace colon titles (should return false)', () => {
    it('allows Batman: Arkham City', () => {
      expect(is_namespaced_link('Batman: Arkham City')).toBe(false);
    });

    it('allows Star Trek: First Contact', () => {
      expect(is_namespaced_link('Star Trek: First Contact')).toBe(false);
    });

    it('allows 9:05', () => {
      expect(is_namespaced_link('9:05')).toBe(false);
    });

    it('allows Halo: Combat Evolved', () => {
      expect(is_namespaced_link('Halo: Combat Evolved')).toBe(false);
    });

    it('allows titles with multiple colons', () => {
      expect(is_namespaced_link('Time: 12:30:45')).toBe(false);
    });

    it('allows titles with colons and spaces', () => {
      expect(is_namespaced_link('Article: Section: Subsection')).toBe(false);
    });

    it('allows empty string to return false', () => {
      expect(is_namespaced_link('')).toBe(false);
    });

    it('does not match namespace prefix without colon', () => {
      expect(is_namespaced_link('File')).toBe(false);
      expect(is_namespaced_link('Category')).toBe(false);
      expect(is_namespaced_link('Wikipedia')).toBe(false);
    });
  });
});
