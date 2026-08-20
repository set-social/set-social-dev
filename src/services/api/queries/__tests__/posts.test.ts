import { buildPostPhotoPath } from '../posts';

describe('buildPostPhotoPath', () => {
  it('encodes the visibility directly in the path for "friends"', () => {
    const path = buildPostPhotoPath('user-1', 'friends', 'jpg');
    expect(path).toMatch(/^user-1\/friends\/[^/]+\.jpg$/);
  });

  it('encodes the visibility directly in the path for "private"', () => {
    const path = buildPostPhotoPath('user-1', 'private', 'png');
    expect(path).toMatch(/^user-1\/private\/[^/]+\.png$/);
  });

  it('produces a different filename on each call, so re-uploads never collide', () => {
    const first = buildPostPhotoPath('user-1', 'friends', 'jpg');
    const second = buildPostPhotoPath('user-1', 'friends', 'jpg');
    expect(first).not.toBe(second);
  });
});
