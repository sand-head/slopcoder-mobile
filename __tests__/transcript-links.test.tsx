/**
 * Links in a transcript go somewhere, and say so when they cannot.
 *
 * The bug this holds still: the agent writes the web's own spelling of an
 * artifact, `/artifacts/{id}`, and on the phone the markdown renderer handed
 * that to `Linking.openURL`, which rejected it into nothing. Every form the
 * agent and the cockpit produce must land on the app's own screen, an edition
 * link must land on that edition, and anything that cannot open must tell the
 * reader rather than swallow the tap.
 */
import React from 'react';

/** A script URL, spelled so the linter does not read the test itself as one. */
const SCRIPT_URL = ['java', 'script:alert(1)'].join('');
import { Alert, Linking, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { getStateFromPath } from '@react-navigation/native';
import { linkSegments, resolveLink } from '../src/api/links';
import { artifactRouteId, linking } from '../src/linking';

const mockSeam = { baseUrl: 'https://slop.example.com', apiKey: 'slop_k' };
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));

import { openTarget, useOpenLink } from '../src/ui/links';
import { Prose } from '../src/ui/kit';
import { LinkedText, TranscriptServicesProvider, type TranscriptServices } from '../src/ui/transcriptServices';
import { NavigationContext } from '@react-navigation/native';

const ID = '01a20552-194a-78d0-8c26-eda9326d3644';
const SESSION = '01a204c6-92d6-7b03-ae14-1c8401ff415d';
const BASE = 'https://slop.example.com';

describe('resolveLink', () => {
  it.each([
    [`/artifacts/${ID}`],
    [`artifacts/${ID}`],
    [`/artifacts/${ID}/`],
    [`${BASE}/artifacts/${ID}`],
    [`HTTPS://SLOP.EXAMPLE.COM/artifacts/${ID}`],
    [`slopcoder://artifacts/${ID}`],
    [`/artifacts/${ID.toUpperCase()}#top`],
  ])('opens %s as the artifact', href => {
    expect(resolveLink(href, BASE)).toEqual({ kind: 'artifact', id: ID, version: null });
  });

  it('carries the edition the web spells ?v=N', () => {
    expect(resolveLink(`/artifacts/${ID}?v=2`, BASE)).toEqual({ kind: 'artifact', id: ID, version: 2 });
    expect(resolveLink(`${BASE}/artifacts/${ID}?x=1&v=12`, BASE)).toEqual({ kind: 'artifact', id: ID, version: 12 });
    expect(resolveLink(`/artifacts/${ID}?v=0`, BASE)).toEqual({ kind: 'artifact', id: ID, version: null });
    expect(resolveLink(`/artifacts/${ID}?v=abc`, BASE)).toEqual({ kind: 'artifact', id: ID, version: null });
  });

  it('opens same-host sessions and routines as their screens', () => {
    expect(resolveLink(`/session/${SESSION}`, BASE)).toEqual({ kind: 'session', id: SESSION });
    expect(resolveLink(`${BASE}/routines/${SESSION}`, BASE)).toEqual({ kind: 'routine', id: SESSION });
  });

  it('respects a server that lives under a path', () => {
    expect(resolveLink(`https://host.example/slop/artifacts/${ID}`, 'https://host.example/slop/')).toEqual({
      kind: 'artifact',
      id: ID,
      version: null,
    });
  });

  it('sends another host, even with an artifact-shaped path, to the browser', () => {
    expect(resolveLink(`https://elsewhere.example/artifacts/${ID}`, BASE)).toEqual({
      kind: 'external',
      url: `https://elsewhere.example/artifacts/${ID}`,
    });
    expect(resolveLink('https://example.org/docs', BASE)).toEqual({ kind: 'external', url: 'https://example.org/docs' });
  });

  it('opens other pages of this server in the browser rather than dropping them', () => {
    expect(resolveLink('/settings/memory', BASE)).toEqual({ kind: 'external', url: `${BASE}/settings/memory` });
  });

  it('refuses what it cannot open, instead of guessing', () => {
    expect(resolveLink(SCRIPT_URL, BASE).kind).toBe('unsupported');
    expect(resolveLink('file:///etc/passwd', BASE).kind).toBe('unsupported');
    expect(resolveLink('notes.md', BASE).kind).toBe('unsupported');
    expect(resolveLink('', BASE).kind).toBe('unsupported');
    expect(resolveLink('slopcoder://nowhere', BASE).kind).toBe('unsupported');
  });
});

describe('linkSegments', () => {
  it('finds the publish tool sentence link, keeping its full stop outside', () => {
    const text = `The user can read it at /artifacts/${ID}. It is private.`;
    expect(linkSegments(text)).toEqual([
      { text: 'The user can read it at ', href: null },
      { text: `/artifacts/${ID}`, href: `/artifacts/${ID}` },
      { text: '. It is private.', href: null },
    ]);
  });

  it('finds absolute URLs and edition links', () => {
    const segments = linkSegments(`see ${BASE}/artifacts/${ID}?v=3, or (https://example.org/x).`);
    expect(segments.filter(s => s.href).map(s => s.href)).toEqual([
      `${BASE}/artifacts/${ID}?v=3`,
      'https://example.org/x',
    ]);
  });

  it('leaves a route that is only part of someone else\'s path alone', () => {
    expect(linkSegments(`home/artifacts/${ID}`).every(s => s.href === null)).toBe(true);
  });

  it('is one plain segment when there is nothing to link', () => {
    expect(linkSegments('3 files changed')).toEqual([{ text: '3 files changed', href: null }]);
  });
});

