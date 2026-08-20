import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from './Icon';

type AvatarProps = {
  uri?: string | null;
  size?: number;
  /** Normalized 0-1 fraction of the source photo's own bounding box the crop
   * centers on — same convention as CSS `object-position` (0.5, 0.5 is a
   * plain center crop, the only behavior this component had before). */
  focalX?: number;
  focalY?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
};

// Keyed by uri so every Avatar rendering the same photo at a dozen different
// sizes across the app (feed cards, DMs, the profile header, ...) triggers
// exactly one native Image.getSize call for it, not one per instance.
const naturalSizeCache = new Map<string, { width: number; height: number }>();

function useNaturalSize(uri: string | null | undefined) {
  const [natural, setNatural] = useState(() => (uri ? (naturalSizeCache.get(uri) ?? null) : null));

  useEffect(() => {
    if (!uri) {
      setNatural(null);
      return;
    }
    const cached = naturalSizeCache.get(uri);
    if (cached) {
      setNatural(cached);
      return;
    }
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled) return;
        const dims = { width, height };
        naturalSizeCache.set(uri, dims);
        setNatural(dims);
      },
      // Swallow — an off-center focal point just falls back to a plain
      // centered cover crop below until/unless this ever resolves.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return natural;
}

/** Circular avatar — clips the photo to a perfect circle via a matched-size
 * `overflow: hidden` container instead of relying on the image's own corner
 * radius, so it never bleeds past the edge. Falls back to a centered user
 * glyph (sized well under the container, not edge-to-edge) when there's no photo yet. */
export function Avatar({ uri, size = 40, focalX = 0.5, focalY = 0.5, onPress, accessibilityLabel }: AvatarProps) {
  const theme = useTheme();
  const Wrapper = onPress ? Pressable : View;

  // A centered focal point (the default, and the only value most photos
  // ever have) needs none of the natural-size math below — it's exactly the
  // plain `resizeMode="cover"` this component always used. Only an
  // off-center focal point needs the source image's aspect ratio to know
  // how far a "cover" fit overflows the frame on each axis.
  const isCentered = focalX === 0.5 && focalY === 0.5;
  const natural = useNaturalSize(isCentered ? null : uri);

  let imageWidth = size;
  let imageHeight = size;
  let translateX = 0;
  let translateY = 0;
  if (!isCentered && natural && natural.width > 0 && natural.height > 0) {
    const scale = Math.max(size / natural.width, size / natural.height);
    imageWidth = natural.width * scale;
    imageHeight = natural.height * scale;
    // Matches CSS object-position semantics: focal 0 shows the image's
    // left/top edge, 1 shows its right/bottom edge, 0.5 is centered (the
    // same placement the plain size x size box above already produces).
    // `|| 0` only exists to turn a -0 result (no overflow on that axis) into
    // a plain 0 — cosmetic, but keeps snapshot/equality comparisons sane.
    const overflowX = imageWidth - size;
    const overflowY = imageHeight - size;
    translateX = -overflowX * focalX || 0;
    translateY = -overflowY * focalY || 0;
  }

  return (
    <Wrapper
      onPress={onPress}
      hitSlop={onPress ? 8 : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        flexShrink: 0,
        flexGrow: 0,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: theme.colors.bg.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri ? (
        <Image
          testID="avatar-image"
          source={{ uri }}
          style={{
            width: imageWidth,
            height: imageHeight,
            transform: [{ translateX }, { translateY }],
          }}
          resizeMode="cover"
        />
      ) : (
        <Icon name="user" size={Math.round(size * 0.5)} color={theme.colors.text.secondary} />
      )}
    </Wrapper>
  );
}
