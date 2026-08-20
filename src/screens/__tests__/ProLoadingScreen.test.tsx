import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import type { ReactTestRendererJSON, ReactTestRendererNode } from 'react-test-renderer';
import { ProLoadingScreen } from '../ProLoadingScreen';

type TreeNode = ReactTestRendererJSON | ReactTestRendererJSON[] | ReactTestRendererNode[] | string | null;

/** Depth-first search over the rendered host-node tree for the first node
 * whose text content includes `text`, returning it and every ancestor
 * (closest first) — lets a test inspect an ancestor's style without
 * hand-maintaining the tree shape. */
function findWithAncestors(
  node: TreeNode,
  text: string,
  ancestors: ReactTestRendererJSON[] = [],
): ReactTestRendererJSON[] | null {
  if (node == null) return null;
  if (typeof node === 'string') return node.includes(text) ? ancestors : null;
  if (Array.isArray(node)) {
    for (const child of node as TreeNode[]) {
      const found = findWithAncestors(child, text, ancestors);
      if (found) return found;
    }
    return null;
  }
  return findWithAncestors(node.children as TreeNode, text, [node, ...ancestors]);
}

describe('ProLoadingScreen', () => {
  it('renders the branded background with a labeled progress indicator', async () => {
    const { getByLabelText } = await render(<ProLoadingScreen />);
    expect(getByLabelText('Loading SetSocial Pro')).toBeTruthy();
  });

  it('accepts a custom label for the progress indicator', async () => {
    const { getByLabelText } = await render(<ProLoadingScreen label="Checking your session" />);
    expect(getByLabelText('Checking your session')).toBeTruthy();
  });

  // Regression guard for the logo-shift bug: the PRO wordmark must stay
  // taken out of the flow that determines the mark's centering (see the
  // comment above it in ProLoadingScreen.tsx) — if it's ever put back as a
  // normal flex sibling of the mark, this screen's centered group becomes
  // taller than LoadingScreen's again, and the mark visibly jumps the
  // instant RootNavigator swaps LoadingScreen for this screen.
  it('keeps the PRO wordmark out of the flow that centers the logo mark', async () => {
    const { toJSON, getByTestId } = await render(<ProLoadingScreen />);

    // The wordmark's own position comes from a real onLayout measurement of
    // the mark (see ProLoadingScreen.tsx) — react-test-renderer never fires
    // layout events on its own, so it has to be simulated here for the
    // wordmark to render at all.
    await fireEvent(getByTestId('pro-loading-mark'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 100, width: 50, height: 50 } },
    });

    const ancestors = findWithAncestors(toJSON(), 'PRO');
    expect(ancestors).not.toBeNull();

    const styles = (ancestors ?? []).map(n => (Array.isArray(n.props.style) ? Object.assign({}, ...n.props.style) : n.props.style));
    const hasAbsoluteAncestor = styles.some(s => s?.position === 'absolute');
    expect(hasAbsoluteAncestor).toBe(true);
  });

  // Regression guard for the *glow* shift this same fix caused once already:
  // the glow (position: absolute, no explicit offsets) inherits its
  // position from whichever parent's alignItems/justifyContent it's nested
  // under. It must stay a direct sibling of the mark under the same
  // centered container LoadingScreen uses — wrapping glow+mark in their own
  // extra View (even one that looks harmless) changes that inherited
  // parent and visibly shifts the glow out from behind the mark.
  it('keeps the glow a direct sibling of the mark (not nested in an extra wrapper)', async () => {
    const { getByTestId } = await render(<ProLoadingScreen />);
    const glow = getByTestId('pro-loading-glow');
    const mark = getByTestId('pro-loading-mark');
    expect(glow.parent).toBe(mark.parent);
  });
});
