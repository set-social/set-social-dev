import React from 'react';
import { Image } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { Avatar } from '../Avatar';

describe('Avatar', () => {
  it('falls back to a user glyph icon when there is no photo', async () => {
    const { queryByTestId } = await render(<Avatar uri={null} size={40} />);
    expect(queryByTestId('avatar-image')).toBeNull();
  });

  it('renders a plain centered image at size x size with no translate, without measuring the source photo', async () => {
    const getSizeSpy = jest.spyOn(Image, 'getSize');
    const { getByTestId } = await render(<Avatar uri="https://example.com/photo.jpg" size={56} />);

    const image = getByTestId('avatar-image');
    expect(image.props.style).toMatchObject({ width: 56, height: 56, transform: [{ translateX: 0 }, { translateY: 0 }] });
    // The default (centered) focal point is exactly the old, pre-focal-point
    // behavior — no need to know the photo's own dimensions for it.
    expect(getSizeSpy).not.toHaveBeenCalled();
    getSizeSpy.mockRestore();
  });

  it('shifts a wide photo toward its left edge for a focal point of (0, 0.5)', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success(200, 100);
    });

    const { getByTestId } = await render(<Avatar uri="https://example.com/wide.jpg" size={50} focalX={0} focalY={0.5} />);

    // scale = max(50/200, 50/100) = 0.5 -> rendered at 100x50; overflow is
    // 50px wide, 0px tall. focalX=0 pins the image's left edge to the
    // frame's left edge (translateX 0); focalY=0.5 is still centered
    // vertically (no vertical overflow to speak of here).
    await waitFor(() => {
      expect(getByTestId('avatar-image').props.style).toMatchObject({
        width: 100,
        height: 50,
        transform: [{ translateX: 0 }, { translateY: 0 }],
      });
    });

    (Image.getSize as jest.Mock).mockRestore();
  });

  it('shifts a wide photo toward its right edge for a focal point of (1, 0.5)', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success(200, 100);
    });

    const { getByTestId } = await render(
      <Avatar uri="https://example.com/wide-right.jpg" size={50} focalX={1} focalY={0.5} />,
    );

    await waitFor(() => {
      expect(getByTestId('avatar-image').props.style).toMatchObject({
        width: 100,
        height: 50,
        transform: [{ translateX: -50 }, { translateY: 0 }],
      });
    });

    (Image.getSize as jest.Mock).mockRestore();
  });
});
