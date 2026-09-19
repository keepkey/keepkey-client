/**
 * The transparency contract, enforced.
 *
 * Rule: if an MCP tool touches a web page, that page shows the user it is
 * happening. The overlay used to fire only from showThen() (click/type/select),
 * so every read — snapshot, read_page, console, network, storage, screenshot —
 * ran invisibly. That is the class of bug this file exists to prevent coming
 * back.
 *
 * A new browser tool must land in ANNOUNCE_CAPTIONS or NO_ANNOUNCE. There is no
 * third option and no default, so "I forgot the overlay" fails the build
 * instead of shipping a silent tool.
 */
import { describe, it, expect } from 'vitest';
import { BROWSER_TOOLS, ANNOUNCE_CAPTIONS, NO_ANNOUNCE } from './browserTools';

const toolNames = () => BROWSER_TOOLS.map(t => t.name);

describe('MCP transparency contract', () => {
  it('classifies every browser tool as announced or explicitly exempt', () => {
    const unclassified = toolNames().filter(n => !(n in ANNOUNCE_CAPTIONS) && !(n in NO_ANNOUNCE));
    expect(
      unclassified,
      `Unclassified browser tool(s): ${unclassified.join(', ')}. ` +
        'Every tool must either announce itself in the page (add a caption to ' +
        'ANNOUNCE_CAPTIONS) or state why it need not (add it to NO_ANNOUNCE). ' +
        'If it reads or captures page content, it announces.',
    ).toEqual([]);
  });

  it('never classifies a tool as both', () => {
    const both = toolNames().filter(n => n in ANNOUNCE_CAPTIONS && n in NO_ANNOUNCE);
    expect(both).toEqual([]);
  });

  it('does not classify tools that no longer exist', () => {
    const known = new Set(toolNames());
    const stale = [...Object.keys(ANNOUNCE_CAPTIONS), ...Object.keys(NO_ANNOUNCE)].filter(n => !known.has(n));
    expect(stale, `Stale entries for removed tool(s): ${stale.join(', ')}`).toEqual([]);
  });

  it('announces every tool that reads or captures page content', () => {
    // Pinned by name on purpose. These are the operations a user cannot
    // otherwise perceive, so moving one into NO_ANNOUNCE has to be a deliberate
    // edit to this list with a reviewer looking at it.
    const mustAnnounce = [
      'bex_snapshot',
      'bex_find',
      'bex_read_page',
      'bex_console',
      'bex_network',
      'bex_perf',
      'bex_storage',
      'bex_screenshot',
    ];
    for (const name of mustAnnounce) {
      expect(ANNOUNCE_CAPTIONS[name], `${name} reads page content and must announce`).toBeTruthy();
    }
  });

  it('gives every exemption a stated reason', () => {
    for (const [name, reason] of Object.entries(NO_ANNOUNCE)) {
      expect(reason.length, `${name} is exempt without saying why`).toBeGreaterThan(10);
    }
  });
});