describe('the deep link and route identity', () => {
  it('routes slopcoder://artifacts/{id}?v=N to the artifact with its edition', () => {
    const state = getStateFromPath(`artifacts/${ID}?v=4`, linking.config as never);
    const route = state?.routes.at(-1);
    expect(route?.name).toBe('Artifact');
    expect(route?.params).toEqual({ id: ID, v: '4' });
  });

  it('gives an edition its own screen, and the latest the id alone', () => {
    expect(artifactRouteId({ params: { id: ID } })).toBe(ID);
    expect(artifactRouteId({ params: { id: ID, version: 2 } })).toBe(`${ID}@2`);
    expect(artifactRouteId({ params: { id: ID, v: '2' } })).toBe(`${ID}@2`);
  });
});

describe('openTarget', () => {
  const navigation = { push: jest.fn() };
  beforeEach(() => {
    navigation.push.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('pushes the app screen, so back returns to the transcript', () => {
    openTarget({ kind: 'artifact', id: ID, version: null }, navigation);
    openTarget({ kind: 'artifact', id: ID, version: 3 }, navigation);
    openTarget({ kind: 'session', id: SESSION }, navigation);
    openTarget({ kind: 'routine', id: SESSION }, navigation);
    expect(navigation.push.mock.calls).toEqual([
      ['Artifact', { id: ID }],
      ['Artifact', { id: ID, version: 3 }],
      ['Session', { id: SESSION }],
      ['Routine', { id: SESSION }],
    ]);
  });

  it('says so when the browser cannot open a link', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    openTarget({ kind: 'external', url: 'https://example.org' }, navigation);
    await act(async () => {});
    expect(Alert.alert).toHaveBeenCalledWith('Could not open link', expect.stringContaining('https://example.org'));
  });

  it('says so for a link that is nothing it can open', () => {
    openTarget({ kind: 'unsupported', url: SCRIPT_URL }, navigation);
    expect(Alert.alert).toHaveBeenCalledWith('Could not open link', expect.stringContaining(SCRIPT_URL));
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('refuses aloud rather than throwing when there is no navigator', () => {
    openTarget({ kind: 'artifact', id: ID, version: null }, undefined);
    expect(Alert.alert).toHaveBeenCalled();
  });
});

describe('links as rendered', () => {
  const navigation = { push: jest.fn() };
  const services: TranscriptServices = { useOpenLink, ProseImage: null, ArtifactMedia: null, ImageViewer: null };

  function within(children: React.ReactNode) {
    return (
      <NavigationContext.Provider value={navigation as never}>
        <TranscriptServicesProvider value={services}>{children}</TranscriptServicesProvider>
      </NavigationContext.Provider>
    );
  }

  beforeEach(() => navigation.push.mockReset());

  it('opens an artifact the agent linked in prose', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(within(<Prose>{`The report is [here](/artifacts/${ID}?v=2).`}</Prose>));
    });
    // The renderer's link node: the one text with a press handler.
    const links = tree!.root.findAll(node => typeof node.props.onPress === 'function' && typeof node.type !== 'string');
    const link = links[0];
    expect(link).toBeDefined();
    openURL.mockClear();
    await act(async () => link!.props.onPress());
    expect(navigation.push).toHaveBeenCalledWith('Artifact', { id: ID, version: 2 });
    // And the renderer did not also try the URL itself.
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('makes a link in tool-result text tappable', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(within(<Text><LinkedText text={`Read it at /artifacts/${ID}.`} /></Text>));
    });
    const link = tree!.root.find(node => node.props.accessibilityRole === 'link' && typeof node.type !== 'string');
    expect(link.props.children).toBe(`/artifacts/${ID}`);
    await act(async () => link.props.onPress());
    expect(navigation.push).toHaveBeenCalledWith('Artifact', { id: ID });
  });

  it('leaves plain text plain outside the app root', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<Text><LinkedText text={`at /artifacts/${ID}`} /></Text>);
    });
    expect(tree!.root.findAll(node => node.props.accessibilityRole === 'link')).toHaveLength(0);
  });
});

describe('links in a search result row', () => {
  it('makes the matched line tappable, not just the path', async () => {
    const { buildToolCard } = require('../src/api/toolcard');
    const { ToolCard } = require('../src/ui/ToolCard');
    const navigation = { push: jest.fn(), navigate: jest.fn() };
    const services: TranscriptServices = { useOpenLink, ProseImage: null, ArtifactMedia: null, ImageViewer: null };
    const card = buildToolCard('grep_files', JSON.stringify({ pattern: 'artifacts' }), `fixture/links.txt:1:relative: /artifacts/${ID}`, false);
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        <NavigationContext.Provider value={navigation as never}>
          <TranscriptServicesProvider value={services}>
            <ToolCard card={card} state="ok" forceOpen />
          </TranscriptServicesProvider>
        </NavigationContext.Provider>,
      );
    });
    const link = tree!.root.find(node => node.props.accessibilityRole === 'link' && typeof node.type !== 'string');
    expect(link.props.children).toBe(`/artifacts/${ID}`);
    await act(async () => link.props.onPress());
    expect(navigation.push).toHaveBeenCalledWith('Artifact', { id: ID });
  });
});
