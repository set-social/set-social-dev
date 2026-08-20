import { resolveFriendRequestState, normalizedSearchTerm, type FriendRelationships } from '../community';

function relationships(overrides: Partial<FriendRelationships> = {}): FriendRelationships {
  return {
    friendIds: new Set(),
    outgoingByAddressee: new Map(),
    incomingByRequester: new Map(),
    ...overrides,
  };
}

describe('resolveFriendRequestState', () => {
  it('returns "none" with no requestId when there is no relationship at all', () => {
    const result = resolveFriendRequestState(relationships(), 'user-2');
    expect(result).toEqual({ state: 'none', requestId: null });
  });

  it('returns "none" when relationships have not loaded yet', () => {
    const result = resolveFriendRequestState(undefined, 'user-2');
    expect(result).toEqual({ state: 'none', requestId: null });
  });

  it('returns "friends" when the other user is in friendIds', () => {
    const result = resolveFriendRequestState(relationships({ friendIds: new Set(['user-2']) }), 'user-2');
    expect(result).toEqual({ state: 'friends', requestId: null });
  });

  it('returns "outgoing" with the request id when we sent a still-pending request', () => {
    const result = resolveFriendRequestState(
      relationships({ outgoingByAddressee: new Map([['user-2', 'req-1']]) }),
      'user-2',
    );
    expect(result).toEqual({ state: 'outgoing', requestId: 'req-1' });
  });

  it('returns "incoming" with the request id when the other user sent us a pending request', () => {
    const result = resolveFriendRequestState(
      relationships({ incomingByRequester: new Map([['user-2', 'req-2']]) }),
      'user-2',
    );
    expect(result).toEqual({ state: 'incoming', requestId: 'req-2' });
  });

  it('prioritizes an existing friendship over any stale pending-request maps for the same id', () => {
    const result = resolveFriendRequestState(
      relationships({
        friendIds: new Set(['user-2']),
        outgoingByAddressee: new Map([['user-2', 'req-1']]),
      }),
      'user-2',
    );
    expect(result.state).toBe('friends');
  });
});

describe('normalizedSearchTerm', () => {
  it('trims whitespace', () => {
    expect(normalizedSearchTerm('  jordan  ')).toBe('jordan');
  });

  it('strips a leading "@" so it does not count toward search length', () => {
    expect(normalizedSearchTerm('@jordan')).toBe('jordan');
  });

  it('strips ilike wildcards and or-filter syntax characters', () => {
    expect(normalizedSearchTerm('jo%rd_an,(x)')).toBe('jordanx');
  });
});
